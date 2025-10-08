// ProfitCalculator: Centralized profit calculation with detailed breakdown
import { config } from '../config/index.js';

export interface ProfitBreakdown {
  gross: number;           // Raw spread + bonus
  bonusValue: number;      // collateralValue * bonusPct
  gasCost: number;         // Gas cost in USD
  fees: number;            // Protocol fees in USD
  net: number;             // Final profit after all deductions
}

export interface ProfitCalculatorOptions {
  bonusPct?: number;       // Liquidation bonus percentage (default: 0.05)
  feeBps?: number;         // Fee in basis points (default: from config.profitFeeBps)
  gasCostUsd?: number;     // Gas cost in USD (default: from config.gasCostUsd)
}

/**
 * ProfitCalculator provides centralized profit estimation logic.
 * Formula: gross = (collateralValue - principalValue) + (collateralValue * bonusPct)
 *          net = gross - fees - gasCost
 */
export class ProfitCalculator {
  private bonusPct: number;
  private feeBps: number;
  private gasCostUsd: number;

  constructor(options: ProfitCalculatorOptions = {}) {
    this.bonusPct = options.bonusPct ?? 0.05; // 5% default liquidation bonus
    this.feeBps = options.feeBps ?? config.profitFeeBps;
    this.gasCostUsd = options.gasCostUsd ?? config.gasCostUsd;
  }

  /**
   * Calculate profit with detailed breakdown
   * @param collateralValueUsd Collateral value in USD
   * @param principalValueUsd Principal (debt) value in USD
   * @returns Detailed profit breakdown
   */
  calculateProfit(collateralValueUsd: number, principalValueUsd: number): ProfitBreakdown {
    // Raw spread
    const rawSpread = collateralValueUsd - principalValueUsd;
    
    // Bonus value on collateral
    const bonusValue = collateralValueUsd * this.bonusPct;
    
    // Gross profit
    const gross = rawSpread + bonusValue;
    
    // Calculate fees on gross
    const fees = gross * (this.feeBps / 10000);
    
    // Gas cost
    const gasCost = this.gasCostUsd;
    
    // Net profit
    const net = gross - fees - gasCost;
    
    return {
      gross,
      bonusValue,
      gasCost,
      fees,
      net
    };
  }

  /**
   * Get the bonus percentage used by this calculator
   */
  getBonusPct(): number {
    return this.bonusPct;
  }

  /**
   * Get the fee basis points used by this calculator
   */
  getFeeBps(): number {
    return this.feeBps;
  }

  /**
   * Get the gas cost used by this calculator
   */
  getGasCostUsd(): number {
    return this.gasCostUsd;
  }
}
