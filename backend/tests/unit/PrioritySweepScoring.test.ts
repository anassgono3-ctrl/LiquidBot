import { describe, it, expect } from 'vitest';

import { computeScore, shouldInclude, sortFinal, computeStats } from '../../src/priority/scoring.js';
import type { UserData, ScoredUser, ScoringConfig } from '../../src/priority/scoring.js';

describe('Priority Sweep Scoring', () => {
  const defaultConfig: ScoringConfig = {
    debtWeight: 1.0,
    collateralWeight: 0.8,
    hfPenalty: 2.5,
    hfCeiling: 1.20,
    lowHfBoost: 1.1,
    minDebtUsd: 500,
    minCollateralUsd: 1500,
    hotlistMaxHf: 1.05
  };

  describe('computeScore', () => {
    it('should compute score for user with debt and collateral', () => {
      const user: UserData = {
        address: '0xuser1',
        totalCollateralUSD: 10000,
        totalDebtUSD: 5000,
        healthFactor: 1.5
      };

      const score = computeScore(user, defaultConfig);
      expect(score).toBeGreaterThan(0);
      expect(isFinite(score)).toBe(true);
    });

    it('should apply low HF boost when HF < hotlistMaxHf', () => {
      const userLowHf: UserData = {
        address: '0xuser1',
        totalCollateralUSD: 10000,
        totalDebtUSD: 5000,
        healthFactor: 1.03 // Below hotlistMaxHf (1.05)
      };

      const userHighHf: UserData = {
        address: '0xuser2',
        totalCollateralUSD: 10000,
        totalDebtUSD: 5000,
        healthFactor: 1.10 // Above hotlistMaxHf
      };

      const scoreLowHf = computeScore(userLowHf, defaultConfig);
      const scoreHighHf = computeScore(userHighHf, defaultConfig);

      // Low HF user should have higher score due to boost
      expect(scoreLowHf).toBeGreaterThan(scoreHighHf);
    });

    it('should penalize high health factors above ceiling', () => {
      const userLowHf: UserData = {
        address: '0xuser1',
        totalCollateralUSD: 10000,
        totalDebtUSD: 5000,
        healthFactor: 1.10 // Below ceiling (1.20)
      };

      const userHighHf: UserData = {
        address: '0xuser2',
        totalCollateralUSD: 10000,
        totalDebtUSD: 5000,
        healthFactor: 2.00 // Well above ceiling
      };

      const scoreLowHf = computeScore(userLowHf, defaultConfig);
      const scoreHighHf = computeScore(userHighHf, defaultConfig);

      // Higher HF should result in lower score due to penalty
      expect(scoreLowHf).toBeGreaterThan(scoreHighHf);
    });

    it('should handle zero values gracefully', () => {
      const user: UserData = {
        address: '0xuser1',
        totalCollateralUSD: 0,
        totalDebtUSD: 0,
        healthFactor: 0
      };

      const score = computeScore(user, defaultConfig);
      expect(score).toBe(0);
      expect(isFinite(score)).toBe(true);
    });

    it('should clamp extreme values to prevent infinity', () => {
      const user: UserData = {
        address: '0xuser1',
        totalCollateralUSD: 1e20,
        totalDebtUSD: 1e20,
        healthFactor: 1e20
      };

      const score = computeScore(user, defaultConfig);
      expect(isFinite(score)).toBe(true);
      // Extreme HF leads to large penalty, score may be clamped to 0
      expect(score).toBeGreaterThanOrEqual(0);
    });

    it('should handle negative values by clamping to zero', () => {
      const user: UserData = {
        address: '0xuser1',
        totalCollateralUSD: -1000,
        totalDebtUSD: -500,
        healthFactor: -1
      };

      const score = computeScore(user, defaultConfig);
      expect(isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('shouldInclude', () => {
    it('should include user with debt >= minDebtUsd', () => {
      const user: UserData = {
        address: '0xuser1',
        totalCollateralUSD: 100,
        totalDebtUSD: 500,
        healthFactor: 1.5
      };

      expect(shouldInclude(user, defaultConfig)).toBe(true);
    });

    it('should include user with collateral >= minCollateralUsd', () => {
      const user: UserData = {
        address: '0xuser1',
        totalCollateralUSD: 1500,
        totalDebtUSD: 100,
        healthFactor: 1.5
      };

      expect(shouldInclude(user, defaultConfig)).toBe(true);
    });

    it('should include user with either debt or collateral above threshold', () => {
      const userDebtOnly: UserData = {
        address: '0xuser1',
        totalCollateralUSD: 100,
        totalDebtUSD: 600,
        healthFactor: 1.5
      };

      const userCollateralOnly: UserData = {
        address: '0xuser2',
        totalCollateralUSD: 2000,
        totalDebtUSD: 100,
        healthFactor: 1.5
      };

      expect(shouldInclude(userDebtOnly, defaultConfig)).toBe(true);
      expect(shouldInclude(userCollateralOnly, defaultConfig)).toBe(true);
    });

    it('should exclude user below both thresholds', () => {
      const user: UserData = {
        address: '0xuser1',
        totalCollateralUSD: 100,
        totalDebtUSD: 100,
        healthFactor: 1.5
      };

      expect(shouldInclude(user, defaultConfig)).toBe(false);
    });
  });

  describe('sortFinal', () => {
    it('should sort users by score descending', () => {
      const users: ScoredUser[] = [
        { address: '0xuser1', totalCollateralUSD: 1000, totalDebtUSD: 500, healthFactor: 1.5, score: 10 },
        { address: '0xuser2', totalCollateralUSD: 2000, totalDebtUSD: 1000, healthFactor: 1.3, score: 20 },
        { address: '0xuser3', totalCollateralUSD: 500, totalDebtUSD: 250, healthFactor: 1.8, score: 5 }
      ];

      const sorted = sortFinal(users);
      expect(sorted[0].score).toBe(20);
      expect(sorted[1].score).toBe(10);
      expect(sorted[2].score).toBe(5);
    });

    it('should handle empty array', () => {
      const users: ScoredUser[] = [];
      const sorted = sortFinal(users);
      expect(sorted).toEqual([]);
    });

    it('should handle single user', () => {
      const users: ScoredUser[] = [
        { address: '0xuser1', totalCollateralUSD: 1000, totalDebtUSD: 500, healthFactor: 1.5, score: 10 }
      ];

      const sorted = sortFinal(users);
      expect(sorted.length).toBe(1);
      expect(sorted[0].score).toBe(10);
    });
  });

  describe('computeStats', () => {
    it('should compute statistics for scored users', () => {
      const users: ScoredUser[] = [
        { address: '0xuser1', totalCollateralUSD: 1000, totalDebtUSD: 500, healthFactor: 1.5, score: 20 },
        { address: '0xuser2', totalCollateralUSD: 2000, totalDebtUSD: 1000, healthFactor: 1.3, score: 15 },
        { address: '0xuser3', totalCollateralUSD: 500, totalDebtUSD: 250, healthFactor: 1.8, score: 10 }
      ];

      const stats = computeStats(users);
      expect(stats.topScore).toBe(20);
      expect(stats.medianHf).toBe(1.5);
      expect(stats.avgDebt).toBeCloseTo(583.33, 1);
      expect(stats.avgCollateral).toBeCloseTo(1166.67, 1);
    });

    it('should handle empty array', () => {
      const users: ScoredUser[] = [];
      const stats = computeStats(users);
      expect(stats.topScore).toBe(0);
      expect(stats.medianHf).toBe(0);
      expect(stats.avgDebt).toBe(0);
      expect(stats.avgCollateral).toBe(0);
    });

    it('should handle single user', () => {
      const users: ScoredUser[] = [
        { address: '0xuser1', totalCollateralUSD: 1000, totalDebtUSD: 500, healthFactor: 1.5, score: 10 }
      ];

      const stats = computeStats(users);
      expect(stats.topScore).toBe(10);
      expect(stats.medianHf).toBe(1.5);
      expect(stats.avgDebt).toBe(500);
      expect(stats.avgCollateral).toBe(1000);
    });
  });
});
