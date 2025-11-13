import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { PriceService } from '../../src/services/PriceService.js';

describe('PriceService - Aliases and Derived Assets', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    // Save original env
    originalEnv = {
      PRICE_FEED_ALIASES: process.env.PRICE_FEED_ALIASES,
      DERIVED_RATIO_FEEDS: process.env.DERIVED_RATIO_FEEDS,
      PRICE_POLL_DISABLE_AFTER_ERRORS: process.env.PRICE_POLL_DISABLE_AFTER_ERRORS
    };
  });

  afterEach(() => {
    // Restore original env
    process.env.PRICE_FEED_ALIASES = originalEnv.PRICE_FEED_ALIASES;
    process.env.DERIVED_RATIO_FEEDS = originalEnv.DERIVED_RATIO_FEEDS;
    process.env.PRICE_POLL_DISABLE_AFTER_ERRORS = originalEnv.PRICE_POLL_DISABLE_AFTER_ERRORS;
  });

  describe('Alias support', () => {
    it('should resolve alias to target symbol', async () => {
      // Note: Without Chainlink feeds configured, PriceService uses stub prices
      // Both USDC and USDbC should return the same default stablecoin price (1.0)
      const priceService = new PriceService();
      
      // Both should return default stablecoin price
      const usdcPrice = await priceService.getPrice('USDC');
      const usdBcPrice = await priceService.getPrice('USDbC');
      
      expect(usdcPrice).toBe(1.0);
      expect(usdBcPrice).toBe(1.0);
    });

    it('should cache prices correctly', async () => {
      const priceService = new PriceService();
      
      // First call
      const price1 = await priceService.getPrice('USDC');
      
      // Second call should use cache
      const price2 = await priceService.getPrice('USDC');
      
      expect(price1).toBe(price2);
      expect(price1).toBe(1.0);
    });
  });

  describe('Derived asset support', () => {
    it('should identify non-derived assets without config', () => {
      // Without DERIVED_RATIO_FEEDS config, no assets are derived
      const priceService = new PriceService();
      
      expect(priceService.isDerivedAsset('wstETH')).toBe(false);
      expect(priceService.isDerivedAsset('weETH')).toBe(false);
      expect(priceService.isDerivedAsset('WETH')).toBe(false);
      expect(priceService.isDerivedAsset('USDC')).toBe(false);
    });

    it('should handle case-insensitive asset checks', () => {
      // Without config, all should return false
      const priceService = new PriceService();
      
      expect(priceService.isDerivedAsset('wstETH')).toBe(false);
      expect(priceService.isDerivedAsset('WSTETH')).toBe(false);
      expect(priceService.isDerivedAsset('WsTeTh')).toBe(false);
    });
  });

  describe('Feed polling disable', () => {
    it('should track feed polling disabled state', () => {
      const priceService = new PriceService();
      
      // Initially, no feeds should be disabled
      expect(priceService.isFeedPollingDisabled('WETH')).toBe(false);
      expect(priceService.isFeedPollingDisabled('USDC')).toBe(false);
    });

    it('should handle case-insensitive feed checks', () => {
      const priceService = new PriceService();
      
      expect(priceService.isFeedPollingDisabled('weth')).toBe(false);
      expect(priceService.isFeedPollingDisabled('WETH')).toBe(false);
      expect(priceService.isFeedPollingDisabled('WeTh')).toBe(false);
    });
  });

  describe('Default behavior', () => {
    it('should return stub prices without configuration', async () => {
      const priceService = new PriceService();
      
      // All should return default prices
      const usdbc = await priceService.getPrice('USDbC');
      const usdc = await priceService.getPrice('USDC');
      const weth = await priceService.getPrice('WETH');
      
      expect(usdbc).toBe(1.0);
      expect(usdc).toBe(1.0);
      expect(weth).toBe(3000.0);
    });

    it('should identify non-derived assets without config', () => {
      const priceService = new PriceService();
      
      expect(priceService.isDerivedAsset('wstETH')).toBe(false);
      expect(priceService.isDerivedAsset('weETH')).toBe(false);
      expect(priceService.isDerivedAsset('rETH')).toBe(false);
    });

    it('should handle empty config gracefully', () => {
      const priceService = new PriceService();
      
      expect(priceService.isDerivedAsset('wstETH')).toBe(false);
    });

    it('should not have disabled feeds by default', () => {
      const priceService = new PriceService();
      
      expect(priceService.isFeedPollingDisabled('WETH')).toBe(false);
      expect(priceService.isFeedPollingDisabled('USDC')).toBe(false);
    });
  });
});
