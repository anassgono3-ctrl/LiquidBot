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
   */
  async notifyOpportunity(opportunity: Opportunity): Promise<void> {
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

    // Additional sanity checks on amounts
    const scalingCheck = this.checkScalingSanity(opportunity);
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
   * Check for scaling issues in opportunity amounts.
   * Returns validation result with warnings if issues detected.
   */
  private checkScalingSanity(opportunity: Opportunity): {
    valid: boolean;
    warnings: string[];
  } {
    const warnings: string[] = [];

    // Check collateral amount
    if (opportunity.collateralAmountRaw) {
      const collateralDecimals = opportunity.collateralReserve.decimals ?? 18;
      const humanCollateral = Number(opportunity.collateralAmountRaw) / (10 ** collateralDecimals);
      const collateralValidation = validateAmount(humanCollateral, opportunity.collateralReserve.symbol || 'collateral');
      
      if (!collateralValidation.valid) {
        warnings.push(`Collateral: ${collateralValidation.reason}`);
      }
    }

    // Check debt amount
    if (opportunity.principalAmountRaw) {
      const principalDecimals = opportunity.principalReserve.decimals ?? 18;
      const humanDebt = Number(opportunity.principalAmountRaw) / (10 ** principalDecimals);
      const debtValidation = validateAmount(humanDebt, opportunity.principalReserve.symbol || 'debt');
      
      if (!debtValidation.valid) {
        warnings.push(`Debt: ${debtValidation.reason}`);
      }
    }

    // Check health factor consistency
    if (opportunity.healthFactor !== null && opportunity.healthFactor !== undefined) {
      // If HF < 1 but collateral USD is 0 or undefined, suspicious
      if (opportunity.healthFactor < 1 && 
          (!opportunity.collateralValueUsd || opportunity.collateralValueUsd === 0)) {
        warnings.push('HF < 1 but collateral USD is 0 (data inconsistency)');
      }

      // If HF >= 1 but we're being notified as liquidatable, suspicious
      if (opportunity.healthFactor >= 1) {
        warnings.push(`HF >= 1 (${opportunity.healthFactor.toFixed(4)}) but flagged as liquidatable`);
      }
    }

    // If there are warnings, mark as invalid (don't send)
    return {
      valid: warnings.length === 0,
      warnings
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
}
