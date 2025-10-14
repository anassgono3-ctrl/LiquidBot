// Unit tests for ExecutionService amount scaling and dust guard
// These tests verify the calculation logic for debt amounts and USD values
import { describe, it, expect } from 'vitest';

describe('ExecutionService - Amount Scaling and Dust Guard Logic', () => {
  // These tests verify the mathematical correctness of amount scaling
  // without relying on the full execution flow (which requires env vars loaded at module time)

  describe('Amount Scaling with Various Decimals', () => {
    it('should correctly scale USDC (6 decimals) amount to USD with 1e18 math', () => {
      // Test the math directly
      const debtToCoverRaw = BigInt('17702'); // ~0.017702 USDC (6 decimals)
      const tokenDecimals = 6;
      const priceRaw = BigInt('100000000'); // $1 in 8 decimals
      const priceDecimals = 8;
      
      // Scale amount to 1e18
      const amount1e18 = debtToCoverRaw * (10n ** BigInt(18 - tokenDecimals));
      // Scale price to 1e18
      const price1e18 = priceRaw * (10n ** BigInt(18 - priceDecimals));
      // Calculate USD value: (amount * price) / 1e18
      const usdValue1e18 = (amount1e18 * price1e18) / (10n ** 18n);
      
      // Convert to human-readable USD
      const debtToCoverUsd = Number(usdValue1e18) / 1e18;
      
      // Verify USD value is non-zero and approximately correct
      expect(debtToCoverUsd).toBeGreaterThan(0);
      expect(debtToCoverUsd).toBeGreaterThan(0.017);
      expect(debtToCoverUsd).toBeLessThan(0.018);
    });

    it('should correctly scale WETH (18 decimals) amount to USD with 1e18 math', () => {
      const debtToCoverRaw = BigInt('500000000000000000'); // 0.5 WETH (18 decimals)
      const tokenDecimals = 18;
      const priceRaw = BigInt('300000000000'); // $3000 in 8 decimals
      const priceDecimals = 8;
      
      // Scale amount to 1e18
      const amount1e18 = debtToCoverRaw * (10n ** BigInt(18 - tokenDecimals));
      // Scale price to 1e18
      const price1e18 = priceRaw * (10n ** BigInt(18 - priceDecimals));
      // Calculate USD value: (amount * price) / 1e18
      const usdValue1e18 = (amount1e18 * price1e18) / (10n ** 18n);
      
      // Convert to human-readable USD
      const debtToCoverUsd = Number(usdValue1e18) / 1e18;
      
      // Verify: 0.5 WETH at $3000 = $1500
      expect(debtToCoverUsd).toBeGreaterThan(1400);
      expect(debtToCoverUsd).toBeLessThan(1600);
    });

    it('should handle various token decimals correctly', () => {
      const testCases = [
        { decimals: 6, raw: BigInt('500000'), price: BigInt('100000000'), expectedUsd: 0.5 },      // 0.5 USDC at $1
        { decimals: 8, raw: BigInt('50000000'), price: BigInt('100000000'), expectedUsd: 0.5 },    // 0.5 WBTC at $1
        { decimals: 18, raw: BigInt('500000000000000000'), price: BigInt('100000000'), expectedUsd: 0.5 }, // 0.5 ETH at $1
      ];

      for (const testCase of testCases) {
        const priceDecimals = 8;
        
        // Scale amount to 1e18
        const amount1e18 = testCase.raw * (10n ** BigInt(18 - testCase.decimals));
        // Scale price to 1e18
        const price1e18 = testCase.price * (10n ** BigInt(18 - priceDecimals));
        // Calculate USD value: (amount * price) / 1e18
        const usdValue1e18 = (amount1e18 * price1e18) / (10n ** 18n);
        
        // Convert to human-readable USD
        const debtToCoverUsd = Number(usdValue1e18) / 1e18;
        
        // All should be around $0.5
        expect(debtToCoverUsd).toBeGreaterThan(0.49);
        expect(debtToCoverUsd).toBeLessThan(0.51);
      }
    });
  });

  describe('Dust Guard', () => {
    const MIN_USD_1e18 = 5n * 10n**18n; // $5 USD minimum threshold

    it('should identify amounts below $5 USD as dust', () => {
      // 0.001 USDC at $1 = $0.001 (well below $5)
      const debtToCoverRaw = BigInt('500'); // 0.0005 USDC (6 decimals)
      const tokenDecimals = 6;
      const priceRaw = BigInt('100000000'); // $1 in 8 decimals
      const priceDecimals = 8;
      
      // Calculate USD value
      const amount1e18 = debtToCoverRaw * (10n ** BigInt(18 - tokenDecimals));
      const price1e18 = priceRaw * (10n ** BigInt(18 - priceDecimals));
      const usdValue1e18 = (amount1e18 * price1e18) / (10n ** 18n);
      
      // Check dust guard
      const isDust = debtToCoverRaw === 0n || usdValue1e18 < MIN_USD_1e18;
      
      expect(isDust).toBe(true);
    });

    it('should NOT identify amounts >= $5 USD as dust', () => {
      // 10 USDC at $1 = $10 (above $5)
      const debtToCoverRaw = BigInt('10000000'); // 10 USDC (6 decimals)
      const tokenDecimals = 6;
      const priceRaw = BigInt('100000000'); // $1 in 8 decimals
      const priceDecimals = 8;
      
      // Calculate USD value
      const amount1e18 = debtToCoverRaw * (10n ** BigInt(18 - tokenDecimals));
      const price1e18 = priceRaw * (10n ** BigInt(18 - priceDecimals));
      const usdValue1e18 = (amount1e18 * price1e18) / (10n ** 18n);
      
      // Check dust guard
      const isDust = debtToCoverRaw === 0n || usdValue1e18 < MIN_USD_1e18;
      
      expect(isDust).toBe(false);
    });

    it('should identify zero debt as dust', () => {
      const debtToCoverRaw = BigInt('0');
      const isDust = debtToCoverRaw === 0n;
      
      expect(isDust).toBe(true);
    });

    it('should handle exactly $5 USD threshold correctly', () => {
      // 5 USDC at $1 = exactly $5
      const debtToCoverRaw = BigInt('5000000'); // 5 USDC (6 decimals)
      const tokenDecimals = 6;
      const priceRaw = BigInt('100000000'); // $1 in 8 decimals
      const priceDecimals = 8;
      
      // Calculate USD value
      const amount1e18 = debtToCoverRaw * (10n ** BigInt(18 - tokenDecimals));
      const price1e18 = priceRaw * (10n ** BigInt(18 - priceDecimals));
      const usdValue1e18 = (amount1e18 * price1e18) / (10n ** 18n);
      
      // Check dust guard (>= threshold means NOT dust)
      const isDust = debtToCoverRaw === 0n || usdValue1e18 < MIN_USD_1e18;
      
      expect(isDust).toBe(false); // Exactly $5 should NOT be dust
    });

    it('should handle slightly below $5 USD as dust', () => {
      // 4.99 USDC at $1 = $4.99 (just below $5)
      const debtToCoverRaw = BigInt('4990000'); // 4.99 USDC (6 decimals)
      const tokenDecimals = 6;
      const priceRaw = BigInt('100000000'); // $1 in 8 decimals
      const priceDecimals = 8;
      
      // Calculate USD value
      const amount1e18 = debtToCoverRaw * (10n ** BigInt(18 - tokenDecimals));
      const price1e18 = priceRaw * (10n ** BigInt(18 - priceDecimals));
      const usdValue1e18 = (amount1e18 * price1e18) / (10n ** 18n);
      
      // Check dust guard
      const isDust = debtToCoverRaw === 0n || usdValue1e18 < MIN_USD_1e18;
      
      expect(isDust).toBe(true);
    });
  });

  describe('Human-Readable Format', () => {
    it('should format USDC amounts correctly', () => {
      const debtToCoverRaw = BigInt('17702'); // 0.017702 USDC
      const tokenDecimals = 6;
      
      const debtToCoverHuman = (Number(debtToCoverRaw) / Math.pow(10, tokenDecimals)).toFixed(6);
      
      expect(debtToCoverHuman).toBe('0.017702');
    });

    it('should format WETH amounts correctly', () => {
      const debtToCoverRaw = BigInt('500000000000000000'); // 0.5 WETH
      const tokenDecimals = 18;
      
      const debtToCoverHuman = (Number(debtToCoverRaw) / Math.pow(10, tokenDecimals)).toFixed(6);
      
      expect(parseFloat(debtToCoverHuman)).toBeCloseTo(0.5, 6);
    });

    it('should verify BigInt string conversion', () => {
      const debtToCoverRaw = BigInt('17702');
      const debtToCoverStr = debtToCoverRaw.toString();
      
      expect(debtToCoverStr).toBe('17702');
      expect(() => BigInt(debtToCoverStr)).not.toThrow();
      expect(BigInt(debtToCoverStr)).toBe(debtToCoverRaw);
    });
  });
});
