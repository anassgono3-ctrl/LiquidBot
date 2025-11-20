import { describe, it, expect } from 'vitest';
import { Comparator, type Candidate, type GroundTruthEvent } from '../../../src/replay/Comparator.js';

describe('Comparator', () => {
  describe('classifyCandidate', () => {
    it('should classify as detected when candidate is before liquidation', () => {
      const groundTruth: GroundTruthEvent[] = [
        { user: '0xUser1', block: 1000, txHash: '0xTx1' }
      ];
      
      const comparator = new Comparator(groundTruth);
      
      const candidate: Candidate = {
        user: '0xUser1',
        block: 995,
        healthFactor: 0.98,
        debtUSD: 1000,
        collateralUSD: 1100,
        profitEstUSD: 50
      };
      
      const result = comparator.classifyCandidate(candidate);
      expect(result.classification).toBe('detected');
      expect(result.onChainLiquidated).toBe(true);
    });

    it('should classify as detected when candidate is at liquidation block', () => {
      const groundTruth: GroundTruthEvent[] = [
        { user: '0xUser1', block: 1000, txHash: '0xTx1' }
      ];
      
      const comparator = new Comparator(groundTruth);
      
      const candidate: Candidate = {
        user: '0xUser1',
        block: 1000,
        healthFactor: 0.98,
        debtUSD: 1000,
        collateralUSD: 1100,
        profitEstUSD: 50
      };
      
      const result = comparator.classifyCandidate(candidate);
      expect(result.classification).toBe('detected');
      expect(result.onChainLiquidated).toBe(true);
    });

    it('should classify as false-positive when candidate is after liquidation', () => {
      const groundTruth: GroundTruthEvent[] = [
        { user: '0xUser1', block: 1000, txHash: '0xTx1' }
      ];
      
      const comparator = new Comparator(groundTruth);
      
      const candidate: Candidate = {
        user: '0xUser1',
        block: 1005,
        healthFactor: 0.98,
        debtUSD: 1000,
        collateralUSD: 1100,
        profitEstUSD: 50
      };
      
      const result = comparator.classifyCandidate(candidate);
      expect(result.classification).toBe('false-positive');
      expect(result.onChainLiquidated).toBe(false);
    });

    it('should classify as false-positive when user was never liquidated', () => {
      const groundTruth: GroundTruthEvent[] = [
        { user: '0xUser2', block: 1000, txHash: '0xTx1' }
      ];
      
      const comparator = new Comparator(groundTruth);
      
      const candidate: Candidate = {
        user: '0xUser1',
        block: 995,
        healthFactor: 0.98,
        debtUSD: 1000,
        collateralUSD: 1100,
        profitEstUSD: 50
      };
      
      const result = comparator.classifyCandidate(candidate);
      expect(result.classification).toBe('false-positive');
      expect(result.onChainLiquidated).toBe(false);
    });
  });

  describe('checkDetection', () => {
    it('should mark as detected with correct lead time', () => {
      const groundTruth: GroundTruthEvent[] = [
        { user: '0xUser1', block: 1000, txHash: '0xTx1' }
      ];
      
      const comparator = new Comparator(groundTruth);
      
      // Record detection at block 995
      comparator.recordDetection({
        user: '0xUser1',
        block: 995,
        healthFactor: 0.98,
        debtUSD: 1000,
        collateralUSD: 1100,
        profitEstUSD: 50
      });
      
      const result = comparator.checkDetection({
        user: '0xUser1',
        block: 1000,
        txHash: '0xTx1'
      });
      
      expect(result.detected).toBe(true);
      expect(result.leadBlocks).toBe(5);
      expect(result.firstDetectionBlock).toBe(995);
    });

    it('should mark as not detected when never recorded', () => {
      const groundTruth: GroundTruthEvent[] = [
        { user: '0xUser1', block: 1000, txHash: '0xTx1' }
      ];
      
      const comparator = new Comparator(groundTruth);
      
      const result = comparator.checkDetection({
        user: '0xUser1',
        block: 1000,
        txHash: '0xTx1'
      });
      
      expect(result.detected).toBe(false);
      expect(result.leadBlocks).toBeUndefined();
    });

    it('should use earliest detection when recorded multiple times', () => {
      const groundTruth: GroundTruthEvent[] = [
        { user: '0xUser1', block: 1000, txHash: '0xTx1' }
      ];
      
      const comparator = new Comparator(groundTruth);
      
      // Record detection at block 995
      comparator.recordDetection({
        user: '0xUser1',
        block: 995,
        healthFactor: 0.98,
        debtUSD: 1000,
        collateralUSD: 1100,
        profitEstUSD: 50
      });
      
      // Record detection at block 990 (earlier)
      comparator.recordDetection({
        user: '0xUser1',
        block: 990,
        healthFactor: 0.97,
        debtUSD: 1000,
        collateralUSD: 1100,
        profitEstUSD: 50
      });
      
      const result = comparator.checkDetection({
        user: '0xUser1',
        block: 1000,
        txHash: '0xTx1'
      });
      
      expect(result.leadBlocks).toBe(10); // 1000 - 990
      expect(result.firstDetectionBlock).toBe(990);
    });
  });

  describe('getMissedEvents', () => {
    it('should return events that were not detected', () => {
      const groundTruth: GroundTruthEvent[] = [
        { user: '0xUser1', block: 1000, txHash: '0xTx1' },
        { user: '0xUser2', block: 1005, txHash: '0xTx2' },
        { user: '0xUser3', block: 1010, txHash: '0xTx3' }
      ];
      
      const comparator = new Comparator(groundTruth);
      
      // Only detect User1
      comparator.recordDetection({
        user: '0xUser1',
        block: 995,
        healthFactor: 0.98,
        debtUSD: 1000,
        collateralUSD: 1100,
        profitEstUSD: 50
      });
      
      const missed = comparator.getMissedEvents();
      expect(missed).toHaveLength(2);
      expect(missed.map(e => e.user)).toContain('0xUser2');
      expect(missed.map(e => e.user)).toContain('0xUser3');
    });

    it('should return empty array when all events detected', () => {
      const groundTruth: GroundTruthEvent[] = [
        { user: '0xUser1', block: 1000, txHash: '0xTx1' }
      ];
      
      const comparator = new Comparator(groundTruth);
      
      comparator.recordDetection({
        user: '0xUser1',
        block: 995,
        healthFactor: 0.98,
        debtUSD: 1000,
        collateralUSD: 1100,
        profitEstUSD: 50
      });
      
      const missed = comparator.getMissedEvents();
      expect(missed).toHaveLength(0);
    });
  });

  describe('getCoverageRatio', () => {
    it('should return 1.0 when all events detected', () => {
      const groundTruth: GroundTruthEvent[] = [
        { user: '0xUser1', block: 1000, txHash: '0xTx1' },
        { user: '0xUser2', block: 1005, txHash: '0xTx2' }
      ];
      
      const comparator = new Comparator(groundTruth);
      
      comparator.recordDetection({
        user: '0xUser1',
        block: 995,
        healthFactor: 0.98,
        debtUSD: 1000,
        collateralUSD: 1100,
        profitEstUSD: 50
      });
      
      comparator.recordDetection({
        user: '0xUser2',
        block: 1000,
        healthFactor: 0.99,
        debtUSD: 2000,
        collateralUSD: 2200,
        profitEstUSD: 100
      });
      
      const ratio = comparator.getCoverageRatio();
      expect(ratio).toBe(1.0);
    });

    it('should return 0.5 when half detected', () => {
      const groundTruth: GroundTruthEvent[] = [
        { user: '0xUser1', block: 1000, txHash: '0xTx1' },
        { user: '0xUser2', block: 1005, txHash: '0xTx2' }
      ];
      
      const comparator = new Comparator(groundTruth);
      
      comparator.recordDetection({
        user: '0xUser1',
        block: 995,
        healthFactor: 0.98,
        debtUSD: 1000,
        collateralUSD: 1100,
        profitEstUSD: 50
      });
      
      const ratio = comparator.getCoverageRatio();
      expect(ratio).toBe(0.5);
    });

    it('should return 1.0 when no events (perfect coverage)', () => {
      const groundTruth: GroundTruthEvent[] = [];
      const comparator = new Comparator(groundTruth);
      
      const ratio = comparator.getCoverageRatio();
      expect(ratio).toBe(1.0);
    });
  });

  describe('getDetectionStats', () => {
    it('should calculate statistics correctly', () => {
      const groundTruth: GroundTruthEvent[] = [
        { user: '0xUser1', block: 1000, txHash: '0xTx1' },
        { user: '0xUser2', block: 1010, txHash: '0xTx2' },
        { user: '0xUser3', block: 1020, txHash: '0xTx3' }
      ];
      
      const comparator = new Comparator(groundTruth);
      
      // Detect User1 with 5 block lead
      comparator.recordDetection({
        user: '0xUser1',
        block: 995,
        healthFactor: 0.98,
        debtUSD: 1000,
        collateralUSD: 1100,
        profitEstUSD: 50
      });
      
      // Detect User2 with 10 block lead
      comparator.recordDetection({
        user: '0xUser2',
        block: 1000,
        healthFactor: 0.99,
        debtUSD: 2000,
        collateralUSD: 2200,
        profitEstUSD: 100
      });
      
      // User3 not detected
      
      const stats = comparator.getDetectionStats();
      
      expect(stats.totalEvents).toBe(3);
      expect(stats.detected).toBe(2);
      expect(stats.missed).toBe(1);
      expect(stats.avgLeadBlocks).toBe(7.5); // (5 + 10) / 2
      expect(stats.medianLeadBlocks).toBe(7.5);
    });
  });
});
