import { describe, it, expect } from 'vitest';

import { createLiquidationTracker } from '../../src/polling/liquidationTracker.js';
import type { LiquidationCall } from '../../src/types/index.js';

describe('liquidationTracker', () => {
  const createMockLiquidation = (id: string, timestamp = 1000): LiquidationCall => ({
    id,
    timestamp,
    liquidator: '0xLiquidator',
    user: '0xUser',
    principalAmount: '100',
    collateralAmount: '200',
    txHash: null,
    principalReserve: null,
    collateralReserve: null
  });

  it('identifies all events as new on first poll', () => {
    const tracker = createLiquidationTracker();
    const snapshot = [
      createMockLiquidation('a'),
      createMockLiquidation('b'),
      createMockLiquidation('c')
    ];

    const result = tracker.diff(snapshot);

    expect(result.newEvents).toHaveLength(3);
    expect(result.snapshotLen).toBe(3);
    expect(result.seenSize).toBe(3);
    expect(result.newEvents.map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns zero new events when snapshot has overlapping IDs', () => {
    const tracker = createLiquidationTracker();
    
    // First poll
    const snapshot1 = [
      createMockLiquidation('a'),
      createMockLiquidation('b'),
      createMockLiquidation('c')
    ];
    tracker.diff(snapshot1);

    // Second poll with same IDs
    const snapshot2 = [
      createMockLiquidation('a'),
      createMockLiquidation('b'),
      createMockLiquidation('c')
    ];
    const result = tracker.diff(snapshot2);

    expect(result.newEvents).toHaveLength(0);
    expect(result.snapshotLen).toBe(3);
    expect(result.seenSize).toBe(3);
  });

  it('identifies only new events in subsequent polls', () => {
    const tracker = createLiquidationTracker();
    
    // First poll
    const snapshot1 = [
      createMockLiquidation('a'),
      createMockLiquidation('b')
    ];
    tracker.diff(snapshot1);

    // Second poll with 2 overlapping + 2 new
    const snapshot2 = [
      createMockLiquidation('b'), // old
      createMockLiquidation('c'), // new
      createMockLiquidation('a'), // old
      createMockLiquidation('d')  // new
    ];
    const result = tracker.diff(snapshot2);

    expect(result.newEvents).toHaveLength(2);
    expect(result.snapshotLen).toBe(4);
    expect(result.seenSize).toBe(4);
    expect(result.newEvents.map(e => e.id)).toEqual(['c', 'd']);
  });

  it('prunes oldest IDs when max limit is exceeded', () => {
    const tracker = createLiquidationTracker({ max: 3 });
    
    // Add 5 events (should prune 2 oldest)
    const snapshot = [
      createMockLiquidation('a'),
      createMockLiquidation('b'),
      createMockLiquidation('c'),
      createMockLiquidation('d'),
      createMockLiquidation('e')
    ];
    const result = tracker.diff(snapshot);

    expect(result.newEvents).toHaveLength(5);
    expect(result.seenSize).toBe(3); // Only 3 kept after pruning

    // Verify that oldest were pruned by checking if they're detected as new again
    const snapshot2 = [
      createMockLiquidation('a'), // was pruned, should be new
      createMockLiquidation('b'), // was pruned, should be new
      createMockLiquidation('c'), // should still be tracked
      createMockLiquidation('d'), // should still be tracked
      createMockLiquidation('e')  // should still be tracked
    ];
    const result2 = tracker.diff(snapshot2);

    expect(result2.newEvents).toHaveLength(2);
    expect(result2.newEvents.map(e => e.id)).toEqual(['a', 'b']);
  });

  it('handles empty snapshots', () => {
    const tracker = createLiquidationTracker();
    const result = tracker.diff([]);

    expect(result.newEvents).toHaveLength(0);
    expect(result.snapshotLen).toBe(0);
    expect(result.seenSize).toBe(0);
  });

  it('getStats returns correct tracker state', () => {
    const tracker = createLiquidationTracker({ max: 100 });
    
    const snapshot = [
      createMockLiquidation('a'),
      createMockLiquidation('b')
    ];
    tracker.diff(snapshot);

    const stats = tracker.getStats();
    expect(stats.seenTotal).toBe(2);
    expect(stats.max).toBe(100);
  });
});
