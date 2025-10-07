// Unit tests for PriceService
import { describe, it, expect, beforeEach } from 'vitest';

import { PriceService } from '../../src/services/PriceService.js';

describe('PriceService', () => {
  let priceService: PriceService;

  beforeEach(() => {
    priceService = new PriceService();
  });

  describe('getPrice', () => {
    it('should return 1.0 for stablecoins', async () => {
      const usdcPrice = await priceService.getPrice('USDC');
      const usdtPrice = await priceService.getPrice('USDT');
      const daiPrice = await priceService.getPrice('DAI');

      expect(usdcPrice).toBe(1.0);
      expect(usdtPrice).toBe(1.0);
      expect(daiPrice).toBe(1.0);
    });

    it('should return default prices for known tokens', async () => {
      const wethPrice = await priceService.getPrice('WETH');
      const wbtcPrice = await priceService.getPrice('WBTC');

      expect(wethPrice).toBeGreaterThan(0);
      expect(wbtcPrice).toBeGreaterThan(0);
      expect(wbtcPrice).toBeGreaterThan(wethPrice); // BTC typically > ETH
    });

    it('should handle case-insensitive symbols', async () => {
      const upperCase = await priceService.getPrice('USDC');
      const lowerCase = await priceService.getPrice('usdc');
      const mixedCase = await priceService.getPrice('UsDc');

      expect(upperCase).toBe(lowerCase);
      expect(lowerCase).toBe(mixedCase);
    });

    it('should return default price for unknown tokens', async () => {
      const unknownPrice = await priceService.getPrice('UNKNOWN_TOKEN');
      expect(unknownPrice).toBe(1.0);
    });

    it('should return default price for empty symbol', async () => {
      const emptyPrice = await priceService.getPrice('');
      expect(emptyPrice).toBe(1.0);
    });

    it('should cache prices', async () => {
      const price1 = await priceService.getPrice('USDC');
      const price2 = await priceService.getPrice('USDC');

      expect(price1).toBe(price2);
    });
  });

  describe('getPrices', () => {
    it('should return prices for multiple symbols', async () => {
      const symbols = ['USDC', 'WETH', 'DAI'];
      const prices = await priceService.getPrices(symbols);

      expect(prices.size).toBe(3);
      expect(prices.get('USDC')).toBe(1.0);
      expect(prices.get('WETH')).toBeGreaterThan(0);
      expect(prices.get('DAI')).toBe(1.0);
    });

    it('should handle empty array', async () => {
      const prices = await priceService.getPrices([]);
      expect(prices.size).toBe(0);
    });
  });

  describe('clearCache', () => {
    it('should clear the price cache', async () => {
      await priceService.getPrice('USDC');
      priceService.clearCache();
      
      // Cache should be empty, but price should still be returned
      const price = await priceService.getPrice('USDC');
      expect(price).toBe(1.0);
    });
  });
});
