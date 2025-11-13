/**
 * ProfitEstimator: Basic profit estimation utility for liquidations
 * 
 * Estimates gross profit from liquidation using provided USD values:
 * grossProfit = collateralValueUsd - debtValueUsd
 * 
 * Note: This is a simplified estimator that doesn't model gas costs.
 * Future enhancements could add gas cost estimation and net profit calculation.
 */

export interface ProfitEstimate {
  debtValueUsd: number;
  collateralValueUsd: number;
  grossProfitUsd: number;
  liquidationBonusPct: number;
}

/**
 * ProfitEstimator calculates estimated profit from liquidation opportunities
 */
export class ProfitEstimator {
  /**
   * Estimate profit from a liquidation using USD values
   * @param debtUsd Debt value in USD
   * @param liquidationBonusPct Liquidation bonus (e.g., 0.05 for 5%)
   * @returns Profit estimate in USD
   */
  static estimateFromUsd(
    debtUsd: number,
    liquidationBonusPct: number
  ): ProfitEstimate {
    // Calculate seized collateral value including bonus
    const collateralValueUsd = debtUsd * (1 + liquidationBonusPct);
    
    // Gross profit = bonus value
    const grossProfitUsd = debtUsd * liquidationBonusPct;

    return {
      debtValueUsd: debtUsd,
      collateralValueUsd,
      grossProfitUsd,
      liquidationBonusPct
    };
  }

  /**
   * Quick estimate using only USD values (no asset lookup)
   * @param debtUsd Debt value in USD
   * @param collateralUsd Collateral value in USD
   * @param liquidationBonusPct Liquidation bonus
   * @returns Profit estimate
   */
  estimateProfitSimple(
    debtUsd: number,
    collateralUsd: number,
    liquidationBonusPct: number
  ): ProfitEstimate {
    const seizedValue = debtUsd * (1 + liquidationBonusPct);
    const grossProfitUsd = seizedValue - debtUsd;

    return {
      debtValueUsd: debtUsd,
      collateralValueUsd: seizedValue,
      grossProfitUsd,
      liquidationBonusPct
    };
  }
}
