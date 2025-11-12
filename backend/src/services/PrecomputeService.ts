/**
 * PrecomputeService: Precompute liquidation calldata for hot accounts
 * 
 * For top-K hot-set accounts, precomputes:
 * - liquidation calldata (Pool.liquidationCall)
 * - maxDebtToCover (respecting closeFactor)
 * - profit estimate (seized collateral valuation - debtToCover)
 * 
 * Caches results per head and invalidates on price/event changes.
 */

import { ethers } from 'ethers';

import type { HotSetEntry } from './HotSetTracker.js';

export interface PrecomputedLiquidation {
  user: string;
  debtAsset: string;
  collateralAsset: string;
  maxDebtToCover: bigint;
  expectedCollateralSeize: bigint;
  estProfitUsd: number;
  encodedCalldata: string;
  lastBlock: number;
  readyAtMs: number;
  hf: number;
}

export interface PrecomputeServiceConfig {
  topK: number;
  enabled: boolean;
  closeFactorPct: number; // e.g., 50 for 50% max close
}

// Aave Pool ABI (minimal, for liquidationCall)
const AAVE_POOL_ABI = [
  'function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken) external returns ()'
];

/**
 * PrecomputeService handles precomputation of liquidation calldata
 */
export class PrecomputeService {
  private cache: Map<string, PrecomputedLiquidation> = new Map();
  private readonly config: PrecomputeServiceConfig;
  private poolInterface: ethers.Interface;
  private currentBlock: number = 0;

  constructor(config: PrecomputeServiceConfig) {
    this.config = config;
    this.poolInterface = new ethers.Interface(AAVE_POOL_ABI);

    if (this.config.enabled) {
      // eslint-disable-next-line no-console
      console.log(
        `[precompute] Initialized: topK=${this.config.topK}, ` +
        `closeFactor=${this.config.closeFactorPct}%`
      );
    }
  }

  /**
   * Precompute liquidations for top-K hot accounts
   * @param hotEntries Hot set entries sorted by HF
   * @param blockNumber Current block number
   * @param getPriceUsd Function to get USD price for an asset
   * @param getUserDebt Function to get user's debt for a specific asset
   * @param getUserCollateral Function to get user's collateral for a specific asset
   */
  async precompute(
    hotEntries: HotSetEntry[],
    blockNumber: number,
    getPriceUsd: (assetAddress: string) => Promise<number | null>,
    getUserDebt: (user: string, debtAsset: string) => Promise<bigint>,
    getUserCollateral: (user: string, collateralAsset: string) => Promise<bigint>,
    getDebtAssets: (user: string) => Promise<string[]>,
    getCollateralAssets: (user: string) => Promise<string[]>
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const now = Date.now();
    this.currentBlock = blockNumber;

    // Invalidate stale cache entries (from previous blocks)
    this.invalidateStale(blockNumber);

    // Select top-K entries
    const topK = hotEntries.slice(0, this.config.topK);

    // Precompute for each entry
    const promises = topK.map(entry =>
      this.precomputeForUser(
        entry,
        blockNumber,
        now,
        getPriceUsd,
        getUserDebt,
        getUserCollateral,
        getDebtAssets,
        getCollateralAssets
      )
    );

    await Promise.allSettled(promises);

    // eslint-disable-next-line no-console
    console.log(
      `[precompute] Completed for ${topK.length} users (cached=${this.cache.size}) at block ${blockNumber}`
    );
  }

  /**
   * Precompute liquidation for a single user
   */
  private async precomputeForUser(
    entry: HotSetEntry,
    blockNumber: number,
    now: number,
    getPriceUsd: (assetAddress: string) => Promise<number | null>,
    getUserDebt: (user: string, debtAsset: string) => Promise<bigint>,
    getUserCollateral: (user: string, collateralAsset: string) => Promise<bigint>,
    getDebtAssets: (user: string) => Promise<string[]>,
    getCollateralAssets: (user: string) => Promise<string[]>
  ): Promise<void> {
    try {
      // Get user's debt and collateral assets
      const [debtAssets, collateralAssets] = await Promise.all([
        getDebtAssets(entry.address),
        getCollateralAssets(entry.address)
      ]);

      if (debtAssets.length === 0 || collateralAssets.length === 0) {
        return;
      }

      // For simplicity, use first debt and first collateral asset
      // In production, would iterate through all combinations or use heuristics
      const debtAsset = debtAssets[0];
      const collateralAsset = collateralAssets[0];

      // Get current debt balance
      const totalDebt = await getUserDebt(entry.address, debtAsset);
      
      if (totalDebt === 0n) {
        return;
      }

      // Calculate maxDebtToCover based on close factor
      const closeFactor = BigInt(this.config.closeFactorPct);
      const maxDebtToCover = (totalDebt * closeFactor) / 100n;

      // Get collateral balance (for future validation logic)
      // const totalCollateral = await getUserCollateral(entry.address, collateralAsset);

      // Estimate seized collateral (simplified - would need liquidation bonus calculation)
      // For now, assume 1:1 ratio (in production, query Aave reserve data for bonus)
      const liquidationBonus = 105n; // 5% bonus (example)
      const expectedCollateralSeize = (maxDebtToCover * liquidationBonus) / 100n;

      // Get USD prices
      const [debtPriceUsd, collateralPriceUsd] = await Promise.all([
        getPriceUsd(debtAsset),
        getPriceUsd(collateralAsset)
      ]);

      if (debtPriceUsd === null || collateralPriceUsd === null) {
        return;
      }

      // Calculate profit estimate (simplified - assumes decimals = 18)
      const debtValueUsd = Number(maxDebtToCover) / 1e18 * debtPriceUsd;
      const collateralValueUsd = Number(expectedCollateralSeize) / 1e18 * collateralPriceUsd;
      const estProfitUsd = collateralValueUsd - debtValueUsd;

      // Encode calldata
      const encodedCalldata = this.poolInterface.encodeFunctionData('liquidationCall', [
        collateralAsset,
        debtAsset,
        entry.address,
        maxDebtToCover,
        false // receiveAToken
      ]);

      // Create precomputed entry
      const precomputed: PrecomputedLiquidation = {
        user: entry.address,
        debtAsset,
        collateralAsset,
        maxDebtToCover,
        expectedCollateralSeize,
        estProfitUsd,
        encodedCalldata,
        lastBlock: blockNumber,
        readyAtMs: now,
        hf: entry.hf
      };

      // Cache the result
      const cacheKey = this.getCacheKey(entry.address);
      this.cache.set(cacheKey, precomputed);

    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[precompute] Failed for user ${entry.address}:`, error);
    }
  }

  /**
   * Get precomputed liquidation for a user
   */
  get(user: string): PrecomputedLiquidation | null {
    const cacheKey = this.getCacheKey(user);
    return this.cache.get(cacheKey) || null;
  }

  /**
   * Invalidate cache entry for a user (e.g., after a relevant event)
   */
  invalidate(user: string): void {
    const cacheKey = this.getCacheKey(user);
    this.cache.delete(cacheKey);
  }

  /**
   * Invalidate all entries from previous blocks
   */
  private invalidateStale(currentBlock: number): void {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastBlock < currentBlock) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Invalidate all cache entries (e.g., on significant price movement)
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Get cache key for a user
   */
  private getCacheKey(user: string): string {
    return user.toLowerCase();
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    cacheSize: number;
    currentBlock: number;
  } {
    return {
      cacheSize: this.cache.size,
      currentBlock: this.currentBlock
    };
  }

  /**
   * Check if service is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}
