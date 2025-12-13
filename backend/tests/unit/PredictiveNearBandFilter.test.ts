/**
 * Unit tests for Predictive near-band filtering
 * Tests PREDICTIVE_NEAR_ONLY and PREDICTIVE_NEAR_BAND_BPS logic
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NearBandFilter } from '../../src/predictive/NearBandFilter.js';

describe('Predictive Near-Band Filtering', () => {
  describe('NearBandFilter', () => {
    let filter: NearBandFilter;
    
    beforeEach(() => {
      filter = new NearBandFilter({
        nearBandBps: 30, // 0.30%
        minDebtUsd: 1,
        hfPredCritical: 1.0008
      });
    });

    describe('shouldCheck', () => {
      it('should include users with HF in near-band (1.0 to 1.003)', () => {
        const snapshot = {
          user: '0xuser1',
          hf: 1.002,
          debtUsd: 100
        };
        
        expect(filter.shouldCheck(snapshot)).toBe(true);
      });

      it('should include users with HF below 1.0 (already liquidatable)', () => {
        const snapshot = {
          user: '0xuser1',
          hf: 0.99,
          debtUsd: 100
        };
        
        expect(filter.shouldCheck(snapshot)).toBe(true);
      });

      it('should include users with projected HF below critical threshold', () => {
        const snapshot = {
          user: '0xuser1',
          hf: 1.05, // Current HF not in band
          projectedHf: 1.0005, // But projected is below critical
          debtUsd: 100
        };
        
        expect(filter.shouldCheck(snapshot)).toBe(true);
      });

      it('should skip users far from liquidation (HF > 1.003)', () => {
        const snapshot = {
          user: '0xuser1',
          hf: 1.17, // Way above near-band threshold
          debtUsd: 100
        };
        
        expect(filter.shouldCheck(snapshot)).toBe(false);
      });

      it('should skip users below minimum debt threshold', () => {
        const snapshot = {
          user: '0xuser1',
          hf: 1.002, // In near band
          debtUsd: 0.5 // Below minDebtUsd
        };
        
        expect(filter.shouldCheck(snapshot)).toBe(false);
      });

      it('should handle missing debtUsd gracefully', () => {
        const snapshot = {
          user: '0xuser1',
          hf: 1.002
          // No debtUsd - should still check based on HF
        };
        
        expect(filter.shouldCheck(snapshot)).toBe(true);
      });
    });

    describe('filter batch', () => {
      it('should filter a batch and return statistics', () => {
        const snapshots = [
          { user: '0xuser1', hf: 0.99, debtUsd: 100 },  // Below 1.0 - keep
          { user: '0xuser2', hf: 1.001, debtUsd: 100 }, // In band - keep
          { user: '0xuser3', hf: 1.002, debtUsd: 100 }, // In band - keep
          { user: '0xuser4', hf: 1.17, debtUsd: 100 },  // Far above - skip
          { user: '0xuser5', hf: 1.25, debtUsd: 100 },  // Far above - skip
          { user: '0xuser6', hf: 1.0005, debtUsd: 100 } // In band - keep
        ];
        
        const result = filter.filter(snapshots);
        
        expect(result.kept.length).toBe(4);
        expect(result.skipped).toBe(2);
        expect(result.hfRange.min).toBeCloseTo(0.99, 2);
        expect(result.hfRange.max).toBeCloseTo(1.002, 3);
      });

      it('should handle empty batch', () => {
        const result = filter.filter([]);
        
        expect(result.kept.length).toBe(0);
        expect(result.skipped).toBe(0);
      });

      it('should handle all users being skipped', () => {
        const snapshots = [
          { user: '0xuser1', hf: 1.5, debtUsd: 100 },
          { user: '0xuser2', hf: 2.0, debtUsd: 100 }
        ];
        
        const result = filter.filter(snapshots);
        
        expect(result.kept.length).toBe(0);
        expect(result.skipped).toBe(2);
      });
    });

    describe('configuration', () => {
      it('should respect custom nearBandBps threshold', () => {
        const customFilter = new NearBandFilter({
          nearBandBps: 50, // 0.50% instead of 0.30%
          minDebtUsd: 1,
          hfPredCritical: 1.0008
        });
        
        const snapshot = {
          user: '0xuser1',
          hf: 1.004, // Would be skipped with 30 bps, but included with 50 bps
          debtUsd: 100
        };
        
        expect(customFilter.shouldCheck(snapshot)).toBe(true);
        
        // But far above should still be skipped
        const farSnapshot = {
          user: '0xuser2',
          hf: 1.17,
          debtUsd: 100
        };
        expect(customFilter.shouldCheck(farSnapshot)).toBe(false);
      });

      it('should respect custom minDebtUsd threshold', () => {
        const customFilter = new NearBandFilter({
          nearBandBps: 30,
          minDebtUsd: 50, // Higher debt threshold
          hfPredCritical: 1.0008
        });
        
        const lowDebtSnapshot = {
          user: '0xuser1',
          hf: 1.002,
          debtUsd: 25 // Below threshold
        };
        
        expect(customFilter.shouldCheck(lowDebtSnapshot)).toBe(false);
        
        const highDebtSnapshot = {
          user: '0xuser2',
          hf: 1.002,
          debtUsd: 100 // Above threshold
        };
        
        expect(customFilter.shouldCheck(highDebtSnapshot)).toBe(true);
      });
    });
  });
});
