// Unit tests for Chainlink price normalization utilities
import { describe, it, expect } from 'vitest';

import {
  normalizeChainlinkPrice,
  safeNormalizeChainlinkPrice,
  formatChainlinkPrice
} from '../../src/utils/chainlinkMath.js';

describe('chainlinkMath', () => {
  describe('normalizeChainlinkPrice', () => {
    it('should normalize 8-decimal Chainlink price correctly', () => {
      // ETH/USD: $3000.50
      const answer = 300050000000n; // 3000.50 * 1e8
      const price = normalizeChainlinkPrice(answer, 8);
      expect(price).toBe(3000.5);
    });

    it('should normalize 18-decimal price correctly', () => {
      // Price with 18 decimals: $1.5
      const answer = 1500000000000000000n; // 1.5 * 1e18
      const price = normalizeChainlinkPrice(answer, 18);
      expect(price).toBe(1.5);
    });

    it('should handle integer prices', () => {
      // BTC/USD: $60000
      const answer = 6000000000000n; // 60000 * 1e8
      const price = normalizeChainlinkPrice(answer, 8);
      expect(price).toBe(60000);
    });

    it('should handle very small prices', () => {
      // Small token: $0.000123
      const answer = 12300n; // 0.000123 * 1e8
      const price = normalizeChainlinkPrice(answer, 8);
      expect(price).toBeCloseTo(0.000123, 6);
    });

    it('should handle prices with 6 decimals', () => {
      // USDC feed (hypothetical 6 decimals): $1.00
      const answer = 1000000n; // 1.0 * 1e6
      const price = normalizeChainlinkPrice(answer, 6);
      expect(price).toBe(1.0);
    });

    it('should throw on zero answer', () => {
      expect(() => normalizeChainlinkPrice(0n, 8)).toThrow('Invalid Chainlink answer');
    });

    it('should throw on negative answer', () => {
      expect(() => normalizeChainlinkPrice(-100n, 8)).toThrow('Invalid Chainlink answer');
    });

    it('should throw on invalid decimals', () => {
      expect(() => normalizeChainlinkPrice(100n, -1)).toThrow('Invalid decimals');
      expect(() => normalizeChainlinkPrice(100n, 19)).toThrow('Invalid decimals');
    });
  });

  describe('safeNormalizeChainlinkPrice', () => {
    it('should return price for valid input', () => {
      const answer = 300050000000n;
      const price = safeNormalizeChainlinkPrice(answer, 8);
      expect(price).toBe(3000.5);
    });

    it('should return null for invalid answer', () => {
      const price = safeNormalizeChainlinkPrice(0n, 8);
      expect(price).toBeNull();
    });

    it('should return null for invalid decimals', () => {
      const price = safeNormalizeChainlinkPrice(100n, -1);
      expect(price).toBeNull();
    });
  });

  describe('formatChainlinkPrice', () => {
    it('should format price with default decimals', () => {
      const answer = 300050000000n; // $3000.50
      const formatted = formatChainlinkPrice(answer, 8);
      expect(formatted).toBe('3000.50000000');
    });

    it('should format price with custom decimals', () => {
      const answer = 300050000000n; // $3000.50
      const formatted = formatChainlinkPrice(answer, 8, 2);
      expect(formatted).toBe('3000.50');
    });

    it('should format large price correctly', () => {
      const answer = 6000000000000n; // $60000.00
      const formatted = formatChainlinkPrice(answer, 8, 2);
      expect(formatted).toBe('60000.00');
    });

    it('should format small price correctly', () => {
      const answer = 12300n; // $0.000123
      const formatted = formatChainlinkPrice(answer, 8, 6);
      expect(formatted).toBe('0.000123');
    });
  });

  describe('edge cases', () => {
    it('should handle maximum safe BigInt values', () => {
      // Very large price (edge case)
      const answer = BigInt('999999999999999999'); // ~10 billion with 8 decimals
      const price = normalizeChainlinkPrice(answer, 8);
      expect(price).toBeGreaterThan(0);
      expect(isFinite(price)).toBe(true);
    });

    it('should maintain precision for prices with many decimal places', () => {
      // Price: $1234.56789012 (8 decimals)
      const answer = 123456789012n;
      const price = normalizeChainlinkPrice(answer, 8);
      expect(price).toBeCloseTo(1234.56789012, 8);
    });
  });
});
