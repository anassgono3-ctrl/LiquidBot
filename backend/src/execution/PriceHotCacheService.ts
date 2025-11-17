/**
 * PriceHotCacheService: Ultra-fast price cache for hot accounts
 * 
 * Maintains a short-interval hot cache (300-500ms) for debt and collateral
 * prices of HotCriticalQueue users. Ensures execution path never blocks on
 * price fallback.
 * 
 * Respects existing PRICES_USE_AAVE_ORACLE and CHAINLINK_FEEDS configuration.
 */

import type { PriceService } from '../services/PriceService.js';

export interface PriceHotCacheConfig {
  cacheIntervalMs: number; // How often to refresh prices (300-500ms)
  stalePriceThresholdMs: number; // Consider price stale after this time
  maxCacheSize: number; // Max number of assets to track
}

interface CachedPrice {
  asset: string;
  priceUsd: number;
  timestamp: number;
  source: 'chainlink' | 'aave_oracle' | 'fallback';
}

/**
 * PriceHotCacheService provides sub-second price updates for hot account assets
 */
export class PriceHotCacheService {
  private cache: Map<string, CachedPrice> = new Map();
  private config: PriceHotCacheConfig;
  private priceService: PriceService;
  private refreshInterval: NodeJS.Timeout | null = null;
  private assetsToTrack: Set<string> = new Set();

  constructor(priceService: PriceService, config: PriceHotCacheConfig) {
    this.priceService = priceService;
    this.config = config;

    // eslint-disable-next-line no-console
    console.log(
      `[price-hot-cache] Initialized: interval=${config.cacheIntervalMs}ms, ` +
      `staleThreshold=${config.stalePriceThresholdMs}ms`
    );
  }

  /**
   * Start the price refresh loop
   */
  start(): void {
    if (this.refreshInterval) {
      return; // Already started
    }

    // eslint-disable-next-line no-console
    console.log(`[price-hot-cache] Starting refresh loop every ${this.config.cacheIntervalMs}ms`);
    
    this.refreshInterval = setInterval(() => {
      void this.refreshPrices();
    }, this.config.cacheIntervalMs);

    // Do initial refresh immediately
    void this.refreshPrices();
  }

  /**
   * Stop the price refresh loop
   */
  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      // eslint-disable-next-line no-console
      console.log('[price-hot-cache] Stopped refresh loop');
    }
  }

  /**
   * Add assets to track (e.g., from HotCriticalQueue entries)
   */
  trackAssets(assets: string[]): void {
    for (const asset of assets) {
      const normalized = asset.toLowerCase();
      if (!this.assetsToTrack.has(normalized)) {
        this.assetsToTrack.add(normalized);
      }
    }

    // Enforce max cache size by removing least recently updated assets
    if (this.assetsToTrack.size > this.config.maxCacheSize) {
      this.evictOldestAssets();
    }
  }

  /**
   * Remove assets from tracking
   */
  untrackAssets(assets: string[]): void {
    for (const asset of assets) {
      this.assetsToTrack.delete(asset.toLowerCase());
    }
  }

  /**
   * Get cached price for an asset (returns null if stale or not cached)
   */
  getPrice(asset: string): number | null {
    const cached = this.cache.get(asset.toLowerCase());
    
    if (!cached) {
      return null;
    }

    // Check staleness
    const age = Date.now() - cached.timestamp;
    if (age > this.config.stalePriceThresholdMs) {
      return null;
    }

    return cached.priceUsd;
  }

  /**
   * Get cached price with metadata
   */
  getPriceWithMeta(asset: string): CachedPrice | null {
    const cached = this.cache.get(asset.toLowerCase());
    
    if (!cached) {
      return null;
    }

    // Check staleness
    const age = Date.now() - cached.timestamp;
    if (age > this.config.stalePriceThresholdMs) {
      return null;
    }

    return cached;
  }

  /**
   * Force refresh prices for tracked assets
   */
  async refreshPrices(): Promise<void> {
    const assets = Array.from(this.assetsToTrack);
    
    if (assets.length === 0) {
      return;
    }

    const startTime = Date.now();
    const promises = assets.map(asset => this.fetchAndCachePrice(asset));
    
    try {
      await Promise.all(promises);
      const elapsed = Date.now() - startTime;
      
      // Only log if refresh took longer than expected
      if (elapsed > this.config.cacheIntervalMs / 2) {
        // eslint-disable-next-line no-console
        console.warn(
          `[price-hot-cache] Refresh took ${elapsed}ms for ${assets.length} assets ` +
          `(${Math.round(elapsed / assets.length)}ms/asset)`
        );
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[price-hot-cache] Error during price refresh:', error);
    }
  }

  /**
   * Fetch and cache price for a single asset
   */
  private async fetchAndCachePrice(asset: string): Promise<void> {
    try {
      // Use PriceService to get price (respects PRICES_USE_AAVE_ORACLE, CHAINLINK_FEEDS, etc.)
      const priceUsd = await this.priceService.getPriceUsd(asset);
      
      if (priceUsd) {
        this.cache.set(asset.toLowerCase(), {
          asset: asset.toLowerCase(),
          priceUsd,
          timestamp: Date.now(),
          source: 'chainlink' // PriceService handles source internally
        });
      }
    } catch (error) {
      // Silent fail - we'll retry on next interval
      // Only log if we've seen repeated failures
    }
  }

  /**
   * Evict oldest assets when cache is full
   */
  private evictOldestAssets(): void {
    // Find assets not in cache (never refreshed) or oldest by timestamp
    const assetsWithTimestamps: Array<{ asset: string; timestamp: number }> = [];
    
    for (const asset of this.assetsToTrack) {
      const cached = this.cache.get(asset);
      assetsWithTimestamps.push({
        asset,
        timestamp: cached?.timestamp || 0
      });
    }

    // Sort by timestamp (oldest first)
    assetsWithTimestamps.sort((a, b) => a.timestamp - b.timestamp);

    // Remove oldest assets until we're under the limit
    const toRemove = this.assetsToTrack.size - this.config.maxCacheSize;
    for (let i = 0; i < toRemove; i++) {
      this.assetsToTrack.delete(assetsWithTimestamps[i].asset);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    trackedAssets: number;
    cachedPrices: number;
    avgAge: number;
    stalePrices: number;
  } {
    const now = Date.now();
    let totalAge = 0;
    let stalePrices = 0;

    for (const cached of this.cache.values()) {
      const age = now - cached.timestamp;
      totalAge += age;

      if (age > this.config.stalePriceThresholdMs) {
        stalePrices++;
      }
    }

    return {
      trackedAssets: this.assetsToTrack.size,
      cachedPrices: this.cache.size,
      avgAge: this.cache.size > 0 ? totalAge / this.cache.size : 0,
      stalePrices
    };
  }

  /**
   * Clear all cached prices
   */
  clear(): void {
    this.cache.clear();
    this.assetsToTrack.clear();
  }
}

/**
 * Load PriceHotCacheService configuration from environment variables
 */
export function loadPriceHotCacheConfig(): PriceHotCacheConfig {
  return {
    cacheIntervalMs: Number(process.env.PRICE_HOT_CACHE_INTERVAL_MS || 400), // 400ms default
    stalePriceThresholdMs: Number(process.env.PRICE_HOT_STALE_MS || 1000), // 1s default
    maxCacheSize: Number(process.env.PRICE_HOT_MAX_ASSETS || 100) // Track up to 100 assets
  };
}
