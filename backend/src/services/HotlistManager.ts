// HotlistManager: Priority queue for users near liquidation threshold
// Maintains a bounded set of high-priority candidates for frequent rechecking

import {
  hotlistSize,
  hotlistPromotedTotal,
  hotlistRevisitTotal
} from '../metrics/index.js';

export interface HotlistEntry {
  address: string;
  healthFactor: number;
  totalDebtUsd: number;
  lastCheck: number; // timestamp in ms
  addedAt: number; // timestamp in ms
}

export interface HotlistManagerOptions {
  maxEntries?: number;
  minHf?: number;
  maxHf?: number;
  minDebtUsd?: number;
}

/**
 * HotlistManager maintains a priority queue of users that are:
 * - Close to liquidation threshold (HF near 1.0)
 * - Have meaningful debt size
 * Ranked by proximity to HF=1.0 and debt size
 */
export class HotlistManager {
  private entries: Map<string, HotlistEntry> = new Map();
  private readonly maxEntries: number;
  private readonly minHf: number;
  private readonly maxHf: number;
  private readonly minDebtUsd: number;

  constructor(options: HotlistManagerOptions = {}) {
    this.maxEntries = options.maxEntries ?? 2000;
    this.minHf = options.minHf ?? 0.98;
    this.maxHf = options.maxHf ?? 1.05;
    this.minDebtUsd = options.minDebtUsd ?? 100;
  }

  /**
   * Consider a user for hotlist inclusion
   * @param address User address
   * @param healthFactor Current health factor
   * @param totalDebtUsd Total debt in USD
   * @returns true if user was added/updated in hotlist
   */
  consider(address: string, healthFactor: number, totalDebtUsd: number): boolean {
    const normalized = address.toLowerCase();
    const now = Date.now();

    // Check if user meets hotlist criteria
    if (!this.meetsCriteria(healthFactor, totalDebtUsd)) {
      // Remove from hotlist if no longer meets criteria
      if (this.entries.has(normalized)) {
        this.entries.delete(normalized);
        hotlistSize.set(this.entries.size);
      }
      return false;
    }

    // Check if user already in hotlist
    const existing = this.entries.get(normalized);
    if (existing) {
      // Update existing entry
      existing.healthFactor = healthFactor;
      existing.totalDebtUsd = totalDebtUsd;
      existing.lastCheck = now;
      return true;
    }

    // Check if we have room for new entry
    if (this.entries.size >= this.maxEntries) {
      // Find lowest priority entry to evict
      const lowestPriority = this.findLowestPriority();
      if (lowestPriority) {
        const newPriority = this.calculatePriority(healthFactor, totalDebtUsd);
        const lowestPriorityValue = this.calculatePriority(
          lowestPriority.healthFactor,
          lowestPriority.totalDebtUsd
        );

        // Only add if new entry has higher priority
        if (newPriority > lowestPriorityValue) {
          this.entries.delete(lowestPriority.address);
        } else {
          return false;
        }
      }
    }

    // Add new entry
    const entry: HotlistEntry = {
      address: normalized,
      healthFactor,
      totalDebtUsd,
      lastCheck: now,
      addedAt: now
    };

    this.entries.set(normalized, entry);
    hotlistPromotedTotal.inc();
    hotlistSize.set(this.entries.size);
    return true;
  }

  /**
   * Check if a user meets hotlist criteria
   * @param healthFactor Health factor
   * @param totalDebtUsd Total debt in USD
   * @returns true if meets criteria
   */
  private meetsCriteria(healthFactor: number, totalDebtUsd: number): boolean {
    return (
      healthFactor >= this.minHf &&
      healthFactor <= this.maxHf &&
      totalDebtUsd >= this.minDebtUsd
    );
  }

  /**
   * Calculate priority score for a user
   * Higher score = higher priority
   * @param healthFactor Health factor
   * @param totalDebtUsd Total debt in USD
   * @returns Priority score
   */
  private calculatePriority(healthFactor: number, totalDebtUsd: number): number {
    // Priority based on:
    // 1. Proximity to HF=1.0 (closer is higher priority)
    // 2. Debt size (larger is higher priority)

    // Distance from 1.0, inverted (closer = higher)
    const hfDistance = Math.abs(healthFactor - 1.0);
    const hfScore = 1.0 / (1.0 + hfDistance * 10); // Normalize to 0-1 range

    // Debt size, normalized (log scale for large numbers)
    const debtScore = Math.log10(Math.max(1, totalDebtUsd)) / 10; // Roughly 0-1 for debts up to 10B

    // Combined score (HF proximity weighted more heavily)
    return hfScore * 0.7 + debtScore * 0.3;
  }

  /**
   * Find the entry with lowest priority
   * @returns Hotlist entry or undefined
   */
  private findLowestPriority(): HotlistEntry | undefined {
    let lowest: HotlistEntry | undefined;
    let lowestPriority = Infinity;

    for (const entry of this.entries.values()) {
      const priority = this.calculatePriority(entry.healthFactor, entry.totalDebtUsd);
      if (priority < lowestPriority) {
        lowestPriority = priority;
        lowest = entry;
      }
    }

    return lowest;
  }

  /**
   * Get all hotlist entries sorted by priority (highest first)
   * @returns Array of hotlist entries
   */
  getAll(): HotlistEntry[] {
    const entries = Array.from(this.entries.values());
    
    // Sort by priority (descending)
    entries.sort((a, b) => {
      const priorityA = this.calculatePriority(a.healthFactor, a.totalDebtUsd);
      const priorityB = this.calculatePriority(b.healthFactor, b.totalDebtUsd);
      return priorityB - priorityA;
    });

    return entries;
  }

  /**
   * Get hotlist entry for a specific user
   * @param address User address
   * @returns Hotlist entry or undefined
   */
  get(address: string): HotlistEntry | undefined {
    return this.entries.get(address.toLowerCase());
  }

  /**
   * Check if user is in hotlist
   * @param address User address
   * @returns true if in hotlist
   */
  has(address: string): boolean {
    return this.entries.has(address.toLowerCase());
  }

  /**
   * Get hotlist size
   * @returns Number of entries
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Update last check timestamp for a user
   * @param address User address
   */
  touch(address: string): void {
    const entry = this.entries.get(address.toLowerCase());
    if (entry) {
      entry.lastCheck = Date.now();
      hotlistRevisitTotal.inc();
    }
  }

  /**
   * Get entries that need revisiting (haven't been checked recently)
   * @param maxAgeSec Maximum age in seconds
   * @returns Array of addresses that need checking
   */
  getNeedingRevisit(maxAgeSec: number): string[] {
    const now = Date.now();
    const maxAgeMs = maxAgeSec * 1000;
    const needRevisit: string[] = [];

    for (const entry of this.entries.values()) {
      const age = now - entry.lastCheck;
      if (age >= maxAgeMs) {
        needRevisit.push(entry.address);
      }
    }

    return needRevisit;
  }

  /**
   * Clear all entries (for testing)
   */
  clear(): void {
    this.entries.clear();
    hotlistSize.set(0);
  }

  /**
   * Get configuration
   */
  getConfig() {
    return {
      maxEntries: this.maxEntries,
      minHf: this.minHf,
      maxHf: this.maxHf,
      minDebtUsd: this.minDebtUsd
    };
  }
}
