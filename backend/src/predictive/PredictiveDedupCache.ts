/**
 * PredictiveDedupCache: LRU cache with TTL for predictive candidate deduplication
 * 
 * Prevents re-evaluating the same user repeatedly across consecutive blocks
 * unless a stronger signal (larger delta) arrives.
 */

import { config } from '../config/index.js';
import { predictiveDedupHitsTotal } from '../metrics/index.js';

export interface CachedCandidate {
  userAddress: string;
  asset: string;
  lastEvaluatedBlock: number;
  lastEvaluatedTimestamp: number;
  lastSignalStrength: number; // Delta that triggered evaluation
  lastHf?: number;
}

/**
 * PredictiveDedupCache provides LRU cache with TTL for candidate deduplication
 */
export class PredictiveDedupCache {
  private readonly cache: Map<string, CachedCandidate> = new Map();
  private readonly ttlSec: number;
  private readonly maxSize: number;
  private readonly accessOrder: string[] = []; // LRU tracking

  constructor(
    ttlSec?: number,
    maxSize?: number
  ) {
    this.ttlSec = ttlSec ?? config.predictiveDedupCacheTtlSec;
    this.maxSize = maxSize ?? config.predictiveDedupCacheMaxSize;

    console.log(
      `[predictive-dedup-cache] Initialized: ttl=${this.ttlSec}s, maxSize=${this.maxSize}`
    );
  }

  /**
   * Generate cache key from user address and asset
   */
  private getCacheKey(userAddress: string, asset: string): string {
    return `${userAddress.toLowerCase()}:${asset.toUpperCase()}`;
  }

  /**
   * Check if user should be evaluated
   * Returns true if:
   * - User not in cache (never evaluated)
   * - Cache entry expired (TTL exceeded)
   * - New signal is stronger than cached signal
   */
  public shouldEvaluate(
    userAddress: string,
    asset: string,
    signalStrength: number,
    currentBlock: number
  ): boolean {
    const key = this.getCacheKey(userAddress, asset);
    const cached = this.cache.get(key);

    if (!cached) {
      // Not in cache - should evaluate
      return true;
    }

    const now = Date.now();
    const ageMs = now - cached.lastEvaluatedTimestamp;

    // Check TTL expiration
    if (ageMs > this.ttlSec * 1000) {
      // Expired - remove and allow evaluation
      this.cache.delete(key);
      const idx = this.accessOrder.indexOf(key);
      if (idx >= 0) {
        this.accessOrder.splice(idx, 1);
      }
      return true;
    }

    // Check signal strength
    if (signalStrength > cached.lastSignalStrength) {
      // Stronger signal - allow evaluation
      return true;
    }

    // Cache hit - skip evaluation
    predictiveDedupHitsTotal.inc({ asset });
    
    // Update LRU order
    const idx = this.accessOrder.indexOf(key);
    if (idx >= 0) {
      this.accessOrder.splice(idx, 1);
    }
    this.accessOrder.push(key);

    return false;
  }

  /**
   * Record that a user was evaluated
   */
  public recordEvaluation(
    userAddress: string,
    asset: string,
    signalStrength: number,
    block: number,
    hf?: number
  ): void {
    const key = this.getCacheKey(userAddress, asset);
    const now = Date.now();

    // Evict LRU entry if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const lruKey = this.accessOrder.shift();
      if (lruKey) {
        this.cache.delete(lruKey);
      }
    }

    // Store/update entry
    this.cache.set(key, {
      userAddress,
      asset,
      lastEvaluatedBlock: block,
      lastEvaluatedTimestamp: now,
      lastSignalStrength: signalStrength,
      lastHf: hf
    });

    // Update LRU order
    const idx = this.accessOrder.indexOf(key);
    if (idx >= 0) {
      this.accessOrder.splice(idx, 1);
    }
    this.accessOrder.push(key);
  }

  /**
   * Get cached entry if exists and not expired
   */
  public get(userAddress: string, asset: string): CachedCandidate | null {
    const key = this.getCacheKey(userAddress, asset);
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    const now = Date.now();
    const ageMs = now - cached.lastEvaluatedTimestamp;

    if (ageMs > this.ttlSec * 1000) {
      // Expired
      this.cache.delete(key);
      const idx = this.accessOrder.indexOf(key);
      if (idx >= 0) {
        this.accessOrder.splice(idx, 1);
      }
      return null;
    }

    return cached;
  }

  /**
   * Clear expired entries
   */
  public pruneExpired(): number {
    const now = Date.now();
    let prunedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      const ageMs = now - entry.lastEvaluatedTimestamp;
      if (ageMs > this.ttlSec * 1000) {
        this.cache.delete(key);
        const idx = this.accessOrder.indexOf(key);
        if (idx >= 0) {
          this.accessOrder.splice(idx, 1);
        }
        prunedCount++;
      }
    }

    return prunedCount;
  }

  /**
   * Get cache statistics
   */
  public getStats(): {
    size: number;
    maxSize: number;
    ttlSec: number;
    oldestEntryAgeMs: number | null;
  } {
    let oldestAgeMs: number | null = null;
    const now = Date.now();

    if (this.cache.size > 0) {
      for (const entry of this.cache.values()) {
        const ageMs = now - entry.lastEvaluatedTimestamp;
        if (oldestAgeMs === null || ageMs > oldestAgeMs) {
          oldestAgeMs = ageMs;
        }
      }
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlSec: this.ttlSec,
      oldestEntryAgeMs: oldestAgeMs
    };
  }

  /**
   * Clear all entries
   */
  public clear(): void {
    this.cache.clear();
    this.accessOrder.length = 0;
  }
}
