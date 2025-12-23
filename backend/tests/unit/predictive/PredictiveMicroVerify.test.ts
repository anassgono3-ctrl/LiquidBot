/**
 * Unit tests for PredictiveMicroVerify
 * Tests batching, caching, and priority-based verification
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PredictiveMicroVerify,
  type MicroVerifyCandidate
} from '../../../src/services/predictive/PredictiveMicroVerify.js';

describe('PredictiveMicroVerify', () => {
  let microVerify: PredictiveMicroVerify;

  beforeEach(() => {
    microVerify = new PredictiveMicroVerify({
      enabled: true,
      maxPerBlock: 10,
      snapshotTtlMs: 2000,
      multicall3Address: '0xcA11bde05977b3631167028862bE2a173976CA11'
    });
  });

  describe('Priority-based selection', () => {
    it('should select top-K candidates by priority', async () => {
      const candidates: MicroVerifyCandidate[] = [
        { user: '0x1', hfCurrent: 1.01, debtUsd: 1000, priority: 50 },
        { user: '0x2', hfCurrent: 1.005, debtUsd: 2000, priority: 100 },
        { user: '0x3', hfCurrent: 1.02, debtUsd: 500, priority: 25 },
        { user: '0x4', hfCurrent: 1.001, debtUsd: 3000, priority: 150 },
        { user: '0x5', hfCurrent: 1.015, debtUsd: 800, priority: 75 }
      ];

      microVerify = new PredictiveMicroVerify({
        enabled: true,
        maxPerBlock: 3, // Only take top 3
        snapshotTtlMs: 2000,
        multicall3Address: '0xcA11bde05977b3631167028862bE2a173976CA11'
      });

      const results = await microVerify.batchVerify(candidates, 1000);
      
      expect(results.length).toBe(3);
      expect(results[0].user).toBe('0x4'); // Priority 150
      expect(results[1].user).toBe('0x2'); // Priority 100
      expect(results[2].user).toBe('0x5'); // Priority 75
    });

    it('should handle empty candidate list', async () => {
      const results = await microVerify.batchVerify([], 1000);
      expect(results.length).toBe(0);
    });

    it('should handle candidates less than maxPerBlock', async () => {
      const candidates: MicroVerifyCandidate[] = [
        { user: '0x1', hfCurrent: 1.01, debtUsd: 1000, priority: 50 },
        { user: '0x2', hfCurrent: 1.005, debtUsd: 2000, priority: 100 }
      ];

      microVerify = new PredictiveMicroVerify({
        enabled: true,
        maxPerBlock: 10,
        snapshotTtlMs: 2000,
        multicall3Address: '0xcA11bde05977b3631167028862bE2a173976CA11'
      });

      const results = await microVerify.batchVerify(candidates, 1000);
      expect(results.length).toBe(2);
    });
  });

  describe('Snapshot caching', () => {
    it('should use cached snapshot within TTL', async () => {
      const candidates: MicroVerifyCandidate[] = [
        { user: '0x1', hfCurrent: 1.01, debtUsd: 1000, priority: 100 }
      ];

      // First verification - will cache
      const results1 = await microVerify.batchVerify(candidates, 1000);
      expect(results1.length).toBe(1);
      expect(results1[0].cached).toBe(false);

      // Second verification immediately - should use cache
      const results2 = await microVerify.batchVerify(candidates, 1001);
      expect(results2.length).toBe(1);
      expect(results2[0].cached).toBe(true);
    });

    it('should skip verification if all candidates are cached', async () => {
      const candidates: MicroVerifyCandidate[] = [
        { user: '0x1', hfCurrent: 1.01, debtUsd: 1000, priority: 100 },
        { user: '0x2', hfCurrent: 1.005, debtUsd: 2000, priority: 90 }
      ];

      // First verification - will cache both
      await microVerify.batchVerify(candidates, 1000);

      // Second verification - should return cached results only
      const results = await microVerify.batchVerify(candidates, 1001);
      expect(results.length).toBe(2);
      expect(results.every(r => r.cached)).toBe(true);
    });

    it('should handle mix of cached and uncached candidates', async () => {
      const candidates1: MicroVerifyCandidate[] = [
        { user: '0x1', hfCurrent: 1.01, debtUsd: 1000, priority: 100 }
      ];

      // Cache first user
      await microVerify.batchVerify(candidates1, 1000);

      // Verify both cached and new user
      const candidates2: MicroVerifyCandidate[] = [
        { user: '0x1', hfCurrent: 1.01, debtUsd: 1000, priority: 100 }, // Cached
        { user: '0x2', hfCurrent: 1.005, debtUsd: 2000, priority: 90 }  // New
      ];

      const results = await microVerify.batchVerify(candidates2, 1001);
      expect(results.length).toBe(2);
      
      const cachedResult = results.find(r => r.user === '0x1');
      const newResult = results.find(r => r.user === '0x2');
      
      expect(cachedResult?.cached).toBe(true);
      expect(newResult?.cached).toBe(false);
    });

    it('should not use stale cache beyond TTL', async () => {
      microVerify = new PredictiveMicroVerify({
        enabled: true,
        maxPerBlock: 10,
        snapshotTtlMs: 100, // 100ms TTL
        multicall3Address: '0xcA11bde05977b3631167028862bE2a173976CA11'
      });

      const candidates: MicroVerifyCandidate[] = [
        { user: '0x1', hfCurrent: 1.01, debtUsd: 1000, priority: 100 }
      ];

      // First verification
      await microVerify.batchVerify(candidates, 1000);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Second verification - cache should be stale
      const results = await microVerify.batchVerify(candidates, 1001);
      expect(results.length).toBe(1);
      expect(results[0].cached).toBe(false);
    });
  });

  describe('Cache invalidation', () => {
    it('should invalidate specific user', async () => {
      const candidates: MicroVerifyCandidate[] = [
        { user: '0x1', hfCurrent: 1.01, debtUsd: 1000, priority: 100 },
        { user: '0x2', hfCurrent: 1.005, debtUsd: 2000, priority: 90 }
      ];

      // Cache both users
      await microVerify.batchVerify(candidates, 1000);

      // Invalidate user 1
      microVerify.invalidateUser('0x1');

      // Verify both again
      const results = await microVerify.batchVerify(candidates, 1001);
      expect(results.length).toBe(2);

      const user1Result = results.find(r => r.user === '0x1');
      const user2Result = results.find(r => r.user === '0x2');

      expect(user1Result?.cached).toBe(false); // Invalidated
      expect(user2Result?.cached).toBe(true);  // Still cached
    });

    it('should invalidate all cache entries', async () => {
      const candidates: MicroVerifyCandidate[] = [
        { user: '0x1', hfCurrent: 1.01, debtUsd: 1000, priority: 100 },
        { user: '0x2', hfCurrent: 1.005, debtUsd: 2000, priority: 90 }
      ];

      // Cache both users
      await microVerify.batchVerify(candidates, 1000);

      // Invalidate all
      microVerify.invalidateAll();

      // Verify both again
      const results = await microVerify.batchVerify(candidates, 1001);
      expect(results.length).toBe(2);
      expect(results.every(r => !r.cached)).toBe(true);
    });

    it('should handle case-insensitive invalidation', async () => {
      const candidates: MicroVerifyCandidate[] = [
        { user: '0xABC', hfCurrent: 1.01, debtUsd: 1000, priority: 100 }
      ];

      await microVerify.batchVerify(candidates, 1000);

      // Invalidate with different case
      microVerify.invalidateUser('0xabc');

      const results = await microVerify.batchVerify(candidates, 1001);
      expect(results[0].cached).toBe(false);
    });
  });

  describe('Cache pruning', () => {
    it('should prune stale entries', async () => {
      microVerify = new PredictiveMicroVerify({
        enabled: true,
        maxPerBlock: 10,
        snapshotTtlMs: 100,
        multicall3Address: '0xcA11bde05977b3631167028862bE2a173976CA11'
      });

      const candidates: MicroVerifyCandidate[] = [
        { user: '0x1', hfCurrent: 1.01, debtUsd: 1000, priority: 100 }
      ];

      await microVerify.batchVerify(candidates, 1000);

      const stats1 = microVerify.getCacheStats();
      expect(stats1.size).toBe(1);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Prune stale entries
      const pruned = microVerify.pruneCache();
      expect(pruned).toBe(1);

      const stats2 = microVerify.getCacheStats();
      expect(stats2.size).toBe(0);
    });

    it('should not prune fresh entries', async () => {
      const candidates: MicroVerifyCandidate[] = [
        { user: '0x1', hfCurrent: 1.01, debtUsd: 1000, priority: 100 }
      ];

      await microVerify.batchVerify(candidates, 1000);

      const pruned = microVerify.pruneCache();
      expect(pruned).toBe(0);

      const stats = microVerify.getCacheStats();
      expect(stats.size).toBe(1);
    });
  });

  describe('Disabled mode', () => {
    beforeEach(() => {
      microVerify = new PredictiveMicroVerify({
        enabled: false,
        maxPerBlock: 10,
        snapshotTtlMs: 2000,
        multicall3Address: '0xcA11bde05977b3631167028862bE2a173976CA11'
      });
    });

    it('should return empty results when disabled', async () => {
      const candidates: MicroVerifyCandidate[] = [
        { user: '0x1', hfCurrent: 1.01, debtUsd: 1000, priority: 100 }
      ];

      const results = await microVerify.batchVerify(candidates, 1000);
      expect(results.length).toBe(0);
    });
  });

  describe('Cache statistics', () => {
    it('should report cache size and TTL', async () => {
      const candidates: MicroVerifyCandidate[] = [
        { user: '0x1', hfCurrent: 1.01, debtUsd: 1000, priority: 100 },
        { user: '0x2', hfCurrent: 1.005, debtUsd: 2000, priority: 90 }
      ];

      await microVerify.batchVerify(candidates, 1000);

      const stats = microVerify.getCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.ttlMs).toBe(2000);
    });

    it('should update cache size after invalidation', async () => {
      const candidates: MicroVerifyCandidate[] = [
        { user: '0x1', hfCurrent: 1.01, debtUsd: 1000, priority: 100 },
        { user: '0x2', hfCurrent: 1.005, debtUsd: 2000, priority: 90 }
      ];

      await microVerify.batchVerify(candidates, 1000);

      let stats = microVerify.getCacheStats();
      expect(stats.size).toBe(2);

      microVerify.invalidateUser('0x1');

      stats = microVerify.getCacheStats();
      expect(stats.size).toBe(1);
    });
  });
});
