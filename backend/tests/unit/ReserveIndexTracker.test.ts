/**
 * Unit tests for ReserveIndexTracker
 * Tests reserve index delta calculation and recheck gating
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ReserveIndexTracker } from '../../src/services/ReserveIndexTracker.js';

describe('ReserveIndexTracker', () => {
  let tracker: ReserveIndexTracker;
  
  beforeEach(() => {
    tracker = new ReserveIndexTracker(2); // 2 bps threshold
  });

  describe('calculateDelta', () => {
    it('should return shouldRecheck=true on first update (no previous data)', () => {
      const delta = tracker.calculateDelta(
        '0xreserve1',
        1000000000000000000n, // 1.0 * 1e18
        1000000000000000000n,
        'WETH'
      );

      expect(delta.shouldRecheck).toBe(true);
      expect(delta.reason).toBe('first_update');
      expect(delta.maxDeltaBps).toBe(0);
    });

    it('should skip recheck when delta is below threshold', () => {
      const reserve = '0xreserve1';
      const baseIndex = 1000000000000000000n; // 1.0 * 1e18
      
      // First update
      tracker.updateIndices(reserve, baseIndex, baseIndex, 100);
      
      // Second update: 0.01% change (1 bps) - below 2 bps threshold
      const newIndex = 1000100000000000000n; // 1.0001 * 1e18
      const delta = tracker.calculateDelta(reserve, newIndex, newIndex, 'WETH');

      expect(delta.shouldRecheck).toBe(false);
      expect(delta.reason).toBe('delta_below_threshold');
      expect(delta.liquidityIndexDeltaBps).toBeCloseTo(1, 1);
      expect(delta.variableBorrowIndexDeltaBps).toBeCloseTo(1, 1);
    });

    it('should recheck when delta exceeds threshold', () => {
      const reserve = '0xreserve1';
      const baseIndex = 1000000000000000000n; // 1.0 * 1e18
      
      // First update
      tracker.updateIndices(reserve, baseIndex, baseIndex, 100);
      
      // Second update: 0.03% change (3 bps) - above 2 bps threshold
      const newIndex = 1000300000000000000n; // 1.0003 * 1e18
      const delta = tracker.calculateDelta(reserve, newIndex, newIndex, 'WETH');

      expect(delta.shouldRecheck).toBe(true);
      expect(delta.reason).toBe('delta_above_threshold');
      expect(delta.maxDeltaBps).toBeGreaterThanOrEqual(2);
    });

    it('should use max delta from either liquidity or variableBorrow index', () => {
      const reserve = '0xreserve1';
      const baseIndex = 1000000000000000000n;
      
      // First update
      tracker.updateIndices(reserve, baseIndex, baseIndex, 100);
      
      // Second update: liquidityIndex small change (1 bps), variableBorrow large change (5 bps)
      const newLiquidityIndex = 1000100000000000000n; // 1 bps change
      const newVariableBorrowIndex = 1000500000000000000n; // 5 bps change
      
      const delta = tracker.calculateDelta(
        reserve,
        newLiquidityIndex,
        newVariableBorrowIndex,
        'WETH'
      );

      expect(delta.shouldRecheck).toBe(true);
      expect(delta.maxDeltaBps).toBeCloseTo(5, 1);
      expect(delta.liquidityIndexDeltaBps).toBeCloseTo(1, 1);
      expect(delta.variableBorrowIndexDeltaBps).toBeCloseTo(5, 1);
    });

    it('should handle multiple reserves independently', () => {
      const reserve1 = '0xreserve1';
      const reserve2 = '0xreserve2';
      const baseIndex = 1000000000000000000n;
      
      // Initialize both reserves
      tracker.updateIndices(reserve1, baseIndex, baseIndex, 100);
      tracker.updateIndices(reserve2, baseIndex, baseIndex, 100);
      
      // Update reserve1 with large delta
      const largeChangeIndex = 1000500000000000000n; // 5 bps
      const delta1 = tracker.calculateDelta(reserve1, largeChangeIndex, largeChangeIndex, 'WETH');
      expect(delta1.shouldRecheck).toBe(true);
      
      // Update reserve2 with small delta
      const smallChangeIndex = 1000050000000000000n; // 0.5 bps
      const delta2 = tracker.calculateDelta(reserve2, smallChangeIndex, smallChangeIndex, 'USDC');
      expect(delta2.shouldRecheck).toBe(false);
    });
  });

  describe('updateIndices', () => {
    it('should store and retrieve indices', () => {
      const reserve = '0xreserve1';
      const liquidityIndex = 1000000000000000000n;
      const variableBorrowIndex = 1500000000000000000n;
      
      tracker.updateIndices(reserve, liquidityIndex, variableBorrowIndex, 100);
      
      const stored = tracker.getIndices(reserve);
      expect(stored).toBeDefined();
      expect(stored?.liquidityIndex).toBe(liquidityIndex);
      expect(stored?.variableBorrowIndex).toBe(variableBorrowIndex);
      expect(stored?.blockNumber).toBe(100);
    });

    it('should normalize reserve addresses to lowercase', () => {
      const reserve = '0xABCDEF';
      const liquidityIndex = 1000000000000000000n;
      
      tracker.updateIndices(reserve, liquidityIndex, liquidityIndex, 100);
      
      // Should be retrievable with lowercase
      const stored = tracker.getIndices('0xabcdef');
      expect(stored).toBeDefined();
      expect(stored?.liquidityIndex).toBe(liquidityIndex);
    });
  });

  describe('clear', () => {
    it('should clear all tracked reserves', () => {
      tracker.updateIndices('0xreserve1', 1000000000000000000n, 1000000000000000000n, 100);
      tracker.updateIndices('0xreserve2', 1000000000000000000n, 1000000000000000000n, 100);
      
      const statsBefore = tracker.getStats();
      expect(statsBefore.trackedReserves).toBe(2);
      
      tracker.clear();
      
      const statsAfter = tracker.getStats();
      expect(statsAfter.trackedReserves).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle zero old index gracefully', () => {
      const reserve = '0xreserve1';
      
      // Initialize with zero index (shouldn't happen but handle it)
      tracker.updateIndices(reserve, 0n, 0n, 100);
      
      // Update with non-zero
      const delta = tracker.calculateDelta(reserve, 1000000000000000000n, 1000000000000000000n, 'WETH');
      
      // Should still recheck since previous was zero (edge case)
      expect(delta.liquidityIndexDeltaBps).toBe(0);
    });

    it('should handle very small index changes accurately', () => {
      const reserve = '0xreserve1';
      const baseIndex = 1000000000000000000n;
      
      tracker.updateIndices(reserve, baseIndex, baseIndex, 100);
      
      // 0.001% change (0.1 bps)
      const tinyChangeIndex = 1000010000000000000n;
      const delta = tracker.calculateDelta(reserve, tinyChangeIndex, tinyChangeIndex, 'WETH');
      
      expect(delta.shouldRecheck).toBe(false);
      expect(delta.maxDeltaBps).toBeLessThan(2);
    });
  });
});
