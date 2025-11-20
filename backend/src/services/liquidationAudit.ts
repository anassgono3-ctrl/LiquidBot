/**
 * Liquidation Audit Module
 * 
 * Monitors on-chain LiquidationCall events and audits whether the liquidated user
 * was in the current watch set. Classifies missed liquidations and sends notifications.
 */

import { ethers } from 'ethers';

import type { DecodedEvent } from '../abi/aaveV3PoolEvents.js';
import { config } from '../config/index.js';
import {
  liquidationAuditTotal,
  liquidationAuditReasonNotInWatchSet,
  liquidationAuditReasonRaced,
  liquidationAuditErrors,
  watchMissCount,
  auditUsdScalingSuspectTotal
} from '../metrics/index.js';
import { detectSuspiciousScaling } from '../utils/CanonicalUsdMath.js';

import { NotificationService } from './NotificationService.js';
import { PriceService } from './PriceService.js';
import { AaveOracleHelper } from './AaveOracleHelper.js';
import { DecisionTraceStore } from './DecisionTraceStore.js';
import { DecisionClassifier, type ClassifiedReason } from './DecisionClassifier.js';
import { MissRowLogger } from './MissRowLogger.js';

/**
 * Audit reason classification (legacy)
 */
export type AuditReason = 'not_in_watch_set' | 'raced';

/**
 * Liquidation audit result
 */
export interface LiquidationAuditResult {
  user: string;
  debtAsset: string;
  collateralAsset: string;
  debtToCover: bigint;
  liquidatedCollateralAmount: bigint;
  blockNumber: number;
  transactionHash: string;
  liquidator: string;
  receiveAToken: boolean;
  reason: AuditReason; // Legacy field
  classifiedReason?: ClassifiedReason; // New classifier
  infoMinDebt?: boolean;
  debtUsd: number | null;
  collateralUsd: number | null;
  candidatesTotal: number;
  notes?: string[]; // Classification notes
}

/**
 * Rate limiter for sampling audit notifications
 */
class RateLimiter {
  private count = 0;
  private windowStart = Date.now();
  private readonly limit: number;
  private readonly windowMs = 60000; // 1 minute window

  constructor(limit: number) {
    this.limit = limit;
  }

  canSend(): boolean {
    // 0 means unlimited
    if (this.limit === 0) return true;

    const now = Date.now();
    // Reset window if expired
    if (now - this.windowStart >= this.windowMs) {
      this.count = 0;
      this.windowStart = now;
    }

    // Check if we're under the limit
    if (this.count < this.limit) {
      this.count++;
      return true;
    }

    return false;
  }

  getStats(): { count: number; limit: number; windowStart: number } {
    return { count: this.count, limit: this.limit, windowStart: this.windowStart };
  }
}

/**
 * LiquidationAuditService handles auditing of on-chain liquidation events
 */
export class LiquidationAuditService {
  private priceService: PriceService;
  private notificationService: NotificationService;
  private rateLimiter: RateLimiter;
  private provider: ethers.JsonRpcProvider | null = null;
  private aaveOracleHelper: AaveOracleHelper | null = null;
  private decisionTraceStore: DecisionTraceStore | null = null;
  private classifier: DecisionClassifier | null = null;
  private missRowLogger: MissRowLogger | null = null;
  private useAaveOracle: boolean;
  private ourBotAddress?: string;

  private autoHealCallback?: (user: string) => void;

  constructor(
    priceService: PriceService,
    notificationService: NotificationService,
    provider?: ethers.JsonRpcProvider,
    decisionTraceStore?: DecisionTraceStore,
    ourBotAddress?: string,
    autoHealCallback?: (user: string) => void
  ) {
    this.priceService = priceService;
    this.notificationService = notificationService;
    this.rateLimiter = new RateLimiter(config.liquidationAuditSampleLimit);
    this.provider = provider || null;
    this.ourBotAddress = ourBotAddress;
    this.autoHealCallback = autoHealCallback;
    
    // Initialize Aave oracle helper if provider available
    // Use pricesUseAaveOracle flag or fallback to liquidationAuditPriceMode
    this.useAaveOracle = config.pricesUseAaveOracle || config.liquidationAuditPriceMode === 'aave_oracle';
    if (this.provider && this.useAaveOracle) {
      this.aaveOracleHelper = new AaveOracleHelper(this.provider);
      // Initialize asynchronously
      this.aaveOracleHelper.initialize().then(() => {
        // eslint-disable-next-line no-console
        console.log(`[oracle] AaveOracleHelper initialized for audit (address=${this.aaveOracleHelper?.getOracleAddress() || 'unknown'})`);
      }).catch((error) => {
        // eslint-disable-next-line no-console
        console.error('[liquidation-audit] Failed to initialize AaveOracleHelper:', error);
        this.aaveOracleHelper = null;
      });
    }
    
    // Initialize decision trace store and classifier if provided
    if (decisionTraceStore) {
      this.decisionTraceStore = decisionTraceStore;
      this.classifier = new DecisionClassifier(decisionTraceStore);
      this.missRowLogger = new MissRowLogger(true);
    }

    // Log config on initialization
    this.logConfig();
  }

  /**
   * Log configuration on startup
   */
  private logConfig(): void {
    // eslint-disable-next-line no-console
    console.log(
      `[config] LIQUIDATION_AUDIT_ENABLED=${config.liquidationAuditEnabled} ` +
      `LIQUIDATION_AUDIT_NOTIFY=${config.liquidationAuditNotify} ` +
      `LIQUIDATION_AUDIT_PRICE_MODE=${config.liquidationAuditPriceMode} ` +
      `LIQUIDATION_AUDIT_SAMPLE_LIMIT=${config.liquidationAuditSampleLimit}`
    );
  }

  /**
   * Main handler for LiquidationCall events
   * 
   * @param decoded Decoded LiquidationCall event
   * @param blockNumber Block number of the event
   * @param transactionHash Transaction hash of the event
   * @param isInWatchSet Function to check if user is in watch set
   * @param candidatesTotal Total number of candidates in watch set
   */
  async onLiquidationCall(
    decoded: DecodedEvent,
    blockNumber: number,
    transactionHash: string,
    isInWatchSet: (user: string) => boolean,
    candidatesTotal: number
  ): Promise<void> {
    // Check if audit is enabled
    if (!config.liquidationAuditEnabled) {
      return;
    }

    try {
      // Extract event data
      const user = decoded.args.user?.toLowerCase() || '';
      const debtAsset = decoded.args.debtAsset?.toLowerCase() || '';
      const collateralAsset = decoded.args.collateralAsset?.toLowerCase() || '';
      const debtToCover = BigInt(decoded.args.debtToCover?.toString() || '0');
      const liquidatedCollateralAmount = BigInt(decoded.args.liquidatedCollateralAmount?.toString() || '0');
      const liquidator = decoded.args.liquidator?.toLowerCase() || '';
      const receiveAToken = decoded.args.receiveAToken || false;

      // Determine if user was in watch set (legacy)
      const inSet = isInWatchSet(user);
      const reason: AuditReason = inSet ? 'raced' : 'not_in_watch_set';

      // Get USD values for debt and collateral
      const { debtUsd, collateralUsd } = await this.getUsdValues(
        debtAsset,
        collateralAsset,
        debtToCover,
        liquidatedCollateralAmount,
        blockNumber
      );

      // Use classifier if available
      let classifiedReason: ClassifiedReason | undefined;
      let notes: string[] | undefined;
      let blockTimestamp = 0;
      
      if (this.classifier && this.provider) {
        const eventSeenAtMs = Date.now();
        
        // Get block timestamp
        try {
          const block = await this.provider.getBlock(blockNumber);
          blockTimestamp = block?.timestamp || 0;
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn('[liquidation-audit] Failed to get block timestamp:', error);
        }
        
        // Classify the miss
        const classification = this.classifier.classify(
          user,
          liquidator,
          eventSeenAtMs,
          debtUsd,
          blockNumber,
          this.ourBotAddress
        );
        
        classifiedReason = classification.reason;
        notes = classification.notes;
        
        // Log miss row
        if (this.missRowLogger) {
          const missRow = MissRowLogger.fromClassification(
            blockNumber,
            blockTimestamp,
            transactionHash,
            user,
            debtAsset,
            collateralAsset,
            liquidator,
            classifiedReason,
            eventSeenAtMs,
            debtUsd,
            collateralUsd,
            classification.trace
          );
          
          this.missRowLogger.log(missRow);
        }
      }

      // Check if debt is below MIN_DEBT_USD (informational tag)
      const infoMinDebt = debtUsd !== null && debtUsd < config.minDebtUsd;

      // Create audit result
      const auditResult: LiquidationAuditResult = {
        user,
        debtAsset,
        collateralAsset,
        debtToCover,
        liquidatedCollateralAmount,
        blockNumber,
        transactionHash,
        liquidator,
        receiveAToken,
        reason,
        classifiedReason,
        infoMinDebt: infoMinDebt ? true : undefined,
        debtUsd,
        collateralUsd,
        candidatesTotal,
        notes
      };

      // Log audit
      this.logAudit(auditResult);

      // Update metrics
      this.updateMetrics(reason);

      // Auto-heal: add user to watch set if not_in_watch_set
      if (reason === 'not_in_watch_set' && this.autoHealCallback) {
        try {
          this.autoHealCallback(user);
          // eslint-disable-next-line no-console
          console.log(`[liquidation-audit] Auto-heal: added user ${user} to watch set`);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('[liquidation-audit] Auto-heal failed:', error);
        }
      }

      // Send notification if enabled and under rate limit
      if (config.liquidationAuditNotify && this.rateLimiter.canSend()) {
        await this.sendNotification(auditResult);
      } else if (config.liquidationAuditNotify && !this.rateLimiter.canSend()) {
        // eslint-disable-next-line no-console
        console.log('[liquidation-audit] Rate limit reached, skipping notification');
      }

    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[liquidation-audit] Error processing liquidation event:', error);
      liquidationAuditErrors.inc();
    }
  }

  /**
   * Get USD values for debt and collateral assets
   */
  private async getUsdValues(
    debtAsset: string,
    collateralAsset: string,
    debtToCover: bigint,
    liquidatedCollateralAmount: bigint,
    blockNumber: number
  ): Promise<{ debtUsd: number | null; collateralUsd: number | null }> {
    try {
      // Use Aave oracle if enabled and available
      if (this.aaveOracleHelper && this.aaveOracleHelper.isInitialized()) {
        const [debtUsd, collateralUsd] = await Promise.all([
          this.aaveOracleHelper.toUsd(debtToCover, debtAsset, blockNumber),
          this.aaveOracleHelper.toUsd(liquidatedCollateralAmount, collateralAsset, blockNumber)
        ]);
        
        // Check for suspicious USD scaling
        if (debtUsd !== null) {
          await this.checkSuspiciousScaling(debtAsset, debtToCover, debtUsd);
        }
        if (collateralUsd !== null) {
          await this.checkSuspiciousScaling(collateralAsset, liquidatedCollateralAmount, collateralUsd);
        }
        
        return { debtUsd, collateralUsd };
      }

      // Fallback to PriceService (legacy)
      const debtSymbol = await this.getTokenSymbol(debtAsset);
      const collateralSymbol = await this.getTokenSymbol(collateralAsset);

      // Get prices based on configured mode
      let debtPrice: number;
      let collateralPrice: number;

      if (config.liquidationAuditPriceMode === 'block' && this.provider) {
        // Block-tagged price reads (preferred for accuracy)
        debtPrice = await this.getPriceAtBlock(debtSymbol, blockNumber);
        collateralPrice = await this.getPriceAtBlock(collateralSymbol, blockNumber);
      } else {
        // Current price reads (fallback)
        debtPrice = await this.priceService.getPrice(debtSymbol, false);
        collateralPrice = await this.priceService.getPrice(collateralSymbol, false);
      }

      // Get decimals (assume 18 if not available - would need proper token contract calls)
      const debtDecimals = await this.getTokenDecimals(debtAsset);
      const collateralDecimals = await this.getTokenDecimals(collateralAsset);

      // Calculate USD values
      const debtUsd = Number(debtToCover) / Math.pow(10, debtDecimals) * debtPrice;
      const collateralUsd = Number(liquidatedCollateralAmount) / Math.pow(10, collateralDecimals) * collateralPrice;

      return { debtUsd, collateralUsd };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[liquidation-audit] Error getting USD values:', error);
      return { debtUsd: null, collateralUsd: null };
    }
  }

  /**
   * Get token symbol from address
   * Simplified implementation - returns address as fallback
   */
  private async getTokenSymbol(address: string): Promise<string> {
    // In a full implementation, this would query the ERC20 contract for symbol()
    // For now, we'll use a simple mapping for common Base tokens
    const knownTokens: Record<string, string> = {
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
      '0x4200000000000000000000000000000000000006': 'WETH',
      '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 'USDbC',
      '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 'DAI',
      '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': 'cbETH',
      '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 'cbBTC',
      '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': 'wstETH',
      '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a': 'weETH'
    };

    return knownTokens[address.toLowerCase()] || address;
  }

  /**
   * Get token decimals
   * Simplified implementation - returns 18 as default
   */
  private async getTokenDecimals(address: string): Promise<number> {
    // In a full implementation, this would query the ERC20 contract for decimals()
    // For now, we'll use a simple mapping for common Base tokens
    const knownDecimals: Record<string, number> = {
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6,  // USDC
      '0x4200000000000000000000000000000000000006': 18, // WETH
      '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 6,  // USDbC
      '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 18, // DAI
      '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': 18, // cbETH
      '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 8,  // cbBTC
      '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': 18, // wstETH
      '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a': 18  // weETH
    };

    return knownDecimals[address.toLowerCase()] || 18;
  }

  /**
   * Get price at specific block (block-tagged read)
   * Falls back to current price if block-tagged read fails
   */
  private async getPriceAtBlock(symbol: string, blockNumber: number): Promise<number> {
    try {
      // For now, fall back to current price
      // In a full implementation, would use block-tagged Chainlink reads
      return await this.priceService.getPrice(symbol, false);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[liquidation-audit] Block-tagged price fetch failed for ${symbol} at block ${blockNumber}, using current`);
      return await this.priceService.getPrice(symbol, false);
    }
  }

  /**
   * Log audit result
   */
  private logAudit(result: LiquidationAuditResult): void {
    const debtUsdStr = result.debtUsd !== null ? `$${result.debtUsd.toFixed(2)}` : '~$N/A';
    const collateralUsdStr = result.collateralUsd !== null ? `$${result.collateralUsd.toFixed(2)}` : '~$N/A';
    const infoTag = result.infoMinDebt ? ' info_min_debt' : '';
    const classifiedTag = result.classifiedReason ? ` classified=${result.classifiedReason}` : '';

    // eslint-disable-next-line no-console
    console.log(
      `[liquidation-audit] user=${result.user} ` +
      `debtToCover=${result.debtToCover.toString()} (~${debtUsdStr}) ` +
      `collateralSeized=${result.liquidatedCollateralAmount.toString()} (~${collateralUsdStr}) ` +
      `block=${result.blockNumber} tx=${result.transactionHash} ` +
      `reason=${result.reason}${classifiedTag}${infoTag} candidates_total=${result.candidatesTotal}`
    );
  }

  /**
   * Update metrics counters
   */
  private updateMetrics(reason: AuditReason): void {
    liquidationAuditTotal.inc();
    
    if (reason === 'not_in_watch_set') {
      liquidationAuditReasonNotInWatchSet.inc();
      watchMissCount.inc(); // New metric for coverage tracking
    } else if (reason === 'raced') {
      liquidationAuditReasonRaced.inc();
    }
  }

  /**
   * Send Telegram notification
   */
  private async sendNotification(result: LiquidationAuditResult): Promise<void> {
    if (!this.notificationService.isEnabled()) {
      return;
    }

    try {
      const message = this.formatNotificationMessage(result);
      // Use the internal bot to send a message directly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.notificationService as any).bot?.sendMessage(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.notificationService as any).chatId,
        message,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[liquidation-audit] Failed to send notification:', error);
    }
  }

  /**
   * Format notification message for Telegram
   */
  private formatNotificationMessage(result: LiquidationAuditResult): string {
    const userAddr = this.sanitizeAddress(result.user);
    const txAddr = this.sanitizeAddress(result.transactionHash);
    const debtSymbol = this.sanitizeAddress(result.debtAsset);
    const collateralSymbol = this.sanitizeAddress(result.collateralAsset);

    // Format amounts with decimals
    const debtAmount = this.formatAmount(result.debtToCover, result.debtAsset);
    const collateralAmount = this.formatAmount(result.liquidatedCollateralAmount, result.collateralAsset);

    // Format USD values with improved N/A handling
    const debtUsdStr = result.debtUsd !== null && result.debtUsd > 0 
      ? `~$${this.formatUsdValue(result.debtUsd)}` 
      : '~$N/A';
    const collateralUsdStr = result.collateralUsd !== null && result.collateralUsd > 0
      ? `~$${this.formatUsdValue(result.collateralUsd)}` 
      : '~$N/A';
    
    // Add note if price missing
    let priceNote = '';
    if (result.debtUsd === null) {
      priceNote += `\n⚠️ Price missing for debt asset ${result.debtAsset}`;
    }
    if (result.collateralUsd === null) {
      priceNote += `\n⚠️ Price missing for collateral asset ${result.collateralAsset}`;
    }

    // Info tag for min debt
    let infoTag = '';
    if (result.infoMinDebt && result.debtUsd !== null) {
      infoTag = `\n\nℹ️ <b>info_min_debt:</b> eventDebtUSD=${this.formatUsdValue(result.debtUsd)} &lt; MIN_DEBT_USD=${config.minDebtUsd}`;
    }
    
    // Add classification notes if available
    let notesSection = '';
    if (result.notes && result.notes.length > 0) {
      notesSection = `\n\n📝 <b>Notes:</b>\n${result.notes.map(n => `  • ${n}`).join('\n')}`;
    }

    const txLink = `https://basescan.org/tx/${result.transactionHash}`;
    const reasonDisplay = result.classifiedReason || result.reason;

    return `🔍 <b>[liquidation-audit]</b>

👤 user=<code>${userAddr}</code>
💰 debt=${debtSymbol} debtToCover=${debtAmount} (${debtUsdStr})
💎 collateral=${collateralSymbol} seized=${collateralAmount} (${collateralUsdStr})${priceNote}
📦 block=${result.blockNumber}
🔗 tx=<a href="${txLink}">${txAddr}</a>
📊 reason=<b>${reasonDisplay}</b>
👥 candidates_total=${this.formatNumber(result.candidatesTotal)}${infoTag}${notesSection}`;
  }

  /**
   * Sanitize address for display (show first 6 and last 4 chars)
   */
  private sanitizeAddress(address: string): string {
    if (!address || address.length < 12) {
      return address;
    }
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  }

  /**
   * Format token amount with appropriate decimals
   */
  private formatAmount(amount: bigint, tokenAddress: string): string {
    // Get decimals for the token
    const decimals = tokenAddress.toLowerCase() === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' ||
                     tokenAddress.toLowerCase() === '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca'
      ? 6  // USDC, USDbC
      : 18; // Default

    const divisor = 10n ** BigInt(decimals);
    const integerPart = amount / divisor;
    const fractionalPart = amount % divisor;
    
    // Convert to number for formatting
    const value = Number(integerPart) + Number(fractionalPart) / Number(divisor);
    
    // Format with appropriate precision
    if (value < 0.0001) {
      return value.toExponential(4);
    } else if (value < 1) {
      return value.toFixed(6);
    } else {
      return value.toFixed(6).replace(/\.?0+$/, '');
    }
  }

  /**
   * Format USD value with appropriate precision and commas
   */
  private formatUsdValue(value: number): string {
    if (value < 1) {
      return value.toFixed(4);
    } else if (value < 100) {
      return value.toFixed(2);
    } else {
      // Add thousands separators
      return value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
  }

  /**
   * Format number with thousands separators
   */
  private formatNumber(value: number): string {
    return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /**
   * Check for suspicious USD scaling that might indicate decimal mismatch
   */
  private async checkSuspiciousScaling(
    asset: string,
    rawAmount: bigint,
    usdValue: number
  ): Promise<void> {
    try {
      // Get decimals for the asset
      const decimals = await this.getTokenDecimals(asset);
      
      if (detectSuspiciousScaling(rawAmount, decimals, usdValue)) {
        // Log warning
        console.warn(
          `[audit] suspicious_usd_scaling: asset=${asset} rawAmount=${rawAmount} ` +
          `decimals=${decimals} usdValue=${usdValue.toFixed(6)}`
        );
        
        // Increment metric with asset label
        const symbol = await this.getTokenSymbol(asset);
        auditUsdScalingSuspectTotal.inc({ asset: symbol });
      }
    } catch (err) {
      // Don't fail audit on suspicion check error
      console.error('[audit] Error checking suspicious scaling:', err);
    }
  }
}
