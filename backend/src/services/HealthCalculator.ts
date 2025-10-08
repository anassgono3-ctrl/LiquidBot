// HealthCalculator: Calculate health factor for user positions
import type { User, HealthFactorResult } from '../types/index.js';
import { config } from '../config/index.js';

/**
 * Health Factor Formula:
 * HF = (Σ collateral_value × liquidationThreshold) / Σ debt_value
 */
export class HealthCalculator {
  // Dust threshold: treat debt below this value (in ETH) as effectively zero
  private readonly DUST_EPSILON_ETH = 0.000001;

  /**
   * Calculate health factor for a user
   * @param user User data from subgraph
   * @returns Health factor result with collateral, debt, and risk status
   */
  calculateHealthFactor(user: User): HealthFactorResult {
    let totalCollateralETH = 0;
    let weightedCollateralETH = 0;
    let totalDebtETH = 0;

    for (const userReserve of user.reserves) {
      const reserve = userReserve.reserve;
      const decimals = reserve.decimals;
      const priceInEth = parseFloat(reserve.price.priceInEth);

      // Calculate collateral value in ETH
      if (reserve.usageAsCollateralEnabled) {
        const collateralBalance = parseFloat(userReserve.currentATokenBalance) / Math.pow(10, decimals);
        const collateralValueETH = collateralBalance * priceInEth;
        totalCollateralETH += collateralValueETH;

        // Apply liquidation threshold (basis points to decimal)
        const liquidationThreshold = reserve.reserveLiquidationThreshold / 10000;
        weightedCollateralETH += collateralValueETH * liquidationThreshold;
      }

      // Calculate debt value in ETH
      const variableDebt = parseFloat(userReserve.currentVariableDebt) / Math.pow(10, decimals);
      const stableDebt = parseFloat(userReserve.currentStableDebt) / Math.pow(10, decimals);
      const totalDebt = variableDebt + stableDebt;
      const debtValueETH = totalDebt * priceInEth;
      totalDebtETH += debtValueETH;
    }

    // Handle zero debt or dust case (infinite health factor)
    if (totalDebtETH === 0 || totalDebtETH < this.DUST_EPSILON_ETH) {
      return {
        healthFactor: Infinity,
        totalCollateralETH,
        totalDebtETH: totalDebtETH < this.DUST_EPSILON_ETH ? 0 : totalDebtETH,
        isAtRisk: false,
      };
    }

    const healthFactor = weightedCollateralETH / totalDebtETH;
    const isAtRisk = healthFactor < config.alertThreshold;

    return {
      healthFactor,
      totalCollateralETH,
      totalDebtETH,
      isAtRisk,
    };
  }

  /**
   * Batch calculate health factors for multiple users
   * @param users Array of user data
   * @returns Array of health factor results
   */
  batchCalculateHealthFactors(
    users: User[]
  ): Array<HealthFactorResult & { userId: string }> {
    return users.map((user) => ({
      userId: user.id,
      ...this.calculateHealthFactor(user),
    }));
  }

  /**
   * Filter users at risk (HF < threshold)
   * @param users Array of user data
   * @param threshold Health factor threshold (default: alert threshold)
   * @returns Users at risk with their health factors
   */
  getUsersAtRisk(
    users: User[],
    threshold = config.alertThreshold
  ): Array<{ user: User; healthFactor: HealthFactorResult }> {
    return users
      .map((user) => ({
        user,
        healthFactor: this.calculateHealthFactor(user),
      }))
      .filter(({ healthFactor }) => healthFactor.healthFactor < threshold);
  }
}
