import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { DecisionClassifier } from '../../src/services/DecisionClassifier.js';
import { DecisionTraceStore, type DecisionTrace } from '../../src/services/DecisionTraceStore.js';

describe('DecisionClassifier', () => {
  let store: DecisionTraceStore;
  let classifier: DecisionClassifier;

  beforeEach(() => {
    store = new DecisionTraceStore(1000, 300000);
    classifier = new DecisionClassifier(store);
  });

  afterEach(() => {
    store.destroy();
  });

  describe('classify', () => {
    it('should classify as "ours" when liquidator is our bot', () => {
      const user = '0x' + '1'.repeat(40);
      const liquidator = '0x' + '2'.repeat(40);
      const ourAddress = '0x' + '2'.repeat(40); // Same as liquidator
      const eventSeenAtMs = Date.now();

      const result = classifier.classify(
        user,
        liquidator,
        eventSeenAtMs,
        100,
        12345,
        ourAddress
      );

      expect(result.reason).toBe('ours');
      expect(result.notes).toContain('Liquidation executed by our bot');
    });

    it('should classify as "raced" when no decision trace found', () => {
      const user = '0x' + '3'.repeat(40);
      const liquidator = '0x' + '4'.repeat(40);
      const eventSeenAtMs = Date.now();

      const result = classifier.classify(
        user,
        liquidator,
        eventSeenAtMs,
        100,
        12345
      );

      expect(result.reason).toBe('raced');
      expect(result.notes.length).toBeGreaterThan(0);
    });

    it('should classify as "raced" when action was attempt', () => {
      const user = '0x' + '5'.repeat(40);
      const liquidator = '0x' + '6'.repeat(40);
      const now = Date.now();

      // Record an attempt decision
      const trace: DecisionTrace = {
        user,
        debtAsset: '0x' + 'a'.repeat(40),
        collateralAsset: '0x' + 'b'.repeat(40),
        ts: now - 10000, // 10s ago
        blockNumber: 12344,
        hfAtDecision: 0.99,
        estDebtUsd: 100,
        estProfitUsd: 20,
        thresholds: {
          minDebtUsd: 5,
          minProfitUsd: 10,
          maxSlippagePct: 1.0
        },
        gates: {
          passedMinDebt: true,
          passedMinProfit: true,
          passedSlippage: true,
          passedPrefund: true,
          passedPriceFresh: true,
          passedCallStatic: true
        },
        action: 'attempt',
        priceSource: 'aave_oracle',
        headLagBlocks: 1,
        attemptMeta: {
          txHash: '0x' + 'c'.repeat(64),
          tsSend: now - 9000
        }
      };

      store.record(trace);

      const result = classifier.classify(
        user,
        liquidator,
        now,
        100,
        12345
      );

      expect(result.reason).toBe('raced');
      expect(result.trace).toBeDefined();
    });

    it('should classify as "filtered.min_debt" when skipped due to min debt', () => {
      const user = '0x' + '7'.repeat(40);
      const liquidator = '0x' + '8'.repeat(40);
      const now = Date.now();

      // Record a skip decision due to min debt
      const trace: DecisionTrace = {
        user,
        debtAsset: '0x' + 'a'.repeat(40),
        collateralAsset: '0x' + 'b'.repeat(40),
        ts: now - 10000,
        blockNumber: 12344,
        hfAtDecision: 0.99,
        estDebtUsd: 3, // Below threshold
        estProfitUsd: 20,
        thresholds: {
          minDebtUsd: 5,
          minProfitUsd: 10,
          maxSlippagePct: 1.0
        },
        gates: {
          passedMinDebt: false,
          passedMinProfit: true,
          passedSlippage: true,
          passedPrefund: true,
          passedPriceFresh: true,
          passedCallStatic: true
        },
        action: 'skip',
        skipReason: 'min_debt',
        priceSource: 'aave_oracle',
        headLagBlocks: 0
      };

      store.record(trace);

      const result = classifier.classify(
        user,
        liquidator,
        now,
        100,
        12345
      );

      expect(result.reason).toBe('filtered.min_debt');
      expect(result.notes.some(n => n.includes('debt below threshold'))).toBe(true);
    });

    it('should classify as "filtered.min_profit" when skipped due to min profit', () => {
      const user = '0x' + '9'.repeat(40);
      const liquidator = '0x' + 'a'.repeat(40);
      const now = Date.now();

      const trace: DecisionTrace = {
        user,
        debtAsset: '0x' + 'a'.repeat(40),
        collateralAsset: '0x' + 'b'.repeat(40),
        ts: now - 10000,
        blockNumber: 12344,
        hfAtDecision: 0.99,
        estDebtUsd: 100,
        estProfitUsd: 5, // Below threshold
        thresholds: {
          minDebtUsd: 5,
          minProfitUsd: 10,
          maxSlippagePct: 1.0
        },
        gates: {
          passedMinDebt: true,
          passedMinProfit: false,
          passedSlippage: true,
          passedPrefund: true,
          passedPriceFresh: true,
          passedCallStatic: true
        },
        action: 'skip',
        skipReason: 'min_profit',
        priceSource: 'aave_oracle',
        headLagBlocks: 0
      };

      store.record(trace);

      const result = classifier.classify(
        user,
        liquidator,
        now,
        100,
        12345
      );

      expect(result.reason).toBe('filtered.min_profit');
      expect(result.notes.some(n => n.includes('profit below threshold'))).toBe(true);
    });

    it('should classify as "filtered.slippage" when skipped due to slippage', () => {
      const user = '0x' + 'b'.repeat(40);
      const liquidator = '0x' + 'c'.repeat(40);
      const now = Date.now();

      const trace: DecisionTrace = {
        user,
        debtAsset: '0x' + 'a'.repeat(40),
        collateralAsset: '0x' + 'b'.repeat(40),
        ts: now - 10000,
        blockNumber: 12344,
        hfAtDecision: 0.99,
        estDebtUsd: 100,
        estProfitUsd: 20,
        thresholds: {
          minDebtUsd: 5,
          minProfitUsd: 10,
          maxSlippagePct: 1.0
        },
        gates: {
          passedMinDebt: true,
          passedMinProfit: true,
          passedSlippage: false,
          passedPrefund: true,
          passedPriceFresh: true,
          passedCallStatic: true
        },
        action: 'skip',
        skipReason: 'slippage',
        priceSource: 'aave_oracle',
        headLagBlocks: 0
      };

      store.record(trace);

      const result = classifier.classify(
        user,
        liquidator,
        now,
        100,
        12345
      );

      expect(result.reason).toBe('filtered.slippage');
      expect(result.notes.some(n => n.includes('slippage'))).toBe(true);
    });

    it('should classify as "latency.head_lag" when head lag is high', () => {
      const user = '0x' + 'd'.repeat(40);
      const liquidator = '0x' + 'e'.repeat(40);
      const now = Date.now();

      const trace: DecisionTrace = {
        user,
        debtAsset: '0x' + 'a'.repeat(40),
        collateralAsset: '0x' + 'b'.repeat(40),
        ts: now - 10000,
        blockNumber: 12344,
        hfAtDecision: 1.01, // Above 1 but skipped
        estDebtUsd: 100,
        estProfitUsd: 20,
        thresholds: {
          minDebtUsd: 5,
          minProfitUsd: 10,
          maxSlippagePct: 1.0
        },
        gates: {
          passedMinDebt: true,
          passedMinProfit: true,
          passedSlippage: true,
          passedPrefund: true,
          passedPriceFresh: true,
          passedCallStatic: true
        },
        action: 'skip',
        priceSource: 'aave_oracle',
        headLagBlocks: 5 // High lag
      };

      store.record(trace);

      const result = classifier.classify(
        user,
        liquidator,
        now,
        100,
        12345
      );

      expect(result.reason).toBe('latency.head_lag');
      expect(result.notes.some(n => n.includes('head lag'))).toBe(true);
    });

    it('should classify as "latency.pricing_delay" when HF was below 1 at prev block', () => {
      const user = '0x' + 'f'.repeat(40);
      const liquidator = '0x' + 'g'.repeat(40);
      const now = Date.now();

      const trace: DecisionTrace = {
        user,
        debtAsset: '0x' + 'a'.repeat(40),
        collateralAsset: '0x' + 'b'.repeat(40),
        ts: now - 10000,
        blockNumber: 12344,
        hfAtDecision: 1.01, // Above 1 now
        hfPrevBlock: 0.98, // But was below 1 previously
        estDebtUsd: 100,
        estProfitUsd: 20,
        thresholds: {
          minDebtUsd: 5,
          minProfitUsd: 10,
          maxSlippagePct: 1.0
        },
        gates: {
          passedMinDebt: true,
          passedMinProfit: true,
          passedSlippage: true,
          passedPrefund: true,
          passedPriceFresh: true,
          passedCallStatic: true
        },
        action: 'skip',
        priceSource: 'aave_oracle',
        headLagBlocks: 1
      };

      store.record(trace);

      const result = classifier.classify(
        user,
        liquidator,
        now,
        100,
        12345
      );

      expect(result.reason).toBe('latency.pricing_delay');
      expect(result.notes.some(n => n.includes('pricing delay'))).toBe(true);
    });

    it('should classify as "unknown" for unrecognized skip reason', () => {
      const user = '0x' + 'h'.repeat(40);
      const liquidator = '0x' + 'i'.repeat(40);
      const now = Date.now();

      const trace: DecisionTrace = {
        user,
        debtAsset: '0x' + 'a'.repeat(40),
        collateralAsset: '0x' + 'b'.repeat(40),
        ts: now - 10000,
        blockNumber: 12344,
        hfAtDecision: 0.99,
        estDebtUsd: 100,
        estProfitUsd: 20,
        thresholds: {
          minDebtUsd: 5,
          minProfitUsd: 10,
          maxSlippagePct: 1.0
        },
        gates: {
          passedMinDebt: true,
          passedMinProfit: true,
          passedSlippage: true,
          passedPrefund: true,
          passedPriceFresh: true,
          passedCallStatic: true
        },
        action: 'skip',
        skipReason: 'unknown',
        priceSource: 'aave_oracle',
        headLagBlocks: 0
      };

      store.record(trace);

      const result = classifier.classify(
        user,
        liquidator,
        now,
        100,
        12345
      );

      expect(result.reason).toBe('unknown');
      expect(result.notes.length).toBeGreaterThan(0);
    });
  });
});
