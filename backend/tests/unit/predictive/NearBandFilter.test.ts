/**
 * Unit tests for NearBandFilter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NearBandFilter, type UserSnapshot } from '../../../src/predictive/NearBandFilter.js';

describe('NearBandFilter', () => {
  let filter: NearBandFilter;

  beforeEach(() => {
    filter = new NearBandFilter({
      nearBandBps: 30,    // 0.30%
      minDebtUsd: 5,
      hfPredCritical: 1.0008
    });
  });

  describe('shouldCheck', () => {
    it('should include users in near-band range', () => {
      const user: UserSnapshot = {
        user: '0xNEAR',
        hf: 1.002,
        debtUsd: 100
      };

      expect(filter.shouldCheck(user)).toBe(true);
    });

    it('should include users already liquidatable', () => {
      const user: UserSnapshot = {
        user: '0xLIQ',
        hf: 0.99,
        debtUsd: 100
      };

      expect(filter.shouldCheck(user)).toBe(true);
    });

    it('should exclude users far above threshold', () => {
      const user: UserSnapshot = {
        user: '0xSAFE',
        hf: 1.5,
        debtUsd: 100
      };

      expect(filter.shouldCheck(user)).toBe(false);
    });

    it('should exclude users below minimum debt', () => {
      const user: UserSnapshot = {
        user: '0xDUST',
        hf: 1.001,
        debtUsd: 1  // Below minDebtUsd of 5
      };

      expect(filter.shouldCheck(user)).toBe(false);
    });

    it('should include users with projected HF near critical', () => {
      const user: UserSnapshot = {
        user: '0xPROJ',
        hf: 1.05,
        debtUsd: 100,
        projectedHf: 1.0005  // Below hfPredCritical
      };

      expect(filter.shouldCheck(user)).toBe(true);
    });

    it('should exclude users without projected HF and far from threshold', () => {
      const user: UserSnapshot = {
        user: '0xNO_PROJ',
        hf: 1.1,
        debtUsd: 100
        // No projectedHf
      };

      expect(filter.shouldCheck(user)).toBe(false);
    });

    it('should handle edge case at exact threshold', () => {
      const user: UserSnapshot = {
        user: '0xEDGE',
        hf: 1.003,  // Exactly at 1.0 + 30bps
        debtUsd: 100
      };

      expect(filter.shouldCheck(user)).toBe(true);
    });
  });

  describe('filter', () => {
    it('should filter a batch of users correctly', () => {
      const users: UserSnapshot[] = [
        { user: '0x1', hf: 0.99, debtUsd: 100 },   // Liquidatable
        { user: '0x2', hf: 1.001, debtUsd: 100 },  // Near-band
        { user: '0x3', hf: 1.1, debtUsd: 100 },    // Too far
        { user: '0x4', hf: 1.002, debtUsd: 100 },  // Near-band
        { user: '0x5', hf: 1.5, debtUsd: 100 }     // Too far
      ];

      const result = filter.filter(users);

      expect(result.kept.length).toBe(3);  // 0x1, 0x2, 0x4
      expect(result.skipped).toBe(2);       // 0x3, 0x5
      expect(result.hfRange.min).toBe(0.99);
      expect(result.hfRange.max).toBeGreaterThan(1.0);
    });

    it('should handle empty input', () => {
      const result = filter.filter([]);

      expect(result.kept.length).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.hfRange.min).toBe(0);
      expect(result.hfRange.max).toBe(0);
    });

    it('should handle all users filtered out', () => {
      const users: UserSnapshot[] = [
        { user: '0x1', hf: 2.0, debtUsd: 100 },
        { user: '0x2', hf: 1.8, debtUsd: 100 },
        { user: '0x3', hf: 1.5, debtUsd: 100 }
      ];

      const result = filter.filter(users);

      expect(result.kept.length).toBe(0);
      expect(result.skipped).toBe(3);
    });

    it('should handle all users passing filter', () => {
      const users: UserSnapshot[] = [
        { user: '0x1', hf: 0.99, debtUsd: 100 },
        { user: '0x2', hf: 1.001, debtUsd: 100 },
        { user: '0x3', hf: 1.002, debtUsd: 100 }
      ];

      const result = filter.filter(users);

      expect(result.kept.length).toBe(3);
      expect(result.skipped).toBe(0);
    });

    it('should track HF range correctly', () => {
      const users: UserSnapshot[] = [
        { user: '0x1', hf: 0.95, debtUsd: 100 },   // Min
        { user: '0x2', hf: 1.001, debtUsd: 100 },
        { user: '0x3', hf: 1.0025, debtUsd: 100 }  // Max
      ];

      const result = filter.filter(users);

      expect(result.hfRange.min).toBeCloseTo(0.95, 2);
      expect(result.hfRange.max).toBeCloseTo(1.0025, 4);
    });
  });

  describe('Configuration', () => {
    it('should use custom configuration', () => {
      const customFilter = new NearBandFilter({
        nearBandBps: 50,  // Wider band: 0.50%
        minDebtUsd: 10,
        hfPredCritical: 1.001
      });

      const config = customFilter.getConfig();

      expect(config.nearBandBps).toBe(50);
      expect(config.minDebtUsd).toBe(10);
      expect(config.hfPredCritical).toBe(1.001);
    });

    it('should handle narrow band configuration', () => {
      const narrowFilter = new NearBandFilter({
        nearBandBps: 10,  // Very narrow: 0.10%
        minDebtUsd: 1,
        hfPredCritical: 1.0005
      });

      const user1: UserSnapshot = { user: '0x1', hf: 1.0005, debtUsd: 10 };
      const user2: UserSnapshot = { user: '0x2', hf: 1.0015, debtUsd: 10 };

      expect(narrowFilter.shouldCheck(user1)).toBe(true);   // Within 0.10%
      expect(narrowFilter.shouldCheck(user2)).toBe(false);  // Outside 0.10%
    });

    it('should handle wide band configuration', () => {
      const wideFilter = new NearBandFilter({
        nearBandBps: 100,  // Wide: 1.00%
        minDebtUsd: 1,
        hfPredCritical: 1.002
      });

      const user: UserSnapshot = { user: '0x1', hf: 1.009, debtUsd: 10 };

      expect(wideFilter.shouldCheck(user)).toBe(true);  // Within 1.00%
    });
  });

  describe('Projected HF scenarios', () => {
    it('should include users with concerning projected HF even if current HF is safe', () => {
      const user: UserSnapshot = {
        user: '0xPROJECTED',
        hf: 1.08,          // Currently safe
        debtUsd: 500,
        projectedHf: 1.0003  // Projected to be critical
      };

      expect(filter.shouldCheck(user)).toBe(true);
    });

    it('should exclude users with safe projected HF and safe current HF', () => {
      const user: UserSnapshot = {
        user: '0xSAFE_BOTH',
        hf: 1.2,
        debtUsd: 500,
        projectedHf: 1.15
      };

      expect(filter.shouldCheck(user)).toBe(false);
    });
  });

  describe('Debt threshold scenarios', () => {
    it('should filter out dust positions regardless of HF', () => {
      const user: UserSnapshot = {
        user: '0xDUST',
        hf: 1.001,  // Near-band HF
        debtUsd: 0.1  // Very low debt
      };

      expect(filter.shouldCheck(user)).toBe(false);
    });

    it('should include positions at exact minimum debt threshold', () => {
      const user: UserSnapshot = {
        user: '0xMIN_DEBT',
        hf: 1.001,
        debtUsd: 5  // Exactly at minDebtUsd
      };

      expect(filter.shouldCheck(user)).toBe(true);
    });
  });
});
