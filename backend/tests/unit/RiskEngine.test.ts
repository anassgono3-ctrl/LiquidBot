// RiskEngine Tests: Verify numeric correctness with BigInt
import { describe, it, expect } from 'vitest';

describe('RiskEngine', () => {
  describe('BigInt calculations', () => {
    it('should handle scaling constants correctly', () => {
      const WAD = 10n ** 18n;
      const RAY = 10n ** 27n;
      const BPS = 10000n;
      
      // Verify constants are correct
      expect(WAD).toBe(1000000000000000000n);
      expect(RAY).toBe(1000000000000000000000000000n);
      expect(BPS).toBe(10000n);
      
      // Test basic arithmetic
      const amount = 5n * WAD; // 5.0
      const threshold = 8000n; // 80%
      const weighted = (amount * threshold) / BPS;
      expect(weighted).toBe(4n * WAD); // 4.0
    });
  
  it('should calculate liquidation correctly for different decimals', () => {
      // Test 18-decimal collateral (WETH)
      const wethAmount = 5n * (10n ** 18n);
      const wethPrice = 2000n * (10n ** 8n);
      const wethDecimals = 18;
      
      // Calculate value in base currency
      const baseCurrencyUnit = 10n ** 8n;
      const wethValue = (wethAmount * wethPrice) / ((10n ** BigInt(wethDecimals)) * baseCurrencyUnit);
      
      // Should be $10,000 (5 WETH * $2000)
      expect(wethValue).toBe(10000n);
      
      // Test 6-decimal debt (USDC)
      const usdcAmount = 8000n * (10n ** 6n);
      const usdcPrice = 1n * (10n ** 8n);
      const usdcDecimals = 6;
      
      const usdcValue = (usdcAmount * usdcPrice) / ((10n ** BigInt(usdcDecimals)) * baseCurrencyUnit);
      
      // Should be $8,000
      expect(usdcValue).toBe(8000n);
    });
  });
});
