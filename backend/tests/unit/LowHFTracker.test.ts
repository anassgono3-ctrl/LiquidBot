import { describe, it, expect, beforeEach } from 'vitest';

import { LowHFTracker } from '../../src/services/LowHFTracker.js';

describe('LowHFTracker', () => {
  let tracker: LowHFTracker;

  beforeEach(() => {
    tracker = new LowHFTracker({
      maxEntries: 10,
      recordMode: 'all',
      dumpOnShutdown: false,
      summaryIntervalSec: 0 // Disable periodic logging for tests
    });
  });

  describe('record', () => {
    it('should record a low HF entry', () => {
      tracker.record(
        '0x1234567890abcdef',
        0.95,
        12345678,
        'head',
        10000,
        9500
      );

      expect(tracker.getCount()).toBe(1);
      expect(tracker.getMinHF()).toBe(0.95);
    });

    it('should not record HF above threshold', () => {
      // Mock config.alwaysIncludeHfBelow which is accessed in record()
      // This test assumes the default threshold of 1.10
      tracker.record(
        '0x1234567890abcdef',
        1.15, // Above threshold
        12345678,
        'head',
        10000,
        8000
      );

      expect(tracker.getCount()).toBe(0);
    });

    it('should track minimum HF across multiple entries', () => {
      tracker.record('0xaddr1', 0.95, 12345678, 'head', 10000, 9500);
      tracker.record('0xaddr2', 0.85, 12345679, 'head', 10000, 9000);
      tracker.record('0xaddr3', 1.05, 12345680, 'head', 10000, 9000);

      expect(tracker.getCount()).toBe(3);
      expect(tracker.getMinHF()).toBe(0.85);
    });

    it('should respect max entries limit in all mode', () => {
      // Record 15 entries (exceeds max of 10)
      for (let i = 0; i < 15; i++) {
        tracker.record(
          `0xaddr${i}`,
          0.90 + i * 0.01, // HF from 0.90 to 1.04
          12345678 + i,
          'head',
          10000,
          9000
        );
      }

      // Should keep only 10 entries (lowest HF values)
      expect(tracker.getCount()).toBe(10);
    });
  });

  describe('min mode', () => {
    beforeEach(() => {
      tracker = new LowHFTracker({
        maxEntries: 10,
        recordMode: 'min',
        dumpOnShutdown: false,
        summaryIntervalSec: 0
      });
    });

    it('should only keep minimum HF entry', () => {
      tracker.record('0xaddr1', 0.95, 12345678, 'head', 10000, 9500);
      tracker.record('0xaddr2', 0.85, 12345679, 'head', 10000, 9000);
      tracker.record('0xaddr3', 1.05, 12345680, 'head', 10000, 9000);

      expect(tracker.getCount()).toBe(1);
      expect(tracker.getMinHF()).toBe(0.85);

      const entries = tracker.getAll();
      expect(entries[0].address).toBe('0xaddr2');
    });

    it('should replace min entry when lower HF found', () => {
      tracker.record('0xaddr1', 0.95, 12345678, 'head', 10000, 9500);
      expect(tracker.getCount()).toBe(1);

      tracker.record('0xaddr2', 0.85, 12345679, 'head', 10000, 9000);
      expect(tracker.getCount()).toBe(1);

      const entries = tracker.getAll();
      expect(entries[0].address).toBe('0xaddr2');
      expect(entries[0].lastHF).toBe(0.85);
    });
  });

  describe('getPaginated', () => {
    beforeEach(() => {
      // Add 20 entries
      for (let i = 0; i < 20; i++) {
        tracker.record(
          `0xaddr${i}`,
          0.80 + i * 0.01,
          12345678 + i,
          'head',
          10000,
          9000
        );
      }
    });

    it('should return paginated results', () => {
      const page1 = tracker.getPaginated(5, 0);
      expect(page1.length).toBe(5);

      const page2 = tracker.getPaginated(5, 5);
      expect(page2.length).toBe(5);

      // Verify different entries
      expect(page1[0].address).not.toBe(page2[0].address);
    });

    it('should respect limit parameter', () => {
      const results = tracker.getPaginated(3, 0);
      expect(results.length).toBe(3);
    });

    it('should handle offset beyond entries', () => {
      const results = tracker.getPaginated(10, 100);
      expect(results.length).toBe(0);
    });

    it('should exclude reserves when includeReserves=false', () => {
      const withReserves = tracker.getPaginated(5, 0, true);
      const withoutReserves = tracker.getPaginated(5, 0, false);

      // Both should have same length
      expect(withReserves.length).toBe(withoutReserves.length);

      // Reserves should be undefined when excluded
      expect(withoutReserves[0].reserves).toBeUndefined();
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      tracker.record('0xaddr1', 0.95, 12345678, 'head', 10000, 9500);
      tracker.record('0xaddr2', 0.85, 12345679, 'head', 10000, 9000);

      const stats = tracker.getStats();
      expect(stats.count).toBe(2);
      expect(stats.minHF).toBe(0.85);
      expect(stats.mode).toBe('all');
      expect(stats.maxEntries).toBe(10);
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      tracker.record('0xaddr1', 0.95, 12345678, 'head', 10000, 9500);
      tracker.record('0xaddr2', 0.85, 12345679, 'head', 10000, 9000);

      expect(tracker.getCount()).toBe(2);

      tracker.clear();

      expect(tracker.getCount()).toBe(0);
      expect(tracker.getMinHF()).toBeNull();
    });
  });

  describe('extended tracking', () => {
    it('should include reserves when extendedEnabled=true, mode=all, and reserves provided', () => {
      const trackerWithExtended = new LowHFTracker({
        maxEntries: 10,
        recordMode: 'all',
        extendedEnabled: true,
        dumpOnShutdown: false,
        summaryIntervalSec: 0
      });

      const reserves = [
        {
          asset: '0xabcd1234',
          symbol: 'WETH',
          ltv: 0.80,
          liquidationThreshold: 0.85,
          collateralUsd: 10000,
          debtUsd: 0,
          sourcePrice: 'chainlink:0xfeed123'
        }
      ];

      trackerWithExtended.record(
        '0x1234567890abcdef',
        0.95,
        12345678,
        'head',
        10000,
        9500,
        reserves
      );

      const entries = trackerWithExtended.getAll();
      expect(entries[0].reserves).toBeDefined();
      expect(entries[0].reserves?.length).toBe(1);
      expect(entries[0].reserves?.[0].symbol).toBe('WETH');
    });

    it('should not include reserves when extendedEnabled=false', () => {
      const trackerWithoutExtended = new LowHFTracker({
        maxEntries: 10,
        recordMode: 'all',
        extendedEnabled: false,
        dumpOnShutdown: false,
        summaryIntervalSec: 0
      });

      const reserves = [
        {
          asset: '0xabcd1234',
          symbol: 'WETH',
          ltv: 0.80,
          liquidationThreshold: 0.85,
          collateralUsd: 10000,
          debtUsd: 0,
          sourcePrice: 'chainlink:0xfeed123'
        }
      ];

      trackerWithoutExtended.record(
        '0x1234567890abcdef',
        0.95,
        12345678,
        'head',
        10000,
        9500,
        reserves
      );

      const entries = trackerWithoutExtended.getAll();
      expect(entries[0].reserves).toBeUndefined();
    });

    it('should not include reserves in min mode even if extended is enabled', () => {
      const trackerMinMode = new LowHFTracker({
        maxEntries: 10,
        recordMode: 'min',
        extendedEnabled: true,
        dumpOnShutdown: false,
        summaryIntervalSec: 0
      });

      const reserves = [
        {
          asset: '0xabcd1234',
          symbol: 'WETH',
          ltv: 0.80,
          liquidationThreshold: 0.85,
          collateralUsd: 10000,
          debtUsd: 0,
          sourcePrice: 'chainlink:0xfeed123'
        }
      ];

      trackerMinMode.record(
        '0x1234567890abcdef',
        0.95,
        12345678,
        'head',
        10000,
        9500,
        reserves
      );

      const entries = trackerMinMode.getAll();
      expect(entries[0].reserves).toBeUndefined();
    });
  });
});
