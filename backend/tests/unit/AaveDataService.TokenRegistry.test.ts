/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ethers } from 'ethers';

import { AaveDataService } from '../../src/services/AaveDataService.js';
import { TokenMetadataRegistry } from '../../src/services/TokenMetadataRegistry.js';

describe('AaveDataService - TokenMetadataRegistry Integration', () => {
  let mockProvider: ethers.JsonRpcProvider;
  let mockAaveMetadata: any;
  let tokenRegistry: TokenMetadataRegistry;
  let aaveDataService: AaveDataService;
  let consoleSpy: any;

  /**
   * Helper function to get the private getSymbolForAsset method
   */
  function getSymbolForAsset(service: AaveDataService, address: string): Promise<string> {
    return (service as any).getSymbolForAsset.call(service, address);
  }

  beforeEach(() => {
    // Create mock provider
    mockProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 8453n })
    } as unknown as ethers.JsonRpcProvider;

    // Create mock AaveMetadata
    mockAaveMetadata = {
      getReserve: vi.fn()
    };

    // Create TokenMetadataRegistry with mocks
    tokenRegistry = new TokenMetadataRegistry({
      provider: mockProvider,
      aaveMetadata: mockAaveMetadata
    });

    // Create AaveDataService
    aaveDataService = new AaveDataService(mockProvider, mockAaveMetadata);
    
    // Wire TokenMetadataRegistry into AaveDataService
    aaveDataService.setTokenRegistry(tokenRegistry);
  });

  afterEach(() => {
    // Restore all console spies
    if (consoleSpy) {
      consoleSpy.mockRestore();
      consoleSpy = null;
    }
  });

  describe('Symbol Resolution via TokenMetadataRegistry', () => {
    it('should resolve USDC via override without symbol_missing warning', async () => {
      const usdcAddress = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
      
      // Mock AaveMetadata doesn't have USDC
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      // Spy on console to verify logging behavior
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleSpy = { mockRestore: () => { warnSpy.mockRestore(); logSpy.mockRestore(); } };

      const symbol = await getSymbolForAsset(aaveDataService, usdcAddress);

      expect(symbol).toBe('USDC');
      
      // Should log resolution via override
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_resolved via override')
      );
      
      // Should NOT emit symbol_missing warning
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );
    });

    it('should resolve cbBTC via override without symbol_missing warning', async () => {
      const cbBTCAddress = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleSpy = { mockRestore: () => { warnSpy.mockRestore(); logSpy.mockRestore(); } };

      const symbol = await getSymbolForAsset(aaveDataService, cbBTCAddress);

      expect(symbol).toBe('cbBTC');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_resolved via override')
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );
    });

    it('should resolve weETH via override without symbol_missing warning', async () => {
      const weETHAddress = '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleSpy = { mockRestore: () => { warnSpy.mockRestore(); logSpy.mockRestore(); } };

      const symbol = await getSymbolForAsset(aaveDataService, weETHAddress);

      expect(symbol).toBe('weETH');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_resolved via override')
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );
    });

    it('should resolve wstETH via override without symbol_missing warning', async () => {
      const wstETHAddress = '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleSpy = { mockRestore: () => { warnSpy.mockRestore(); logSpy.mockRestore(); } };

      const symbol = await getSymbolForAsset(aaveDataService, wstETHAddress);

      expect(symbol).toBe('wstETH');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_resolved via override')
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );
    });

    it('should resolve cbETH via override without symbol_missing warning', async () => {
      const cbETHAddress = '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleSpy = { mockRestore: () => { warnSpy.mockRestore(); logSpy.mockRestore(); } };

      const symbol = await getSymbolForAsset(aaveDataService, cbETHAddress);

      expect(symbol).toBe('cbETH');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_resolved via override')
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );
    });

    it('should resolve AAVE via override without symbol_missing warning', async () => {
      const aaveAddress = '0x63706e401c06ac8513145b7687a14804d17f814b';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleSpy = { mockRestore: () => { warnSpy.mockRestore(); logSpy.mockRestore(); } };

      const symbol = await getSymbolForAsset(aaveDataService, aaveAddress);

      expect(symbol).toBe('AAVE');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_resolved via override')
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );
    });

    it('should resolve EURC via override without symbol_missing warning', async () => {
      const eurcAddress = '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleSpy = { mockRestore: () => { warnSpy.mockRestore(); logSpy.mockRestore(); } };

      const symbol = await getSymbolForAsset(aaveDataService, eurcAddress);

      expect(symbol).toBe('EURC');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_resolved via override')
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );
    });

    it('should resolve USDbC via override without symbol_missing warning', async () => {
      const usdBCAddress = '0x9506a02b003d7a7eaf86579863a29601528ca0be';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleSpy = { mockRestore: () => { warnSpy.mockRestore(); logSpy.mockRestore(); } };

      const symbol = await getSymbolForAsset(aaveDataService, usdBCAddress);

      expect(symbol).toBe('USDbC');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_resolved via override')
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );
    });

    it('should normalize addresses to lowercase during resolution', async () => {
      const mixedCaseAddress = '0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913'; // USDC mixed case
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const symbol = await getSymbolForAsset(aaveDataService, mixedCaseAddress);

      expect(symbol).toBe('USDC');
      
      // Verify AaveMetadata was called with lowercase
      expect(mockAaveMetadata.getReserve).toHaveBeenCalledWith(mixedCaseAddress.toLowerCase());
    });

    it('should prioritize base metadata over overrides', async () => {
      const usdcAddress = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
      
      // Mock base metadata having USDC with a custom symbol
      mockAaveMetadata.getReserve.mockReturnValue({
        symbol: 'CUSTOM_USDC',
        decimals: 6
      });

      const symbol = await getSymbolForAsset(aaveDataService, usdcAddress);

      // Should use base metadata, not override
      expect(symbol).toBe('CUSTOM_USDC');
    });

    it('should cache resolved symbols for subsequent calls', async () => {
      const usdcAddress = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleSpy = logSpy;

      // First call
      const symbol1 = await getSymbolForAsset(aaveDataService, usdcAddress);
      expect(symbol1).toBe('USDC');
      expect(logSpy).toHaveBeenCalledTimes(1);
      
      logSpy.mockClear();
      
      // Second call - should use cache (no additional log due to warn-once behavior)
      const symbol2 = await getSymbolForAsset(aaveDataService, usdcAddress);
      expect(symbol2).toBe('USDC');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('should handle unknown addresses with on-chain fallback', async () => {
      const unknownAddress = '0x1234567890123456789012345678901234567890';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      // Without a working provider, on-chain will fail and use negative cache
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      consoleSpy = warnSpy;

      const symbol = await getSymbolForAsset(aaveDataService, unknownAddress);

      // Should return UNKNOWN after on-chain fetch fails
      expect(symbol).toBe('UNKNOWN');
      
      // Should log symbol_missing from TokenMetadataRegistry (on-chain fetch failed)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_missing')
      );
    });
  });

  describe('Fallback without TokenMetadataRegistry', () => {
    it('should use hardcoded mappings when TokenMetadataRegistry is not set', async () => {
      // Create service without TokenMetadataRegistry
      const serviceWithoutRegistry = new AaveDataService(mockProvider, mockAaveMetadata);
      
      const usdcAddress = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const symbol = await getSymbolForAsset(serviceWithoutRegistry, usdcAddress);

      // Should still resolve via hardcoded mapping
      expect(symbol).toBe('USDC');
    });

    it('should emit symbol_missing warning for unknown addresses without registry', async () => {
      const serviceWithoutRegistry = new AaveDataService(mockProvider, mockAaveMetadata);
      
      const unknownAddress = '0x1234567890123456789012345678901234567890';
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      consoleSpy = warnSpy;

      const symbol = await getSymbolForAsset(serviceWithoutRegistry, unknownAddress);

      expect(symbol).toBe('UNKNOWN');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );
    });
  });
});
