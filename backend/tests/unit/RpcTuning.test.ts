import { describe, it, expect } from 'vitest';

import { config } from '../../src/config/index.js';

describe('RPC Tuning Configuration', () => {
  describe('Environment Variables', () => {
    it('should have default multicall batch size of 120', () => {
      expect(config.multicallBatchSize).toBe(120);
    });

    it('should have adaptive head paging enabled by default', () => {
      expect(config.headPageAdaptive).toBe(true);
    });

    it('should have head page target of 900ms by default', () => {
      expect(config.headPageTargetMs).toBe(900);
    });

    it('should have head page min of 600 by default', () => {
      expect(config.headPageMin).toBe(600);
    });

    it('should have head page max set to a reasonable value', () => {
      expect(config.headPageMax).toBeGreaterThan(config.headPageMin);
      expect(config.headPageMax).toBeGreaterThanOrEqual(config.headCheckPageSize);
    });

    it('should have hedge window of 300ms by default', () => {
      expect(config.headCheckHedgeMs).toBe(300);
    });

    it('should have event batch coalesce window of 120ms by default', () => {
      expect(config.eventBatchCoalesceMs).toBe(120);
    });

    it('should have event batch max per block of 2 by default', () => {
      expect(config.eventBatchMaxPerBlock).toBe(2);
    });

    it('should have max parallel event batches of 1 by default', () => {
      expect(config.maxParallelEventBatches).toBe(1);
    });
  });

  describe('Configuration Validation', () => {
    it('should have valid page size bounds', () => {
      expect(config.headPageMin).toBeGreaterThan(0);
      expect(config.headPageMax).toBeGreaterThan(config.headPageMin);
      expect(config.headCheckPageSize).toBeGreaterThan(0);
    });

    it('should have valid timeout configuration', () => {
      expect(config.chunkTimeoutMs).toBeGreaterThan(0);
      expect(config.chunkRetryAttempts).toBeGreaterThanOrEqual(0);
    });

    it('should have valid event coalescing configuration', () => {
      expect(config.eventBatchCoalesceMs).toBeGreaterThan(0);
      expect(config.eventBatchMaxPerBlock).toBeGreaterThan(0);
      expect(config.maxParallelEventBatches).toBeGreaterThan(0);
    });

    it('should have valid multicall batch size', () => {
      expect(config.multicallBatchSize).toBeGreaterThan(0);
      expect(config.multicallBatchSize).toBeLessThanOrEqual(500);
    });
  });
});
