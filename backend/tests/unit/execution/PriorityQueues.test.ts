import { describe, it, expect, beforeEach } from 'vitest';

import { HotCriticalQueue, WarmProjectedQueue, type PriorityQueueConfig, type QueueEntry } from '../../../src/execution/PriorityQueues.js';

describe('PriorityQueues', () => {
  let config: PriorityQueueConfig;

  beforeEach(() => {
    config = {
      hotHfThresholdBps: 10012, // 1.0012
      warmHfThresholdBps: 10300, // 1.03
      preSim: {
        enabled: true,
        hfWindow: 1.01,
        bufferBps: 50
      },
      maxHotSize: 10,
      maxWarmSize: 20,
      minLiqExecUsd: 50
    };
  });

  describe('HotCriticalQueue', () => {
    it('should accept entry with HF <= hot threshold', () => {
      const queue = new HotCriticalQueue(config);
      const entry: QueueEntry = {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 1.0010,
        blockNumber: 12345,
        timestamp: Date.now(),
        totalCollateralUsd: 1000,
        totalDebtUsd: 999,
        entryReason: 'hf_threshold',
        priority: 1
      };

      const added = queue.upsert(entry);
      expect(added).toBe(true);
      expect(queue.size()).toBe(1);
    });

    it('should reject entry with HF > hot threshold and no projection', () => {
      const queue = new HotCriticalQueue(config);
      const entry: QueueEntry = {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 1.05,
        blockNumber: 12345,
        timestamp: Date.now(),
        totalCollateralUsd: 1000,
        totalDebtUsd: 950,
        entryReason: 'hf_threshold',
        priority: 10
      };

      const added = queue.upsert(entry);
      expect(added).toBe(false);
      expect(queue.size()).toBe(0);
    });

    it('should accept entry with projected HF < 1.0 within 2 blocks', () => {
      const queue = new HotCriticalQueue(config);
      const entry: QueueEntry = {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 1.02,
        blockNumber: 12345,
        timestamp: Date.now(),
        totalCollateralUsd: 1000,
        totalDebtUsd: 980,
        projectedHF: 0.995,
        blocksUntilCritical: 2,
        entryReason: 'volatility_projection',
        priority: 5
      };

      const added = queue.upsert(entry);
      expect(added).toBe(true);
      expect(queue.size()).toBe(1);
    });

    it('should reject entry below min debt USD', () => {
      const queue = new HotCriticalQueue(config);
      const entry: QueueEntry = {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 1.0010,
        blockNumber: 12345,
        timestamp: Date.now(),
        totalCollateralUsd: 30,
        totalDebtUsd: 29.9,
        entryReason: 'hf_threshold',
        priority: 1
      };

      const added = queue.upsert(entry);
      expect(added).toBe(false);
    });

    it('should return entries sorted by priority', () => {
      const queue = new HotCriticalQueue(config);
      
      queue.upsert({
        user: '0x1111111111111111111111111111111111111111',
        healthFactor: 1.001,
        blockNumber: 12345,
        timestamp: Date.now(),
        totalCollateralUsd: 1000,
        totalDebtUsd: 999,
        entryReason: 'hf_threshold',
        priority: 10
      });

      queue.upsert({
        user: '0x2222222222222222222222222222222222222222',
        healthFactor: 0.999,
        blockNumber: 12345,
        timestamp: Date.now(),
        totalCollateralUsd: 1000,
        totalDebtUsd: 1001,
        entryReason: 'hf_threshold',
        priority: 1
      });

      const entries = queue.getAll();
      expect(entries[0].priority).toBe(1);
      expect(entries[1].priority).toBe(10);
    });

    it('should provide accurate statistics', () => {
      const queue = new HotCriticalQueue(config);
      
      queue.upsert({
        user: '0x1111111111111111111111111111111111111111',
        healthFactor: 1.001,
        blockNumber: 12345,
        timestamp: Date.now(),
        totalCollateralUsd: 1000,
        totalDebtUsd: 999,
        entryReason: 'hf_threshold',
        priority: 10
      });

      queue.upsert({
        user: '0x2222222222222222222222222222222222222222',
        healthFactor: 0.999,
        blockNumber: 12345,
        timestamp: Date.now(),
        totalCollateralUsd: 2000,
        totalDebtUsd: 2001,
        entryReason: 'price_trigger',
        priority: 1
      });

      const stats = queue.getStats();
      expect(stats.size).toBe(2);
      expect(stats.minHF).toBe(0.999);
      expect(stats.avgDebtUsd).toBe(1500);
      expect(stats.reasonBreakdown['hf_threshold']).toBe(1);
      expect(stats.reasonBreakdown['price_trigger']).toBe(1);
    });
  });

  describe('WarmProjectedQueue', () => {
    it('should accept entry between hot and warm thresholds', () => {
      const queue = new WarmProjectedQueue(config);
      const entry: QueueEntry = {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 1.015,
        blockNumber: 12345,
        timestamp: Date.now(),
        totalCollateralUsd: 1000,
        totalDebtUsd: 985,
        entryReason: 'hf_threshold',
        priority: 5
      };

      const added = queue.upsert(entry);
      expect(added).toBe(true);
      expect(queue.size()).toBe(1);
    });

    it('should reject entry below hot threshold', () => {
      const queue = new WarmProjectedQueue(config);
      const entry: QueueEntry = {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 1.0010,
        blockNumber: 12345,
        timestamp: Date.now(),
        totalCollateralUsd: 1000,
        totalDebtUsd: 999,
        entryReason: 'hf_threshold',
        priority: 1
      };

      const added = queue.upsert(entry);
      expect(added).toBe(false);
      expect(queue.size()).toBe(0);
    });

    it('should reject entry above warm threshold', () => {
      const queue = new WarmProjectedQueue(config);
      const entry: QueueEntry = {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 1.05,
        blockNumber: 12345,
        timestamp: Date.now(),
        totalCollateralUsd: 1000,
        totalDebtUsd: 950,
        entryReason: 'hf_threshold',
        priority: 10
      };

      const added = queue.upsert(entry);
      expect(added).toBe(false);
      expect(queue.size()).toBe(0);
    });
  });
});
