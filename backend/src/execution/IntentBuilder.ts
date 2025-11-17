/**
 * IntentBuilder: Prebuilt liquidation intents for hot accounts
 * 
 * For users in HotCriticalQueue, prebuild LiquidationIntent with:
 * - Resolved prices (from PriceHotCacheService)
 * - Repay amount and close factor
 * - Encoded calldata for liquidation
 * - Gas limit estimate and priority fee suggestion
 * - Recent HF snapshot
 * 
 * Intents are cached and revalidated before send if age > max_intent_age_ms.
 */

import { ethers } from 'ethers';

export interface LiquidationIntent {
  // User and assets
  user: string;
  debtAsset: string;
  collateralAsset: string;
  
  // Amounts (wei)
  debtToCover: bigint;
  expectedCollateral: bigint;
  
  // Prices (USD)
  debtPriceUsd: number;
  collateralPriceUsd: number;
  
  // Transaction data
  calldata: string;
  gasLimitEstimate: bigint;
  priorityFeeSuggestion: bigint;
  
  // Snapshot
  healthFactor: number;
  blockNumber: number;
  timestamp: number;
  
  // Metadata
  closeFactorBps: number; // e.g., 5000 = 50%
  profitEstimateUsd: number;
  intentAge: number; // ms since creation
}

export interface IntentBuilderConfig {
  maxIntentAgeMs: number; // Max age before revalidation required
  closeFactorBps: number; // Default close factor (e.g., 5000 = 50%)
  receiveAToken: boolean; // Receive aToken instead of underlying
  gasLimitBuffer: number; // Buffer multiplier for gas estimate (e.g., 1.2)
}

interface IntentCache {
  intent: LiquidationIntent;
  cachedAt: number;
}

/**
 * IntentBuilder creates and manages prebuilt liquidation intents
 */
export class IntentBuilder {
  private cache: Map<string, IntentCache> = new Map();
  private config: IntentBuilderConfig;
  private poolInterface: ethers.Interface;

  // Aave Pool ABI (minimal, for liquidationCall)
  private static readonly POOL_ABI = [
    'function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken) external returns ()'
  ];

  constructor(config: IntentBuilderConfig) {
    this.config = config;
    this.poolInterface = new ethers.Interface(IntentBuilder.POOL_ABI);

    // eslint-disable-next-line no-console
    console.log(
      `[intent-builder] Initialized: maxAge=${config.maxIntentAgeMs}ms, ` +
      `closeFactor=${config.closeFactorBps / 100}%, receiveAToken=${config.receiveAToken}`
    );
  }

  /**
   * Build or retrieve cached intent for a user
   * 
   * @param user User address
   * @param debtAsset Debt token address
   * @param collateralAsset Collateral token address
   * @param totalDebt Total debt in wei
   * @param healthFactor Current health factor
   * @param blockNumber Current block number
   * @param getPriceUsd Function to get USD price for an asset
   * @param gasPrice Current gas price suggestion
   * @returns Liquidation intent or null if cannot build
   */
  async buildIntent(
    user: string,
    debtAsset: string,
    collateralAsset: string,
    totalDebt: bigint,
    healthFactor: number,
    blockNumber: number,
    getPriceUsd: (asset: string) => Promise<number | null>,
    gasPrice: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
  ): Promise<LiquidationIntent | null> {
    const cacheKey = this.getCacheKey(user, debtAsset, collateralAsset);
    const cached = this.cache.get(cacheKey);

    // Check if cached intent is still valid
    if (cached && this.isIntentValid(cached)) {
      // Update age and return
      const intent = cached.intent;
      intent.intentAge = Date.now() - cached.cachedAt;
      return intent;
    }

    // Build new intent
    try {
      const intent = await this.buildNewIntent(
        user,
        debtAsset,
        collateralAsset,
        totalDebt,
        healthFactor,
        blockNumber,
        getPriceUsd,
        gasPrice
      );

      if (intent) {
        this.cache.set(cacheKey, {
          intent,
          cachedAt: Date.now()
        });
      }

      return intent;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[intent-builder] Failed to build intent for ${user}:`, error);
      return null;
    }
  }

  /**
   * Build a new liquidation intent from scratch
   */
  private async buildNewIntent(
    user: string,
    debtAsset: string,
    collateralAsset: string,
    totalDebt: bigint,
    healthFactor: number,
    blockNumber: number,
    getPriceUsd: (asset: string) => Promise<number | null>,
    gasPrice: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
  ): Promise<LiquidationIntent | null> {
    // Get prices
    const debtPriceUsd = await getPriceUsd(debtAsset);
    const collateralPriceUsd = await getPriceUsd(collateralAsset);

    if (!debtPriceUsd || !collateralPriceUsd) {
      return null;
    }

    // Calculate debt to cover based on close factor
    const debtToCover = (totalDebt * BigInt(this.config.closeFactorBps)) / BigInt(10000);

    // Estimate collateral seized (simplified: 1:1 value + liquidation bonus)
    // In reality, this should use liquidation bonus from Aave reserve config
    const liquidationBonusBps = 500; // 5% typical bonus
    const debtValueUsd = Number(debtToCover) * debtPriceUsd;
    const collateralValueWithBonusUsd = debtValueUsd * (1 + liquidationBonusBps / 10000);
    const expectedCollateral = BigInt(
      Math.floor((collateralValueWithBonusUsd / collateralPriceUsd) * 1e18)
    );

    // Encode calldata
    const calldata = this.poolInterface.encodeFunctionData('liquidationCall', [
      collateralAsset,
      debtAsset,
      user,
      debtToCover,
      this.config.receiveAToken
    ]);

    // Estimate gas (simplified)
    const baseGas = 350000n; // Typical liquidation gas
    const gasLimitEstimate = BigInt(
      Math.floor(Number(baseGas) * this.config.gasLimitBuffer)
    );

    // Calculate profit estimate
    const profitEstimateUsd = collateralValueWithBonusUsd - debtValueUsd;

    return {
      user: user.toLowerCase(),
      debtAsset: debtAsset.toLowerCase(),
      collateralAsset: collateralAsset.toLowerCase(),
      debtToCover,
      expectedCollateral,
      debtPriceUsd,
      collateralPriceUsd,
      calldata,
      gasLimitEstimate,
      priorityFeeSuggestion: gasPrice.maxPriorityFeePerGas,
      healthFactor,
      blockNumber,
      timestamp: Date.now(),
      closeFactorBps: this.config.closeFactorBps,
      profitEstimateUsd,
      intentAge: 0
    };
  }

  /**
   * Check if a cached intent is still valid
   */
  private isIntentValid(cached: IntentCache): boolean {
    const age = Date.now() - cached.cachedAt;
    return age < this.config.maxIntentAgeMs;
  }

  /**
   * Revalidate prices for an intent before sending
   * 
   * @param intent The intent to revalidate
   * @param getPriceUsd Function to get current USD price
   * @returns Updated intent with fresh prices or null if prices stale/unavailable
   */
  async revalidateIntent(
    intent: LiquidationIntent,
    getPriceUsd: (asset: string) => Promise<number | null>
  ): Promise<LiquidationIntent | null> {
    const debtPriceUsd = await getPriceUsd(intent.debtAsset);
    const collateralPriceUsd = await getPriceUsd(intent.collateralAsset);

    if (!debtPriceUsd || !collateralPriceUsd) {
      return null;
    }

    // Check if prices have diverged significantly (>5%)
    const debtPriceDelta = Math.abs(debtPriceUsd - intent.debtPriceUsd) / intent.debtPriceUsd;
    const collateralPriceDelta = Math.abs(collateralPriceUsd - intent.collateralPriceUsd) / intent.collateralPriceUsd;

    if (debtPriceDelta > 0.05 || collateralPriceDelta > 0.05) {
      // Prices have moved too much, need to rebuild intent
      return null;
    }

    // Update prices and recalculate profit
    const updatedIntent = { ...intent };
    updatedIntent.debtPriceUsd = debtPriceUsd;
    updatedIntent.collateralPriceUsd = collateralPriceUsd;
    
    const debtValueUsd = Number(intent.debtToCover) * debtPriceUsd;
    const collateralValueUsd = Number(intent.expectedCollateral) * collateralPriceUsd;
    updatedIntent.profitEstimateUsd = collateralValueUsd - debtValueUsd;
    
    return updatedIntent;
  }

  /**
   * Get cached intent for a user
   */
  getIntent(user: string, debtAsset: string, collateralAsset: string): LiquidationIntent | null {
    const cacheKey = this.getCacheKey(user, debtAsset, collateralAsset);
    const cached = this.cache.get(cacheKey);
    
    if (cached && this.isIntentValid(cached)) {
      cached.intent.intentAge = Date.now() - cached.cachedAt;
      return cached.intent;
    }
    
    return null;
  }

  /**
   * Invalidate cached intent for a user
   */
  invalidateIntent(user: string, debtAsset: string, collateralAsset: string): void {
    const cacheKey = this.getCacheKey(user, debtAsset, collateralAsset);
    this.cache.delete(cacheKey);
  }

  /**
   * Clear all cached intents
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    validCount: number;
    staleCount: number;
    avgAge: number;
  } {
    const now = Date.now();
    let validCount = 0;
    let staleCount = 0;
    let totalAge = 0;

    for (const cached of this.cache.values()) {
      const age = now - cached.cachedAt;
      totalAge += age;

      if (this.isIntentValid(cached)) {
        validCount++;
      } else {
        staleCount++;
      }
    }

    return {
      size: this.cache.size,
      validCount,
      staleCount,
      avgAge: this.cache.size > 0 ? totalAge / this.cache.size : 0
    };
  }

  /**
   * Generate cache key for user + assets
   */
  private getCacheKey(user: string, debtAsset: string, collateralAsset: string): string {
    return `${user.toLowerCase()}-${debtAsset.toLowerCase()}-${collateralAsset.toLowerCase()}`;
  }
}

/**
 * Load IntentBuilder configuration from environment variables
 */
export function loadIntentBuilderConfig(): IntentBuilderConfig {
  return {
    maxIntentAgeMs: Number(process.env.MAX_INTENT_AGE_MS || 2000), // 2 seconds default
    closeFactorBps: Number(process.env.PRECOMPUTE_CLOSE_FACTOR_PCT || 50) * 100,
    receiveAToken: (process.env.PRECOMPUTE_RECEIVE_A_TOKEN || 'false').toLowerCase() === 'true',
    gasLimitBuffer: Number(process.env.GAS_LIMIT_BUFFER || 1.2)
  };
}
