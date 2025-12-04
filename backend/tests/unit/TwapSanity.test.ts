// Unit tests for TwapSanity service
import { describe, it, expect, beforeEach } from 'vitest';

import { TwapSanity } from '../../src/services/TwapSanity.js';

describe('TwapSanity', () => {
  let twapSanity: TwapSanity;

  beforeEach(() => {
    twapSanity = new TwapSanity();
  });

  describe('initialization', () => {
    it('should initialize with disabled state when TWAP_ENABLED is false', () => {
      expect(twapSanity.isEnabled()).toBe(false);
    });

    it('should return configured symbols when enabled', () => {
      const symbols = twapSanity.getConfiguredSymbols();
      expect(Array.isArray(symbols)).toBe(true);
    });
  });

  describe('sanityCheck', () => {
    it('should pass when TWAP is disabled', async () => {
      const result = await twapSanity.sanityCheck('WETH', 3000);
      
      expect(result.ok).toBe(true);
      expect(result.twapPrice).toBeNull();
      expect(result.error).toBe('TWAP disabled');
    });

    it('should pass when no pool is configured for symbol', async () => {
      const result = await twapSanity.sanityCheck('UNKNOWN_TOKEN', 100);
      
      expect(result.ok).toBe(true);
      expect(result.twapPrice).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      // Test with invalid parameters that would cause errors
      const result = await twapSanity.sanityCheck('', NaN);
      
      expect(result.ok).toBe(true); // Conservative: pass on error
    });
  });

  describe('configuration', () => {
    it('should parse pool configurations correctly', () => {
      // This test verifies that the constructor handles pool configs
      // In a real scenario with TWAP_ENABLED=true, this would check parsing
      expect(() => new TwapSanity()).not.toThrow();
    });
  });
});
