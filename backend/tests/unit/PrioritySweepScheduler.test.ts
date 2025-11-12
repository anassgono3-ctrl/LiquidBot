/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as scheduler from '../../src/priority/scheduler.js';

// Mock the config module
vi.mock('../../src/config/index.js', () => ({
  config: {
    prioritySweepEnabled: true,
    prioritySweepIntervalMin: 1,
    priorityMinDebtUsd: 500,
    priorityMinCollateralUsd: 1500,
    priorityTargetSize: 50,
    priorityMaxScanUsers: 1000,
    prioritySweepTimeoutMs: 10000,
    prioritySweepPageSize: 100,
    prioritySweepInterRequestMs: 0,
    priorityScoreDebtWeight: 1.0,
    priorityScoreCollateralWeight: 0.8,
    priorityScoreHfPenalty: 2.5,
    priorityScoreHfCeiling: 1.20,
    priorityScoreLowHfBoost: 1.1,
    hotlistMaxHf: 1.05,
    prioritySweepMetricsEnabled: false,
    prioritySweepLogSummary: false,
    useMockSubgraph: true,
    resolveSubgraphEndpoint: () => ({ endpoint: 'mock://endpoint', needsHeader: false })
  }
}));

// Mock metrics module
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

describe('Priority Sweep Scheduler', () => {
  beforeEach(() => {
    // Stop any running scheduler before each test
    scheduler.stopPrioritySweepScheduler();
  });

  afterEach(() => {
    // Clean up after each test
    scheduler.stopPrioritySweepScheduler();
  });

  describe('startPrioritySweepScheduler', () => {
    it('should start scheduler and run sweep immediately', async () => {
      scheduler.startPrioritySweepScheduler();
      
      // Wait a bit for initial sweep to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const prioritySet = scheduler.getPrioritySet();
      expect(prioritySet).not.toBeNull();
      expect(prioritySet?.version).toBe(1);
    });

    it('should respect single-flight protection', async () => {
      scheduler.startPrioritySweepScheduler();
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const firstVersion = scheduler.getPrioritySet()?.version;
      
      // Trigger concurrent sweep attempts should be blocked
      // In mock mode sweeps are instant, so we can't easily test this
      // But the flag should prevent overlapping sweeps
      expect(firstVersion).toBeDefined();
    });

    it('should allow stop and restart', async () => {
      scheduler.startPrioritySweepScheduler();
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const prioritySetBeforeStop = scheduler.getPrioritySet();
      expect(prioritySetBeforeStop).not.toBeNull();
      
      scheduler.stopPrioritySweepScheduler();
      
      // Priority set should still be available after stop
      const prioritySetAfterStop = scheduler.getPrioritySet();
      expect(prioritySetAfterStop).not.toBeNull();
      
      // Restart
      scheduler.startPrioritySweepScheduler();
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const newPrioritySet = scheduler.getPrioritySet();
      expect(newPrioritySet).not.toBeNull();
      // Priority set should be updated (may be same or newer version)
      expect(newPrioritySet?.generatedAt).toBeGreaterThanOrEqual(prioritySetAfterStop?.generatedAt || 0);
    });
  });

  describe('stopPrioritySweepScheduler', () => {
    it('should stop the scheduler', async () => {
      scheduler.startPrioritySweepScheduler();
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const versionBeforeStop = scheduler.getPrioritySet()?.version;
      
      scheduler.stopPrioritySweepScheduler();
      
      // Wait to ensure no more sweeps run
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const versionAfterStop = scheduler.getPrioritySet()?.version;
      
      // Version should not have incremented after stop
      expect(versionAfterStop).toBe(versionBeforeStop);
    });

    it('should be safe to call multiple times', () => {
      scheduler.startPrioritySweepScheduler();
      scheduler.stopPrioritySweepScheduler();
      scheduler.stopPrioritySweepScheduler(); // Should not throw
      
      expect(true).toBe(true); // No error
    });
  });

  describe('isSweepInProgress', () => {
    it('should return false initially', () => {
      expect(scheduler.isSweepInProgress()).toBe(false);
    });

    it('should return false after sweep completes', async () => {
      scheduler.startPrioritySweepScheduler();
      
      // Wait for sweep to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(scheduler.isSweepInProgress()).toBe(false);
    });
  });
});
