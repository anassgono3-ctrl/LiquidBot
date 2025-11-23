import { describe, it, expect, beforeEach } from 'vitest';

import { SprinterEngine, type SprinterEngineConfig } from '../../../src/sprinter/SprinterEngine.js';
import { TemplateCache, type TemplateCacheConfig } from '../../../src/sprinter/TemplateCache.js';

describe('SprinterEngine - Predictive Integration', () => {
  let engine: SprinterEngine;
  let templateCache: TemplateCache;

  const engineConfig: SprinterEngineConfig = {
    prestageHfBps: 10200, // 1.02
    executionHfThresholdBps: 9800, // 0.98
    optimisticEpsilonBps: 20, // 0.20%
    maxPrestaged: 100,
    staleBlocks: 10,
    verifyBatch: 25,
    closeFactorMode: 'fixed50',
    minDebtUsd: 50
  };
  
  const cacheConfig: TemplateCacheConfig = {
    aavePoolAddress: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    refreshIndexBps: 10000,
    maxEntries: 50
  };

  beforeEach(() => {
    templateCache = new TemplateCache(cacheConfig);
    engine = new SprinterEngine(engineConfig, templateCache);
  });

  describe('prestageFromPredictive', () => {
    const user = '0x3333333333333333333333333333333333333333';
    const debtToken = '0x4444444444444444444444444444444444444444';
    const collateralToken = '0x5555555555555555555555555555555555555555';
    const debtWei = 100n * 10n ** 18n; // 100 tokens
    const collateralWei = 200n * 10n ** 18n; // 200 tokens
    const currentBlock = 1000;
    const debtPriceUsd = 1.0;

    it('should accept candidate with projected HF below threshold', () => {
      const projectedHF = 1.01; // Below prestage threshold (1.02)
      
      const result = engine.prestageFromPredictive(
        user,
        debtToken,
        collateralToken,
        debtWei,
        collateralWei,
        projectedHF,
        currentBlock,
        debtPriceUsd
      );

      expect(result).toBe(true);
      
      const candidate = engine.getCandidate(user);
      expect(candidate).toBeDefined();
      expect(candidate?.projectedHF).toBe(projectedHF);
    });

    it('should reject candidate with projected HF above threshold', () => {
      const projectedHF = 1.03; // Above prestage threshold (1.02)
      
      const result = engine.prestageFromPredictive(
        user,
        debtToken,
        collateralToken,
        debtWei,
        collateralWei,
        projectedHF,
        currentBlock,
        debtPriceUsd
      );

      expect(result).toBe(false);
      
      const candidate = engine.getCandidate(user);
      expect(candidate).toBeUndefined();
    });

    it('should reject candidate below minimum debt USD', () => {
      const projectedHF = 1.01;
      const smallDebt = 10n * 10n ** 18n; // 10 USD (below 50 USD minimum)
      
      const result = engine.prestageFromPredictive(
        user,
        debtToken,
        collateralToken,
        smallDebt,
        collateralWei,
        projectedHF,
        currentBlock,
        debtPriceUsd
      );

      expect(result).toBe(false);
      
      const candidate = engine.getCandidate(user);
      expect(candidate).toBeUndefined();
    });

    it('should handle multiple predictive candidates', () => {
      const users = [
        '0x6666666666666666666666666666666666666666',
        '0x7777777777777777777777777777777777777777',
        '0x8888888888888888888888888888888888888888'
      ];

      const projectedHFs = [1.015, 1.008, 1.019];

      users.forEach((u, i) => {
        const result = engine.prestageFromPredictive(
          u,
          debtToken,
          collateralToken,
          debtWei,
          collateralWei,
          projectedHFs[i],
          currentBlock,
          debtPriceUsd
        );
        expect(result).toBe(true);
      });

      const stats = engine.getStats();
      expect(stats.total).toBe(users.length);
    });

    it('should update existing candidate if already pre-staged', () => {
      const projectedHF1 = 1.015;
      const projectedHF2 = 1.005;

      // First pre-stage
      engine.prestageFromPredictive(
        user,
        debtToken,
        collateralToken,
        debtWei,
        collateralWei,
        projectedHF1,
        currentBlock,
        debtPriceUsd
      );

      let candidate = engine.getCandidate(user);
      expect(candidate?.projectedHF).toBe(projectedHF1);

      // Update with new projection
      engine.prestageFromPredictive(
        user,
        debtToken,
        collateralToken,
        debtWei,
        collateralWei,
        projectedHF2,
        currentBlock + 1,
        debtPriceUsd
      );

      candidate = engine.getCandidate(user);
      expect(candidate?.projectedHF).toBe(projectedHF2);
      expect(candidate?.preparedBlock).toBe(currentBlock + 1);
    });

    it('should respect max prestaged limit', () => {
      const smallEngine = new SprinterEngine(
        { ...engineConfig, maxPrestaged: 2 },
        templateCache
      );

      const users = [
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '0xcccccccccccccccccccccccccccccccccccccccc'
      ];

      // Add first two candidates
      users.slice(0, 2).forEach(u => {
        const result = smallEngine.prestageFromPredictive(
          u,
          debtToken,
          collateralToken,
          debtWei,
          collateralWei,
          1.01,
          currentBlock,
          debtPriceUsd
        );
        expect(result).toBe(true);
      });

      // Third candidate should trigger eviction but still succeed
      const result = smallEngine.prestageFromPredictive(
        users[2],
        debtToken,
        collateralToken,
        debtWei,
        collateralWei,
        1.0, // Lower HF - higher priority
        currentBlock,
        debtPriceUsd
      );
      expect(result).toBe(true);

      const stats = smallEngine.getStats();
      expect(stats.total).toBeLessThanOrEqual(2);
    });

    it('should normalize user addresses', () => {
      const upperUser = '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
      const lowerUser = upperUser.toLowerCase();

      engine.prestageFromPredictive(
        upperUser,
        debtToken,
        collateralToken,
        debtWei,
        collateralWei,
        1.01,
        currentBlock,
        debtPriceUsd
      );

      // Should find by lowercase
      const candidate = engine.getCandidate(lowerUser);
      expect(candidate).toBeDefined();
      expect(candidate?.user).toBe(lowerUser);
    });

    it('should handle edge case at exact threshold', () => {
      const projectedHF = 1.02; // Exactly at threshold (10200 bps)
      
      const result = engine.prestageFromPredictive(
        user,
        debtToken,
        collateralToken,
        debtWei,
        collateralWei,
        projectedHF,
        currentBlock,
        debtPriceUsd
      );

      // Should accept at threshold
      expect(result).toBe(true);
    });

    it('should integrate with regular prestage flow', () => {
      // First, add via predictive
      engine.prestageFromPredictive(
        user,
        debtToken,
        collateralToken,
        debtWei,
        collateralWei,
        1.01,
        currentBlock,
        debtPriceUsd
      );

      // Should be retrievable
      const candidate = engine.getCandidate(user);
      expect(candidate).toBeDefined();

      // Should be removable
      const removed = engine.remove(user);
      expect(removed).toBe(true);

      // Should no longer exist
      const afterRemove = engine.getCandidate(user);
      expect(afterRemove).toBeUndefined();
    });
  });

  describe('predictive integration with stale eviction', () => {
    it('should evict stale predictive candidates', () => {
      const users = [
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        '0xffffffffffffffffffffffffffffffffffffffff'
      ];

      // Add candidates at block 1000
      users.forEach(u => {
        engine.prestageFromPredictive(
          u,
          '0x4444444444444444444444444444444444444444',
          '0x5555555555555555555555555555555555555555',
          100n * 10n ** 18n,
          200n * 10n ** 18n,
          1.01,
          1000,
          1.0
        );
      });

      let stats = engine.getStats();
      expect(stats.total).toBe(2);

      // Evict candidates older than block 1011 (stale threshold is 10 blocks)
      const evicted = engine.evictStale(1011);
      expect(evicted).toBe(2);

      stats = engine.getStats();
      expect(stats.total).toBe(0);
    });

    it('should not evict recent predictive candidates', () => {
      engine.prestageFromPredictive(
        '0x1010101010101010101010101010101010101010',
        '0x4444444444444444444444444444444444444444',
        '0x5555555555555555555555555555555555555555',
        100n * 10n ** 18n,
        200n * 10n ** 18n,
        1.01,
        1000,
        1.0
      );

      // Current block is 1005 - within stale threshold
      const evicted = engine.evictStale(1005);
      expect(evicted).toBe(0);

      const stats = engine.getStats();
      expect(stats.total).toBe(1);
    });
  });
});
