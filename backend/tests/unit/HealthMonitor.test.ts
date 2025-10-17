// Unit tests for HealthMonitor
import { describe, it, expect, beforeEach } from 'vitest';

import { HealthMonitor } from '../../src/services/HealthMonitor.js';
import { SubgraphService } from '../../src/services/SubgraphService.js';

describe('HealthMonitor', () => {
  let healthMonitor: HealthMonitor;
  let mockSubgraphService: SubgraphService;

  beforeEach(() => {
    mockSubgraphService = SubgraphService.createMock();
    healthMonitor = new HealthMonitor(mockSubgraphService);
  });

  describe('updateAndDetectBreaches', () => {
    it('should return empty array (disabled)', async () => {
      const breaches = await healthMonitor.updateAndDetectBreaches();
      expect(breaches).toHaveLength(0);
    });

    it('should return empty array regardless of data (disabled)', async () => {
      // Even with mock data, should return empty since monitoring is disabled
      const breaches = await healthMonitor.updateAndDetectBreaches();
      expect(breaches).toHaveLength(0);
    });

  });

  describe('getHealthSnapshotMap', () => {
    it('should return empty map (disabled)', async () => {
      const snapshot = await healthMonitor.getHealthSnapshotMap();
      expect(snapshot.size).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return disabled status', () => {
      const stats = healthMonitor.getStats();

      expect(stats).toHaveProperty('mode');
      expect(stats.mode).toBe('disabled');
      expect(stats).toHaveProperty('message');
    });
  });

  describe('clearState', () => {
    it('should clear tracking state (no-op)', async () => {
      // No-op now, just ensure it doesn't throw
      healthMonitor.clearState();
      const stats = healthMonitor.getStats();
      expect(stats.mode).toBe('disabled');
    });
  });
});
