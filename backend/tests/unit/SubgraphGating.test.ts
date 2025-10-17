// Test for subgraph gating and on-chain backfill features
import { describe, it, expect } from 'vitest';

import { config } from '../../src/config/index.js';

describe('Subgraph Gating Configuration', () => {
  describe('USE_SUBGRAPH flag', () => {
    it('should have useSubgraph config accessor', () => {
      expect(config).toHaveProperty('useSubgraph');
      expect(typeof config.useSubgraph).toBe('boolean');
    });
  });

  describe('On-chain backfill configuration', () => {
    it('should have backfill enabled flag', () => {
      expect(config).toHaveProperty('realtimeInitialBackfillEnabled');
      expect(typeof config.realtimeInitialBackfillEnabled).toBe('boolean');
    });

    it('should have backfill blocks configuration', () => {
      expect(config).toHaveProperty('realtimeInitialBackfillBlocks');
      expect(typeof config.realtimeInitialBackfillBlocks).toBe('number');
      expect(config.realtimeInitialBackfillBlocks).toBeGreaterThan(0);
    });

    it('should have backfill chunk blocks configuration', () => {
      expect(config).toHaveProperty('realtimeInitialBackfillChunkBlocks');
      expect(typeof config.realtimeInitialBackfillChunkBlocks).toBe('number');
      expect(config.realtimeInitialBackfillChunkBlocks).toBeGreaterThan(0);
    });

    it('should have backfill max logs configuration', () => {
      expect(config).toHaveProperty('realtimeInitialBackfillMaxLogs');
      expect(typeof config.realtimeInitialBackfillMaxLogs).toBe('number');
      expect(config.realtimeInitialBackfillMaxLogs).toBeGreaterThan(0);
    });
  });

  describe('Head-check paging configuration', () => {
    it('should have head check page strategy', () => {
      expect(config).toHaveProperty('headCheckPageStrategy');
      expect(['all', 'paged']).toContain(config.headCheckPageStrategy);
    });

    it('should have head check page size', () => {
      expect(config).toHaveProperty('headCheckPageSize');
      expect(typeof config.headCheckPageSize).toBe('number');
      expect(config.headCheckPageSize).toBeGreaterThan(0);
    });
  });

  describe('Subgraph paging configuration', () => {
    it('should have subgraph page size', () => {
      expect(config).toHaveProperty('subgraphPageSize');
      expect(typeof config.subgraphPageSize).toBe('number');
      // Should be clamped between 50 and 200
      expect(config.subgraphPageSize).toBeGreaterThanOrEqual(50);
      expect(config.subgraphPageSize).toBeLessThanOrEqual(200);
    });
  });
});
