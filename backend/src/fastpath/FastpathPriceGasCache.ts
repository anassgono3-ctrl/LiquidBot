/**
 * FastpathPriceGasCache: Micro-caches for price and gas data
 * 
 * Provides low-latency access to price and gas estimates with TTL-based
 * invalidation. Used by CriticalLaneExecutor to avoid blocking on RPC calls.
 */

import { config } from '../config/index.js';

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

/**
 * PriceCache provides cached access to token prices
 */
export class PriceCache {
  private cache: Map<string, CacheEntry<bigint>> = new Map();
  private ttlMs: number;
  
  constructor(ttlMs?: number) {
    this.ttlMs = ttlMs || config.fastpathPriceCacheTtlMs;
  }
  
  /**
   * Get cached price for a token
   */
  get(token: string): bigint | null {
    const entry = this.cache.get(token.toLowerCase());
    if (!entry) {
      return null;
    }
    
    const age = Date.now() - entry.timestamp;
    if (age > this.ttlMs) {
      // Expired
      this.cache.delete(token.toLowerCase());
      return null;
    }
    
    return entry.value;
  }
  
  /**
   * Set cached price for a token
   */
  set(token: string, price: bigint): void {
    this.cache.set(token.toLowerCase(), {
      value: price,
      timestamp: Date.now()
    });
  }
  
  /**
   * Check if price is cached and fresh
   */
  has(token: string): boolean {
    return this.get(token) !== null;
  }
  
  /**
   * Clear all cached prices
   */
  clear(): void {
    this.cache.clear();
  }
  
  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }
}

/**
 * GasCache provides cached access to gas price estimates
 */
export class GasCache {
  private cache: Map<string, CacheEntry<number>> = new Map();
  private ttlMs: number;
  
  constructor(ttlMs?: number) {
    this.ttlMs = ttlMs || config.fastpathGasCacheTtlMs;
  }
  
  /**
   * Get cached gas price estimate (in Gwei)
   */
  get(key: string = 'default'): number | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }
    
    const age = Date.now() - entry.timestamp;
    if (age > this.ttlMs) {
      // Expired
      this.cache.delete(key);
      return null;
    }
    
    return entry.value;
  }
  
  /**
   * Set cached gas price estimate
   */
  set(value: number, key: string = 'default'): void {
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }
  
  /**
   * Check if gas price is cached and fresh
   */
  has(key: string = 'default'): boolean {
    return this.get(key) !== null;
  }
  
  /**
   * Clear all cached gas prices
   */
  clear(): void {
    this.cache.clear();
  }
  
  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }
}

/**
 * Combined cache for fast-path execution
 */
export class FastpathCache {
  public prices: PriceCache;
  public gas: GasCache;
  
  constructor() {
    this.prices = new PriceCache();
    this.gas = new GasCache();
  }
  
  /**
   * Clear all caches
   */
  clearAll(): void {
    this.prices.clear();
    this.gas.clear();
  }
  
  /**
   * Get combined cache statistics
   */
  getStats(): { priceEntries: number; gasEntries: number } {
    return {
      priceEntries: this.prices.size(),
      gasEntries: this.gas.size()
    };
  }
}
