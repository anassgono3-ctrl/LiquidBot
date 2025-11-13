/**
 * ProfitEstimator: Basic profit estimation utility for liquidations
 * 
 * Estimates gross profit from liquidation using Aave oracle prices:
 * grossProfit = collateralValueUsd - debtValueUsd
 * 
 * Note: This is a simplified estimator that doesn't model gas costs.
 * Future enhancements could add gas cost estimation and net profit calculation.
 */

import type { AssetMetadataCache } from '../aave/AssetMetadataCache.js';

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
  private assetCache: AssetMetadataCache;

  constructor(assetCache: AssetMetadataCache) {
    this.assetCache = assetCache;
  }

  /**
   * Estimate profit from a liquidation
   * @param debtAsset Debt asset address
   * @param debtAmount Debt amount in raw token units
   * @param collateralAsset Collateral asset address
   * @param collateralAmount Collateral amount in raw token units
   * @param liquidationBonusPct Liquidation bonus (e.g., 0.05 for 5%)
   * @returns Profit estimate in USD
   */
  async estimateProfit(
    debtAsset: string,
    debtAmount: bigint,
    collateralAsset: string,
    collateralAmount: bigint,
    liquidationBonusPct: number
  ): Promise<ProfitEstimate | null> {
    try {
      // Get asset metadata for decimals and prices
      const debtMeta = this.assetCache.get(debtAsset.toLowerCase());
      const collateralMeta = this.assetCache.get(collateralAsset.toLowerCase());

      if (!debtMeta || !collateralMeta) {
        return null;
      }

      // Get prices from Aave oracle (8 decimals, USD denominated)
      const debtPriceRaw = debtMeta.priceRaw;
      const collateralPriceRaw = collateralMeta.priceRaw;

      if (!debtPriceRaw || !collateralPriceRaw || debtPriceRaw <= 0n || collateralPriceRaw <= 0n) {
        return null;
      }

      // Calculate USD values using 1e18 normalization
      // debtUsd = (debtAmount * 10^(18 - debtDecimals) * debtPriceRaw * 10^10) / 10^18 / 10^18
      const debtDecimalDiff = 18 - debtMeta.decimals;
      const debt1e18 = debtDecimalDiff >= 0 
        ? debtAmount * BigInt(10 ** debtDecimalDiff)
        : debtAmount / BigInt(10 ** Math.abs(debtDecimalDiff));
      
      const debtPrice1e18 = debtPriceRaw * BigInt(1e10); // Convert 1e8 to 1e18
      const debtUsd1e18 = (debt1e18 * debtPrice1e18) / BigInt(1e18);
      const debtValueUsd = Number(debtUsd1e18) / 1e18;

      // Apply liquidation bonus to debt to get expected collateral
      const bonusBps = Math.round(liquidationBonusPct * 10000);
      const debtWithBonus1e18 = (debtUsd1e18 * BigInt(10000 + bonusBps)) / BigInt(10000);

      // Calculate actual collateral value
      const collateralDecimalDiff = 18 - collateralMeta.decimals;
      const collateral1e18 = collateralDecimalDiff >= 0
        ? collateralAmount * BigInt(10 ** collateralDecimalDiff)
        : collateralAmount / BigInt(10 ** Math.abs(collateralDecimalDiff));
      
      const collateralPrice1e18 = collateralPriceRaw * BigInt(1e10);
      const collateralUsd1e18 = (collateral1e18 * collateralPrice1e18) / BigInt(1e18);
      const collateralValueUsd = Number(collateralUsd1e18) / 1e18;

      // Gross profit = seized collateral value - debt to cover
      const grossProfitUsd = Number(debtWithBonus1e18) / 1e18 - debtValueUsd;

      return {
        debtValueUsd,
        collateralValueUsd: Number(debtWithBonus1e18) / 1e18,
        grossProfitUsd,
        liquidationBonusPct
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[profit-estimator] Failed to estimate profit:', error);
      return null;
    }
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
