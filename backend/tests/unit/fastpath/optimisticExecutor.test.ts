import { describe, it, expect, beforeEach } from 'vitest';

import { OptimisticExecutor } from '../../../src/exec/fastpath/OptimisticExecutor.js';
import { reversionBudget } from '../../../src/exec/fastpath/ReversionBudget.js';

describe('OptimisticExecutor', () => {
  let executor: OptimisticExecutor;

  beforeEach(() => {
    // Reset the singleton budget before each test
    reversionBudget.reset();
    executor = new OptimisticExecutor(true, 5); // enabled, 5 bps epsilon
  });

  describe('shouldExecuteOptimistic', () => {
    it('should execute optimistic when HF < epsilon threshold', () => {
      const result = executor.shouldExecuteOptimistic(0.995); // Below 0.9995
      expect(result.executed).toBe(true);
      expect(result.reason).toBe('epsilon_threshold');
    });

    it('should not execute optimistic when HF >= epsilon threshold', () => {
      const result = executor.shouldExecuteOptimistic(0.9996); // Above 0.9995
      expect(result.executed).toBe(false);
      expect(result.reason).toBe('borderline_hf');
    });

    it('should not execute when budget exceeded', () => {
      // Exhaust budget using the singleton
      for (let i = 0; i < 50; i++) {
        reversionBudget.recordRevert();
      }

      const result = executor.shouldExecuteOptimistic(0.99);
      expect(result.executed).toBe(false);
      expect(result.reason).toBe('budget_exceeded');
    });

    it('should not execute when disabled', () => {
      const disabledExecutor = new OptimisticExecutor(false, 5);
      const result = disabledExecutor.shouldExecuteOptimistic(0.99);
      expect(result.executed).toBe(false);
      expect(result.reason).toBe('borderline_hf');
    });

    it('should include latency measurement', () => {
      const result = executor.shouldExecuteOptimistic(0.995);
      expect(result.latencyMs).toBeDefined();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getEpsilonThreshold', () => {
    it('should calculate correct epsilon threshold', () => {
      expect(executor.getEpsilonThreshold()).toBe(0.9995); // 1.0 - 0.0005
    });

    it('should handle different epsilon values', () => {
      const executor10 = new OptimisticExecutor(true, 10);
      expect(executor10.getEpsilonThreshold()).toBe(0.999); // 1.0 - 0.001
    });
  });

  describe('recordSuccess', () => {
    it('should record successful execution', () => {
      expect(() => executor.recordSuccess()).not.toThrow();
    });
  });

  describe('recordRevert', () => {
    it('should record revert and update budget', () => {
      const initialBudget = reversionBudget.getRemainingBudget();
      executor.recordRevert();
      expect(reversionBudget.getRemainingBudget()).toBe(initialBudget - 1);
    });
  });

  describe('verifyPostExecution', () => {
    it('should handle successful verification', async () => {
      const result = await executor.verifyPostExecution('0xtxhash', async () => true);
      expect(result).toBe(true);
    });

    it('should handle failed verification', async () => {
      const result = await executor.verifyPostExecution('0xtxhash', async () => false);
      expect(result).toBe(false);
    });

    it('should handle verification errors', async () => {
      const result = await executor.verifyPostExecution('0xtxhash', async () => {
        throw new Error('Verification failed');
      });
      expect(result).toBe(false);
    });
  });

  describe('isEnabled', () => {
    it('should return true when enabled and budget available', () => {
      expect(executor.isEnabled()).toBe(true);
    });

    it('should return false when disabled', () => {
      const disabledExecutor = new OptimisticExecutor(false, 5);
      expect(disabledExecutor.isEnabled()).toBe(false);
    });

    it('should return false when budget exceeded', () => {
      reversionBudget.reset();
      for (let i = 0; i < 50; i++) {
        reversionBudget.recordRevert();
      }
      expect(executor.isEnabled()).toBe(false);
    });
  });
});
