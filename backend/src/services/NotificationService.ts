// NotificationService: Telegram bot notifications
import TelegramBot from 'node-telegram-bot-api';

import { config } from '../config/index.js';
import type { Opportunity } from '../types/index.js';

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

  constructor() {
    const token = config.telegramBotToken;
    const chatId = config.telegramChatId;

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
   */
  async notifyOpportunity(opportunity: Opportunity): Promise<void> {
    if (!this.enabled || !this.bot || !this.chatId) {
      return;
    }

    try {
      const message = this.formatOpportunityMessage(opportunity);
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[notification] Failed to send opportunity notification:', err);
    }
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
  private formatOpportunityMessage(op: Opportunity): string {
    const userAddr = this.sanitizeAddress(op.user);
    const collateralSymbol = op.collateralReserve.symbol || 'Unknown';
    const principalSymbol = op.principalReserve.symbol || 'Unknown';
    
    const collateralAmount = this.formatAmount(
      op.collateralAmountRaw,
      op.collateralReserve.decimals || 18
    );
    const principalAmount = this.formatAmount(
      op.principalAmountRaw,
      op.principalReserve.decimals || 18
    );

    const collateralUsd = op.collateralValueUsd 
      ? `~$${op.collateralValueUsd.toFixed(2)}`
      : 'N/A';
    const principalUsd = op.principalValueUsd
      ? `~$${op.principalValueUsd.toFixed(2)}`
      : 'N/A';
    const profit = op.profitEstimateUsd
      ? `$${op.profitEstimateUsd.toFixed(2)}`
      : 'N/A';
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

    return `🚨 <b>Liquidation Opportunity${sourceTag}</b>

👤 User: <code>${userAddr}</code>
💰 Collateral: ${collateralAmount} ${collateralSymbol} (${collateralUsd})
📉 Debt: ${principalAmount} ${principalSymbol} (${principalUsd})
📊 Health Factor: ${hf}
💵 Est. Profit: ${profit}${txLink}

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
