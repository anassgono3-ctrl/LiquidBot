import { describe, it, expect } from 'vitest';

import { calculateUsdValue, formatTokenAmount } from '../../src/utils/usdMath.js';

describe('usdMath', () => {
  describe('calculateUsdValue', () => {
    it('should calculate USD for USDC (6 decimals)', () => {
      // 1000 USDC (6 decimals) at $1.00
      const rawAmount = BigInt(1000_000000); // 1000 USDC
      const decimals = 6;
      const priceRaw = BigInt(100000000); // $1.00 in 1e8
      
      const usd = calculateUsdValue(rawAmount, decimals, priceRaw);
      expect(usd).toBeCloseTo(1000, 2);
    });

    it('should calculate USD for WETH (18 decimals)', () => {
      // 1 WETH (18 decimals) at $3000
      const rawAmount = BigInt(1e18); // 1 WETH
      const decimals = 18;
      const priceRaw = BigInt(300000000000); // $3000 in 1e8
      
      const usd = calculateUsdValue(rawAmount, decimals, priceRaw);
      expect(usd).toBeCloseTo(3000, 2);
    });

    it('should calculate USD for DAI (18 decimals)', () => {
      // 500 DAI (18 decimals) at $1.00
      const rawAmount = BigInt(500) * BigInt(1e18); // 500 DAI
      const decimals = 18;
      const priceRaw = BigInt(100000000); // $1.00 in 1e8
      
      const usd = calculateUsdValue(rawAmount, decimals, priceRaw);
      expect(usd).toBeCloseTo(500, 2);
    });

    it('should handle small amounts without rounding to zero', () => {
      // 0.001 USDC (very small amount) at $1.00
      const rawAmount = BigInt(1000); // 0.001 USDC
      const decimals = 6;
      const priceRaw = BigInt(100000000); // $1.00 in 1e8
      
      const usd = calculateUsdValue(rawAmount, decimals, priceRaw);
      expect(usd).toBeGreaterThan(0);
      expect(usd).toBeCloseTo(0.001, 6);
    });

    it('should handle zero amount', () => {
      const rawAmount = BigInt(0);
      const decimals = 6;
      const priceRaw = BigInt(100000000);
      
      const usd = calculateUsdValue(rawAmount, decimals, priceRaw);
      expect(usd).toBe(0);
    });

    it('should handle high-precision decimals (>18)', () => {
      // Some tokens have more than 18 decimals
      const rawAmount = BigInt(1000) * BigInt(10 ** 24); // 1000 tokens with 24 decimals
      const decimals = 24;
      const priceRaw = BigInt(100000000); // $1.00 in 1e8
      
      const usd = calculateUsdValue(rawAmount, decimals, priceRaw);
      expect(usd).toBeCloseTo(1000, 2);
    });

    it('should produce same result as plan resolver for typical case', () => {
      // Simulate a typical liquidation scenario
      // 50 USDC debt at $1.00
      const rawAmount = BigInt(50_000000); // 50 USDC (6 decimals)
      const decimals = 6;
      const priceRaw = BigInt(100000000); // $1.00 in 1e8
      
      const usd = calculateUsdValue(rawAmount, decimals, priceRaw);
      
      // This should match the plan resolver calculation exactly
      expect(usd).toBeCloseTo(50, 8); // Very tight tolerance
    });
  });

  describe('formatTokenAmount', () => {
    it('should format USDC amount (6 decimals)', () => {
      const rawAmount = BigInt(1000_000000); // 1000 USDC
      const decimals = 6;
      
      const formatted = formatTokenAmount(rawAmount, decimals);
      expect(formatted).toBe('1000');
    });

    it('should format WETH amount (18 decimals)', () => {
      const rawAmount = BigInt(1.5 * 1e18); // 1.5 WETH
      const decimals = 18;
      
      const formatted = formatTokenAmount(rawAmount, decimals);
      expect(formatted).toBe('1.5');
    });

    it('should trim trailing zeros', () => {
      const rawAmount = BigInt(1234_567000); // 1234.567 USDC
      const decimals = 6;
      
      const formatted = formatTokenAmount(rawAmount, decimals);
      expect(formatted).toBe('1234.567');
    });

    it('should handle zero amount', () => {
      const rawAmount = BigInt(0);
      const decimals = 6;
      
      const formatted = formatTokenAmount(rawAmount, decimals);
      expect(formatted).toBe('0');
    });

    it('should handle fractional amounts', () => {
      const rawAmount = BigInt(500000); // 0.5 USDC
      const decimals = 6;
      
      const formatted = formatTokenAmount(rawAmount, decimals);
      expect(formatted).toBe('0.5');
    });

    it('should handle very small amounts', () => {
      const rawAmount = BigInt(1); // 0.000001 USDC
      const decimals = 6;
      
      const formatted = formatTokenAmount(rawAmount, decimals);
      expect(formatted).toBe('0.000001');
    });
  });
});
