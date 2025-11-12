/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { PrioritySweepRunner } from '../../src/priority/prioritySweep.js';

// Mock the config module
vi.mock('../../src/config/index.js', () => ({
  config: {
    prioritySweepPageSize: 100,
    priorityMaxScanUsers: 1000,
    priorityTargetSize: 50,
    prioritySweepInterRequestMs: 0,
    priorityScoreDebtWeight: 1.0,
    priorityScoreCollateralWeight: 0.8,
    priorityScoreHfPenalty: 2.5,
    priorityScoreHfCeiling: 1.20,
    priorityScoreLowHfBoost: 1.1,
    priorityMinDebtUsd: 500,
    priorityMinCollateralUsd: 1500,
    hotlistMaxHf: 1.05,
    prioritySweepMetricsEnabled: false,
    prioritySweepLogSummary: false,
    useMockSubgraph: true,
    resolveSubgraphEndpoint: () => ({ endpoint: 'mock://endpoint', needsHeader: false })
  }
}));

// Mock the metrics module
vi.mock('../../src/metrics/priority.js', () => ({
  prioritySweepRunsTotal: { inc: vi.fn() },
  prioritySweepLastDurationMs: { set: vi.fn() },
  prioritySweepSeen: { set: vi.fn() },
  prioritySweepFiltered: { set: vi.fn() },
  prioritySweepSelected: { set: vi.fn() },
  prioritySweepTopScore: { set: vi.fn() },
  prioritySweepMedianHf: { set: vi.fn() },
  prioritySweepLastErrorFlag: { set: vi.fn() },
  prioritySweepDurationHistogram: { observe: vi.fn() },
  prioritySweepHeapPeakMb: { set: vi.fn() },
  prioritySweepErrorsTotal: { inc: vi.fn() }
}));

describe('PrioritySweepRunner', () => {
  let runner: PrioritySweepRunner;

  beforeEach(() => {
    runner = new PrioritySweepRunner();
  });

  describe('initialization', () => {
    it('should initialize with null priority set', () => {
      expect(runner.getPrioritySet()).toBeNull();
    });
  });

  describe('runSweep', () => {
    it('should handle mock mode gracefully', async () => {
      const result = await runner.runSweep();
      
      expect(result).toBeDefined();
      expect(result.version).toBe(1);
      expect(result.users).toEqual([]);
      expect(result.stats.usersSeen).toBe(0);
      expect(result.stats.usersFiltered).toBe(0);
      expect(result.stats.usersSelected).toBe(0);
    });

    it('should update priority set after sweep', async () => {
      expect(runner.getPrioritySet()).toBeNull();
      
      await runner.runSweep();
      
      const prioritySet = runner.getPrioritySet();
      expect(prioritySet).not.toBeNull();
      expect(prioritySet?.version).toBe(1);
    });

    it('should increment version on each sweep', async () => {
      await runner.runSweep();
      const firstVersion = runner.getPrioritySet()?.version;
      
      await runner.runSweep();
      const secondVersion = runner.getPrioritySet()?.version;
      
      expect(secondVersion).toBe((firstVersion || 0) + 1);
    });

    it('should abort on timeout signal', async () => {
      const abortController = new AbortController();
      
      // Abort immediately
      abortController.abort();
      
      await expect(runner.runSweep(abortController.signal)).rejects.toThrow('aborted');
    });

    it('should include stats in priority set', async () => {
      const result = await runner.runSweep();
      
      expect(result.stats).toBeDefined();
      expect(result.stats.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.stats.heapPeakMb).toBeGreaterThan(0);
      expect(result.stats.topScore).toBeGreaterThanOrEqual(0);
      expect(result.stats.medianHf).toBeGreaterThanOrEqual(0);
    });
  });
});
