// PreSimCache: LRU cache for pre-computed liquidation plans
// Keys: (user, debtAsset, collateralAsset, blockTag)
// TTL: configurable blocks (default 2)

import { config } from '../config/index.js';
import { preSimCacheHit, preSimCacheMiss } from '../metrics/index.js';

export interface PreSimPlan {
  user: string;
  debtAsset: string;
  collateralAsset: string;
  blockTag: number;
  repayAmount: bigint;
  expectedCollateral: bigint;
  estimatedProfit: number; // USD
  timestamp: number;
}

interface CacheEntry {
  plan: PreSimPlan;
  expiryBlock: number;
}

/**
 * PreSimCache provides LRU caching for pre-computed liquidation plans.
 * Cache is keyed by (user, debtAsset, collateralAsset, blockTag) and has
 * a TTL measured in blocks.
 */
export class PreSimCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number;
  private ttlBlocks: number;

  constructor(maxSize: number = 1000, ttlBlocks?: number) {
    this.maxSize = maxSize;
    this.ttlBlocks = ttlBlocks ?? config.preSimCacheTtlBlocks;
  }

  /**
   * Generate cache key from plan parameters
   */
  private getCacheKey(user: string, debtAsset: string, collateralAsset: string, blockTag: number): string {
    return `${user.toLowerCase()}-${debtAsset.toLowerCase()}-${collateralAsset.toLowerCase()}-${blockTag}`;
  }

  /**
   * Store a pre-computed plan in the cache
   */
  set(plan: PreSimPlan): void {
    const key = this.getCacheKey(plan.user, plan.debtAsset, plan.collateralAsset, plan.blockTag);
    const expiryBlock = plan.blockTag + this.ttlBlocks;

    // LRU eviction: if at max size, remove oldest entry
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, { plan, expiryBlock });
  }

  /**
   * Get a cached plan if available and not expired
   * @param currentBlock Current block number for TTL check
   */
  get(
    user: string,
    debtAsset: string,
    collateralAsset: string,
    blockTag: number,
    currentBlock: number
  ): PreSimPlan | null {
    const key = this.getCacheKey(user, debtAsset, collateralAsset, blockTag);
    const entry = this.cache.get(key);

    if (!entry) {
      preSimCacheMiss.inc();
      return null;
    }

    // Check if expired
    if (currentBlock > entry.expiryBlock) {
      this.cache.delete(key);
      preSimCacheMiss.inc();
      return null;
    }

    preSimCacheHit.inc();
    
    // Move to end (LRU update)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.plan;
  }

  /**
   * Check if a plan exists in cache without updating LRU
   */
  has(user: string, debtAsset: string, collateralAsset: string, blockTag: number, currentBlock: number): boolean {
    const key = this.getCacheKey(user, debtAsset, collateralAsset, blockTag);
    const entry = this.cache.get(key);

    if (!entry) return false;
    if (currentBlock > entry.expiryBlock) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Clear all entries from cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; ttlBlocks: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlBlocks: this.ttlBlocks
    };
  }

  /**
   * Remove expired entries
   */
  pruneExpired(currentBlock: number): number {
    let pruned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (currentBlock > entry.expiryBlock) {
        this.cache.delete(key);
        pruned++;
      }
    }
    return pruned;
  }
}
