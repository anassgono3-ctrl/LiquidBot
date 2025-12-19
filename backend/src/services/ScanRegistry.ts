/**
 * ScanRegistry: Global scan deduplication with in-flight locking and recently-completed tracking
 * 
 * Purpose: Prevent duplicate concurrent scans by enforcing strict deduplication across:
 * - Trigger type (price/reserve/head/event)
 * - Asset/symbol/reserve identifier
 * - Block number
 * - Reason hash (for additional context)
 * 
 * Features:
 * - In-flight map: tracks currently executing scans
 * - Recently-completed LRU: prevents re-scanning same target within TTL window
 * - TTL-based cleanup: max(2 blocks * avg_block_time, 10s)
 * - Comprehensive metrics for observability
 * 
 * Replaces ScanConcurrencyController with stronger deduplication keys.
 */

import { config } from '../config/index.js';
import { scansSuppressedByRegistry } from '../metrics/index.js';

export interface ScanKey {
  triggerType: 'price' | 'reserve' | 'head' | 'event';
  symbolOrReserve?: string; // Asset symbol (WETH, USDC) or reserve address
  blockTag?: number;
  reasonHash?: string; // Additional context for deduplication
}

interface ScanEntry {
  key: string;
  startTime: number;
  completedTime?: number;
  ttl: number;
}

interface ScanRegistryStats {
  inFlight: number;
  recentlyCompleted: number;
  totalSuppressed: number;
  avgBlockTimeMs: number;
}

/**
 * ScanRegistry enforces global scan deduplication
 */
export class ScanRegistry {
  // In-flight scans
  private inFlight: Map<string, ScanEntry> = new Map();
  
  // Recently completed scans (TTL-based LRU)
  private recentlyCompleted: Map<string, ScanEntry> = new Map();
  
  // Configuration
  private readonly defaultTtlMs: number;
  private readonly maxRecentlyCompletedSize: number;
  private readonly avgBlockTimeMs: number;
  
  // Stats tracking
  private totalSuppressed = 0;
  
  constructor(options?: {
    defaultTtlMs?: number;
    maxRecentlyCompletedSize?: number;
    avgBlockTimeMs?: number;
  }) {
    this.avgBlockTimeMs = options?.avgBlockTimeMs ?? 2000; // 2s per block on Base
    this.defaultTtlMs = options?.defaultTtlMs ?? Math.max(2 * this.avgBlockTimeMs, 10000); // max(2 blocks, 10s)
    this.maxRecentlyCompletedSize = options?.maxRecentlyCompletedSize ?? 1000;
    
    console.log(
      `[scan-registry] Initialized: ttl=${this.defaultTtlMs}ms, ` +
      `maxRecentlyCompleted=${this.maxRecentlyCompletedSize}, ` +
      `avgBlockTime=${this.avgBlockTimeMs}ms`
    );
    
    // Start periodic cleanup
    this.startCleanup();
  }
  
  /**
   * Generate a strong deduplication key from scan parameters
   */
  private generateKey(scanKey: ScanKey): string {
    const parts: string[] = [scanKey.triggerType];
    
    if (scanKey.symbolOrReserve) {
      // Normalize to lowercase and take first 10 chars for reserve addresses
      const identifier = scanKey.symbolOrReserve.toLowerCase();
      const normalized = identifier.startsWith('0x') 
        ? identifier.slice(0, 12) 
        : identifier;
      parts.push(normalized);
    }
    
    if (scanKey.blockTag !== undefined) {
      parts.push(`b${scanKey.blockTag}`);
    }
    
    if (scanKey.reasonHash) {
      parts.push(scanKey.reasonHash);
    }
    
    return parts.join(':');
  }
  
  /**
   * Attempt to acquire a scan lock
   * 
   * Returns true if scan can proceed, false if suppressed (duplicate)
   */
  public acquire(scanKey: ScanKey): boolean {
    const key = this.generateKey(scanKey);
    const now = Date.now();
    
    // Check if already in-flight
    const inFlightEntry = this.inFlight.get(key);
    if (inFlightEntry) {
      const elapsed = now - inFlightEntry.startTime;
      if (elapsed < inFlightEntry.ttl) {
        // Still in-flight - suppress
        this.totalSuppressed++;
        scansSuppressedByRegistry.inc({ 
          trigger_type: scanKey.triggerType,
          reason: 'in_flight'
        });
        
        console.log(
          `[scan-suppress] registry=in_flight trigger=${scanKey.triggerType} ` +
          `identifier=${scanKey.symbolOrReserve || 'none'} ` +
          `block=${scanKey.blockTag || 'none'} ` +
          `elapsed=${Math.round(elapsed)}ms ttl=${inFlightEntry.ttl}ms`
        );
        
        return false;
      }
      
      // In-flight entry expired (stale) - remove and allow new scan
      this.inFlight.delete(key);
    }
    
    // Check if recently completed
    const recentEntry = this.recentlyCompleted.get(key);
    if (recentEntry && recentEntry.completedTime) {
      const elapsed = now - recentEntry.completedTime;
      if (elapsed < recentEntry.ttl) {
        // Recently completed within TTL - suppress
        this.totalSuppressed++;
        scansSuppressedByRegistry.inc({ 
          trigger_type: scanKey.triggerType,
          reason: 'recently_completed'
        });
        
        console.log(
          `[scan-suppress] registry=recently_completed trigger=${scanKey.triggerType} ` +
          `identifier=${scanKey.symbolOrReserve || 'none'} ` +
          `block=${scanKey.blockTag || 'none'} ` +
          `elapsed=${Math.round(elapsed)}ms ttl=${recentEntry.ttl}ms`
        );
        
        return false;
      }
      
      // Recently-completed entry expired - remove
      this.recentlyCompleted.delete(key);
    }
    
    // Acquire new lock
    this.inFlight.set(key, {
      key,
      startTime: now,
      ttl: this.defaultTtlMs
    });
    
    return true;
  }
  
  /**
   * Release a scan lock and move to recently-completed
   */
  public release(scanKey: ScanKey): void {
    const key = this.generateKey(scanKey);
    const entry = this.inFlight.get(key);
    
    if (!entry) {
      // Not in-flight - already released or never acquired
      return;
    }
    
    // Remove from in-flight
    this.inFlight.delete(key);
    
    // Add to recently-completed with TTL
    this.recentlyCompleted.set(key, {
      key,
      startTime: entry.startTime,
      completedTime: Date.now(),
      ttl: this.defaultTtlMs
    });
    
    // Enforce max size (LRU eviction if needed)
    if (this.recentlyCompleted.size > this.maxRecentlyCompletedSize) {
      this.evictOldestRecentlyCompleted();
    }
  }
  
  /**
   * Check if a scan is currently in-flight
   */
  public isInFlight(scanKey: ScanKey): boolean {
    const key = this.generateKey(scanKey);
    const entry = this.inFlight.get(key);
    
    if (!entry) return false;
    
    const elapsed = Date.now() - entry.startTime;
    return elapsed < entry.ttl;
  }
  
  /**
   * Evict oldest recently-completed entry (LRU)
   */
  private evictOldestRecentlyCompleted(): void {
    let oldestKey: string | null = null;
    let oldestTime = Number.MAX_SAFE_INTEGER;
    
    for (const [key, entry] of this.recentlyCompleted.entries()) {
      const time = entry.completedTime || entry.startTime;
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.recentlyCompleted.delete(oldestKey);
    }
  }
  
  /**
   * Clean up expired entries (both in-flight and recently-completed)
   */
  public cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    
    // Clean up expired in-flight scans
    for (const [key, entry] of this.inFlight.entries()) {
      const elapsed = now - entry.startTime;
      if (elapsed >= entry.ttl) {
        this.inFlight.delete(key);
        cleaned++;
      }
    }
    
    // Clean up expired recently-completed scans
    for (const [key, entry] of this.recentlyCompleted.entries()) {
      if (!entry.completedTime) continue;
      
      const elapsed = now - entry.completedTime;
      if (elapsed >= entry.ttl) {
        this.recentlyCompleted.delete(key);
        cleaned++;
      }
    }
    
    return cleaned;
  }
  
  /**
   * Start periodic cleanup timer
   */
  private startCleanup(): void {
    const cleanupIntervalMs = Math.max(this.defaultTtlMs / 2, 5000); // Half TTL or 5s min
    
    setInterval(() => {
      const cleaned = this.cleanup();
      if (cleaned > 0) {
        console.log(`[scan-registry] Cleanup: removed ${cleaned} expired entries`);
      }
    }, cleanupIntervalMs);
  }
  
  /**
   * Get registry statistics
   */
  public getStats(): ScanRegistryStats {
    return {
      inFlight: this.inFlight.size,
      recentlyCompleted: this.recentlyCompleted.size,
      totalSuppressed: this.totalSuppressed,
      avgBlockTimeMs: this.avgBlockTimeMs
    };
  }
  
  /**
   * Clear all entries (for testing)
   */
  public clear(): void {
    this.inFlight.clear();
    this.recentlyCompleted.clear();
    this.totalSuppressed = 0;
  }
}
