/**
 * HFCalculator: Batch health factor calculations
 * 
 * Pure math calculations for health factors on per-block snapshots
 */

export interface ReserveData {
  asset: string;
  debtUsd: number;
  collateralUsd: number;
  liquidationThreshold: number;
}

export interface UserSnapshot {
  address: string;
  reserves: ReserveData[];
  block: number;
}

export class HFCalculator {
  /**
   * Calculate health factor for a user
   * HF = sum(collateral_i * LT_i) / sum(debt_i)
   */
  public static calculateHF(snapshot: UserSnapshot): number {
    let totalCollateralWeighted = 0;
    let totalDebt = 0;

    for (const reserve of snapshot.reserves) {
      totalCollateralWeighted += reserve.collateralUsd * reserve.liquidationThreshold;
      totalDebt += reserve.debtUsd;
    }

    if (totalDebt === 0) {
      return Number.MAX_SAFE_INTEGER;
    }

    return totalCollateralWeighted / totalDebt;
  }

  /**
   * Batch calculate health factors for multiple users
   */
  public static batchCalculateHF(snapshots: UserSnapshot[]): Map<string, number> {
    const results = new Map<string, number>();
    
    for (const snapshot of snapshots) {
      const hf = this.calculateHF(snapshot);
      results.set(snapshot.address, hf);
    }

    return results;
  }

  /**
   * Project health factor with price changes
   * @param snapshot Current user snapshot
   * @param priceChanges Map of asset -> multiplier (e.g., 0.99 for -1%)
   */
  public static projectHF(
    snapshot: UserSnapshot,
    priceChanges: Map<string, number>
  ): number {
    let totalCollateralWeighted = 0;
    let totalDebt = 0;

    for (const reserve of snapshot.reserves) {
      const priceMultiplier = priceChanges.get(reserve.asset) ?? 1.0;
      const adjustedCollateral = reserve.collateralUsd * priceMultiplier;
      const adjustedDebt = reserve.debtUsd * priceMultiplier;

      totalCollateralWeighted += adjustedCollateral * reserve.liquidationThreshold;
      totalDebt += adjustedDebt;
    }

    if (totalDebt === 0) {
      return Number.MAX_SAFE_INTEGER;
    }

    return totalCollateralWeighted / totalDebt;
  }
}
