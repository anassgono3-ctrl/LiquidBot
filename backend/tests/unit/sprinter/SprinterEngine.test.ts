import { describe, it, expect, beforeEach } from 'vitest';

import { SprinterEngine, type SprinterEngineConfig } from '../../../src/sprinter/SprinterEngine.js';
import { TemplateCache, type TemplateCacheConfig } from '../../../src/sprinter/TemplateCache.js';

describe('SprinterEngine', () => {
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

  describe('Candidate pre-staging', () => {
    it('should pre-stage a candidate with low HF', () => {
      const user = '0x1234567890123456789012345678901234567890';
      const debtToken = '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA';
      const collateralToken = '0x4200000000000000000000000000000000000006';
      const debtWei = 1000000000000000000n; // 1 ETH
      const collateralWei = 2000000000000000000n; // 2 ETH
      const projectedHF = 1.01; // Below prestage threshold
      const currentBlock = 1000;
      const debtPriceUsd = 2000;

      const success = engine.prestage(
        user,
        debtToken,
        collateralToken,
        debtWei,
        collateralWei,
        projectedHF,
        currentBlock,
        debtPriceUsd
      );

      expect(success).toBe(true);
      
      const candidate = engine.getCandidate(user);
      expect(candidate).toBeDefined();
      expect(candidate?.user).toBe(user.toLowerCase());
      expect(candidate?.projectedHF).toBe(projectedHF);
    });

    it('should not pre-stage candidate above prestage threshold', () => {
      const user = '0x1234567890123456789012345678901234567890';
      const debtToken = '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA';
      const collateralToken = '0x4200000000000000000000000000000000000006';
      const debtWei = 1000000000000000000n;
      const collateralWei = 2000000000000000000n;
      const projectedHF = 1.05; // Above prestage threshold (1.02)
      const currentBlock = 1000;
      const debtPriceUsd = 2000;

      const success = engine.prestage(
        user,
        debtToken,
        collateralToken,
        debtWei,
        collateralWei,
        projectedHF,
        currentBlock,
        debtPriceUsd
      );

      expect(success).toBe(false);
    });

    it('should not pre-stage candidate below minimum debt', () => {
      const user = '0x1234567890123456789012345678901234567890';
      const debtToken = '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA';
      const collateralToken = '0x4200000000000000000000000000000000000006';
      const debtWei = 10000000000000000n; // 0.01 ETH
      const collateralWei = 2000000000000000000n;
      const projectedHF = 1.01;
      const currentBlock = 1000;
      const debtPriceUsd = 2000; // 0.01 * 2000 = $20 < $50 threshold

      const success = engine.prestage(
        user,
        debtToken,
        collateralToken,
        debtWei,
        collateralWei,
        projectedHF,
        currentBlock,
        debtPriceUsd
      );

      expect(success).toBe(false);
    });
  });

  describe('Candidate management', () => {
    it('should retrieve all candidates', () => {
      const currentBlock = 1000;
      const debtPriceUsd = 2000;
      
      engine.prestage(
        '0x1111111111111111111111111111111111111111',
        '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
        '0x4200000000000000000000000000000000000006',
        1000000000000000000n,
        2000000000000000000n,
        1.00,
        currentBlock,
        debtPriceUsd
      );
      
      engine.prestage(
        '0x2222222222222222222222222222222222222222',
        '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
        '0x4200000000000000000000000000000000000006',
        1500000000000000000n,
        2500000000000000000n,
        0.99,
        currentBlock,
        debtPriceUsd
      );

      const candidates = engine.getAllCandidates();
      expect(candidates.length).toBe(2);
    });

    it('should remove a candidate', () => {
      const user = '0x1234567890123456789012345678901234567890';
      const currentBlock = 1000;
      
      engine.prestage(
        user,
        '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
        '0x4200000000000000000000000000000000000006',
        1000000000000000000n,
        2000000000000000000n,
        1.00,
        currentBlock,
        2000
      );

      expect(engine.getCandidate(user)).toBeDefined();
      
      const removed = engine.remove(user);
      expect(removed).toBe(true);
      expect(engine.getCandidate(user)).toBeUndefined();
    });
  });

  describe('Stale candidate eviction', () => {
    it('should evict stale candidates', () => {
      const currentBlock = 1000;
      
      engine.prestage(
        '0x1111111111111111111111111111111111111111',
        '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
        '0x4200000000000000000000000000000000000006',
        1000000000000000000n,
        2000000000000000000n,
        1.00,
        currentBlock,
        2000
      );

      const staleBlock = currentBlock + 11; // Beyond stale threshold
      const evicted = engine.evictStale(staleBlock);
      
      expect(evicted).toBe(1);
    });
  });

  describe('Optimistic execution decision', () => {
    it('should execute when HF is below threshold', () => {
      const candidate = {
        user: '0x1234567890123456789012345678901234567890',
        debtToken: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
        collateralToken: '0x4200000000000000000000000000000000000006',
        debtWei: 1000000000000000000n,
        collateralWei: 2000000000000000000n,
        projectedHF: 0.97,
        repayWeiEstimate: 500000000000000000n,
        templateBuffer: Buffer.from([]),
        templateRepayOffset: 0,
        preparedBlock: 1000,
        preparedTimestamp: Date.now()
      };

      const actualHF = 0.97;
      const shouldExecute = engine.shouldExecuteOptimistic(candidate, actualHF);
      
      expect(shouldExecute).toBe(true);
    });

    it('should execute optimistically when HF is within epsilon', () => {
      const candidate = {
        user: '0x1234567890123456789012345678901234567890',
        debtToken: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
        collateralToken: '0x4200000000000000000000000000000000000006',
        debtWei: 1000000000000000000n,
        collateralWei: 2000000000000000000n,
        projectedHF: 0.97,
        repayWeiEstimate: 500000000000000000n,
        templateBuffer: Buffer.from([]),
        templateRepayOffset: 0,
        preparedBlock: 1000,
        preparedTimestamp: Date.now()
      };

      const actualHF = 0.981; // Just above threshold (0.98) but within epsilon (0.002)
      const shouldExecute = engine.shouldExecuteOptimistic(candidate, actualHF);
      
      expect(shouldExecute).toBe(true);
    });

    it('should not execute when HF is above threshold + epsilon', () => {
      const candidate = {
        user: '0x1234567890123456789012345678901234567890',
        debtToken: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
        collateralToken: '0x4200000000000000000000000000000000000006',
        debtWei: 1000000000000000000n,
        collateralWei: 2000000000000000000n,
        projectedHF: 0.97,
        repayWeiEstimate: 500000000000000000n,
        templateBuffer: Buffer.from([]),
        templateRepayOffset: 0,
        preparedBlock: 1000,
        preparedTimestamp: Date.now()
      };

      const actualHF = 1.00; // Well above threshold + epsilon
      const shouldExecute = engine.shouldExecuteOptimistic(candidate, actualHF);
      
      expect(shouldExecute).toBe(false);
    });
  });
});
