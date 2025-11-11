import { describe, it, expect } from 'vitest';
import { calculateUsdValue } from '../../src/utils/usdMath.js';

describe('USD Dust Guard', () => {
  describe('USD-based dust threshold logic', () => {
    it('should identify dust when repayUSD < threshold', () => {
      const DUST_MIN_USD = 20;
      
      // Simulate debt repay calculation
      const debtToCover = 1000000n; // 1 USDC (6 decimals)
      const decimals = 6;
      const priceRaw = 100000000n; // $1 in 8 decimals
      
      const repayUSD = calculateUsdValue(debtToCover, decimals, priceRaw);
      
      expect(repayUSD).toBeLessThan(DUST_MIN_USD);
      expect(repayUSD).toBeCloseTo(1, 2);
    });

    it('should pass when repayUSD >= threshold', () => {
      const DUST_MIN_USD = 20;
      
      // Simulate debt repay calculation with sufficient amount
      const debtToCover = 100000000n; // 100 USDC (6 decimals)
      const decimals = 6;
      const priceRaw = 100000000n; // $1 in 8 decimals
      
      const repayUSD = calculateUsdValue(debtToCover, decimals, priceRaw);
      
      expect(repayUSD).toBeGreaterThanOrEqual(DUST_MIN_USD);
      expect(repayUSD).toBeCloseTo(100, 2);
    });

    it('should handle different token decimals correctly', () => {
      const DUST_MIN_USD = 20;
      
      // WBTC has 8 decimals - 0.001 WBTC at $50k = $50
      const debtToCover = 100000n; // 0.001 WBTC (8 decimals)
      const decimals = 8;
      const priceRaw = 5000000000000n; // $50k in 8 decimals
      
      const repayUSD = calculateUsdValue(debtToCover, decimals, priceRaw);
      
      // 0.001 * 50000 = 50 USD
      expect(repayUSD).toBeGreaterThan(DUST_MIN_USD);
      expect(repayUSD).toBeCloseTo(50, 2);
    });
    
    it('should handle 18-decimal tokens', () => {
      const DUST_MIN_USD = 20;
      
      // WETH has 18 decimals - 0.01 ETH at $3000 = $30
      const debtToCover = 10000000000000000n; // 0.01 ETH (18 decimals)
      const decimals = 18;
      const priceRaw = 300000000000n; // $3000 in 8 decimals
      
      const repayUSD = calculateUsdValue(debtToCover, decimals, priceRaw);
      
      // 0.01 * 3000 = 30 USD
      expect(repayUSD).toBeGreaterThan(DUST_MIN_USD);
      expect(repayUSD).toBeCloseTo(30, 2);
    });
  });

  describe('Seized collateral calculation', () => {
    it('should calculate seized USD with liquidation bonus', () => {
      const debtToCover = 50000000n; // 50 USDC (6 decimals)
      const liquidationBonusPct = 0.05; // 5%
      const decimals = 6;
      const priceRaw = 100000000n; // $1 in 8 decimals
      
      // Calculate max seizable with bonus
      const maxSeizableCollateral = (debtToCover * BigInt(Math.floor((1 + liquidationBonusPct) * 1e18))) / BigInt(1e18);
      const seizedUsd = calculateUsdValue(maxSeizableCollateral, decimals, priceRaw);
      
      // 50 * 1.05 = 52.5 USD
      expect(seizedUsd).toBeGreaterThan(50);
      expect(seizedUsd).toBeCloseTo(52.5, 1);
    });
  });
});
