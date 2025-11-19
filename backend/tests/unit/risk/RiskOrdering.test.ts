import { describe, it, expect, beforeEach } from 'vitest';

import { RiskOrdering, DEFAULT_WEIGHTS } from '../../../src/risk/RiskOrdering.js';

describe('RiskOrdering', () => {
  let ordering: RiskOrdering;

  beforeEach(() => {
    ordering = new RiskOrdering();
  });

  describe('calculateScore', () => {
    it('should assign higher score to lower HF', () => {
      const candidate1 = {
        address: '0xUser1',
        hf: 1.001,
        totalDebtUsd: 1000
      };

      const candidate2 = {
        address: '0xUser2',
        hf: 1.0005,
        totalDebtUsd: 1000
      };

      const score1 = ordering.calculateScore(candidate1);
      const score2 = ordering.calculateScore(candidate2);

      expect(score2).toBeGreaterThan(score1);
    });

    it('should assign higher score to worsening HF (HF - projHF)', () => {
      const candidate1 = {
        address: '0xUser1',
        hf: 1.001,
        projectedHf: 1.0009,
        totalDebtUsd: 1000
      };

      const candidate2 = {
        address: '0xUser2',
        hf: 1.001,
        projectedHf: 1.0005, // More deterioration
        totalDebtUsd: 1000
      };

      const score1 = ordering.calculateScore(candidate1);
      const score2 = ordering.calculateScore(candidate2);

      expect(score2).toBeGreaterThan(score1);
    });

    it('should assign higher score to larger debt', () => {
      const candidate1 = {
        address: '0xUser1',
        hf: 1.001,
        totalDebtUsd: 1000
      };

      const candidate2 = {
        address: '0xUser2',
        hf: 1.001,
        totalDebtUsd: 10000 // 10x larger debt
      };

      const score1 = ordering.calculateScore(candidate1);
      const score2 = ordering.calculateScore(candidate2);

      expect(score2).toBeGreaterThan(score1);
    });

    it('should handle candidates without projected HF', () => {
      const candidate = {
        address: '0xUser1',
        hf: 1.001,
        totalDebtUsd: 1000
      };

      const score = ordering.calculateScore(candidate);
      expect(score).toBeGreaterThan(0);
    });

    it('should use default weights when enabled', () => {
      ordering.setEnabled(true);

      const candidate = {
        address: '0xUser1',
        hf: 1.001,
        projectedHf: 0.999,
        totalDebtUsd: 1000
      };

      const score = ordering.calculateScore(candidate);

      // Rough calculation check
      const hfProximity = 1.0015 - 1.001;
      const hfDelta = 1.001 - 0.999;
      const debtComponent = Math.log10(1000);
      
      const expectedScore = 
        DEFAULT_WEIGHTS.w1 * hfProximity +
        DEFAULT_WEIGHTS.w2 * hfDelta +
        DEFAULT_WEIGHTS.w3 * debtComponent;

      expect(score).toBeCloseTo(expectedScore, 2);
    });

    it('should return simple HF-based score when disabled', () => {
      ordering.setEnabled(false);

      const candidate = {
        address: '0xUser1',
        hf: 1.001,
        projectedHf: 0.999,
        totalDebtUsd: 1000
      };

      const score = ordering.calculateScore(candidate);
      expect(score).toBeCloseTo(1.0015 - 1.001, 6);
    });
  });

  describe('scoreAndSort', () => {
    it('should sort candidates by score descending', () => {
      const candidates = [
        {
          address: '0xUser1',
          hf: 1.001,
          totalDebtUsd: 1000
        },
        {
          address: '0xUser2',
          hf: 0.999, // Most critical
          totalDebtUsd: 1000
        },
        {
          address: '0xUser3',
          hf: 1.005,
          totalDebtUsd: 1000
        }
      ];

      const sorted = ordering.scoreAndSort(candidates);

      expect(sorted).toHaveLength(3);
      expect(sorted[0].address).toBe('0xUser2');
      expect(sorted[2].address).toBe('0xUser3');
    });

    it('should include score in result', () => {
      const candidates = [
        {
          address: '0xUser1',
          hf: 1.001,
          totalDebtUsd: 1000
        }
      ];

      const sorted = ordering.scoreAndSort(candidates);

      expect(sorted[0]).toHaveProperty('score');
      expect(sorted[0].score).toBeGreaterThan(0);
    });

    it('should handle empty list', () => {
      const sorted = ordering.scoreAndSort([]);
      expect(sorted).toHaveLength(0);
    });

    it('should consider all factors in ordering', () => {
      const candidates = [
        {
          address: '0xUser1',
          hf: 1.001,
          projectedHf: 0.999,
          totalDebtUsd: 10000 // Lower HF, deteriorating, large debt
        },
        {
          address: '0xUser2',
          hf: 1.0005,
          projectedHf: 1.0004,
          totalDebtUsd: 1000 // Lower HF, not deteriorating, small debt
        },
        {
          address: '0xUser3',
          hf: 1.002,
          projectedHf: 1.001,
          totalDebtUsd: 100 // Higher HF, slight deterioration, tiny debt
        }
      ];

      const sorted = ordering.scoreAndSort(candidates);

      // User1 should be highest priority due to combination of factors
      expect(sorted[0].address).toBe('0xUser1');
    });
  });

  describe('setWeights', () => {
    it('should update weights', () => {
      const newWeights = { w1: 200, w2: 100, w3: 10 };
      ordering.setWeights(newWeights);

      const weights = ordering.getWeights();
      expect(weights.w1).toBe(200);
      expect(weights.w2).toBe(100);
      expect(weights.w3).toBe(10);
    });

    it('should allow partial weight updates', () => {
      ordering.setWeights({ w1: 200 });

      const weights = ordering.getWeights();
      expect(weights.w1).toBe(200);
      expect(weights.w2).toBe(DEFAULT_WEIGHTS.w2);
      expect(weights.w3).toBe(DEFAULT_WEIGHTS.w3);
    });
  });

  describe('enable/disable', () => {
    it('should enable risk ordering', () => {
      ordering.setEnabled(true);
      expect(ordering.isEnabled()).toBe(true);
    });

    it('should disable risk ordering', () => {
      ordering.setEnabled(false);
      expect(ordering.isEnabled()).toBe(false);
    });
  });

  describe('logScore', () => {
    it('should log candidate score without throwing', () => {
      const candidate = {
        address: '0xUser1',
        hf: 1.001,
        projectedHf: 0.999,
        totalDebtUsd: 1000,
        score: 15.5
      };

      // Should not throw
      expect(() => {
        ordering.logScore(candidate);
      }).not.toThrow();
    });

    it('should log candidate score with block number', () => {
      const candidate = {
        address: '0xUser1',
        hf: 1.001,
        totalDebtUsd: 1000,
        score: 10.0
      };

      // Should not throw
      expect(() => {
        ordering.logScore(candidate, 12345);
      }).not.toThrow();
    });
  });
});
