import type { LiquidationCall } from '../types/index.js';

export interface LiquidationTrackerOptions {
  /**
   * Maximum number of IDs to track. When exceeded, oldest IDs are pruned (FIFO).
   * Default: 5000
   */
  max?: number;
}

export interface LiquidationTrackerResult {
  /** Newly discovered liquidation events (not in seen set) */
  newEvents: LiquidationCall[];
  /** Size of the snapshot provided */
  snapshotLen: number;
  /** Total number of unique IDs tracked */
  seenSize: number;
}

export interface LiquidationTracker {
  /**
   * Process a snapshot and return new events
   */
  diff(snapshot: LiquidationCall[]): LiquidationTrackerResult;
  /**
   * Get current stats
   */
  getStats(): { seenTotal: number; max: number };
}

/**
 * Creates a liquidation tracker that maintains an in-memory set of seen liquidation IDs
 * and identifies new events in each snapshot.
 */
export function createLiquidationTracker(opts: LiquidationTrackerOptions = {}): LiquidationTracker {
  const max = opts.max ?? 5000;
  const seenIds = new Set<string>();
  const idQueue: string[] = []; // FIFO queue for pruning

  function diff(snapshot: LiquidationCall[]): LiquidationTrackerResult {
    const newEvents: LiquidationCall[] = [];

    for (const event of snapshot) {
      if (!seenIds.has(event.id)) {
        newEvents.push(event);
        seenIds.add(event.id);
        idQueue.push(event.id);
      }
    }

    // Prune if exceeds max
    while (seenIds.size > max && idQueue.length > 0) {
      const oldestId = idQueue.shift();
      if (oldestId) {
        seenIds.delete(oldestId);
      }
    }

    return {
      newEvents,
      snapshotLen: snapshot.length,
      seenSize: seenIds.size
    };
  }

  function getStats() {
    return {
      seenTotal: seenIds.size,
      max
    };
  }

  return { diff, getStats };
}
