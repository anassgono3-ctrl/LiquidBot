import { describe, it, expect, beforeEach } from 'vitest';

import { WatchSet } from '../../src/watch/WatchSet.js';
import { HotSetTracker } from '../../src/services/HotSetTracker.js';
import { LowHFTracker } from '../../src/services/LowHFTracker.js';

describe('WatchSet', () => {
  let hotSetTracker: HotSetTracker;
  let lowHfTracker: LowHFTracker;
  let watchSet: WatchSet;

  beforeEach(() => {
    hotSetTracker = new HotSetTracker({
      hotSetHfMax: 1.03,
      warmSetHfMax: 1.10,
      maxHotSize: 100,
      maxWarmSize: 500
    });
    
    lowHfTracker = new LowHFTracker({
      maxEntries: 1000,
      recordMode: 'all',
      dumpOnShutdown: false,
      summaryIntervalSec: 0
    });

    watchSet = new WatchSet({
      hotSetTracker,
      lowHFTracker: lowHfTracker
    });
  });

  describe('isWatched', () => {
    it('should return true for users in hot set', () => {
      const user = '0x' + '1'.repeat(40);
      
      // Add user to hot set (HF <= 1.03)
      hotSetTracker.update(user, 1.02, 12345, 'head', 1000, 500);
      
      expect(watchSet.isWatched(user)).toBe(true);
    });

    it('should return false for users in warm set', () => {
      const user = '0x' + '2'.repeat(40);
      
      // Add user to warm set (1.03 < HF <= 1.10)
      hotSetTracker.update(user, 1.08, 12345, 'head', 1000, 500);
      
      expect(watchSet.isWatched(user)).toBe(false);
    });

    it('should return true for users in low HF tracker with HF <= 1.03', () => {
      const user = '0x' + '3'.repeat(40);
      
      // Record low HF entry
      lowHfTracker.record(user, 1.01, 12345, 'head', 1000, 500);
      
      expect(watchSet.isWatched(user)).toBe(true);
    });

    it('should return false for users in low HF tracker with HF > 1.03', () => {
      const user = '0x' + '4'.repeat(40);
      
      // Record low HF entry above threshold
      lowHfTracker.record(user, 1.05, 12345, 'head', 1000, 500);
      
      expect(watchSet.isWatched(user)).toBe(false);
    });

    it('should return false for users not in any tracker', () => {
      const user = '0x' + '5'.repeat(40);
      
      expect(watchSet.isWatched(user)).toBe(false);
    });

    it('should handle address normalization', () => {
      const user = '0xAbCd' + '1'.repeat(36);
      
      // Add with uppercase
      hotSetTracker.update(user.toUpperCase(), 1.02, 12345, 'head', 1000, 500);
      
      // Check with lowercase
      expect(watchSet.isWatched(user.toLowerCase())).toBe(true);
    });
  });

  describe('getWatchedUsers', () => {
    it('should return users from hot set', () => {
      const user1 = '0x' + '1'.repeat(40);
      const user2 = '0x' + '2'.repeat(40);
      
      hotSetTracker.update(user1, 1.01, 12345, 'head', 1000, 500);
      hotSetTracker.update(user2, 1.02, 12345, 'head', 1000, 500);
      
      const watched = watchSet.getWatchedUsers();
      expect(watched).toContain(user1.toLowerCase());
      expect(watched).toContain(user2.toLowerCase());
    });

    it('should return users from low HF tracker with HF <= 1.03', () => {
      const user1 = '0x' + '3'.repeat(40);
      const user2 = '0x' + '4'.repeat(40);
      const user3 = '0x' + '5'.repeat(40);
      
      lowHfTracker.record(user1, 1.01, 12345, 'head', 1000, 500);
      lowHfTracker.record(user2, 1.02, 12345, 'head', 1000, 500);
      lowHfTracker.record(user3, 1.05, 12345, 'head', 1000, 500); // Above threshold
      
      const watched = watchSet.getWatchedUsers();
      expect(watched).toContain(user1.toLowerCase());
      expect(watched).toContain(user2.toLowerCase());
      expect(watched).not.toContain(user3.toLowerCase());
    });

    it('should deduplicate users in both trackers', () => {
      const user = '0x' + '1'.repeat(40);
      
      // Add to both trackers
      hotSetTracker.update(user, 1.01, 12345, 'head', 1000, 500);
      lowHfTracker.record(user, 1.01, 12345, 'head', 1000, 500);
      
      const watched = watchSet.getWatchedUsers();
      const count = watched.filter(u => u === user.toLowerCase()).length;
      expect(count).toBe(1);
    });

    it('should return empty array when no watched users', () => {
      const watched = watchSet.getWatchedUsers();
      expect(watched).toEqual([]);
    });
  });

  describe('getWatchedCount', () => {
    it('should return correct count of watched users', () => {
      const user1 = '0x' + '1'.repeat(40);
      const user2 = '0x' + '2'.repeat(40);
      
      hotSetTracker.update(user1, 1.01, 12345, 'head', 1000, 500);
      lowHfTracker.record(user2, 1.02, 12345, 'head', 1000, 500);
      
      expect(watchSet.getWatchedCount()).toBe(2);
    });

    it('should return 0 when no watched users', () => {
      expect(watchSet.getWatchedCount()).toBe(0);
    });
  });
});
