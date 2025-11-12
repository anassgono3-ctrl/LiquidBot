import { describe, it, expect, beforeEach } from 'vitest';

import { HotSetTracker, type HotSetTrackerConfig } from '../../src/services/HotSetTracker.js';

describe('HotSetTracker', () => {
  let tracker: HotSetTracker;
  const defaultConfig: HotSetTrackerConfig = {
    hotSetHfMax: 1.03,
    warmSetHfMax: 1.10,
    maxHotSize: 100,
    maxWarmSize: 500
  };

  beforeEach(() => {
    tracker = new HotSetTracker(defaultConfig);
  });

  describe('configuration', () => {
    it('should initialize with provided config', () => {
      const stats = tracker.getStats();
      expect(stats.hotSize).toBe(0);
      expect(stats.warmSize).toBe(0);
    });

    it('should throw error if hotSetHfMax >= warmSetHfMax', () => {
      expect(() => {
        new HotSetTracker({
          hotSetHfMax: 1.10,
          warmSetHfMax: 1.03,
          maxHotSize: 100,
          maxWarmSize: 500
        });
      }).toThrow('hotSetHfMax must be less than warmSetHfMax');
    });
  });

  describe('update and categorization', () => {
    it('should add user to hot set when HF <= hotSetHfMax', () => {
      const user = '0x' + '1'.repeat(40);
      const hf = 1.02;

      const category = tracker.update(user, hf, 12345, 'head', 1000, 500);

      expect(category).toBe('hot');
      expect(tracker.isInHotSet(user)).toBe(true);
      expect(tracker.getStats().hotSize).toBe(1);
    });

    it('should add user to warm set when hotSetHfMax < HF <= warmSetHfMax', () => {
      const user = '0x' + '2'.repeat(40);
      const hf = 1.06;

      const category = tracker.update(user, hf, 12345, 'head', 1000, 500);

      expect(category).toBe('warm');
      expect(tracker.isInWarmSet(user)).toBe(true);
      expect(tracker.getStats().warmSize).toBe(1);
    });

    it('should categorize as cold when HF > warmSetHfMax', () => {
      const user = '0x' + '3'.repeat(40);
      const hf = 1.20;

      const category = tracker.update(user, hf, 12345, 'head', 1000, 500);

      expect(category).toBe('cold');
      expect(tracker.isInHotSet(user)).toBe(false);
      expect(tracker.isInWarmSet(user)).toBe(false);
    });

    it('should move user between sets when HF changes', () => {
      const user = '0x' + '4'.repeat(40);

      // Start in hot set
      tracker.update(user, 1.01, 12345, 'head', 1000, 500);
      expect(tracker.isInHotSet(user)).toBe(true);

      // Move to warm set
      tracker.update(user, 1.05, 12346, 'head', 1000, 500);
      expect(tracker.isInHotSet(user)).toBe(false);
      expect(tracker.isInWarmSet(user)).toBe(true);

      // Move to cold (removed from tracking)
      tracker.update(user, 1.50, 12347, 'head', 1000, 500);
      expect(tracker.isInHotSet(user)).toBe(false);
      expect(tracker.isInWarmSet(user)).toBe(false);
    });
  });

  describe('capacity management', () => {
    it('should evict highest HF entry when hot set is at capacity', () => {
      // Fill hot set to capacity - all with HF < hotSetHfMax (1.03)
      for (let i = 0; i < defaultConfig.maxHotSize; i++) {
        const user = '0x' + i.toString(16).padStart(40, '0');
        // HF range: 0.95 to 1.02 (all below 1.03)
        const hf = 0.95 + (i * 0.0007); // Spread across 0.95 to 1.02
        tracker.update(user, hf, 12345, 'head', 1000, 500);
      }

      const hotSize = tracker.getStats().hotSize;
      expect(hotSize).toBeLessThanOrEqual(defaultConfig.maxHotSize);

      // Add a new user with lower HF - should evict the highest HF entry if at capacity
      const newUser = '0x' + 'new'.padEnd(40, '0');
      tracker.update(newUser, 0.94, 12345, 'head', 1000, 500);

      // Size should not exceed max
      expect(tracker.getStats().hotSize).toBeLessThanOrEqual(defaultConfig.maxHotSize);
      expect(tracker.isInHotSet(newUser)).toBe(true);
    });

    it('should evict highest HF entry when warm set is at capacity', () => {
      // Fill warm set to capacity - all with HF between hotSetHfMax (1.03) and warmSetHfMax (1.10)
      for (let i = 0; i < defaultConfig.maxWarmSize; i++) {
        const user = '0x' + i.toString(16).padStart(40, '0');
        // HF range: 1.04 to 1.09 (all between 1.03 and 1.10)
        tracker.update(user, 1.04 + (i / (defaultConfig.maxWarmSize * 20)), 12345, 'head', 1000, 500);
      }

      expect(tracker.getStats().warmSize).toBe(defaultConfig.maxWarmSize);

      // Add a new user with lower HF - should evict the highest HF entry
      const newUser = '0x' + 'new'.padEnd(40, '0');
      tracker.update(newUser, 1.035, 12345, 'head', 1000, 500);

      expect(tracker.getStats().warmSize).toBe(defaultConfig.maxWarmSize);
      expect(tracker.isInWarmSet(newUser)).toBe(true);
    });
  });

  describe('getHotSet and getWarmSet', () => {
    it('should return hot set sorted by HF (lowest first)', () => {
      tracker.update('0x' + '1'.repeat(40), 1.03, 12345, 'head', 1000, 500);
      tracker.update('0x' + '2'.repeat(40), 1.00, 12345, 'head', 1000, 500);
      tracker.update('0x' + '3'.repeat(40), 1.02, 12345, 'head', 1000, 500);

      const hotSet = tracker.getHotSet();

      expect(hotSet.length).toBe(3);
      expect(hotSet[0].hf).toBe(1.00);
      expect(hotSet[1].hf).toBe(1.02);
      expect(hotSet[2].hf).toBe(1.03);
    });

    it('should return warm set sorted by HF (lowest first)', () => {
      tracker.update('0x' + '1'.repeat(40), 1.08, 12345, 'head', 1000, 500);
      tracker.update('0x' + '2'.repeat(40), 1.04, 12345, 'head', 1000, 500);
      tracker.update('0x' + '3'.repeat(40), 1.06, 12345, 'head', 1000, 500);

      const warmSet = tracker.getWarmSet();

      expect(warmSet.length).toBe(3);
      expect(warmSet[0].hf).toBe(1.04);
      expect(warmSet[1].hf).toBe(1.06);
      expect(warmSet[2].hf).toBe(1.08);
    });
  });

  describe('getTopK', () => {
    it('should return top K entries by lowest HF', () => {
      tracker.update('0x' + '1'.repeat(40), 1.03, 12345, 'head', 1000, 500);
      tracker.update('0x' + '2'.repeat(40), 1.00, 12345, 'head', 1000, 500);
      tracker.update('0x' + '3'.repeat(40), 1.02, 12345, 'head', 1000, 500);
      tracker.update('0x' + '4'.repeat(40), 1.01, 12345, 'head', 1000, 500);

      const topK = tracker.getTopK(2);

      expect(topK.length).toBe(2);
      expect(topK[0].hf).toBe(1.00);
      expect(topK[1].hf).toBe(1.01);
    });

    it('should return all entries if K > hot set size', () => {
      tracker.update('0x' + '1'.repeat(40), 1.02, 12345, 'head', 1000, 500);
      tracker.update('0x' + '2'.repeat(40), 1.01, 12345, 'head', 1000, 500);

      const topK = tracker.getTopK(10);

      expect(topK.length).toBe(2);
    });
  });

  describe('remove', () => {
    it('should remove user from all sets', () => {
      const user = '0x' + '5'.repeat(40);

      tracker.update(user, 1.02, 12345, 'head', 1000, 500);
      expect(tracker.isInHotSet(user)).toBe(true);

      tracker.remove(user);
      expect(tracker.isInHotSet(user)).toBe(false);
      expect(tracker.getCategory(user)).toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', () => {
      tracker.update('0x' + '1'.repeat(40), 1.02, 12345, 'head', 1000, 500);
      tracker.update('0x' + '2'.repeat(40), 1.00, 12345, 'head', 1000, 500);
      tracker.update('0x' + '3'.repeat(40), 1.05, 12345, 'head', 1000, 500);

      const stats = tracker.getStats();

      expect(stats.hotSize).toBe(2);
      expect(stats.warmSize).toBe(1);
      expect(stats.minHotHf).toBe(1.00);
      expect(stats.maxHotHf).toBe(1.02);
    });

    it('should return null for min/max when hot set is empty', () => {
      const stats = tracker.getStats();

      expect(stats.minHotHf).toBeNull();
      expect(stats.maxHotHf).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear all sets', () => {
      tracker.update('0x' + '1'.repeat(40), 1.02, 12345, 'head', 1000, 500);
      tracker.update('0x' + '2'.repeat(40), 1.05, 12345, 'head', 1000, 500);

      tracker.clear();

      const stats = tracker.getStats();
      expect(stats.hotSize).toBe(0);
      expect(stats.warmSize).toBe(0);
    });
  });
});
