// NotificationService: Telegram bot notifications
import TelegramBot from 'node-telegram-bot-api';

import { config } from '../config/index.js';
import type { Opportunity } from '../types/index.js';
import { formatTokenAmount, validateAmount } from '../utils/decimals.js';

import { PriceService } from './PriceService.js';

export interface HealthBreachEvent {
  user: string;
  healthFactor: number;
  threshold: number;
  timestamp: number;
}

/**
 * NotificationService sends alerts via Telegram.
 * Only initializes if both bot token and chat ID are configured.
 */
export class NotificationService {
  private bot: TelegramBot | null = null;
  private chatId: string | null = null;
  private enabled = false;
  private priceService: PriceService;

  constructor(priceService?: PriceService) {
    const token = config.telegramBotToken;
    const chatId = config.telegramChatId;

    // Initialize PriceService for price validation
    this.priceService = priceService || new PriceService();

    if (token && chatId && token !== 'your_bot_token_here' && chatId !== 'your_chat_id_here') {
      try {
        this.bot = new TelegramBot(token, { polling: false });
        this.chatId = chatId;
        this.enabled = true;
        // eslint-disable-next-line no-console
        console.log('[notification] Telegram bot initialized successfully');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[notification] Failed to initialize Telegram bot:', err);
        this.enabled = false;
      }
    } else {
      // eslint-disable-next-line no-console
      console.log('[notification] Telegram notifications disabled (credentials not configured)');
    }
  }

  /**
   * Check if Telegram notifications are enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Send a liquidation opportunity notification
   * HARD GATING: Only send if all required data is present and actionable
   * UPDATED: Now handles deferred opportunities when price feeds not ready
   */
  async notifyOpportunity(opportunity: Opportunity): Promise<void> {
    // Replay mode guard: disable all notifications
    if (config.isReplay) {
      return;
    }
    
    if (!this.enabled || !this.bot || !this.chatId) {
      return;
    }

    // Hard gating: check if NOTIFY_ONLY_WHEN_ACTIONABLE is enabled
    const notifyOnlyWhenActionable = config.notifyOnlyWhenActionable;

    if (notifyOnlyWhenActionable) {
      // Validate opportunity is actionable before sending
      const validation = await this.validateOpportunityActionable(opportunity);
      if (!validation.valid) {
        // eslint-disable-next-line no-console
        console.log('[notification] Skipping non-actionable opportunity:', {
          user: opportunity.user,
          reason: validation.reason,
          details: validation.details
        });
        return;
      }
    }

    // Additional sanity checks on amounts (now async to support price revalidation)
    const scalingCheck = await this.checkScalingSanity(opportunity);
    
    // Handle deferred opportunities (price feeds not ready yet)
    if (scalingCheck.deferred) {
      // Don't skip permanently - just log that it's deferred
      // The opportunity will be revalued when feeds become ready
      // eslint-disable-next-line no-console
      console.log('[notification] Opportunity deferred until price feeds ready:', {
        user: opportunity.user,
        symbol: opportunity.collateralReserve.symbol,
        hf: opportunity.healthFactor
      });
      return;
    }
    
    if (!scalingCheck.valid) {
      // eslint-disable-next-line no-console
      console.warn('[notification] SCALING SUSPECTED - skipping notification:', {
        user: opportunity.user,
        warnings: scalingCheck.warnings
      });
      return;
    }

    try {
      const message = this.formatOpportunityMessage(opportunity, scalingCheck.warnings);
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[notification] Failed to send opportunity notification:', err);
    }
  }

  /**
   * Check if a symbol is invalid (missing or placeholder)
   */
  private isInvalidSymbol(symbol: string | null | undefined): boolean {
    return !symbol || symbol === 'UNKNOWN' || symbol === 'N/A';
  }

  /**
   * Get canonical decimals for well-known token symbols.
   * Falls back to provided decimals or 18 if unknown.
   */
  private getCanonicalDecimals(symbol?: string | null, fallback?: number | null): number {
    const normalizedSymbol = symbol?.toUpperCase();
    
    switch (normalizedSymbol) {
      case 'WETH':
      case 'DAI':
      case 'CBETH':
      case 'WSTETH':
      case 'WEETH':
        return 18;
      case 'USDC':
      case 'USDBC':
      case 'USDT':
        return 6;
      case 'WBTC':
        return 8;
      default:
        return typeof fallback === 'number' ? fallback : 18;
    }
  }

  /**
   * Convert raw amount to human-readable using BigInt-safe math.
   * @param raw - Raw amount (can be string, number, or bigint)
   * @param decimals - Token decimals
   * @returns Human-readable amount as number
   */
  private toHuman(raw: bigint | string | number | undefined | null, decimals: number): number {
    if (raw === undefined || raw === null) {
      return 0;
    }
    
    try {
      const bn = typeof raw === 'bigint' ? raw : BigInt(raw.toString());
      const base = 10n ** BigInt(Math.max(0, decimals));
      const integer = Number(bn / base);
      const frac = Number(bn % base) / Number(base);
      return integer + frac;
    } catch {
      // Fallback to simple conversion if BigInt conversion fails
      return 0;
    }
  }

  /**
   * Check for scaling issues in opportunity amounts.
   * Returns validation result with warnings if issues detected.
   * UPDATED: Now defers validation when price feeds not ready instead of immediately failing
   */
  private async checkScalingSanity(opportunity: Opportunity): Promise<{
    valid: boolean;
    warnings: string[];
    deferred?: boolean; // New: indicates opportunity should be deferred, not skipped
  }> {
    const warnings: string[] = [];

    // Check collateral amount using canonical decimals
    if (opportunity.collateralAmountRaw) {
      const collateralDecimals = this.getCanonicalDecimals(
        opportunity.collateralReserve.symbol,
        opportunity.collateralReserve.decimals
      );
      const humanCollateral = this.toHuman(opportunity.collateralAmountRaw, collateralDecimals);
      const collateralValidation = validateAmount(humanCollateral, opportunity.collateralReserve.symbol || 'collateral');
      
      if (!collateralValidation.valid) {
        warnings.push(`Collateral: ${collateralValidation.reason}`);
      }
    }

    // Check debt amount using canonical decimals
    if (opportunity.principalAmountRaw) {
      const principalDecimals = this.getCanonicalDecimals(
        opportunity.principalReserve.symbol,
        opportunity.principalReserve.decimals
      );
      const humanDebt = this.toHuman(opportunity.principalAmountRaw, principalDecimals);
      const debtValidation = validateAmount(humanDebt, opportunity.principalReserve.symbol || 'debt');
      
      if (!debtValidation.valid) {
        warnings.push(`Debt: ${debtValidation.reason}`);
      }
    }

    // Check health factor consistency with PRICE READINESS awareness
    if (opportunity.healthFactor !== null && opportunity.healthFactor !== undefined) {
      // If HF < 1 but collateral USD is 0 or undefined, check if feeds are ready
      if (opportunity.healthFactor < 1 && 
          (!opportunity.collateralValueUsd || opportunity.collateralValueUsd === 0)) {
        
        // Check if price feeds are ready
        const feedsReady = this.priceService.isFeedsReady();
        
        if (!feedsReady && config.priceDeferUntilReady) {
          // Feeds not ready - defer this opportunity instead of skipping
          // eslint-disable-next-line no-console
          console.log(
            `[notification] pending_price_retry scheduled: user=${opportunity.user} ` +
            `symbol=${opportunity.collateralReserve.symbol} hf=${opportunity.healthFactor.toFixed(4)}`
          );
          
          return {
            valid: false,
            warnings: ['Deferred: price feeds not ready yet'],
            deferred: true
          };
        } else if (feedsReady) {
          // Feeds ARE ready but still zero - attempt one-time re-fetch
          try {
            const collateralSymbol = opportunity.collateralReserve.symbol || 'UNKNOWN';
            const revalidatedPrice = await this.priceService.getPrice(collateralSymbol, false);
            
            if (revalidatedPrice > 0) {
              // Price is now available! Update the opportunity
              const collateralDecimals = this.getCanonicalDecimals(
                opportunity.collateralReserve.symbol,
                opportunity.collateralReserve.decimals
              );
              const collateralAmountNum = this.toHuman(opportunity.collateralAmountRaw, collateralDecimals);
              opportunity.collateralValueUsd = collateralAmountNum * revalidatedPrice;
              
              // eslint-disable-next-line no-console
              console.log(
                `[notification] price_revalidation_success: symbol=${collateralSymbol} ` +
                `price=${revalidatedPrice.toFixed(2)} usd=${opportunity.collateralValueUsd.toFixed(2)}`
              );
              
              // Clear this warning - price is now valid
              // Continue with other checks...
            } else {
              // Still zero after revalidation
              warnings.push('HF < 1 but collateral USD is 0 (data inconsistency)');
            }
          } catch (error) {
            // Revalidation failed
            warnings.push('HF < 1 but collateral USD is 0 (data inconsistency)');
          }
        } else {
          // Old behavior: price defer disabled
          warnings.push('HF < 1 but collateral USD is 0 (data inconsistency)');
        }
      }

      // If HF >= 1 but we're being notified as liquidatable, suspicious
      if (opportunity.healthFactor >= 1) {
        warnings.push(`HF >= 1 (${opportunity.healthFactor.toFixed(4)}) but flagged as liquidatable`);
      }
    }

    // If there are warnings, mark as invalid (don't send)
    return {
      valid: warnings.length === 0,
      warnings,
      deferred: false
    };
  }

  /**
   * Validate that an opportunity has all required data to be actionable
   * Returns validation result with reason if invalid
   */
  private async validateOpportunityActionable(opportunity: Opportunity): Promise<{
    valid: boolean;
    reason?: 'missing_reserve' | 'missing_decimals' | 'missing_symbol' | 'price_unavailable' | 'zero_debt_to_cover' | 'invalid_pair';
    details?: string;
  }> {
    // Check debt reserve
    if (!opportunity.principalReserve || !opportunity.principalReserve.id) {
      return {
        valid: false,
        reason: 'missing_reserve',
        details: 'Missing debt reserve ID'
      };
    }

    // Check collateral reserve
    if (!opportunity.collateralReserve || !opportunity.collateralReserve.id) {
      return {
        valid: false,
        reason: 'missing_reserve',
        details: 'Missing collateral reserve ID'
      };
    }

    // Check for UNKNOWN or N/A symbols
    const debtSymbol = opportunity.principalReserve.symbol;
    const collateralSymbol = opportunity.collateralReserve.symbol;

    if (this.isInvalidSymbol(debtSymbol)) {
      return {
        valid: false,
        reason: 'missing_symbol',
        details: `Debt symbol is ${debtSymbol || 'missing'}`
      };
    }

    if (this.isInvalidSymbol(collateralSymbol)) {
      return {
        valid: false,
        reason: 'missing_symbol',
        details: `Collateral symbol is ${collateralSymbol || 'missing'}`
      };
    }

    // Check decimals are present
    if (opportunity.principalReserve.decimals === undefined || opportunity.principalReserve.decimals === null) {
      return {
        valid: false,
        reason: 'missing_decimals',
        details: 'Debt reserve missing decimals'
      };
    }

    if (opportunity.collateralReserve.decimals === undefined || opportunity.collateralReserve.decimals === null) {
      return {
        valid: false,
        reason: 'missing_decimals',
        details: 'Collateral reserve missing decimals'
      };
    }

    // Check prices are available (for real-time opportunities)
    if (opportunity.triggerSource === 'realtime') {
      // Use PriceService to validate prices (supports ratio tokens like wstETH, weETH)
      // This ensures the notification path uses the same pricing logic as execution
      try {
        // Validate debt asset price (relaxed mode - don't throw on missing)
        const debtSymbol = opportunity.principalReserve.symbol;
        const debtPrice = await this.priceService.getPrice(debtSymbol || 'UNKNOWN', false);
        
        if (!debtPrice || debtPrice <= 0) {
          return {
            valid: false,
            reason: 'price_unavailable',
            details: `Debt asset ${debtSymbol} price unavailable or zero`
          };
        }

        // Validate collateral asset price (relaxed mode - don't throw on missing)
        const collateralSymbol = opportunity.collateralReserve.symbol;
        const collateralPrice = await this.priceService.getPrice(collateralSymbol || 'UNKNOWN', false);
        
        if (!collateralPrice || collateralPrice <= 0) {
          return {
            valid: false,
            reason: 'price_unavailable',
            details: `Collateral asset ${collateralSymbol} price unavailable or zero`
          };
        }

        // Log successful price validation for ratio tokens
        if (collateralSymbol === 'WSTETH' || collateralSymbol === 'WEETH') {
          // eslint-disable-next-line no-console
          console.log(
            `[notification] Ratio token price validated: ${collateralSymbol}=$${collateralPrice.toFixed(2)}`
          );
        }
      } catch (error) {
        // Price lookup failed
        return {
          valid: false,
          reason: 'price_unavailable',
          details: error instanceof Error ? error.message : 'Price lookup failed'
        };
      }

      // Check debtToCover is computed and non-zero (if provided)
      if (opportunity.debtToCoverUsd !== undefined && opportunity.debtToCoverUsd !== null && opportunity.debtToCoverUsd <= 0) {
        return {
          valid: false,
          reason: 'zero_debt_to_cover',
          details: `debtToCoverUsd is ${opportunity.debtToCoverUsd}`
        };
      }
    }

    return { valid: true };
  }

  /**
   * Send a health breach notification
   */
  async notifyHealthBreach(event: HealthBreachEvent): Promise<void> {
    // Replay mode guard: disable all notifications
    if (config.isReplay) {
      return;
    }
    
    if (!this.enabled || !this.bot || !this.chatId) {
      return;
    }

    try {
      const message = this.formatHealthBreachMessage(event);
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[notification] Failed to send health breach notification:', err);
    }
  }

  /**
   * Format opportunity message for Telegram
   */
  private formatOpportunityMessage(op: Opportunity, warnings: string[] = []): string {
    const userAddr = this.sanitizeAddress(op.user);
    const collateralSymbol = op.collateralReserve.symbol || 'Unknown';
    const principalSymbol = op.principalReserve.symbol || 'Unknown';
    
    // Use formatTokenAmount from decimals module for better formatting
    const collateralDecimals = op.collateralReserve.decimals ?? 18;
    const collateralAmount = op.collateralAmountRaw
      ? formatTokenAmount(BigInt(op.collateralAmountRaw), collateralDecimals, 6) // max 6 decimals
      : this.formatAmount(op.collateralAmountRaw, collateralDecimals);
    
    const principalDecimals = op.principalReserve.decimals ?? 18;
    const principalAmount = op.principalAmountRaw
      ? formatTokenAmount(BigInt(op.principalAmountRaw), principalDecimals, 6) // max 6 decimals
      : this.formatAmount(op.principalAmountRaw, principalDecimals);

    // Format USD values with appropriate precision
    const collateralUsd = op.collateralValueUsd 
      ? `~$${this.formatUsdValue(op.collateralValueUsd)}`
      : 'N/A';
    const principalUsd = op.principalValueUsd
      ? `~$${this.formatUsdValue(op.principalValueUsd)}`
      : 'N/A';
    const profit = op.profitEstimateUsd
      ? `$${this.formatUsdValue(op.profitEstimateUsd)}`
      : 'N/A';
    
    // Format health factor with exactly 4 decimals
    const hf = op.healthFactor !== null && op.healthFactor !== undefined
      ? op.healthFactor.toFixed(4)
      : 'N/A';

    const txLink = op.txHash
      ? `\n🔗 Tx: <a href="https://basescan.org/tx/${op.txHash}">${this.sanitizeAddress(op.txHash)}</a>`
      : '';

    // Add trigger source info for real-time opportunities
    const sourceTag = op.triggerSource === 'realtime' 
      ? ` (Real-time${op.triggerType ? `: ${op.triggerType}` : ''})`
      : op.triggerSource === 'subgraph'
      ? ' (Subgraph)'
      : '';

    // Real-time enriched data (only for realtime path)
    let realtimeInfo = '';
    if (op.triggerSource === 'realtime') {
      const debtToCoverInfo = op.debtToCoverUsd 
        ? `\n💳 Debt to Cover: $${this.formatUsdValue(op.debtToCoverUsd)}`
        : '';
      const bonusInfo = op.bonusPct
        ? `\n🎁 Liquidation Bonus: ${(op.bonusPct * 100).toFixed(2)}%`
        : '';
      realtimeInfo = debtToCoverInfo + bonusInfo;
    }

    // Add scaling warnings if any (should not happen as we filter these out)
    const warningTag = warnings.length > 0 
      ? `\n\n⚠️ <b>(SCALING SUSPECTED)</b>\n${warnings.map(w => `  • ${w}`).join('\n')}`
      : '';

    return `🚨 <b>Liquidation Opportunity${sourceTag}</b>

👤 User: <code>${userAddr}</code>
💰 Collateral: ${collateralAmount} ${collateralSymbol} (${collateralUsd})
📉 Debt: ${principalAmount} ${principalSymbol} (${principalUsd})
📊 Health Factor: ${hf}${realtimeInfo}
💵 Est. Profit: ${profit}${txLink}${warningTag}

⏰ ${new Date(op.timestamp * 1000).toISOString()}`;
  }

  /**
   * Format health breach message for Telegram
   */
  private formatHealthBreachMessage(event: HealthBreachEvent): string {
    const userAddr = this.sanitizeAddress(event.user);
    const hf = event.healthFactor.toFixed(4);
    const threshold = event.threshold.toFixed(2);

    return `⚠️ <b>Health Factor Breach</b>

👤 User: <code>${userAddr}</code>
📉 Health Factor: ${hf}
⚡ Threshold: ${threshold}

🔴 Position now at risk of liquidation

⏰ ${new Date(event.timestamp * 1000).toISOString()}`;
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
   * Format USD value with appropriate precision:
   * - < $1: show 4 decimals
   * - < $100: show 2 decimals
   * - >= $100: show 2 decimals with commas
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
   * Format token amount with decimals
   */
  private formatAmount(rawAmount: string, decimals: number): string {
    try {
      const amount = parseFloat(rawAmount) / Math.pow(10, decimals);
      return amount.toFixed(4);
    } catch {
      return rawAmount;
    }
  }

  /**
   * Send liquidation detection notification (fast-lane)
   */
  async notifyLiquidationDetect(event: {
    user: string;
    healthFactor: number;
    estProfitUsd: number;
    blockNumber: number;
  }): Promise<void> {
    // Replay mode guard: disable all notifications
    if (config.isReplay) {
      return;
    }
    
    if (!this.enabled || !this.bot || !this.chatId) {
      return;
    }

    try {
      const userAddr = this.sanitizeAddress(event.user);
      const hf = event.healthFactor.toFixed(4);
      const profit = this.formatUsdValue(event.estProfitUsd);

      const message = `🔍 <b>[liquidation-detect]</b>

👤 User: <code>${userAddr}</code>
📊 HF: ${hf}
💰 Est. Profit: $${profit}
🔢 Block: ${event.blockNumber}

⏰ ${new Date().toISOString()}`;

      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[notification] Failed to send detection notification:', err);
    }
  }

  /**
   * Send liquidation outcome notification (fast-lane)
   */
  async notifyLiquidationOutcome(outcome: {
    type: 'executed' | 'raced' | 'skipped';
    user: string;
    blockNumber: number;
    txHash?: string;
    gasUsed?: number;
    profitUsd?: number;
    competingTxHash?: string;
    timeDeltaMs?: number;
    skipReason?: string;
    skipDetails?: string;
  }): Promise<void> {
    // Replay mode guard: disable all notifications
    if (config.isReplay) {
      return;
    }
    
    if (!this.enabled || !this.bot || !this.chatId) {
      return;
    }

    try {
      const userAddr = this.sanitizeAddress(outcome.user);
      let message: string;

      if (outcome.type === 'executed') {
        const txLink = outcome.txHash 
          ? `<a href="https://basescan.org/tx/${outcome.txHash}">${this.sanitizeAddress(outcome.txHash)}</a>`
          : 'N/A';
        const gasInfo = outcome.gasUsed ? ` | ⛽ ${outcome.gasUsed.toLocaleString()}` : '';
        const profitInfo = outcome.profitUsd ? ` | 💵 $${this.formatUsdValue(outcome.profitUsd)}` : '';

        message = `✅ <b>[executed]</b>

👤 User: <code>${userAddr}</code>
🔢 Block: ${outcome.blockNumber}
🔗 Tx: ${txLink}${gasInfo}${profitInfo}

⏰ ${new Date().toISOString()}`;

      } else if (outcome.type === 'raced') {
        const competingLink = outcome.competingTxHash
          ? `<a href="https://basescan.org/tx/${outcome.competingTxHash}">${this.sanitizeAddress(outcome.competingTxHash)}</a>`
          : 'N/A';
        const timeDelta = outcome.timeDeltaMs ? ` (Δ${outcome.timeDeltaMs}ms)` : '';

        message = `⚡ <b>[raced]</b>

👤 User: <code>${userAddr}</code>
🔢 Block: ${outcome.blockNumber}
🏁 Competing Tx: ${competingLink}${timeDelta}

⏰ ${new Date().toISOString()}`;

      } else {
        // skipped
        const reason = outcome.skipReason || 'unknown';
        const details = outcome.skipDetails ? `\n📝 ${outcome.skipDetails}` : '';

        message = `⏭️ <b>[skipped]</b>

👤 User: <code>${userAddr}</code>
🔢 Block: ${outcome.blockNumber}
❌ Reason: ${reason}${details}

⏰ ${new Date().toISOString()}`;
      }

      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[notification] Failed to send outcome notification:', err);
    }
  }
}
