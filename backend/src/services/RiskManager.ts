// RiskManager: Enforces risk controls for liquidation execution
import type { Opportunity } from '../types/index.js';
import { executionConfig } from '../config/executionConfig.js';

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface DailyTracker {
  date: string;
  realizedPnl: number;
}

/**
 * RiskManager enforces execution risk controls:
 * - Blacklisted tokens
 * - Position size limits
 * - After-gas profit threshold
 * - Daily loss limits
 */
export class RiskManager {
  private dailyTracker: DailyTracker;

  constructor() {
    const today = new Date().toISOString().split('T')[0];
    this.dailyTracker = {
      date: today,
      realizedPnl: 0
    };
  }

  /**
   * Check if an opportunity can be executed based on all risk rules
   * @param opportunity The opportunity to check
   * @param afterGasProfitUsd Estimated profit after gas costs
   * @returns Risk check result with reason if blocked
   */
  canExecute(opportunity: Opportunity, afterGasProfitUsd: number): RiskCheckResult {
    // Check blacklisted tokens
    const collateralSymbol = (opportunity.collateralReserve.symbol || '').toUpperCase();
    const principalSymbol = (opportunity.principalReserve.symbol || '').toUpperCase();
    
    if (executionConfig.blacklistedTokens.includes(collateralSymbol)) {
      return { allowed: false, reason: `Blacklisted collateral: ${collateralSymbol}` };
    }
    
    if (executionConfig.blacklistedTokens.includes(principalSymbol)) {
      return { allowed: false, reason: `Blacklisted principal: ${principalSymbol}` };
    }

    // Check after-gas profit threshold
    if (afterGasProfitUsd < executionConfig.minProfitAfterGasUsd) {
      return { 
        allowed: false, 
        reason: `After-gas profit $${afterGasProfitUsd.toFixed(2)} < min $${executionConfig.minProfitAfterGasUsd}` 
      };
    }

    // Check position size (use max of collateral and principal values)
    const positionSize = Math.max(
      opportunity.collateralValueUsd || 0,
      opportunity.principalValueUsd || 0
    );
    
    if (positionSize > executionConfig.maxPositionSizeUsd) {
      return { 
        allowed: false, 
        reason: `Position size $${positionSize.toFixed(2)} > max $${executionConfig.maxPositionSizeUsd}` 
      };
    }

    // Check daily loss limit
    this.resetDailyTrackerIfNeeded();
    if (this.dailyTracker.realizedPnl < -executionConfig.dailyLossLimitUsd) {
      return { 
        allowed: false, 
        reason: `Daily loss limit reached: $${(-this.dailyTracker.realizedPnl).toFixed(2)} / $${executionConfig.dailyLossLimitUsd}` 
      };
    }

    return { allowed: true };
  }

  /**
   * Record realized profit/loss for daily tracking
   * @param pnlUsd Realized P&L in USD (positive = profit, negative = loss)
   */
  recordRealizedProfit(pnlUsd: number): void {
    this.resetDailyTrackerIfNeeded();
    this.dailyTracker.realizedPnl += pnlUsd;
  }

  /**
   * Get current daily P&L
   */
  getDailyPnl(): number {
    this.resetDailyTrackerIfNeeded();
    return this.dailyTracker.realizedPnl;
  }

  /**
   * Reset daily tracker if we've rolled over to a new day
   */
  private resetDailyTrackerIfNeeded(): void {
    const today = new Date().toISOString().split('T')[0];
    if (this.dailyTracker.date !== today) {
      this.dailyTracker = {
        date: today,
        realizedPnl: 0
      };
    }
  }
}
