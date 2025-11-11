// Unit tests for PriceService ratio feed composition
import { describe, it, expect } from 'vitest';

import { PriceService } from '../../src/services/PriceService.js';

describe('PriceService - Ratio Feeds', () => {
  let priceService: PriceService;

  // Note: These tests run in stub mode since we don't have a real RPC provider configured in tests
  // The purpose is to validate the code structure and fallback behavior
  
  priceService = new PriceService();

  describe('service initialization', () => {
    it('should initialize PriceService successfully', () => {
      expect(priceService).toBeDefined();
    });

    it('should have default prices for known tokens', async () => {
      const ethPrice = await priceService.getPrice('WETH');
      expect(ethPrice).toBeGreaterThan(0);
    });
  });

  describe('fallback behavior', () => {
    it('should return stub price for unknown wrapped tokens in test mode', async () => {
      // In test mode (no RPC configured), should fall back to stub prices
      const price = await priceService.getPrice('WSTETH');
      
      // Should return default UNKNOWN price (1.0)
      expect(price).toBe(1.0);
    });

    it('should cache prices', async () => {
      const price1 = await priceService.getPrice('USDC');
      const price2 = await priceService.getPrice('USDC');
      
      expect(price1).toBe(price2);
    });
  });

  describe('error handling', () => {
    it('should handle empty symbol gracefully', async () => {
      const price = await priceService.getPrice('');
      expect(price).toBe(1.0); // Default UNKNOWN price
    });

    it('should handle case-insensitive symbols', async () => {
      const upperPrice = await priceService.getPrice('WSTETH');
      const lowerPrice = await priceService.getPrice('wsteth');
      
      expect(upperPrice).toBe(lowerPrice);
    });
  });

  describe('throwOnMissing parameter', () => {
    it('should not throw by default when price is missing', async () => {
      await expect(priceService.getPrice('UNKNOWN_TOKEN')).resolves.toBeDefined();
    });

    it('should return fallback value when throwOnMissing is false', async () => {
      const price = await priceService.getPrice('UNKNOWN_TOKEN', false);
      expect(price).toBe(1.0);
    });
  });
});
