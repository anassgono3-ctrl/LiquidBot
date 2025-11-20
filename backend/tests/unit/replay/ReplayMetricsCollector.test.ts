import { describe, it, expect, beforeEach } from 'vitest';

import { ReplayMetricsCollector } from '../../../src/replay/ReplayMetricsCollector.js';

describe('ReplayMetricsCollector', () => {
  let collector: ReplayMetricsCollector;
  const configSnapshot = {
    hotlistMinHf: 0.99,
    hotlistMaxHf: 1.03,
    hotlistMinDebtUsd: 5,
    minDebtUsd: 10,
    profitMinUsd: 1,
    fastSubsetEnabled: true,
    predictorEnabled: false,
    microVerifyEnabled: true
  };

  beforeEach(() => {
    collector = new ReplayMetricsCollector(configSnapshot);
  });

  describe('Detection Tracking', () => {
    it('should record first detection for a user', () => {
      collector.recordFirstDetection('0xuser1', 100);
      collector.recordLiquidationCall('0xuser1', 105);

      const detections = collector.getDetections();
      expect(detections).toHaveLength(1);
      expect(detections[0].userAddress).toBe('0xuser1');
      expect(detections[0].firstDetectBlock).toBe(100);
      expect(detections[0].liquidationBlock).toBe(105);
      expect(detections[0].detectionLagBlocks).toBe(5);
      expect(detections[0].missReason).toBeNull();
    });

    it('should handle missed detection (no first detection)', () => {
      collector.recordLiquidationCall('0xuser1', 105, 'watch_set_gap');

      const detections = collector.getDetections();
      expect(detections).toHaveLength(1);
      expect(detections[0].firstDetectBlock).toBeNull();
      expect(detections[0].detectionLagBlocks).toBeNull();
      expect(detections[0].missReason).toBe('watch_set_gap');
    });

    it('should normalize addresses to lowercase', () => {
      collector.recordFirstDetection('0xUSER1', 100);
      collector.recordLiquidationCall('0xuser1', 105);

      const detections = collector.getDetections();
      expect(detections).toHaveLength(1);
      expect(detections[0].userAddress).toBe('0xuser1');
    });

    it('should only record first detection block', () => {
      collector.recordFirstDetection('0xuser1', 100);
      collector.recordFirstDetection('0xuser1', 102); // Should be ignored
      collector.recordLiquidationCall('0xuser1', 105);

      const detections = collector.getDetections();
      expect(detections[0].firstDetectBlock).toBe(100);
    });
  });

  describe('Block Metrics', () => {
    it('should record block metrics', () => {
      const metric = {
        block: 100,
        timestamp: 1700000000,
        candidateCount: 5,
        hotsetCount: 2,
        nearThresholdCount: 1,
        fastSubsetSize: 10,
        predictorTriggers: 0,
        newHFEntrants: ['0xuser1'],
        liquidationCalls: [],
        minHF: 1.05,
        durationMs: 50
      };

      collector.recordBlockMetrics(metric);

      const metrics = collector.getBlockMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toEqual(metric);
    });

    it('should track evaluated users from block metrics', () => {
      collector.recordBlockMetrics({
        block: 100,
        timestamp: 1700000000,
        candidateCount: 3,
        hotsetCount: 0,
        nearThresholdCount: 0,
        fastSubsetSize: 0,
        predictorTriggers: 0,
        newHFEntrants: ['0xuser1', '0xuser2', '0xUSER3'],
        liquidationCalls: [],
        minHF: null,
        durationMs: 10
      });

      const summary = collector.generateSummary(100, 200);
      expect(summary.totalUsersEvaluated).toBe(3);
    });
  });

  describe('Summary Generation', () => {
    beforeEach(() => {
      // Setup test data
      collector.recordFirstDetection('0xuser1', 100);
      collector.recordLiquidationCall('0xuser1', 105);

      collector.recordFirstDetection('0xuser2', 110);
      collector.recordLiquidationCall('0xuser2', 115);

      collector.recordLiquidationCall('0xuser3', 120, 'min_debt_filter');
      collector.recordLiquidationCall('0xuser4', 125, 'profit_filter');

      collector.recordBlockMetrics({
        block: 100,
        timestamp: 1700000000,
        candidateCount: 5,
        hotsetCount: 2,
        nearThresholdCount: 1,
        fastSubsetSize: 10,
        predictorTriggers: 0,
        newHFEntrants: ['0xuser1', '0xuser2', '0xuser3', '0xuser4'],
        liquidationCalls: [],
        minHF: 0.95,
        durationMs: 50
      });
    });

    it('should generate accurate summary', () => {
      const summary = collector.generateSummary(100, 200);

      expect(summary.range.start).toBe(100);
      expect(summary.range.end).toBe(200);
      expect(summary.totalBlocks).toBe(101);
      expect(summary.totalLiquidationEvents).toBe(4);
      expect(summary.totalUniqueLiquidatableUsers).toBe(4);
      expect(summary.detectionCoveragePct).toBe(50); // 2 detected out of 4
    });

    it('should calculate median detection lag', () => {
      const summary = collector.generateSummary(100, 200);

      // Lags are [5, 5] => median is 5
      expect(summary.medianDetectionLag).toBe(5);
    });

    it('should count miss reasons correctly', () => {
      const summary = collector.generateSummary(100, 200);

      expect(summary.missedCountByReason.min_debt_filter).toBe(1);
      expect(summary.missedCountByReason.profit_filter).toBe(1);
      expect(summary.missedCountByReason.watch_set_gap).toBe(0);
      expect(summary.missedCountByReason.unknown).toBe(0);
    });

    it('should find earliest liquidation block', () => {
      const summary = collector.generateSummary(100, 200);
      expect(summary.earliestLiquidationBlock).toBe(105);
    });

    it('should include config snapshot', () => {
      const summary = collector.generateSummary(100, 200);
      expect(summary.configSnapshot).toEqual(configSnapshot);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty data', () => {
      const summary = collector.generateSummary(100, 200);

      expect(summary.totalLiquidationEvents).toBe(0);
      expect(summary.detectionCoveragePct).toBe(0);
      expect(summary.medianDetectionLag).toBeNull();
      expect(summary.earliestLiquidationBlock).toBeNull();
    });

    it('should handle single detection', () => {
      collector.recordFirstDetection('0xuser1', 100);
      collector.recordLiquidationCall('0xuser1', 110);

      const summary = collector.generateSummary(100, 200);
      expect(summary.detectionCoveragePct).toBe(100);
      expect(summary.medianDetectionLag).toBe(10);
    });

    it('should handle odd number of lags for median', () => {
      collector.recordFirstDetection('0xuser1', 100);
      collector.recordLiquidationCall('0xuser1', 105); // lag = 5

      collector.recordFirstDetection('0xuser2', 110);
      collector.recordLiquidationCall('0xuser2', 120); // lag = 10

      collector.recordFirstDetection('0xuser3', 130);
      collector.recordLiquidationCall('0xuser3', 145); // lag = 15

      const summary = collector.generateSummary(100, 200);
      expect(summary.medianDetectionLag).toBe(10); // Middle value of [5, 10, 15]
    });
  });
});
