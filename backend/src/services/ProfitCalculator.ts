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
 * 
 * POST-EVENT CALCULATION (using actual seized amounts from LiquidationCall):
 * Formula: netProfit = collateralValueUsd - principalValueUsd - gasCostUsd
 * 
 * The collateralAmount from the event already includes the liquidation bonus,
 * so we do NOT re-apply a bonus multiplier.
 * 
 * bonusPct is kept as a nominal field for backward compatibility but is NOT
 * used in the net profit calculation.
 */
export class ProfitCalculator {
  private bonusPct: number;  // Nominal only - not applied in calculation
  private feeBps: number;
  private gasCostUsd: number;

  constructor(options: ProfitCalculatorOptions = {}) {
    // bonusPct is nominal/placeholder - not applied to post-event amounts
    this.bonusPct = options.bonusPct ?? 0.05; // 5% default (for reference only)
    this.feeBps = options.feeBps ?? config.profitFeeBps;
    this.gasCostUsd = options.gasCostUsd ?? config.gasCostUsd;
  }

  /**
   * Calculate profit with detailed breakdown using actual post-event amounts.
   * 
   * @param collateralValueUsd Actual collateral seized in USD (from event)
   * @param principalValueUsd Actual debt repaid in USD (from event)
   * @returns Detailed profit breakdown
   */
  calculateProfit(collateralValueUsd: number, principalValueUsd: number): ProfitBreakdown {
    // Raw spread (collateral already includes bonus from liquidation)
    const rawSpread = collateralValueUsd - principalValueUsd;
    
    // Bonus value is NOT applied - the event's collateralAmount already reflects what was seized
    const bonusValue = 0;
    
    // Gross profit (no bonus applied)
    const gross = rawSpread;
    
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
