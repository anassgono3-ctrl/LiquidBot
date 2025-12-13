/**
 * HotSetTracker: Near-threshold user tracking (Hot/Warm/Cold sets)
 * 
 * Maintains categorized sets of users based on health factor proximity to liquidation:
 * - Hot set: HF ≤ hotSetHfMax (default 1.03) - imminent liquidation risk
 * - Warm set: HF ≤ warmSetHfMax (default 1.10) - approaching liquidation
 * - Cold set: HF > warmSetHfMax - safe for now
 * 
 * Prioritizes hot-set recomputes to reduce time-to-attempt for liquidations.
 */

import { normalizeAddress } from '../utils/Address.js';

export interface HotSetEntry {
  address: string;
  hf: number;
  lastUpdated: number; // Timestamp (ms)
  lastBlock: number;
  totalCollateralUsd: number;
  totalDebtUsd: number;
  triggerType: 'event' | 'head' | 'price';
}

export interface HotSetTrackerConfig {
  hotSetHfMax: number;
  warmSetHfMax: number;
  maxHotSize: number;
  maxWarmSize: number;
}

export type SetCategory = 'hot' | 'warm' | 'cold';

/**
 * HotSetTracker manages near-threshold users in prioritized sets
 */
export class HotSetTracker {
  private hotSet: Map<string, HotSetEntry> = new Map(); // HF ≤ hotSetHfMax
  private warmSet: Map<string, HotSetEntry> = new Map(); // hotSetHfMax < HF ≤ warmSetHfMax
  
  private readonly hotSetHfMax: number;
  private readonly warmSetHfMax: number;
  private readonly maxHotSize: number;
  private readonly maxWarmSize: number;

  constructor(config: HotSetTrackerConfig) {
    this.hotSetHfMax = config.hotSetHfMax;
    this.warmSetHfMax = config.warmSetHfMax;
    this.maxHotSize = config.maxHotSize;
    this.maxWarmSize = config.maxWarmSize;

    // Validate config
    if (this.hotSetHfMax >= this.warmSetHfMax) {
      throw new Error('hotSetHfMax must be less than warmSetHfMax');
    }

    // eslint-disable-next-line no-console
    console.log(
      `[hot-set] Initialized: hot ≤ ${this.hotSetHfMax}, warm ≤ ${this.warmSetHfMax}, ` +
      `maxHot=${this.maxHotSize}, maxWarm=${this.maxWarmSize}`
    );
  }

  /**
   * Update a user's entry based on their current health factor
   */
  update(
    address: string,
    hf: number,
    blockNumber: number,
    triggerType: 'event' | 'head' | 'price',
    totalCollateralUsd: number,
    totalDebtUsd: number
  ): SetCategory {
    const normalized = normalizeAddress(address);
    const now = Date.now();

    const entry: HotSetEntry = {
      address: normalized,
      hf,
      lastUpdated: now,
      lastBlock: blockNumber,
      totalCollateralUsd,
      totalDebtUsd,
      triggerType
    };

    // Determine target set
    const category = this.categorize(hf);

    // Remove from all sets first
    this.removeFromAllSets(normalized);

    // Add to appropriate set
    if (category === 'hot') {
      this.addToHotSet(entry);
    } else if (category === 'warm') {
      this.addToWarmSet(entry);
    }
    // Cold set doesn't track entries

    return category;
  }

  /**
   * Categorize a health factor
   */
  private categorize(hf: number): SetCategory {
    if (hf <= this.hotSetHfMax) {
      return 'hot';
    } else if (hf <= this.warmSetHfMax) {
      return 'warm';
    } else {
      return 'cold';
    }
  }

  /**
   * Add entry to hot set (with capacity management)
   */
  private addToHotSet(entry: HotSetEntry): void {
    // Check capacity
    if (this.hotSet.size >= this.maxHotSize && !this.hotSet.has(entry.address)) {
      // At capacity, evict highest HF entry
      this.evictHighestHf(this.hotSet);
    }

    this.hotSet.set(entry.address, entry);
  }

  /**
   * Add entry to warm set (with capacity management)
   */
  private addToWarmSet(entry: HotSetEntry): void {
    // Check capacity
    if (this.warmSet.size >= this.maxWarmSize && !this.warmSet.has(entry.address)) {
      // At capacity, evict highest HF entry
      this.evictHighestHf(this.warmSet);
    }

    this.warmSet.set(entry.address, entry);
  }

  /**
   * Evict entry with highest HF from a set
   */
  private evictHighestHf(set: Map<string, HotSetEntry>): void {
    let highestEntry: { address: string; hf: number } | null = null;

    for (const [addr, entry] of set.entries()) {
      if (!highestEntry || entry.hf > highestEntry.hf) {
        highestEntry = { address: addr, hf: entry.hf };
      }
    }

    if (highestEntry) {
      set.delete(highestEntry.address);
    }
  }

  /**
   * Remove user from all sets
   */
  private removeFromAllSets(address: string): void {
    this.hotSet.delete(address);
    this.warmSet.delete(address);
  }

  /**
   * Remove a user entirely (e.g., when they repay and become safe)
   */
  remove(address: string): void {
    const normalized = normalizeAddress(address);
    this.removeFromAllSets(normalized);
  }

  /**
   * Get hot set entries sorted by HF (lowest first)
   */
  getHotSet(): HotSetEntry[] {
    return Array.from(this.hotSet.values()).sort((a, b) => a.hf - b.hf);
  }

  /**
   * Get warm set entries sorted by HF (lowest first)
   */
  getWarmSet(): HotSetEntry[] {
    return Array.from(this.warmSet.values()).sort((a, b) => a.hf - b.hf);
  }

  /**
   * Get top K hot entries by (1 - HF) distance
   */
  getTopK(k: number): HotSetEntry[] {
    const hot = this.getHotSet();
    return hot.slice(0, Math.min(k, hot.length));
  }

  /**
   * Check if user is in hot set
   */
  isInHotSet(address: string): boolean {
    return this.hotSet.has(normalizeAddress(address));
  }

  /**
   * Check if user is in warm set
   */
  isInWarmSet(address: string): boolean {
    return this.warmSet.has(normalizeAddress(address));
  }

  /**
   * Get user's current category
   */
  getCategory(address: string): SetCategory | null {
    const normalized = normalizeAddress(address);
    
    if (this.hotSet.has(normalized)) {
      return 'hot';
    } else if (this.warmSet.has(normalized)) {
      return 'warm';
    }
    
    return null;
  }

  /**
   * Get statistics
   */
  /**
   * Get count of low HF users (hot set)
   * Used by predictive orchestrator for dynamic candidate cap
   */
  getLowHfCount(): number {
    return this.hotSet.size;
  }

  getStats(): {
    hotSize: number;
    warmSize: number;
    minHotHf: number | null;
    maxHotHf: number | null;
  } {
    const hotEntries = Array.from(this.hotSet.values());
    
    let minHotHf: number | null = null;
    let maxHotHf: number | null = null;
    
    if (hotEntries.length > 0) {
      minHotHf = Math.min(...hotEntries.map(e => e.hf));
      maxHotHf = Math.max(...hotEntries.map(e => e.hf));
    }

    return {
      hotSize: this.hotSet.size,
      warmSize: this.warmSet.size,
      minHotHf,
      maxHotHf
    };
  }

  /**
   * Clear all sets
   */
  clear(): void {
    this.hotSet.clear();
    this.warmSet.clear();
  }
}
