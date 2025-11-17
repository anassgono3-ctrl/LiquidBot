// ReserveEventCoalescer: Micro-coalesce rapid ReserveDataUpdated bursts
// Debounces rapid reserve events within 30-50ms window to avoid redundant batch rechecks

import EventEmitter from 'events';

import { config } from '../config/index.js';
import {
  reserveEventCoalescedTotal,
  reserveEventBatchSizeHistogram,
  reserveEventDebounceTimeMs
} from '../metrics/index.js';

export interface ReserveEvent {
  reserve: string;
  blockNumber: number;
  timestamp: number;
  eventType: 'ReserveDataUpdated' | 'ReserveIndexUpdated';
}

export interface CoalescedBatch {
  reserves: string[];
  blockNumber: number;
  eventCount: number;
  firstEventTime: number;
  lastEventTime: number;
}

export interface ReserveEventCoalescerOptions {
  debounceWindowMs?: number; // Default 30-50ms
  maxBatchSize?: number; // Max events per batch before forcing flush
  perReserveCoalescing?: boolean; // Coalesce per-reserve vs globally
}

/**
 * ReserveEventCoalescer debounces rapid ReserveDataUpdated events
 * to prevent redundant 200-call batch rechecks.
 * 
 * When multiple reserve events arrive in quick succession:
 * 1. Events are collected in a debounce window (30-50ms)
 * 2. Duplicate reserves are deduplicated
 * 3. A single batch is emitted after the window expires
 * 
 * This avoids the scenario where 5 rapid reserve updates trigger
 * 5 separate 200-call batch checks (1000 calls) when they could
 * be handled in a single batch (200 calls).
 */
export class ReserveEventCoalescer extends EventEmitter {
  private readonly debounceWindowMs: number;
  private readonly maxBatchSize: number;
  private readonly perReserveCoalescing: boolean;

  // Per-reserve debounce state
  private reserveBatches: Map<string, {
    events: ReserveEvent[];
    timer: NodeJS.Timeout;
    firstEventTime: number;
  }> = new Map();

  // Global debounce state (used when !perReserveCoalescing)
  private globalBatch: {
    events: ReserveEvent[];
    reserves: Set<string>;
    timer: NodeJS.Timeout | null;
    firstEventTime: number;
  } | null = null;

  private isShuttingDown = false;

  constructor(options?: ReserveEventCoalescerOptions) {
    super();
    this.debounceWindowMs = options?.debounceWindowMs ?? 40; // Default 40ms
    this.maxBatchSize = options?.maxBatchSize ?? 50;
    this.perReserveCoalescing = options?.perReserveCoalescing ?? false;

    // eslint-disable-next-line no-console
    console.log(
      `[reserve-coalescer] Initialized with debounceWindow=${this.debounceWindowMs}ms, ` +
      `maxBatchSize=${this.maxBatchSize}, perReserve=${this.perReserveCoalescing}`
    );
  }

  /**
   * Add a reserve event to the coalescer
   */
  addEvent(event: ReserveEvent): void {
    if (this.isShuttingDown) {
      return;
    }

    if (this.perReserveCoalescing) {
      this.addEventPerReserve(event);
    } else {
      this.addEventGlobal(event);
    }
  }

  /**
   * Add event with per-reserve coalescing
   * Each reserve has its own debounce window
   */
  private addEventPerReserve(event: ReserveEvent): void {
    const reserve = event.reserve.toLowerCase();

    if (!this.reserveBatches.has(reserve)) {
      // Create new batch for this reserve
      const timer = setTimeout(() => {
        this.flushReserveBatch(reserve);
      }, this.debounceWindowMs);

      this.reserveBatches.set(reserve, {
        events: [event],
        timer,
        firstEventTime: event.timestamp
      });
    } else {
      // Add to existing batch
      const batch = this.reserveBatches.get(reserve)!;
      batch.events.push(event);

      // Reset timer (debounce)
      clearTimeout(batch.timer);
      batch.timer = setTimeout(() => {
        this.flushReserveBatch(reserve);
      }, this.debounceWindowMs);

      // Force flush if batch too large
      if (batch.events.length >= this.maxBatchSize) {
        clearTimeout(batch.timer);
        this.flushReserveBatch(reserve);
      }
    }
  }

  /**
   * Add event with global coalescing
   * All reserves share a single debounce window
   */
  private addEventGlobal(event: ReserveEvent): void {
    if (!this.globalBatch) {
      // Create new global batch
      const timer = setTimeout(() => {
        this.flushGlobalBatch();
      }, this.debounceWindowMs);

      this.globalBatch = {
        events: [event],
        reserves: new Set([event.reserve.toLowerCase()]),
        timer,
        firstEventTime: event.timestamp
      };
    } else {
      // Add to existing batch
      this.globalBatch.events.push(event);
      this.globalBatch.reserves.add(event.reserve.toLowerCase());

      // Reset timer (debounce)
      if (this.globalBatch.timer) {
        clearTimeout(this.globalBatch.timer);
      }
      this.globalBatch.timer = setTimeout(() => {
        this.flushGlobalBatch();
      }, this.debounceWindowMs);

      // Force flush if batch too large
      if (this.globalBatch.events.length >= this.maxBatchSize) {
        if (this.globalBatch.timer) {
          clearTimeout(this.globalBatch.timer);
        }
        this.flushGlobalBatch();
      }
    }
  }

  /**
   * Flush a per-reserve batch
   */
  private flushReserveBatch(reserve: string): void {
    const batch = this.reserveBatches.get(reserve);
    if (!batch) {
      return;
    }

    this.reserveBatches.delete(reserve);

    const now = Date.now();
    const debounceTime = now - batch.firstEventTime;

    // Get unique block numbers
    const blockNumbers = [...new Set(batch.events.map(e => e.blockNumber))];
    const latestBlock = Math.max(...blockNumbers);

    const coalescedBatch: CoalescedBatch = {
      reserves: [reserve],
      blockNumber: latestBlock,
      eventCount: batch.events.length,
      firstEventTime: batch.firstEventTime,
      lastEventTime: now
    };

    // Emit metrics
    reserveEventCoalescedTotal.inc({ reserve });
    reserveEventBatchSizeHistogram.observe(batch.events.length);
    reserveEventDebounceTimeMs.observe(debounceTime);

    // Emit coalesced batch
    this.emit('batch', coalescedBatch);

    if (batch.events.length > 1) {
      // eslint-disable-next-line no-console
      console.log(
        `[reserve-coalescer] Coalesced ${batch.events.length} events for reserve ${reserve} ` +
        `(debounce=${debounceTime}ms, block=${latestBlock})`
      );
    }
  }

  /**
   * Flush the global batch
   */
  private flushGlobalBatch(): void {
    if (!this.globalBatch) {
      return;
    }

    const batch = this.globalBatch;
    this.globalBatch = null;

    const now = Date.now();
    const debounceTime = now - batch.firstEventTime;

    // Get unique block numbers
    const blockNumbers = [...new Set(batch.events.map(e => e.blockNumber))];
    const latestBlock = Math.max(...blockNumbers);

    const coalescedBatch: CoalescedBatch = {
      reserves: Array.from(batch.reserves),
      blockNumber: latestBlock,
      eventCount: batch.events.length,
      firstEventTime: batch.firstEventTime,
      lastEventTime: now
    };

    // Emit metrics (aggregate across all reserves)
    batch.reserves.forEach(reserve => {
      reserveEventCoalescedTotal.inc({ reserve });
    });
    reserveEventBatchSizeHistogram.observe(batch.events.length);
    reserveEventDebounceTimeMs.observe(debounceTime);

    // Emit coalesced batch
    this.emit('batch', coalescedBatch);

    if (batch.events.length > 1) {
      // eslint-disable-next-line no-console
      console.log(
        `[reserve-coalescer] Coalesced ${batch.events.length} events for ${batch.reserves.size} reserve(s) ` +
        `(debounce=${debounceTime}ms, block=${latestBlock})`
      );
    }
  }

  /**
   * Flush all pending batches immediately
   */
  flushAll(): void {
    // Flush per-reserve batches
    const reserves = Array.from(this.reserveBatches.keys());
    for (const reserve of reserves) {
      const batch = this.reserveBatches.get(reserve);
      if (batch) {
        clearTimeout(batch.timer);
        this.flushReserveBatch(reserve);
      }
    }

    // Flush global batch
    if (this.globalBatch && this.globalBatch.timer) {
      clearTimeout(this.globalBatch.timer);
      this.flushGlobalBatch();
    }
  }

  /**
   * Stop coalescer and cleanup
   */
  stop(): void {
    this.isShuttingDown = true;

    // Clear all timers and flush pending batches
    this.flushAll();

    // eslint-disable-next-line no-console
    console.log('[reserve-coalescer] Stopped');
  }

  /**
   * Get statistics about pending batches
   */
  getStats(): {
    pendingPerReserve: number;
    pendingGlobal: number;
    totalPendingEvents: number;
  } {
    let totalPendingEvents = 0;

    // Count per-reserve events
    for (const batch of this.reserveBatches.values()) {
      totalPendingEvents += batch.events.length;
    }

    // Count global events
    if (this.globalBatch) {
      totalPendingEvents += this.globalBatch.events.length;
    }

    return {
      pendingPerReserve: this.reserveBatches.size,
      pendingGlobal: this.globalBatch ? 1 : 0,
      totalPendingEvents
    };
  }
}
