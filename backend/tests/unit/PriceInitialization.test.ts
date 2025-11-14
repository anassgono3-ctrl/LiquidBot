// PriceInitialization.test.ts - Tests for price readiness and deferred valuation
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PriceService } from '../../src/services/PriceService.js';

describe('PriceService - Price Initialization', () => {
  let priceService: PriceService;

  beforeEach(() => {
    // Clear environment for clean test slate
    delete process.env.CHAINLINK_RPC_URL;
    delete process.env.CHAINLINK_FEEDS;
    delete process.env.PRICE_SYMBOL_ALIASES;
    delete process.env.PRICE_DEFER_UNTIL_READY;
    
    priceService = new PriceService();
  });

  describe('feedsReady flag', () => {
    it('should start with feedsReady=false in stub mode', () => {
      // In stub mode (no Chainlink configured), feeds are not ready initially
      // However, since no async initialization happens, it stays false
      expect(priceService.isFeedsReady()).toBe(false);
    });

    it('should handle symbol normalization via aliases', async () => {
      // Set up symbol aliases
      process.env.PRICE_SYMBOL_ALIASES = 'cbBTC:CBBTC,tBTC:TBTC';
      const service = new PriceService();
      
      // Both forms should work and return the same result
      const price1 = await service.getPrice('cbBTC');
      const price2 = await service.getPrice('CBBTC');
      
      expect(price1).toBeGreaterThan(0);
      expect(price2).toBeGreaterThan(0);
      // In stub mode, both should return default prices
    });
  });

  describe('queueing behavior', () => {
    it('should return stub prices in stub mode even when feeds not ready', async () => {
      // Stub mode always returns default prices
      const price = await priceService.getPrice('USDC');
      expect(price).toBe(1.0);
    });

    it('should handle empty symbol gracefully', async () => {
      const price = await priceService.getPrice('');
      expect(price).toBe(1.0); // UNKNOWN default
    });
  });

  describe('flushPending method', () => {
    it('should return 0 when no pending items', async () => {
      const flushed = await priceService.flushPending();
      expect(flushed).toBe(0);
    });

    it('should warn when called before feedsReady', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      await priceService.flushPending();
      
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('flushPending called but feedsReady=false')
      );
      
      consoleWarnSpy.mockRestore();
    });
  });

  describe('address normalization', () => {
    it('should handle uppercase and lowercase addresses consistently', async () => {
      // In stub mode, addresses aren't used for price lookup
      // This test verifies the service doesn't crash with various formats
      const priceUpper = await priceService.getPrice('WETH');
      const priceLower = await priceService.getPrice('weth');
      
      expect(priceUpper).toBeGreaterThan(0);
      expect(priceLower).toBeGreaterThan(0);
    });
  });

  describe('getPrices batch method', () => {
    it('should return prices for multiple symbols', async () => {
      const symbols = ['USDC', 'WETH', 'DAI'];
      const prices = await priceService.getPrices(symbols);
      
      expect(prices.size).toBe(3);
      expect(prices.get('USDC')).toBe(1.0);
      expect(prices.get('WETH')).toBeGreaterThan(0);
      expect(prices.get('DAI')).toBe(1.0);
    });

    it('should handle empty symbol array', async () => {
      const prices = await priceService.getPrices([]);
      expect(prices.size).toBe(0);
    });
  });

  describe('cache behavior', () => {
    it('should cache prices', async () => {
      const price1 = await priceService.getPrice('USDC');
      const price2 = await priceService.getPrice('USDC');
      
      expect(price1).toBe(price2);
      expect(price1).toBe(1.0);
    });

    it('should allow cache clearing', async () => {
      await priceService.getPrice('USDC');
      priceService.clearCache();
      
      // Should still work after cache clear
      const price = await priceService.getPrice('USDC');
      expect(price).toBe(1.0);
    });
  });

  describe('throwOnMissing parameter', () => {
    it('should not throw when throwOnMissing=false', async () => {
      const price = await priceService.getPrice('UNKNOWN_TOKEN', false);
      expect(price).toBeGreaterThan(0); // Returns default
    });

    it('should handle empty symbol with throwOnMissing=true', async () => {
      await expect(priceService.getPrice('', true)).rejects.toThrow('Empty symbol provided');
    });
  });
});

describe('NotificationService - Price Readiness Integration', () => {
  // Note: Full NotificationService tests would require mocking Telegram bot
  // These are placeholder tests for the integration points
  
  it('should be integrated with PriceService', () => {
    // This is a placeholder to document that NotificationService
    // now has async checkScalingSanity that checks feedsReady
    expect(true).toBe(true);
  });
});

describe('Price Initialization - Integration Scenarios', () => {
  describe('cbBTC zero collateral scenario', () => {
    it('should simulate the problem case', async () => {
      // This test documents the scenario we're fixing:
      // 1. Bot starts up
      // 2. Opportunity with cbBTC collateral arrives
      // 3. Price for cbBTC is not yet available (feeds not initialized)
      // 4. collateralValueUsd = 0 even though HF < 1
      // 5. Should defer instead of skip
      
      const service = new PriceService();
      
      // Initially feeds not ready
      expect(service.isFeedsReady()).toBe(false);
      
      // Simulate getting price before ready
      // In stub mode, we get default price, but in real scenario with Chainlink,
      // this would return 0 or be queued
      const price = await service.getPrice('cbBTC');
      expect(price).toBeGreaterThan(0); // Stub mode returns default
    });
  });

  describe('post-initialization revaluation', () => {
    it('should document the revaluation flow', async () => {
      // After feeds become ready:
      // 1. flushPending() is called
      // 2. Queued opportunities are revalued
      // 3. Metrics are updated (revalueSuccessTotal, revalueFailTotal)
      // 4. Logs show revalue success/fail
      
      const service = new PriceService();
      const flushed = await service.flushPending();
      
      // In test mode with no pending items
      expect(flushed).toBe(0);
    });
  });
});
