import { describe, it, expect, beforeEach } from 'vitest';

import { HFPredictor } from '../../../src/predict/HFPredictor.js';

describe('HFPredictor', () => {
  let predictor: HFPredictor;

  beforeEach(() => {
    predictor = new HFPredictor();
  });

  describe('updateIndices', () => {
    it('should return null for first observation', () => {
      const result = predictor.updateIndices('0xReserve1', {
        variableBorrowIndex: 1000000000000000000000000000n, // 1e27
        liquidityIndex: 1000000000000000000000000000n
      });

      expect(result).toBeNull();
    });

    it('should calculate bps delta for subsequent observations', () => {
      // First observation
      predictor.updateIndices('0xReserve1', {
        variableBorrowIndex: 1000000000000000000000000000n, // 1e27
        liquidityIndex: 1000000000000000000000000000n
      });

      // Second observation with 0.1% increase (10 bps)
      const result = predictor.updateIndices('0xReserve1', {
        variableBorrowIndex: 1001000000000000000000000000n, // 1.001e27
        liquidityIndex: 1001000000000000000000000000n
      });

      expect(result).not.toBeNull();
      expect(result!.borrowDeltaBps).toBeCloseTo(10, 1);
      expect(result!.liquidityDeltaBps).toBeCloseTo(10, 1);
    });

    it('should normalize reserve addresses to lowercase', () => {
      // First observation with uppercase
      predictor.updateIndices('0xRESERVE1', {
        variableBorrowIndex: 1000000000000000000000000000n,
        liquidityIndex: 1000000000000000000000000000n
      });

      // Second observation with lowercase (should be same reserve)
      const result = predictor.updateIndices('0xreserve1', {
        variableBorrowIndex: 1001000000000000000000000000n,
        liquidityIndex: 1001000000000000000000000000n
      });

      expect(result).not.toBeNull();
      expect(result!.borrowDeltaBps).toBeCloseTo(10, 1);
    });

    it('should track multiple reserves independently', () => {
      // Reserve 1
      predictor.updateIndices('0xReserve1', {
        variableBorrowIndex: 1000000000000000000000000000n,
        liquidityIndex: 1000000000000000000000000000n
      });

      // Reserve 2
      predictor.updateIndices('0xReserve2', {
        variableBorrowIndex: 2000000000000000000000000000n,
        liquidityIndex: 2000000000000000000000000000n
      });

      // Update Reserve 1
      const result1 = predictor.updateIndices('0xReserve1', {
        variableBorrowIndex: 1005000000000000000000000000n, // 0.5% increase
        liquidityIndex: 1005000000000000000000000000n
      });

      // Update Reserve 2
      const result2 = predictor.updateIndices('0xReserve2', {
        variableBorrowIndex: 2010000000000000000000000000n, // 0.5% increase
        liquidityIndex: 2010000000000000000000000000n
      });

      expect(result1!.borrowDeltaBps).toBeCloseTo(50, 1);
      expect(result2!.borrowDeltaBps).toBeCloseTo(50, 1);
    });
  });

  describe('isJumpSignificant', () => {
    it('should return true when delta exceeds threshold', () => {
      // Default threshold is 3 bps
      expect(predictor.isJumpSignificant(5)).toBe(true);
      expect(predictor.isJumpSignificant(-5)).toBe(true);
    });

    it('should return false when delta is below threshold', () => {
      expect(predictor.isJumpSignificant(2)).toBe(false);
      expect(predictor.isJumpSignificant(-2)).toBe(false);
    });

    it('should return true when delta equals threshold', () => {
      expect(predictor.isJumpSignificant(3)).toBe(true);
      expect(predictor.isJumpSignificant(-3)).toBe(true);
    });
  });

  describe('predictHfChange', () => {
    it('should return current HF for users already liquidatable', () => {
      const predicted = predictor.predictHfChange('0xUser1', 0.95, 10, 0);
      expect(predicted).toBe(0.95);
    });

    it('should predict HF decrease when borrow index increases more', () => {
      const predicted = predictor.predictHfChange('0xUser1', 1.02, 10, 5);
      expect(predicted).not.toBeNull();
      expect(predicted!).toBeLessThan(1.02);
    });

    it('should predict HF increase when liquidity index increases more', () => {
      const predicted = predictor.predictHfChange('0xUser1', 1.02, 5, 10);
      expect(predicted).not.toBeNull();
      expect(predicted!).toBeGreaterThan(1.02);
    });
  });

  describe('isPredictedCritical', () => {
    it('should return true when predicted HF is below critical threshold', () => {
      // Default HF_PRED_CRITICAL is 1.0008
      expect(predictor.isPredictedCritical(1.0005)).toBe(true);
      expect(predictor.isPredictedCritical(0.999)).toBe(true);
    });

    it('should return false when predicted HF is above critical threshold', () => {
      expect(predictor.isPredictedCritical(1.001)).toBe(false);
      expect(predictor.isPredictedCritical(1.05)).toBe(false);
    });

    it('should return false for null predicted HF', () => {
      expect(predictor.isPredictedCritical(null)).toBe(false);
    });
  });

  describe('getPreviousIndices', () => {
    it('should return null for untracked reserve', () => {
      const indices = predictor.getPreviousIndices('0xUnknown');
      expect(indices).toBeNull();
    });

    it('should return stored indices for tracked reserve', () => {
      predictor.updateIndices('0xReserve1', {
        variableBorrowIndex: 1000000000000000000000000000n,
        liquidityIndex: 2000000000000000000000000000n
      });

      const indices = predictor.getPreviousIndices('0xReserve1');
      expect(indices).not.toBeNull();
      expect(indices!.variableBorrowIndex).toBe(1000000000000000000000000000n);
      expect(indices!.liquidityIndex).toBe(2000000000000000000000000000n);
    });

    it('should normalize address when retrieving', () => {
      predictor.updateIndices('0xRESERVE1', {
        variableBorrowIndex: 1000000000000000000000000000n,
        liquidityIndex: 2000000000000000000000000000n
      });

      const indices = predictor.getPreviousIndices('0xreserve1');
      expect(indices).not.toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear all stored indices', () => {
      predictor.updateIndices('0xReserve1', {
        variableBorrowIndex: 1000000000000000000000000000n,
        liquidityIndex: 1000000000000000000000000000n
      });

      predictor.clear();

      expect(predictor.getTrackedReserveCount()).toBe(0);
      expect(predictor.getPreviousIndices('0xReserve1')).toBeNull();
    });
  });

  describe('getTrackedReserveCount', () => {
    it('should return 0 for new predictor', () => {
      expect(predictor.getTrackedReserveCount()).toBe(0);
    });

    it('should return correct count after tracking reserves', () => {
      predictor.updateIndices('0xReserve1', {
        variableBorrowIndex: 1000000000000000000000000000n,
        liquidityIndex: 1000000000000000000000000000n
      });

      predictor.updateIndices('0xReserve2', {
        variableBorrowIndex: 1000000000000000000000000000n,
        liquidityIndex: 1000000000000000000000000000n
      });

      expect(predictor.getTrackedReserveCount()).toBe(2);
    });
  });
});
