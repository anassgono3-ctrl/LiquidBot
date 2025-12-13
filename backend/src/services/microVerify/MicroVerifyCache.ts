/**
 * MicroVerifyCache: TTL-based cache for micro-verify health factor reads
 * 
 * Features:
 * - Cache key: `${user}:${blockTag}` or `${user}:latest`
 * - TTL configurable via MICRO_VERIFY_CACHE_TTL_MS
 * - Invalidate on user events (Borrow, Repay, Supply, Withdraw, Transfer)
 * - Deduplicate in-flight requests to avoid redundant RPC calls
 * 
 * Purpose: Reduce RPC request volume by caching identical HF lookups across
 * different detection paths (head checks, price-trigger, predictive, reserve-recheck)
 */

import { config } from '../../config/index.js';

export interface CachedHFResult {
  user: string;
  blockTag: string | number;
  hf: number;
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  availableBorrowsBase: bigint;
  currentLiquidationThreshold: bigint;
  ltv: bigint;
  timestamp: number;
}

interface CacheEntry {
  result: CachedHFResult;
  expiresAt: number;
}

interface InflightRequest {
  promise: Promise<CachedHFResult | null>;
  timestamp: number;
}

/**
 * MicroVerifyCache manages short-lived cache of health factor reads
 * with automatic invalidation and de-duplication
 */
export class MicroVerifyCache {
  private readonly cache: Map<string, CacheEntry> = new Map();
  private readonly inflightRequests: Map<string, InflightRequest> = new Map();
  private readonly ttlMs: number;
  private readonly enabled: boolean;
  
  // Configuration constants
  private static readonly INFLIGHT_STALE_THRESHOLD_MS = 10000;
  
  // Metrics
  private hits = 0;
  private misses = 0;
  private inflightShares = 0;
  private invalidations = 0;

  constructor(ttlMs?: number) {
    this.ttlMs = ttlMs ?? config.microVerifyCacheTtlMs ?? 2000;
    this.enabled = this.ttlMs > 0;
    
    if (this.enabled) {
      console.log(`[micro-cache] Initialized with TTL=${this.ttlMs}ms`);
    }
  }

  /**
   * Generate cache key for user and blockTag
   */
  private getCacheKey(user: string, blockTag: string | number): string {
    return `${user.toLowerCase()}:${blockTag}`;
  }

  /**
   * Check if cache entry is still valid
   */
  private isValid(entry: CacheEntry): boolean {
    return Date.now() < entry.expiresAt;
  }

  /**
   * Get cached result if available and valid
   */
  public get(user: string, blockTag: string | number): CachedHFResult | null {
    if (!this.enabled) return null;

    const key = this.getCacheKey(user, blockTag);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    if (!this.isValid(entry)) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    console.log(
      `[micro-cache] hit user=${user} blockTag=${blockTag} ttlMs=${entry.expiresAt - Date.now()}`
    );
    return entry.result;
  }

  /**
   * Store result in cache
   */
  public set(user: string, blockTag: string | number, result: CachedHFResult): void {
    if (!this.enabled) return;

    const key = this.getCacheKey(user, blockTag);
    const expiresAt = Date.now() + this.ttlMs;

    this.cache.set(key, {
      result,
      expiresAt
    });
  }

  /**
   * Invalidate all cache entries for a user
   * Called when user events occur (Borrow, Repay, Supply, Withdraw, Transfer)
   */
  public invalidateUser(user: string): void {
    if (!this.enabled) return;

    const userLower = user.toLowerCase();
    let count = 0;

    // Remove all entries for this user (across all blockTags)
    for (const [key, _entry] of this.cache.entries()) {
      if (key.startsWith(userLower + ':')) {
        this.cache.delete(key);
        count++;
      }
    }

    // Also clear any in-flight requests for this user
    for (const [key, _inflight] of this.inflightRequests.entries()) {
      if (key.startsWith(userLower + ':')) {
        this.inflightRequests.delete(key);
      }
    }

    if (count > 0) {
      this.invalidations++;
      console.log(`[micro-cache] invalidated user=${user} entries=${count}`);
    }
  }

  /**
   * Get or create an in-flight request for deduplication
   * Returns existing promise if request is already in-flight
   */
  public getOrCreateInflight(
    user: string,
    blockTag: string | number,
    factory: () => Promise<CachedHFResult | null>
  ): Promise<CachedHFResult | null> {
    if (!this.enabled) return factory();

    const key = this.getCacheKey(user, blockTag);
    const existing = this.inflightRequests.get(key);

    if (existing) {
      this.inflightShares++;
      console.log(`[micro-cache] inflight-share user=${user} blockTag=${blockTag}`);
      return existing.promise;
    }

    // Create new in-flight request
    const promise = factory()
      .then((result) => {
        // Store in cache if successful
        if (result) {
          this.set(user, blockTag, result);
        }
        // Clean up in-flight tracking
        this.inflightRequests.delete(key);
        return result;
      })
      .catch((error) => {
        // Clean up in-flight tracking on error
        this.inflightRequests.delete(key);
        throw error;
      });

    this.inflightRequests.set(key, {
      promise,
      timestamp: Date.now()
    });

    return promise;
  }

  /**
   * Periodic cleanup of expired entries
   */
  public cleanup(): void {
    if (!this.enabled) return;

    const now = Date.now();
    let cleaned = 0;

    // Remove expired cache entries
    for (const [key, entry] of this.cache.entries()) {
      if (!this.isValid(entry)) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    // Remove stale in-flight requests
    for (const [key, inflight] of this.inflightRequests.entries()) {
      if (now - inflight.timestamp > MicroVerifyCache.INFLIGHT_STALE_THRESHOLD_MS) {
        this.inflightRequests.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[micro-cache] cleanup removed=${cleaned}`);
    }
  }

  /**
   * Get cache statistics
   */
  public getStats() {
    return {
      enabled: this.enabled,
      ttlMs: this.ttlMs,
      cacheSize: this.cache.size,
      inflightSize: this.inflightRequests.size,
      hits: this.hits,
      misses: this.misses,
      inflightShares: this.inflightShares,
      invalidations: this.invalidations,
      hitRate: this.hits + this.misses > 0 ? this.hits / (this.hits + this.misses) : 0
    };
  }

  /**
   * Clear all cache entries (for testing)
   */
  public clear(): void {
    this.cache.clear();
    this.inflightRequests.clear();
  }

  /**
   * Check if cache is enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }
}
