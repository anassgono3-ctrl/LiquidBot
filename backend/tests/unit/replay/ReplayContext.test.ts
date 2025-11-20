// Unit tests for ReplayContext
import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayContext } from '../../../src/replay/ReplayContext.js';

describe('ReplayContext', () => {
  let context: ReplayContext;

  beforeEach(() => {
    context = new ReplayContext(1.02, 1.08, 5);
  });

  describe('Detection Recording', () => {
    it('should record first detection for a user', () => {
      context.recordFirstDetection('0xuser1', 100, 0.98, 1000, 2000);
      
      const state = context.getDetectionState('0xuser1');
      expect(state).toBeDefined();
      expect(state?.firstDetectionBlock).toBe(100);
      expect(state?.hfAtDetection).toBe(0.98);
      expect(state?.debtAtDetection).toBe(1000);
      expect(state?.collateralAtDetection).toBe(2000);
    });

    it('should not overwrite existing detection', () => {
      context.recordFirstDetection('0xuser1', 100, 0.98, 1000, 2000);
      context.recordFirstDetection('0xuser1', 101, 0.97, 1100, 2100);
      
      const state = context.getDetectionState('0xuser1');
      expect(state?.firstDetectionBlock).toBe(100); // First detection preserved
    });

    it('should update simulation status', () => {
      context.recordFirstDetection('0xuser1', 100, 0.98, 1000, 2000);
      context.updateSimulation('0xuser1', 'ok', '', 50);
      
      const state = context.getDetectionState('0xuser1');
      expect(state?.simulationStatus).toBe('ok');
      expect(state?.detectionProfitUSD).toBe(50);
    });
  });

  describe('Liquidation Events', () => {
    it('should record liquidation event', () => {
      context.recordLiquidationEvent(
        '0xuser1',
        105,
        '0xtx1',
        '0xusdc',
        '0xweth',
        1000000n,
        2000000n,
        '0xliquidator'
      );
      
      const event = context.getLiquidationEvent('0xuser1');
      expect(event).toBeDefined();
      expect(event?.block).toBe(105);
      expect(event?.txHash).toBe('0xtx1');
    });

    it('should only record earliest liquidation for a user', () => {
      context.recordLiquidationEvent('0xuser1', 105, '0xtx1', '0xusdc', '0xweth', 1000000n, 2000000n, '0xliq1');
      context.recordLiquidationEvent('0xuser1', 106, '0xtx2', '0xusdc', '0xweth', 1000000n, 2000000n, '0xliq2');
      
      const event = context.getLiquidationEvent('0xuser1');
      expect(event?.block).toBe(105); // First event preserved
    });

    it('should update liquidation event metrics', () => {
      context.recordLiquidationEvent('0xuser1', 105, '0xtx1', '0xusdc', '0xweth', 1000000n, 2000000n, '0xliq1');
      context.updateLiquidationEvent('0xuser1', 0.96, 75);
      
      const event = context.getLiquidationEvent('0xuser1');
      expect(event?.hfAtLiquidation).toBe(0.96);
      expect(event?.eventProfitUSD).toBe(75);
    });
  });

  describe('User Classification', () => {
    it('should classify as detected when detection before liquidation', () => {
      context.recordFirstDetection('0xuser1', 100, 0.98, 1000, 2000);
      context.recordLiquidationEvent('0xuser1', 105, '0xtx1', '0xusdc', '0xweth', 1000000n, 2000000n, '0xliq1');
      
      expect(context.classifyUser('0xuser1')).toBe('detected');
    });

    it('should classify as missed when liquidation without detection', () => {
      context.recordLiquidationEvent('0xuser1', 105, '0xtx1', '0xusdc', '0xweth', 1000000n, 2000000n, '0xliq1');
      
      expect(context.classifyUser('0xuser1')).toBe('missed');
    });

    it('should classify as false_positive when detection without liquidation', () => {
      context.recordFirstDetection('0xuser1', 100, 0.98, 1000, 2000);
      
      expect(context.classifyUser('0xuser1')).toBe('false_positive');
    });

    it('should classify as missed when detection after liquidation', () => {
      context.recordFirstDetection('0xuser1', 106, 0.98, 1000, 2000);
      context.recordLiquidationEvent('0xuser1', 105, '0xtx1', '0xusdc', '0xweth', 1000000n, 2000000n, '0xliq1');
      
      expect(context.classifyUser('0xuser1')).toBe('missed');
    });

    it('should classify as pending when no detection or event', () => {
      expect(context.classifyUser('0xuser1')).toBe('pending');
    });
  });

  describe('Lead Blocks Calculation', () => {
    it('should calculate lead blocks for detected user', () => {
      context.recordFirstDetection('0xuser1', 100, 0.98, 1000, 2000);
      context.recordLiquidationEvent('0xuser1', 105, '0xtx1', '0xusdc', '0xweth', 1000000n, 2000000n, '0xliq1');
      
      expect(context.getLeadBlocks('0xuser1')).toBe(5);
    });

    it('should return null for missed user', () => {
      context.recordLiquidationEvent('0xuser1', 105, '0xtx1', '0xusdc', '0xweth', 1000000n, 2000000n, '0xliq1');
      
      expect(context.getLeadBlocks('0xuser1')).toBeNull();
    });

    it('should return null for false positive', () => {
      context.recordFirstDetection('0xuser1', 100, 0.98, 1000, 2000);
      
      expect(context.getLeadBlocks('0xuser1')).toBeNull();
    });

    it('should return zero lead blocks for same-block detection', () => {
      context.recordFirstDetection('0xuser1', 105, 0.98, 1000, 2000);
      context.recordLiquidationEvent('0xuser1', 105, '0xtx1', '0xusdc', '0xweth', 1000000n, 2000000n, '0xliq1');
      
      expect(context.getLeadBlocks('0xuser1')).toBe(0);
    });
  });

  describe('Eviction Logic', () => {
    it('should increment eviction counter when HF above evict threshold', () => {
      context.addUser('0xuser1');
      context.updateEvictionState('0xuser1', 100, 1.10);
      
      expect(context.shouldEvict('0xuser1')).toBe(false); // Not yet
      
      // Add more consecutive high HF blocks
      for (let i = 1; i < 5; i++) {
        context.updateEvictionState('0xuser1', 100 + i, 1.10);
        expect(context.shouldEvict('0xuser1')).toBe(i === 4); // Evict on 5th consecutive
      }
    });

    it('should reset eviction counter when HF below near threshold', () => {
      context.addUser('0xuser1');
      
      // Build up consecutive high HF
      for (let i = 0; i < 3; i++) {
        context.updateEvictionState('0xuser1', 100 + i, 1.10);
      }
      
      // Drop below near threshold
      context.updateEvictionState('0xuser1', 103, 1.00);
      
      // Should not evict even after more high HF blocks
      context.updateEvictionState('0xuser1', 104, 1.10);
      context.updateEvictionState('0xuser1', 105, 1.10);
      expect(context.shouldEvict('0xuser1')).toBe(false);
    });

    it('should maintain state for HF between near and evict thresholds', () => {
      context.addUser('0xuser1');
      
      context.updateEvictionState('0xuser1', 100, 1.05);
      expect(context.shouldEvict('0xuser1')).toBe(false);
    });
  });

  describe('Metrics Computation', () => {
    it('should compute comprehensive metrics', () => {
      // Setup detected user
      context.recordFirstDetection('0xuser1', 100, 0.98, 1000, 2000);
      context.updateSimulation('0xuser1', 'ok', '', 50);
      context.recordLiquidationEvent('0xuser1', 105, '0xtx1', '0xusdc', '0xweth', 1000000n, 2000000n, '0xliq1');
      context.updateLiquidationEvent('0xuser1', 0.96, 75);
      
      // Setup missed user
      context.recordLiquidationEvent('0xuser2', 110, '0xtx2', '0xusdc', '0xweth', 1000000n, 2000000n, '0xliq2');
      
      // Setup false positive
      context.recordFirstDetection('0xuser3', 108, 0.99, 800, 1600);
      context.updateSimulation('0xuser3', 'revert', 'Insufficient collateral', null);
      
      const metrics = context.computeMetrics();
      
      expect(metrics.groundTruthCount).toBe(2);
      expect(metrics.detected).toBe(1);
      expect(metrics.missed).toBe(1);
      expect(metrics.falsePositives).toBe(1);
      expect(metrics.raceViableCount).toBe(1); // user1 with ok simulation
      expect(metrics.leadBlocksList).toEqual([5]);
      expect(metrics.leadBlocksSum).toBe(5);
      expect(metrics.leadBlocksCount).toBe(1);
      expect(metrics.detectionProfitTotalUSD).toBe(50);
      expect(metrics.eventProfitTotalUSD).toBe(75);
    });

    it('should handle empty state', () => {
      const metrics = context.computeMetrics();
      
      expect(metrics.groundTruthCount).toBe(0);
      expect(metrics.detected).toBe(0);
      expect(metrics.missed).toBe(0);
      expect(metrics.falsePositives).toBe(0);
    });
  });

  describe('Race Viability', () => {
    it('should mark user as race viable with successful simulation and profit', () => {
      context.recordFirstDetection('0xuser1', 100, 0.97, 1000, 2000);
      context.updateSimulation('0xuser1', 'ok', '', 50);
      
      expect(context.isRaceViable('0xuser1', 0.98, 10)).toBe(true);
    });

    it('should not be race viable with reverted simulation', () => {
      context.recordFirstDetection('0xuser1', 100, 0.97, 1000, 2000);
      context.updateSimulation('0xuser1', 'revert', 'Error', null);
      
      expect(context.isRaceViable('0xuser1', 0.98, 10)).toBe(false);
    });

    it('should not be race viable with insufficient profit', () => {
      context.recordFirstDetection('0xuser1', 100, 0.97, 1000, 2000);
      context.updateSimulation('0xuser1', 'ok', '', 5);
      
      expect(context.isRaceViable('0xuser1', 0.98, 10)).toBe(false);
    });

    it('should not be race viable with HF above threshold', () => {
      context.recordFirstDetection('0xuser1', 100, 0.99, 1000, 2000);
      context.updateSimulation('0xuser1', 'ok', '', 50);
      
      expect(context.isRaceViable('0xuser1', 0.98, 10)).toBe(false);
    });
  });
});
