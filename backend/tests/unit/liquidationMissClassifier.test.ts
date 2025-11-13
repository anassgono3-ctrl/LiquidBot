import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { LiquidationMissClassifier, type ClassifierConfig } from '../../src/services/LiquidationMissClassifier.js';
import { ExecutionDecisionsStore, type ExecutionDecision } from '../../src/services/executionDecisions.js';

describe('LiquidationMissClassifier', () => {
  let classifier: LiquidationMissClassifier;
  let decisionsStore: ExecutionDecisionsStore;
  let config: ClassifierConfig;

  beforeEach(() => {
    config = {
      enabled: true,
      transientBlocks: 3,
      minProfitUsd: 10,
      gasThresholdGwei: 50,
      enableProfitCheck: true
    };
    
    decisionsStore = new ExecutionDecisionsStore(1000, 300000);
    classifier = new LiquidationMissClassifier(config, decisionsStore);
  });

  afterEach(() => {
    decisionsStore.destroy();
  });

  describe('classification when disabled', () => {
    it('should return unknown when classifier is disabled', () => {
      config.enabled = false;
      const result = classifier.classify(
        '0x' + '1'.repeat(40),
        '0x' + '2'.repeat(40),
        Date.now(),
        12345,
        true
      );

      expect(result.reason).toBe('unknown');
      expect(result.notes).toContain('Classifier disabled');
    });
  });

  describe('not_in_watch_set classification', () => {
    it('should classify as not_in_watch_set when user was not being watched', () => {
      const user = '0x' + '3'.repeat(40);
      const liquidator = '0x' + '4'.repeat(40);
      
      const result = classifier.classify(
        user,
        liquidator,
        Date.now(),
        12345,
        false // wasInWatchSet = false
      );

      expect(result.reason).toBe('not_in_watch_set');
      expect(result.notes.some(n => n.includes('not in our watch set'))).toBe(true);
    });
  });

  describe('raced classification', () => {
    it('should classify as raced when no execution decision found', () => {
      const user = '0x' + '5'.repeat(40);
      const liquidator = '0x' + '6'.repeat(40);
      
      const result = classifier.classify(
        user,
        liquidator,
        Date.now(),
        12345,
        true // wasInWatchSet = true
      );

      expect(result.reason).toBe('raced');
      expect(result.notes.some(n => n.includes('No execution decision found'))).toBe(true);
    });

    it('should classify as raced when attempt was made with high gas', () => {
      const user = '0x' + '7'.repeat(40);
      const liquidator = '0x' + '8'.repeat(40);
      const now = Date.now();
      
      // Record an attempt decision with gas above threshold
      const decision: ExecutionDecision = {
        user,
        timestamp: now - 10000,
        blockNumber: 12344,
        type: 'attempt',
        debtUsd: 100,
        gasPriceGwei: 60, // Above threshold of 50
        txHash: '0x' + 'a'.repeat(64)
      };
      
      decisionsStore.record(decision);
      
      const result = classifier.classify(
        user,
        liquidator,
        now,
        12345,
        true
      );

      expect(result.reason).toBe('raced');
      expect(result.notes.some(n => n.includes('attempted liquidation'))).toBe(true);
      expect(result.gasPriceGweiAtDecision).toBe(60);
    });
  });

  describe('hf_transient classification', () => {
    it('should classify as hf_transient when liquidatable for very few blocks', () => {
      const user = '0x' + '9'.repeat(40);
      const liquidator = '0x' + 'a'.repeat(40);
      
      // Record first seen at block 12343
      classifier.recordFirstSeen(user, 12343, 0.98);
      
      // Liquidation event at block 12345 (only 2 blocks later, under threshold of 3)
      const result = classifier.classify(
        user,
        liquidator,
        Date.now(),
        12345,
        true
      );

      expect(result.reason).toBe('hf_transient');
      expect(result.blocksSinceFirstSeen).toBe(2);
      expect(result.notes.some(n => n.includes('only 2 blocks'))).toBe(true);
    });

    it('should not classify as hf_transient when liquidatable for many blocks', () => {
      const user = '0x' + 'b'.repeat(40);
      const liquidator = '0x' + 'c'.repeat(40);
      
      // Record first seen at block 12340
      classifier.recordFirstSeen(user, 12340, 0.98);
      
      // Liquidation event at block 12350 (10 blocks later, over threshold of 3)
      const result = classifier.classify(
        user,
        liquidator,
        Date.now(),
        12350,
        true
      );

      expect(result.reason).toBe('raced');
      expect(result.blocksSinceFirstSeen).toBe(10);
    });
  });

  describe('execution_filtered classification', () => {
    it('should classify as execution_filtered when skipped due to guards', () => {
      const user = '0x' + 'd'.repeat(40);
      const liquidator = '0x' + 'e'.repeat(40);
      const now = Date.now();
      
      const decision: ExecutionDecision = {
        user,
        timestamp: now - 10000,
        blockNumber: 12344,
        type: 'skip',
        reason: 'dust_guard',
        debtUsd: 5
      };
      
      decisionsStore.record(decision);
      
      const result = classifier.classify(
        user,
        liquidator,
        now,
        12345,
        true
      );

      expect(result.reason).toBe('execution_filtered');
      expect(result.notes.some(n => n.includes('dust_guard'))).toBe(true);
    });
  });

  describe('insufficient_profit classification', () => {
    it('should classify as insufficient_profit when profit too low', () => {
      const user = '0x' + 'f'.repeat(40);
      const liquidator = '0x' + '1'.repeat(40);
      const now = Date.now();
      
      const decision: ExecutionDecision = {
        user,
        timestamp: now - 10000,
        blockNumber: 12344,
        type: 'skip',
        reason: 'unprofitable',
        debtUsd: 100,
        profitEstimateUsd: 5 // Below threshold of 10
      };
      
      decisionsStore.record(decision);
      
      const result = classifier.classify(
        user,
        liquidator,
        now,
        12345,
        true
      );

      expect(result.reason).toBe('insufficient_profit');
      expect(result.profitEstimateUsd).toBe(5);
      expect(result.notes.some(n => n.includes('$5.00'))).toBe(true);
    });
  });

  describe('revert classification', () => {
    it('should classify as revert when attempt reverted', () => {
      const user = '0x' + '2'.repeat(40);
      const liquidator = '0x' + '3'.repeat(40);
      const now = Date.now();
      
      const decision: ExecutionDecision = {
        user,
        timestamp: now - 10000,
        blockNumber: 12344,
        type: 'revert',
        reason: 'HEALTH_FACTOR_NOT_BELOW_THRESHOLD',
        txHash: '0x' + 'b'.repeat(64),
        gasPriceGwei: 45
      };
      
      decisionsStore.record(decision);
      
      const result = classifier.classify(
        user,
        liquidator,
        now,
        12345,
        true
      );

      expect(result.reason).toBe('revert');
      expect(result.notes.some(n => n.includes('reverted'))).toBe(true);
      expect(result.gasPriceGweiAtDecision).toBe(45);
    });
  });

  describe('gas_outbid classification', () => {
    it('should classify as gas_outbid when gas price too low', () => {
      const user = '0x' + '4'.repeat(40);
      const liquidator = '0x' + '5'.repeat(40);
      const now = Date.now();
      
      const decision: ExecutionDecision = {
        user,
        timestamp: now - 10000,
        blockNumber: 12344,
        type: 'skip',
        reason: 'gas_price_too_high',
        debtUsd: 100,
        gasPriceGwei: 30 // Below threshold of 50
      };
      
      decisionsStore.record(decision);
      
      const result = classifier.classify(
        user,
        liquidator,
        now,
        12345,
        true
      );

      expect(result.reason).toBe('gas_outbid');
      expect(result.gasPriceGweiAtDecision).toBe(30);
      expect(result.notes.some(n => n.includes('30.00 Gwei'))).toBe(true);
    });

    it('should classify attempt as gas_outbid when gas price below threshold', () => {
      const user = '0x' + '6'.repeat(40);
      const liquidator = '0x' + '7'.repeat(40);
      const now = Date.now();
      
      const decision: ExecutionDecision = {
        user,
        timestamp: now - 10000,
        blockNumber: 12344,
        type: 'attempt',
        debtUsd: 100,
        gasPriceGwei: 40, // Below threshold of 50
        txHash: '0x' + 'c'.repeat(64)
      };
      
      decisionsStore.record(decision);
      
      const result = classifier.classify(
        user,
        liquidator,
        now,
        12345,
        true
      );

      expect(result.reason).toBe('gas_outbid');
      expect(result.gasPriceGweiAtDecision).toBe(40);
    });
  });

  describe('firstSeen tracking', () => {
    it('should track first seen block and HF', () => {
      const user = '0x' + '8'.repeat(40);
      
      classifier.recordFirstSeen(user, 12340, 0.95);
      
      const firstSeen = classifier.getFirstSeen(user);
      expect(firstSeen).toBeDefined();
      expect(firstSeen?.blockNumber).toBe(12340);
      expect(firstSeen?.hf).toBe(0.95);
    });

    it('should only record earlier block numbers', () => {
      const user = '0x' + '9'.repeat(40);
      
      classifier.recordFirstSeen(user, 12345, 0.95);
      classifier.recordFirstSeen(user, 12350, 0.90); // Later block, should be ignored
      
      const firstSeen = classifier.getFirstSeen(user);
      expect(firstSeen?.blockNumber).toBe(12345);
      expect(firstSeen?.hf).toBe(0.95);
      
      classifier.recordFirstSeen(user, 12340, 0.98); // Earlier block, should update
      const updated = classifier.getFirstSeen(user);
      expect(updated?.blockNumber).toBe(12340);
      expect(updated?.hf).toBe(0.98);
    });

    it('should clear first seen after classification', () => {
      const user = '0x' + 'a'.repeat(40);
      const liquidator = '0x' + 'b'.repeat(40);
      
      classifier.recordFirstSeen(user, 12340, 0.95);
      
      classifier.classify(user, liquidator, Date.now(), 12345, false);
      
      const firstSeen = classifier.getFirstSeen(user);
      expect(firstSeen).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should remove old first seen records', () => {
      const user1 = '0x' + 'c'.repeat(40);
      const user2 = '0x' + 'd'.repeat(40);
      
      classifier.recordFirstSeen(user1, 12000, 0.95);
      classifier.recordFirstSeen(user2, 13000, 0.90);
      
      classifier.cleanup(13100, 500); // Keep records within 500 blocks
      
      expect(classifier.getFirstSeen(user1)).toBeNull(); // Too old (1100 blocks)
      expect(classifier.getFirstSeen(user2)).toBeDefined(); // Recent (100 blocks)
    });
  });

  describe('profit estimation', () => {
    it('should estimate profit when enabled', () => {
      const profit = classifier.estimateProfit(100, 0.05);
      
      expect(profit).toBe(5); // 5% of 100
    });

    it('should return null when profit check disabled', () => {
      config.enableProfitCheck = false;
      const classifierDisabled = new LiquidationMissClassifier(config, decisionsStore);
      
      const profit = classifierDisabled.estimateProfit(100, 0.05);
      
      expect(profit).toBeNull();
    });
  });
});
