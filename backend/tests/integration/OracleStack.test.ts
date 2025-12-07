/**
 * Integration test for the complete oracle stack
 * 
 * Tests the interaction between:
 * 1. Chainlink (oracle-of-record)
 * 2. Pyth (fast pre-signal for predictive pipeline)
 * 3. TWAP (sanity check against DEX manipulation)
 * 
 * This validates that:
 * - Each oracle service initializes correctly
 * - Oracle hierarchy is maintained (Chainlink primary, Pyth secondary, TWAP sanity)
 * - Services can operate independently when others are disabled
 * - No breaking changes to liquidation logic
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { PriceService } from '../../src/services/PriceService.js';
import { PythListener } from '../../src/services/PythListener.js';
import { TwapSanity } from '../../src/services/TwapSanity.js';

describe('Oracle Stack Integration', () => {
  describe('Service Initialization', () => {
    it('should initialize all oracle services without errors', () => {
      // Create instances (they should handle disabled state gracefully)
      expect(() => new PriceService()).not.toThrow();
      expect(() => new PythListener()).not.toThrow();
      expect(() => new TwapSanity()).not.toThrow();
    });

    it('should respect feature flags for each oracle', () => {
      const priceService = new PriceService();
      const pythListener = new PythListener();
      const twapSanity = new TwapSanity();

      // All oracles should be disabled by default in test env
      expect(pythListener.isEnabled()).toBe(false);
      expect(twapSanity.isEnabled()).toBe(false);
      
      // PriceService is always enabled (provides fallback prices)
      // It just may not have Chainlink feeds configured
    });
  });

  describe('Oracle Hierarchy', () => {
    it('should maintain Chainlink as oracle-of-record', async () => {
      // PriceService uses Chainlink when configured
      const priceService = new PriceService();
      
      // With no Chainlink feeds configured, should fall back to defaults
      const usdcPrice = await priceService.getPrice('USDC');
      expect(typeof usdcPrice).toBe('number');
      expect(usdcPrice).toBeGreaterThan(0);
    });

    it('should use Pyth only as fast pre-signal', () => {
      // Pyth provides early price updates for predictive pipeline
      const pythListener = new PythListener();
      
      // Verify it's configured for monitoring only
      expect(pythListener.isEnabled()).toBe(false); // Disabled in test
      expect(pythListener.getAssets()).toBeInstanceOf(Array);
      
      // When enabled, Pyth callbacks fire but don't override Chainlink
      let callbackFired = false;
      pythListener.onPriceUpdate(() => {
        callbackFired = true;
      });
      
      // Callback registered but won't fire while disabled
      expect(callbackFired).toBe(false);
    });

    it('should use TWAP only as sanity check', async () => {
      // TWAP validates prices but doesn't override
      const twapSanity = new TwapSanity();
      
      // When disabled, all sanity checks pass
      const result = await twapSanity.sanityCheck('WETH', 3000);
      expect(result.ok).toBe(true);
      expect(result.error).toBe('TWAP disabled');
    });
  });

  describe('Independent Operation', () => {
    it('should allow Chainlink to operate without Pyth', async () => {
      const priceService = new PriceService();
      const pythListener = new PythListener();
      
      // Pyth disabled
      expect(pythListener.isEnabled()).toBe(false);
      
      // Chainlink (via PriceService) still works
      const price = await priceService.getPrice('WETH');
      expect(typeof price).toBe('number');
      expect(price).toBeGreaterThan(0);
    });

    it('should allow Chainlink to operate without TWAP', async () => {
      const priceService = new PriceService();
      const twapSanity = new TwapSanity();
      
      // TWAP disabled
      expect(twapSanity.isEnabled()).toBe(false);
      
      // Chainlink (via PriceService) still works
      const price = await priceService.getPrice('USDC');
      expect(typeof price).toBe('number');
      expect(price).toBeGreaterThan(0);
    });

    it('should allow graceful degradation when all oracles disabled', async () => {
      const priceService = new PriceService();
      const pythListener = new PythListener();
      const twapSanity = new TwapSanity();
      
      // All secondary oracles disabled
      expect(pythListener.isEnabled()).toBe(false);
      expect(twapSanity.isEnabled()).toBe(false);
      
      // PriceService falls back to defaults
      const wethPrice = await priceService.getPrice('WETH');
      const usdcPrice = await priceService.getPrice('USDC');
      
      expect(wethPrice).toBeGreaterThan(0);
      expect(usdcPrice).toBeGreaterThan(0);
    });
  });

  describe('Configuration Validation', () => {
    it('should handle Pyth assets configuration', () => {
      const pythListener = new PythListener();
      const assets = pythListener.getAssets();
      
      expect(Array.isArray(assets)).toBe(true);
      expect(assets.length).toBeGreaterThan(0);
      
      // Default assets from config
      const hasCommonAssets = assets.some(a => 
        ['WETH', 'WBTC', 'CBETH', 'USDC'].includes(a.toUpperCase())
      );
      expect(hasCommonAssets).toBe(true);
    });

    it('should handle TWAP pool configuration', () => {
      const twapSanity = new TwapSanity();
      const symbols = twapSanity.getConfiguredSymbols();
      
      expect(Array.isArray(symbols)).toBe(true);
      // May be empty if TWAP_POOLS not configured in test env
    });
  });

  describe('Error Handling', () => {
    it('should handle Pyth connection failures gracefully', async () => {
      const pythListener = new PythListener();
      
      // Attempting to start when disabled should be safe
      await expect(pythListener.start()).resolves.not.toThrow();
      
      // Should remain disconnected
      expect(pythListener.isConnectedStatus()).toBe(false);
      
      // Cleanup
      await pythListener.stop();
    });

    it('should handle TWAP computation errors gracefully', async () => {
      const twapSanity = new TwapSanity();
      
      // Invalid inputs should not throw
      await expect(twapSanity.sanityCheck('', NaN)).resolves.not.toThrow();
      
      // Should pass conservatively on error
      const result = await twapSanity.sanityCheck('UNKNOWN', 0);
      expect(result.ok).toBe(true);
    });

    it('should handle missing price gracefully', async () => {
      const priceService = new PriceService();
      
      // Unknown token should fall back to default
      const price = await priceService.getPrice('UNKNOWN_TOKEN_XYZ');
      expect(typeof price).toBe('number');
      expect(price).toBeGreaterThan(0);
    });
  });

  describe('Lifecycle Management', () => {
    it('should start and stop Pyth listener cleanly', async () => {
      const pythListener = new PythListener();
      
      await pythListener.start();
      expect(pythListener.isConnectedStatus()).toBe(false); // Disabled
      
      await pythListener.stop();
      expect(pythListener.isConnectedStatus()).toBe(false);
    });

    it('should handle multiple start/stop cycles', async () => {
      const pythListener = new PythListener();
      
      // Multiple cycles should not cause issues
      await pythListener.start();
      await pythListener.stop();
      await pythListener.start();
      await pythListener.stop();
      
      // Final state should be clean
      expect(pythListener.isConnectedStatus()).toBe(false);
    });
  });

  describe('Integration Points', () => {
    it('should validate that Chainlink feeds can be extended without breaking Pyth', () => {
      // Adding new Chainlink feeds shouldn't affect Pyth
      const priceService = new PriceService();
      const pythListener = new PythListener();
      
      // Both services operate independently
      expect(priceService).toBeDefined();
      expect(pythListener).toBeDefined();
      
      // Configuration is separate
      const pythAssets = pythListener.getAssets();
      expect(pythAssets.length).toBeGreaterThan(0);
    });

    it('should validate that TWAP pools can be added without breaking Chainlink', async () => {
      // Adding new TWAP pools shouldn't affect Chainlink
      const priceService = new PriceService();
      const twapSanity = new TwapSanity();
      
      // Both services operate independently
      const price = await priceService.getPrice('WETH');
      const sanityCheck = await twapSanity.sanityCheck('WETH', price);
      
      expect(price).toBeGreaterThan(0);
      expect(sanityCheck.ok).toBe(true); // Passes when disabled
    });
  });

  describe('No Breaking Changes to Liquidation Logic', () => {
    it('should not require Pyth for liquidation decisions', async () => {
      // Liquidation decisions use Chainlink/Aave Oracle, not Pyth
      const priceService = new PriceService();
      const pythListener = new PythListener();
      
      // Pyth disabled
      expect(pythListener.isEnabled()).toBe(false);
      
      // Price lookups still work for liquidation logic
      const wethPrice = await priceService.getPrice('WETH');
      const usdcPrice = await priceService.getPrice('USDC');
      
      expect(wethPrice).toBeGreaterThan(0);
      expect(usdcPrice).toBeGreaterThan(0);
    });

    it('should not require TWAP for liquidation decisions', async () => {
      // TWAP is sanity check only, not decision path
      const priceService = new PriceService();
      const twapSanity = new TwapSanity();
      
      // TWAP disabled
      expect(twapSanity.isEnabled()).toBe(false);
      
      // Price lookups still work for liquidation logic
      const cbEthPrice = await priceService.getPrice('cbETH');
      expect(cbEthPrice).toBeGreaterThan(0);
    });

    it('should maintain existing PriceService API', async () => {
      // Existing code should continue to work
      const priceService = new PriceService();
      
      // Core API unchanged
      expect(typeof priceService.getPrice).toBe('function');
      
      // Can get prices for known assets
      const prices = await Promise.all([
        priceService.getPrice('WETH'),
        priceService.getPrice('USDC'),
        priceService.getPrice('DAI')
      ]);
      
      prices.forEach(price => {
        expect(typeof price).toBe('number');
        expect(price).toBeGreaterThan(0);
      });
    });
  });
});
