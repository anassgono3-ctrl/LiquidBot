import { describe, it, expect } from 'vitest';
import { isZero } from '../../src/utils/bigint.js';

describe('Zero-Debt Pruning', () => {
  describe('Candidate filtering logic', () => {
    it('should prune users with totalDebtBase === 0', () => {
      // Simulate candidate list with zero debt user
      const candidates = [
        { userAddress: '0xuser1', totalDebtBase: 1000000000n, totalDebtUsd: 10, healthFactor: 0.95 },
        { userAddress: '0xuser2', totalDebtBase: 0n, totalDebtUsd: 0, healthFactor: Infinity },
        { userAddress: '0xuser3', totalDebtBase: 5000000000n, totalDebtUsd: 50, healthFactor: 0.98 }
      ];
      
      // Filter out zero debt users
      const filtered = candidates.filter(c => !isZero(c.totalDebtBase));
      
      expect(filtered.length).toBe(2);
      expect(filtered.find(c => c.userAddress === '0xuser2')).toBeUndefined();
    });

    it('should prune users with totalDebtUsd < MIN_DEBT_USD', () => {
      const MIN_DEBT_USD = 1;
      
      const candidates = [
        { userAddress: '0xuser1', totalDebtBase: 1000000000n, totalDebtUsd: 10, healthFactor: 0.95 },
        { userAddress: '0xuser2', totalDebtBase: 50000000n, totalDebtUsd: 0.5, healthFactor: 1.05 },
        { userAddress: '0xuser3', totalDebtBase: 5000000000n, totalDebtUsd: 50, healthFactor: 0.98 }
      ];
      
      // Filter out tiny debt users
      const filtered = candidates.filter(c => c.totalDebtUsd >= MIN_DEBT_USD);
      
      expect(filtered.length).toBe(2);
      expect(filtered.find(c => c.userAddress === '0xuser2')).toBeUndefined();
    });
  });

  describe('Health Factor normalization', () => {
    it('should represent HF as Infinity for zero debt', () => {
      const totalDebtBase: bigint = 0n;
      const healthFactor = Infinity;
      
      // Format HF display
      const hfDisplay = isZero(totalDebtBase) ? '∞' : healthFactor.toFixed(4);
      
      expect(hfDisplay).toBe('∞');
    });

    it('should display numeric HF for users with debt', () => {
      const totalDebtBase: bigint = 1000000000n;
      const healthFactor = 0.9876;
      
      // Format HF display
      const hfDisplay = isZero(totalDebtBase) ? '∞' : healthFactor.toFixed(4);
      
      expect(hfDisplay).toBe('0.9876');
    });

    it('should exclude zero-debt HF from minHF calculations', () => {
      const candidates = [
        { healthFactor: 0.95, totalDebtBase: 1000000000n },
        { healthFactor: Infinity, totalDebtBase: 0n },
        { healthFactor: 1.05, totalDebtBase: 5000000000n },
        { healthFactor: 0.98, totalDebtBase: 2000000000n }
      ];
      
      // Calculate minHF excluding zero-debt users
      const withDebt = candidates.filter(c => !isZero(c.totalDebtBase));
      const minHF = Math.min(...withDebt.map(c => c.healthFactor));
      
      expect(minHF).toBe(0.95);
      expect(minHF).not.toBe(Infinity);
    });
  });

  describe('Metrics counting', () => {
    it('should count pruned zero-debt users', () => {
      let zeroDebtCount = 0;
      let tinyDebtCount = 0;
      const MIN_DEBT_USD = 1;
      
      const candidates = [
        { totalDebtBase: 1000000000n, totalDebtUsd: 10 },
        { totalDebtBase: 0n, totalDebtUsd: 0 },
        { totalDebtBase: 50000000n, totalDebtUsd: 0.5 },
        { totalDebtBase: 0n, totalDebtUsd: 0 }
      ];
      
      for (const candidate of candidates) {
        if (isZero(candidate.totalDebtBase)) {
          zeroDebtCount++;
        } else if (candidate.totalDebtUsd < MIN_DEBT_USD) {
          tinyDebtCount++;
        }
      }
      
      expect(zeroDebtCount).toBe(2);
      expect(tinyDebtCount).toBe(1);
    });
  });
});
