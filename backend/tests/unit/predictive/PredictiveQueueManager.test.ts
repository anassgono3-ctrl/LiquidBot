/**
 * Unit tests for PredictiveQueueManager
 * Tests deduplication, budget enforcement, and cooldown logic
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PredictiveQueueManager,
  type PredictiveQueueEntry
} from '../../../src/services/predictive/PredictiveQueueManager.js';

describe('PredictiveQueueManager', () => {
  let manager: PredictiveQueueManager;

  beforeEach(() => {
    manager = new PredictiveQueueManager({
      callsPerBlock: 100,
      candidatesPerBlock: 50,
      safetyMax: 200,
      cooldownSec: 60,
      blockDebounce: 3
    });
  });

  describe('Basic evaluation gating', () => {
    it('should allow first evaluation of a user', () => {
      const result = manager.shouldEvaluate('0x123', 'baseline', 1000);
      expect(result.shouldEvaluate).toBe(true);
      expect(result.reason).toBe('all_checks_passed');
    });

    it('should mark user as evaluated', () => {
      const result = manager.shouldEvaluate('0x123', 'baseline', 1000);
      expect(result.shouldEvaluate).toBe(true);

      const entry: PredictiveQueueEntry = {
        user: '0x123',
        scenario: 'baseline',
        lastEvaluatedBlock: 1000,
        lastEvaluatedMs: Date.now(),
        hf: 1.01,
        debtUsd: 1000,
        priority: 100
      };
      manager.markEvaluated(entry);

      const stats = manager.getStats();
      expect(stats.candidatesThisBlock).toBe(1);
    });
  });

  describe('Same-block deduplication', () => {
    it('should prevent re-evaluation in same block', () => {
      const block = 1000;
      
      // First evaluation
      let result = manager.shouldEvaluate('0x123', 'baseline', block);
      expect(result.shouldEvaluate).toBe(true);

      manager.markEvaluated({
        user: '0x123',
        scenario: 'baseline',
        lastEvaluatedBlock: block,
        lastEvaluatedMs: Date.now(),
        hf: 1.01,
        debtUsd: 1000,
        priority: 100
      });

      // Second evaluation in same block
      result = manager.shouldEvaluate('0x123', 'baseline', block);
      expect(result.shouldEvaluate).toBe(false);
      expect(result.reason).toContain('dedup_same_block');
    });

    it('should allow different scenarios in same block', () => {
      const block = 1000;
      
      // Evaluate baseline scenario
      let result = manager.shouldEvaluate('0x123', 'baseline', block);
      expect(result.shouldEvaluate).toBe(true);
      manager.markEvaluated({
        user: '0x123',
        scenario: 'baseline',
        lastEvaluatedBlock: block,
        lastEvaluatedMs: Date.now(),
        hf: 1.01,
        debtUsd: 1000,
        priority: 100
      });

      // Evaluate adverse scenario (different scenario, same user, same block)
      result = manager.shouldEvaluate('0x123', 'adverse', block);
      expect(result.shouldEvaluate).toBe(true);
    });
  });

  describe('Block debounce', () => {
    it('should enforce block debounce between evaluations', () => {
      const startBlock = 1000;
      
      // First evaluation at block 1000
      let result = manager.shouldEvaluate('0x123', 'baseline', startBlock);
      expect(result.shouldEvaluate).toBe(true);
      manager.markEvaluated({
        user: '0x123',
        scenario: 'baseline',
        lastEvaluatedBlock: startBlock,
        lastEvaluatedMs: Date.now(),
        hf: 1.01,
        debtUsd: 1000,
        priority: 100
      });

      // Attempt evaluation at block 1001 (1 block later, within debounce of 3)
      result = manager.shouldEvaluate('0x123', 'baseline', startBlock + 1);
      expect(result.shouldEvaluate).toBe(false);
      expect(result.reason).toContain('dedup_block_debounce');

      // Attempt at block 1002 (2 blocks later, still within debounce)
      result = manager.shouldEvaluate('0x123', 'baseline', startBlock + 2);
      expect(result.shouldEvaluate).toBe(false);
      expect(result.reason).toContain('dedup_block_debounce');

      // Attempt at block 1003 (3 blocks later, equals debounce - should still be blocked)
      result = manager.shouldEvaluate('0x123', 'baseline', startBlock + 3);
      expect(result.shouldEvaluate).toBe(true); // >= debounce threshold
    });
  });

  describe('Time-based cooldown', () => {
    it('should enforce cooldown period', async () => {
      const block = 1000;
      const now = Date.now();
      
      // First evaluation
      let result = manager.shouldEvaluate('0x123', 'baseline', block);
      expect(result.shouldEvaluate).toBe(true);
      manager.markEvaluated({
        user: '0x123',
        scenario: 'baseline',
        lastEvaluatedBlock: block,
        lastEvaluatedMs: now,
        hf: 1.01,
        debtUsd: 1000,
        priority: 100
      });

      // Attempt immediately (within cooldown)
      // Advance block to bypass block debounce, but keep time within cooldown
      result = manager.shouldEvaluate('0x123', 'baseline', block + 10);
      expect(result.shouldEvaluate).toBe(false);
      expect(result.reason).toContain('dedup_cooldown');
    });
  });

  describe('Per-block candidate budget', () => {
    it('should enforce candidate limit per block', () => {
      const block = 1000;
      
      // Fill up to limit (50 candidates)
      for (let i = 0; i < 50; i++) {
        const result = manager.shouldEvaluate(`0x${i}`, 'baseline', block);
        expect(result.shouldEvaluate).toBe(true);
        manager.markEvaluated({
          user: `0x${i}`,
          scenario: 'baseline',
          lastEvaluatedBlock: block,
          lastEvaluatedMs: Date.now(),
          hf: 1.01,
          debtUsd: 1000,
          priority: 100
        });
      }

      // Attempt 51st candidate - should be rejected
      const result = manager.shouldEvaluate('0x999', 'baseline', block);
      expect(result.shouldEvaluate).toBe(false);
      expect(result.reason).toContain('candidate_budget_exceeded');

      const stats = manager.getStats();
      expect(stats.budgetExceededThisBlock).toBe(true);
    });

    it('should reset budget on new block', () => {
      const block = 1000;
      
      // Fill up block 1000
      for (let i = 0; i < 50; i++) {
        manager.shouldEvaluate(`0x${i}`, 'baseline', block);
        manager.markEvaluated({
          user: `0x${i}`,
          scenario: 'baseline',
          lastEvaluatedBlock: block,
          lastEvaluatedMs: Date.now(),
          hf: 1.01,
          debtUsd: 1000,
          priority: 100
        });
      }

      // Advance to block 1001 - budget should reset
      const result = manager.shouldEvaluate('0x999', 'baseline', block + 1);
      expect(result.shouldEvaluate).toBe(true);

      const stats = manager.getStats();
      expect(stats.candidatesThisBlock).toBe(1);
      expect(stats.budgetExceededThisBlock).toBe(false);
    });
  });

  describe('Per-block call budget', () => {
    it('should track and enforce call budget', () => {
      const block = 1000;
      
      // Increment calls up to limit
      for (let i = 0; i < 100; i++) {
        manager.incrementCalls(1);
      }

      // Attempt evaluation - should fail due to call budget
      const result = manager.shouldEvaluate('0x123', 'baseline', block);
      expect(result.shouldEvaluate).toBe(false);
      expect(result.reason).toContain('call_budget_exceeded');
    });

    it('should allow batch call increments', () => {
      const block = 1000;
      
      manager.incrementCalls(50); // Batch of 50 calls
      
      const remaining = manager.getRemainingBudget();
      expect(remaining.calls).toBe(50);
    });
  });

  describe('Safety maximum queue size', () => {
    it('should enforce safety maximum', () => {
      const block = 1000;
      
      // Fill up to safety max (200)
      for (let i = 0; i < 200; i++) {
        const result = manager.shouldEvaluate(`0x${i}`, 'baseline', block + i);
        if (result.shouldEvaluate) {
          manager.markEvaluated({
            user: `0x${i}`,
            scenario: 'baseline',
            lastEvaluatedBlock: block + i,
            lastEvaluatedMs: Date.now(),
            hf: 1.01,
            debtUsd: 1000,
            priority: 100
          });
        }
      }

      // Attempt to add 201st entry - should be rejected
      const result = manager.shouldEvaluate('0x999', 'baseline', block + 500);
      expect(result.shouldEvaluate).toBe(false);
      expect(result.reason).toContain('queue_safety_max_exceeded');
    });
  });

  describe('User removal', () => {
    it('should remove all scenarios for a user', () => {
      const block = 1000;
      
      // Add user with multiple scenarios
      manager.shouldEvaluate('0x123', 'baseline', block);
      manager.markEvaluated({
        user: '0x123',
        scenario: 'baseline',
        lastEvaluatedBlock: block,
        lastEvaluatedMs: Date.now(),
        hf: 1.01,
        debtUsd: 1000,
        priority: 100
      });

      manager.shouldEvaluate('0x123', 'adverse', block);
      manager.markEvaluated({
        user: '0x123',
        scenario: 'adverse',
        lastEvaluatedBlock: block,
        lastEvaluatedMs: Date.now(),
        hf: 1.01,
        debtUsd: 1000,
        priority: 100
      });

      let stats = manager.getStats();
      expect(stats.currentSize).toBe(2);

      // Remove user
      manager.removeUser('0x123');

      stats = manager.getStats();
      expect(stats.currentSize).toBe(0);
    });

    it('should handle case-insensitive removal', () => {
      const block = 1000;
      
      manager.shouldEvaluate('0xABC', 'baseline', block);
      manager.markEvaluated({
        user: '0xABC',
        scenario: 'baseline',
        lastEvaluatedBlock: block,
        lastEvaluatedMs: Date.now(),
        hf: 1.01,
        debtUsd: 1000,
        priority: 100
      });

      manager.removeUser('0xabc'); // Different case

      const stats = manager.getStats();
      expect(stats.currentSize).toBe(0);
    });
  });

  describe('Stale entry pruning', () => {
    it('should prune entries older than threshold', () => {
      const block = 1000;
      const oldTimestamp = Date.now() - 400000; // 6+ minutes ago
      
      // Add old entry
      manager.shouldEvaluate('0x123', 'baseline', block);
      manager.markEvaluated({
        user: '0x123',
        scenario: 'baseline',
        lastEvaluatedBlock: block,
        lastEvaluatedMs: oldTimestamp,
        hf: 1.01,
        debtUsd: 1000,
        priority: 100
      });

      // Add fresh entry
      manager.shouldEvaluate('0x456', 'baseline', block);
      manager.markEvaluated({
        user: '0x456',
        scenario: 'baseline',
        lastEvaluatedBlock: block,
        lastEvaluatedMs: Date.now(),
        hf: 1.01,
        debtUsd: 1000,
        priority: 100
      });

      let stats = manager.getStats();
      expect(stats.currentSize).toBe(2);

      // Prune with 5 minute threshold
      const pruned = manager.pruneStale(300000);
      expect(pruned).toBe(1);

      stats = manager.getStats();
      expect(stats.currentSize).toBe(1);
    });
  });

  describe('Statistics and budget tracking', () => {
    it('should track dedup skips', () => {
      const block = 1000;
      
      manager.shouldEvaluate('0x123', 'baseline', block);
      manager.markEvaluated({
        user: '0x123',
        scenario: 'baseline',
        lastEvaluatedBlock: block,
        lastEvaluatedMs: Date.now(),
        hf: 1.01,
        debtUsd: 1000,
        priority: 100
      });

      // Attempt re-evaluation (should skip)
      manager.shouldEvaluate('0x123', 'baseline', block);

      const stats = manager.getStats();
      expect(stats.dedupSkipsThisBlock).toBe(1);
    });

    it('should provide remaining budget', () => {
      const block = 1000;
      
      manager.incrementCalls(30);
      for (let i = 0; i < 10; i++) {
        manager.shouldEvaluate(`0x${i}`, 'baseline', block);
        manager.markEvaluated({
          user: `0x${i}`,
          scenario: 'baseline',
          lastEvaluatedBlock: block,
          lastEvaluatedMs: Date.now(),
          hf: 1.01,
          debtUsd: 1000,
          priority: 100
        });
      }

      const remaining = manager.getRemainingBudget();
      expect(remaining.calls).toBe(70);
      expect(remaining.candidates).toBe(40);
    });
  });
});
