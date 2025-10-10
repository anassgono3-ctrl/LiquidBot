import { describe, it, expect } from 'vitest';

import { resolveTokenAddress, isStablecoin, getTokenInfo } from '../../src/config/tokens.js';

describe('Token Address Resolution', () => {
  describe('resolveTokenAddress', () => {
    it('should resolve USDC symbol to address', () => {
      const address = resolveTokenAddress('USDC');
      expect(address).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    });

    it('should resolve WETH symbol to address', () => {
      const address = resolveTokenAddress('WETH');
      expect(address).toBe('0x4200000000000000000000000000000000000006');
    });

    it('should be case-insensitive', () => {
      const address1 = resolveTokenAddress('usdc');
      const address2 = resolveTokenAddress('USDC');
      const address3 = resolveTokenAddress('UsDc');
      expect(address1).toBe(address2);
      expect(address2).toBe(address3);
    });

    it('should pass through valid addresses', () => {
      const address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
      expect(resolveTokenAddress(address)).toBe(address);
    });

    it('should throw for unknown symbols', () => {
      expect(() => resolveTokenAddress('UNKNOWN')).toThrow('Unknown token symbol');
    });

    it('should throw for empty input', () => {
      expect(() => resolveTokenAddress('')).toThrow('Token symbol or address is required');
    });
  });

  describe('isStablecoin', () => {
    it('should identify USDC as stablecoin', () => {
      expect(isStablecoin('USDC')).toBe(true);
    });

    it('should identify USDT as stablecoin', () => {
      expect(isStablecoin('USDT')).toBe(true);
    });

    it('should identify DAI as stablecoin', () => {
      expect(isStablecoin('DAI')).toBe(true);
    });

    it('should identify WETH as not stablecoin', () => {
      expect(isStablecoin('WETH')).toBe(false);
    });

    it('should work with addresses', () => {
      expect(isStablecoin('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')).toBe(true); // USDC
      expect(isStablecoin('0x4200000000000000000000000000000000000006')).toBe(false); // WETH
    });

    it('should return false for unknown tokens', () => {
      expect(isStablecoin('UNKNOWN')).toBe(false);
      expect(isStablecoin('0x1111111111111111111111111111111111111111')).toBe(false);
    });
  });

  describe('getTokenInfo', () => {
    it('should return token info by symbol', () => {
      const info = getTokenInfo('USDC');
      expect(info).toBeDefined();
      expect(info?.symbol).toBe('USDC');
      expect(info?.decimals).toBe(6);
      expect(info?.isStablecoin).toBe(true);
    });

    it('should return token info by address', () => {
      const info = getTokenInfo('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
      expect(info).toBeDefined();
      expect(info?.symbol).toBe('USDC');
    });

    it('should return null for unknown tokens', () => {
      expect(getTokenInfo('UNKNOWN')).toBeNull();
      expect(getTokenInfo('0x1111111111111111111111111111111111111111')).toBeNull();
    });
  });
});
