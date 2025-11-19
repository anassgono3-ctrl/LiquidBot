import { describe, it, expect } from 'vitest';

import { generateSummary } from '../../../src/replay/report.js';
import type { LiquidationAnalysis } from '../../../src/replay/types.js';

describe('report - generateSummary', () => {
  it('should generate summary for empty analyses', () => {
    const summary = generateSummary([]);
    expect(summary.totalLiquidations).toBe(0);
    expect(summary.detectionCoveragePct).toBe(0);
    expect(summary.executionCoveragePct).toBe(0);
    expect(summary.medianDetectionLagBlocks).toBeNull();
    expect(summary.medianExecutionLagBlocks).toBeNull();
    expect(summary.totalPotentialProfitMissedUSD).toBe(0);
  });

  it('should calculate detection coverage correctly', () => {
    const analyses: LiquidationAnalysis[] = [
      {
        user: '0x1',
        txHash: '0xabc',
        txBlock: 100,
        seizedUSD: 1000,
        debtUSD: 900,
        firstLiquidatableBlock: 95,
        earliestWouldExecuteBlock: null,
        detectionLag: 5,
        executionLag: null,
        missReason: 'profit_filter'
      },
      {
        user: '0x2',
        txHash: '0xdef',
        txBlock: 200,
        seizedUSD: 2000,
        debtUSD: 1800,
        firstLiquidatableBlock: null,
        earliestWouldExecuteBlock: null,
        detectionLag: null,
        executionLag: null,
        missReason: 'watch_set_gap'
      }
    ];

    const summary = generateSummary(analyses);
    expect(summary.totalLiquidations).toBe(2);
    expect(summary.detectionCoveragePct).toBe(50); // 1 out of 2
    expect(summary.executionCoveragePct).toBe(0); // 0 out of 2
  });

  it('should calculate execution coverage correctly', () => {
    const analyses: LiquidationAnalysis[] = [
      {
        user: '0x1',
        txHash: '0xabc',
        txBlock: 100,
        seizedUSD: 1000,
        debtUSD: 900,
        firstLiquidatableBlock: 95,
        earliestWouldExecuteBlock: 98,
        detectionLag: 5,
        executionLag: 2,
        missReason: 'success'
      },
      {
        user: '0x2',
        txHash: '0xdef',
        txBlock: 200,
        seizedUSD: 2000,
        debtUSD: 1800,
        firstLiquidatableBlock: 190,
        earliestWouldExecuteBlock: null,
        detectionLag: 10,
        executionLag: null,
        missReason: 'profit_filter'
      }
    ];

    const summary = generateSummary(analyses);
    expect(summary.detectionCoveragePct).toBe(100); // 2 out of 2
    expect(summary.executionCoveragePct).toBe(50); // 1 out of 2
  });

  it('should calculate median detection lag', () => {
    const analyses: LiquidationAnalysis[] = [
      {
        user: '0x1',
        txHash: '0xabc',
        txBlock: 100,
        seizedUSD: 1000,
        debtUSD: 900,
        firstLiquidatableBlock: 95,
        earliestWouldExecuteBlock: null,
        detectionLag: 5,
        executionLag: null,
        missReason: 'profit_filter'
      },
      {
        user: '0x2',
        txHash: '0xdef',
        txBlock: 200,
        seizedUSD: 2000,
        debtUSD: 1800,
        firstLiquidatableBlock: 185,
        earliestWouldExecuteBlock: null,
        detectionLag: 15,
        executionLag: null,
        missReason: 'profit_filter'
      },
      {
        user: '0x3',
        txHash: '0xghi',
        txBlock: 300,
        seizedUSD: 1500,
        debtUSD: 1400,
        firstLiquidatableBlock: 290,
        earliestWouldExecuteBlock: null,
        detectionLag: 10,
        executionLag: null,
        missReason: 'profit_filter'
      }
    ];

    const summary = generateSummary(analyses);
    expect(summary.medianDetectionLagBlocks).toBe(10); // median of [5, 10, 15]
  });

  it('should calculate median for even number of values', () => {
    const analyses: LiquidationAnalysis[] = [
      {
        user: '0x1',
        txHash: '0xabc',
        txBlock: 100,
        seizedUSD: 1000,
        debtUSD: 900,
        firstLiquidatableBlock: 95,
        earliestWouldExecuteBlock: null,
        detectionLag: 4,
        executionLag: null,
        missReason: 'profit_filter'
      },
      {
        user: '0x2',
        txHash: '0xdef',
        txBlock: 200,
        seizedUSD: 2000,
        debtUSD: 1800,
        firstLiquidatableBlock: 190,
        earliestWouldExecuteBlock: null,
        detectionLag: 10,
        executionLag: null,
        missReason: 'profit_filter'
      }
    ];

    const summary = generateSummary(analyses);
    expect(summary.medianDetectionLagBlocks).toBe(7); // median of [4, 10] = 7
  });

  it('should count miss reasons correctly', () => {
    const analyses: LiquidationAnalysis[] = [
      {
        user: '0x1',
        txHash: '0xabc',
        txBlock: 100,
        seizedUSD: 1000,
        debtUSD: 900,
        firstLiquidatableBlock: 95,
        earliestWouldExecuteBlock: 98,
        detectionLag: 5,
        executionLag: 2,
        missReason: 'success'
      },
      {
        user: '0x2',
        txHash: '0xdef',
        txBlock: 200,
        seizedUSD: 2000,
        debtUSD: 1800,
        firstLiquidatableBlock: null,
        earliestWouldExecuteBlock: null,
        detectionLag: null,
        executionLag: null,
        missReason: 'watch_set_gap'
      },
      {
        user: '0x3',
        txHash: '0xghi',
        txBlock: 300,
        seizedUSD: 500,
        debtUSD: 450,
        firstLiquidatableBlock: 295,
        earliestWouldExecuteBlock: null,
        detectionLag: 5,
        executionLag: null,
        missReason: 'below_min_debt'
      },
      {
        user: '0x4',
        txHash: '0xjkl',
        txBlock: 400,
        seizedUSD: 3000,
        debtUSD: 2700,
        firstLiquidatableBlock: 390,
        earliestWouldExecuteBlock: null,
        detectionLag: 10,
        executionLag: null,
        missReason: 'profit_filter'
      }
    ];

    const summary = generateSummary(analyses);
    expect(summary.missedByReason.success).toBe(1);
    expect(summary.missedByReason.watch_set_gap).toBe(1);
    expect(summary.missedByReason.below_min_debt).toBe(1);
    expect(summary.missedByReason.profit_filter).toBe(1);
    expect(summary.missedByReason.unknown).toBe(0);
  });

  it('should calculate total missed profit correctly', () => {
    const analyses: LiquidationAnalysis[] = [
      {
        user: '0x1',
        txHash: '0xabc',
        txBlock: 100,
        seizedUSD: 1000,
        debtUSD: 900,
        firstLiquidatableBlock: 95,
        earliestWouldExecuteBlock: 98,
        detectionLag: 5,
        executionLag: 2,
        missReason: 'success' // Should not count towards missed profit
      },
      {
        user: '0x2',
        txHash: '0xdef',
        txBlock: 200,
        seizedUSD: 2000,
        debtUSD: 1800,
        firstLiquidatableBlock: null,
        earliestWouldExecuteBlock: null,
        detectionLag: null,
        executionLag: null,
        missReason: 'watch_set_gap' // Missed: 2000 - 1800 = 200
      },
      {
        user: '0x3',
        txHash: '0xghi',
        txBlock: 300,
        seizedUSD: 1500,
        debtUSD: 1400,
        firstLiquidatableBlock: 295,
        earliestWouldExecuteBlock: null,
        detectionLag: 5,
        executionLag: null,
        missReason: 'profit_filter' // Missed: 1500 - 1400 = 100
      }
    ];

    const summary = generateSummary(analyses);
    expect(summary.totalPotentialProfitMissedUSD).toBe(300); // 200 + 100
  });
});
