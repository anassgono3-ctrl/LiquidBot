import { describe, it, expect } from 'vitest';

import {
  to18,
  from18,
  applyRay,
  usdValue,
  formatTokenAmount,
  baseToUsd,
  validateAmount,
  DecimalConstants
} from '../../src/utils/decimals.js';

describe('Decimal Utilities', () => {
  describe('to18', () => {
    it('should normalize USDC (6 decimals) to 18 decimals', () => {
      // 1000.50 USDC = 1000500000 (6 decimals)
      const raw = 1000500000n;
      const normalized = to18(raw, 6);
      expect(normalized).toBe(1000500000000000000000n); // 18 decimals
    });

    it('should keep WETH (18 decimals) unchanged', () => {
      // 1.5 WETH = 1500000000000000000 (18 decimals)
      const raw = 1500000000000000000n;
      const normalized = to18(raw, 18);
      expect(normalized).toBe(1500000000000000000n);
    });

    it('should handle zero amount', () => {
      expect(to18(0n, 6)).toBe(0n);
      expect(to18(0n, 18)).toBe(0n);
    });

    it('should handle DAI (18 decimals)', () => {
      const raw = 2000000000000000000000n; // 2000 DAI
      const normalized = to18(raw, 18);
      expect(normalized).toBe(2000000000000000000000n);
    });

    it('should handle cbBTC (8 decimals)', () => {
      // 0.5 BTC = 50000000 (8 decimals)
      const raw = 50000000n;
      const normalized = to18(raw, 8);
      expect(normalized).toBe(500000000000000000n); // 18 decimals
    });
  });

  describe('from18', () => {
    it('should convert 18 decimals back to USDC (6 decimals)', () => {
      const amount18 = 1000500000000000000000n; // 1000.50 in 18 decimals
      const raw = from18(amount18, 6);
      expect(raw).toBe(1000500000n); // 6 decimals
    });

    it('should keep 18 decimals for WETH', () => {
      const amount18 = 1500000000000000000n;
      const raw = from18(amount18, 18);
      expect(raw).toBe(1500000000000000000n);
    });

    it('should handle zero amount', () => {
      expect(from18(0n, 6)).toBe(0n);
      expect(from18(0n, 18)).toBe(0n);
    });

    it('should round down when converting to fewer decimals', () => {
      // 1000.5001 in 18 decimals
      const amount18 = 1000500100000000000000n;
      const raw = from18(amount18, 6);
      expect(raw).toBe(1000500100n); // Keeps precision up to 6 decimals
    });
  });

  describe('applyRay', () => {
    const RAY = 10n ** 27n;

    it('should expand scaled debt with 5% interest (index = 1.05)', () => {
      const scaledDebt = 1000000000n; // 1000 USDC (6 decimals)
      const index = (105n * RAY) / 100n; // 1.05 * RAY
      const expanded = applyRay(scaledDebt, index);
      expect(expanded).toBe(1050000000n); // 1050 USDC
    });

    it('should handle index = 1.0 (no change)', () => {
      const value = 1000000000n;
      const index = RAY; // 1.0
      const result = applyRay(value, index);
      expect(result).toBe(1000000000n);
    });

    it('should handle 25% accrued interest (index = 1.25)', () => {
      const scaledDebt = 1000000000000000000000n; // 1000 DAI (18 decimals)
      const index = (125n * RAY) / 100n; // 1.25 * RAY
      const expanded = applyRay(scaledDebt, index);
      expect(expanded).toBe(1250000000000000000000n); // 1250 DAI
    });

    it('should handle zero value', () => {
      const index = (105n * RAY) / 100n;
      expect(applyRay(0n, index)).toBe(0n);
    });

    it('should handle zero index', () => {
      const value = 1000000000n;
      expect(applyRay(value, 0n)).toBe(0n);
    });

    it('should handle very high index (long-term accrual)', () => {
      const scaledDebt = 1000000000n; // 1000 USDC
      const index = 2n * RAY; // 2.0 (100% interest accrued)
      const expanded = applyRay(scaledDebt, index);
      expect(expanded).toBe(2000000000n); // 2000 USDC
    });
  });

  describe('usdValue', () => {
    it('should calculate USD value for USDC (6 decimals) at $1.00', () => {
      const amount = 1000500000n; // 1000.50 USDC
      const price = 100000000n; // $1.00 (8 decimals Chainlink)
      const usd = usdValue(amount, 6, price, 8);
      expect(usd).toBeCloseTo(1000.5, 2);
    });

    it('should calculate USD value for WETH (18 decimals) at $2500.00', () => {
      const amount = 1500000000000000000n; // 1.5 WETH
      const price = 250000000000n; // $2500.00 (8 decimals)
      const usd = usdValue(amount, 18, price, 8);
      expect(usd).toBeCloseTo(3750, 2);
    });

    it('should handle zero amount', () => {
      const price = 100000000n;
      expect(usdValue(0n, 6, price, 8)).toBe(0);
    });

    it('should handle zero price', () => {
      const amount = 1000000000n;
      expect(usdValue(amount, 6, 0n, 8)).toBe(0);
    });

    it('should calculate USD for DAI (18 decimals) at $0.9995', () => {
      const amount = 5000000000000000000000n; // 5000 DAI
      const price = 99950000n; // $0.9995 (8 decimals)
      const usd = usdValue(amount, 18, price, 8);
      expect(usd).toBeCloseTo(4997.5, 1);
    });

    it('should handle Aave oracle prices (8 decimals)', () => {
      const amount = 100000000n; // 100 USDC
      const price = 100000000n; // $1.00 from Aave oracle (8 decimals)
      const usd = usdValue(amount, 6, price, 8);
      expect(usd).toBeCloseTo(100, 2);
    });

    it('should handle cbBTC (8 decimals) at $50000', () => {
      const amount = 50000000n; // 0.5 BTC (8 decimals)
      const price = 5000000000000n; // $50000 (8 decimals)
      const usd = usdValue(amount, 8, price, 8);
      expect(usd).toBeCloseTo(25000, 1);
    });
  });

  describe('formatTokenAmount', () => {
    it('should format USDC amount with trailing zeros removed', () => {
      const amount = 1000500000n; // 1000.50 USDC
      expect(formatTokenAmount(amount, 6)).toBe('1000.5');
    });

    it('should format whole number without decimals', () => {
      const amount = 1000000000n; // 1000 USDC
      expect(formatTokenAmount(amount, 6)).toBe('1000');
    });

    it('should format WETH with appropriate precision', () => {
      const amount = 1500000000000000000n; // 1.5 WETH
      expect(formatTokenAmount(amount, 18)).toBe('1.5');
    });

    it('should format small amounts', () => {
      const amount = 123000000000000n; // 0.000123 WETH
      expect(formatTokenAmount(amount, 18)).toBe('0.000123');
    });

    it('should respect maxDecimals parameter', () => {
      const amount = 1234567890123456789n; // 1.234567890123456789 WETH
      expect(formatTokenAmount(amount, 18, 4)).toBe('1.2345');
    });

    it('should handle zero amount', () => {
      expect(formatTokenAmount(0n, 6)).toBe('0');
      expect(formatTokenAmount(0n, 18)).toBe('0');
    });
  });

  describe('baseToUsd', () => {
    it('should convert totalCollateralBase (ETH) to USD', () => {
      const collateralBase = 5000000000000000000n; // 5 ETH (18 decimals)
      const ethPrice = 250000000000n; // $2500 (8 decimals)
      const usd = baseToUsd(collateralBase, ethPrice, 8);
      expect(usd).toBeCloseTo(12500, 1);
    });

    it('should handle totalDebtBase conversion', () => {
      const debtBase = 2000000000000000000n; // 2 ETH worth of debt
      const ethPrice = 250000000000n; // $2500
      const usd = baseToUsd(debtBase, ethPrice, 8);
      expect(usd).toBeCloseTo(5000, 1);
    });

    it('should handle zero base amount', () => {
      const ethPrice = 250000000000n;
      expect(baseToUsd(0n, ethPrice, 8)).toBe(0);
    });

    it('should use default decimals (8) when not specified', () => {
      const collateralBase = 1000000000000000000n; // 1 ETH
      const ethPrice = 200000000000n; // $2000 (8 decimals)
      const usd = baseToUsd(collateralBase, ethPrice);
      expect(usd).toBeCloseTo(2000, 1);
    });
  });

  describe('validateAmount', () => {
    it('should accept valid amounts', () => {
      const result = validateAmount(1000.5, 'USDC');
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should reject negative amounts', () => {
      const result = validateAmount(-100, 'USDC');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Negative amount');
    });

    it('should reject suspiciously large amounts', () => {
      const result = validateAmount(1e10, 'USDC', 1e9);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Suspiciously large');
    });

    it('should reject infinite amounts', () => {
      const result = validateAmount(Infinity, 'USDC');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Non-finite');
    });

    it('should reject NaN amounts', () => {
      const result = validateAmount(NaN, 'USDC');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Non-finite');
    });

    it('should accept amounts just under the threshold', () => {
      const result = validateAmount(999999999, 'USDC', 1e9);
      expect(result.valid).toBe(true);
    });

    it('should accept zero', () => {
      const result = validateAmount(0, 'USDC');
      expect(result.valid).toBe(true);
    });
  });

  describe('DecimalConstants', () => {
    it('should export correct RAY constant', () => {
      expect(DecimalConstants.RAY).toBe(10n ** 27n);
    });

    it('should export correct WAD constant', () => {
      expect(DecimalConstants.WAD).toBe(10n ** 18n);
    });

    it('should export standard token decimals', () => {
      expect(DecimalConstants.USDC_DECIMALS).toBe(6);
      expect(DecimalConstants.WETH_DECIMALS).toBe(18);
      expect(DecimalConstants.DAI_DECIMALS).toBe(18);
    });

    it('should export price feed decimals', () => {
      expect(DecimalConstants.CHAINLINK_DECIMALS).toBe(8);
      expect(DecimalConstants.AAVE_BASE_DECIMALS).toBe(18);
    });
  });
});
