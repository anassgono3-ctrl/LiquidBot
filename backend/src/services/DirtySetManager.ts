// DirtySetManager: Tracks users marked as dirty due to events or price triggers
// Provides TTL-based expiration and metrics for observability

import {
  dirtySetSize,
  dirtyMarkedTotal,
  dirtyConsumedTotal,
  dirtyExpiredTotal
} from '../metrics/index.js';

export interface DirtyEntry {
  address: string;
  reasons: Set<string>; // e.g., "borrow", "repay", "price", "supply", "withdraw"
  firstMarkedAt: number; // timestamp in ms
  lastMarkedAt: number; // timestamp in ms
}

export interface DirtySetManagerOptions {
  ttlSec?: number; // Time-to-live for dirty entries in seconds
}

/**
 * DirtySetManager maintains a time-bounded set of users marked as "dirty"
 * due to recent events or price triggers. Provides TTL-based expiration.
 */
export class DirtySetManager {
  private entries: Map<string, DirtyEntry> = new Map();
  private readonly ttlMs: number;

  constructor(options: DirtySetManagerOptions = {}) {
    this.ttlMs = (options.ttlSec ?? 90) * 1000;
  }

  /**
   * Mark a user as dirty with a specific reason
   * @param address User address
   * @param reason Reason for marking (e.g., "borrow", "price")
   */
  mark(address: string, reason: string): void {
    const normalized = address.toLowerCase();
    const now = Date.now();

    const existing = this.entries.get(normalized);
    if (existing) {
      // Update existing entry
      existing.reasons.add(reason);
      existing.lastMarkedAt = now;
    } else {
      // Create new entry
      const entry: DirtyEntry = {
        address: normalized,
        reasons: new Set([reason]),
        firstMarkedAt: now,
        lastMarkedAt: now
      };
      this.entries.set(normalized, entry);
      
      // Increment metric
      dirtyMarkedTotal.inc({ reason });
    }

    // Update gauge
    dirtySetSize.set(this.entries.size);
  }

  /**
   * Mark multiple users as dirty with the same reason
   * @param addresses Array of user addresses
   * @param reason Reason for marking
   */
  markBulk(addresses: string[], reason: string): void {
    for (const address of addresses) {
      this.mark(address, reason);
    }
  }

  /**
   * Check if a user is marked as dirty
   * @param address User address
   * @returns true if user is dirty and not expired
   */
  isDirty(address: string): boolean {
    this.expireStale();
    return this.entries.has(address.toLowerCase());
  }

  /**
   * Get dirty entry for a user
   * @param address User address
   * @returns DirtyEntry or undefined
   */
  get(address: string): DirtyEntry | undefined {
    this.expireStale();
    return this.entries.get(address.toLowerCase());
  }

  /**
   * Get all dirty users
   * @returns Array of dirty user addresses
   */
  getAll(): string[] {
    this.expireStale();
    return Array.from(this.entries.keys());
  }

  /**
   * Get all dirty entries with reasons
   * @returns Array of DirtyEntry objects
   */
  getAllEntries(): DirtyEntry[] {
    this.expireStale();
    return Array.from(this.entries.values());
  }

  /**
   * Get count of dirty users
   * @returns Number of dirty users
   */
  size(): number {
    this.expireStale();
    return this.entries.size;
  }

  /**
   * Consume (remove) a dirty user from the set
   * This is called after the user has been checked
   * @param address User address
   * @returns The consumed entry or undefined
   */
  consume(address: string): DirtyEntry | undefined {
    const normalized = address.toLowerCase();
    const entry = this.entries.get(normalized);
    
    if (entry) {
      this.entries.delete(normalized);
      dirtyConsumedTotal.inc();
      dirtySetSize.set(this.entries.size);
      return entry;
    }
    
    return undefined;
  }

  /**
   * Consume multiple dirty users
   * @param addresses Array of user addresses
   * @returns Map of consumed entries
   */
  consumeBulk(addresses: string[]): Map<string, DirtyEntry> {
    const consumed = new Map<string, DirtyEntry>();
    
    for (const address of addresses) {
      const entry = this.consume(address);
      if (entry) {
        consumed.set(address, entry);
      }
    }
    
    return consumed;
  }

  /**
   * Get intersection of dirty users with a given set
   * Useful for finding which users in a page are dirty
   * @param addresses Set or array of addresses to check
   * @returns Array of addresses that are both in the set and dirty
   */
  getIntersection(addresses: Set<string> | string[]): string[] {
    this.expireStale();
    const addressSet = addresses instanceof Set ? addresses : new Set(addresses);
    const dirty: string[] = [];
    
    for (const addr of addressSet) {
      if (this.entries.has(addr.toLowerCase())) {
        dirty.push(addr);
      }
    }
    
    return dirty;
  }

  /**
   * Get statistics about dirty reasons
   * @returns Object with reason counts
   */
  getReasonStats(): Record<string, number> {
    this.expireStale();
    const stats: Record<string, number> = {};
    
    for (const entry of this.entries.values()) {
      for (const reason of entry.reasons) {
        stats[reason] = (stats[reason] || 0) + 1;
      }
    }
    
    return stats;
  }

  /**
   * Expire stale entries based on TTL
   * Called automatically before most operations
   */
  private expireStale(): void {
    const now = Date.now();
    const toDelete: string[] = [];
    
    for (const [address, entry] of this.entries.entries()) {
      const age = now - entry.lastMarkedAt;
      if (age > this.ttlMs) {
        toDelete.push(address);
      }
    }
    
    for (const address of toDelete) {
      this.entries.delete(address);
      dirtyExpiredTotal.inc();
    }
    
    if (toDelete.length > 0) {
      dirtySetSize.set(this.entries.size);
    }
  }

  /**
   * Clear all entries (for testing)
   */
  clear(): void {
    this.entries.clear();
    dirtySetSize.set(0);
  }

  /**
   * Get TTL in milliseconds
   */
  getTtlMs(): number {
    return this.ttlMs;
  }
}
