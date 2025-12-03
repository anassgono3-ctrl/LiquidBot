/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ethers } from 'ethers';

import { AaveDataService } from '../../src/services/AaveDataService.js';
import { TokenMetadataRegistry } from '../../src/services/TokenMetadataRegistry.js';

describe('AaveDataService - TokenMetadataRegistry Integration', () => {
  let mockProvider: ethers.JsonRpcProvider;
  let mockAaveMetadata: any;
  let tokenRegistry: TokenMetadataRegistry;
  let aaveDataService: AaveDataService;

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

  describe('Symbol Resolution via TokenMetadataRegistry', () => {
    it('should resolve USDC via override without symbol_missing warning', async () => {
      const usdcAddress = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
      
      // Mock AaveMetadata doesn't have USDC
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      // Spy on console.warn to verify no warning is emitted
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Call the private method through reflection (testing internal behavior)
      // In real usage, this is called internally by getAllUserReserves
      const getSymbolForAsset = (aaveDataService as any).getSymbolForAsset.bind(aaveDataService);
      const symbol = await getSymbolForAsset(usdcAddress);

      expect(symbol).toBe('USDC');
      
      // Should log resolution via override
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_resolved via override')
      );
      
      // Should NOT emit symbol_missing warning
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('should resolve cbBTC via override without symbol_missing warning', async () => {
      const cbBTCAddress = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const getSymbolForAsset = (aaveDataService as any).getSymbolForAsset.bind(aaveDataService);
      const symbol = await getSymbolForAsset(cbBTCAddress);

      expect(symbol).toBe('cbBTC');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_resolved via override')
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('should resolve weETH via override without symbol_missing warning', async () => {
      const weETHAddress = '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const getSymbolForAsset = (aaveDataService as any).getSymbolForAsset.bind(aaveDataService);
      const symbol = await getSymbolForAsset(weETHAddress);

      expect(symbol).toBe('weETH');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_resolved via override')
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('should resolve wstETH via override without symbol_missing warning', async () => {
      const wstETHAddress = '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const getSymbolForAsset = (aaveDataService as any).getSymbolForAsset.bind(aaveDataService);
      const symbol = await getSymbolForAsset(wstETHAddress);

      expect(symbol).toBe('wstETH');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_resolved via override')
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('should resolve cbETH via override without symbol_missing warning', async () => {
      const cbETHAddress = '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const getSymbolForAsset = (aaveDataService as any).getSymbolForAsset.bind(aaveDataService);
      const symbol = await getSymbolForAsset(cbETHAddress);

      expect(symbol).toBe('cbETH');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_resolved via override')
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('should resolve AAVE via override without symbol_missing warning', async () => {
      const aaveAddress = '0x63706e401c06ac8513145b7687a14804d17f814b';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const getSymbolForAsset = (aaveDataService as any).getSymbolForAsset.bind(aaveDataService);
      const symbol = await getSymbolForAsset(aaveAddress);

      expect(symbol).toBe('AAVE');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_resolved via override')
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('should resolve EURC via override without symbol_missing warning', async () => {
      const eurcAddress = '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const getSymbolForAsset = (aaveDataService as any).getSymbolForAsset.bind(aaveDataService);
      const symbol = await getSymbolForAsset(eurcAddress);

      expect(symbol).toBe('EURC');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_resolved via override')
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('should resolve USDbC via override without symbol_missing warning', async () => {
      const usdBCAddress = '0x9506a02b003d7a7eaf86579863a29601528ca0be';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const getSymbolForAsset = (aaveDataService as any).getSymbolForAsset.bind(aaveDataService);
      const symbol = await getSymbolForAsset(usdBCAddress);

      expect(symbol).toBe('USDbC');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_resolved via override')
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('should normalize addresses to lowercase during resolution', async () => {
      const mixedCaseAddress = '0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913'; // USDC mixed case
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const getSymbolForAsset = (aaveDataService as any).getSymbolForAsset.bind(aaveDataService);
      const symbol = await getSymbolForAsset(mixedCaseAddress);

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

      const getSymbolForAsset = (aaveDataService as any).getSymbolForAsset.bind(aaveDataService);
      const symbol = await getSymbolForAsset(usdcAddress);

      // Should use base metadata, not override
      expect(symbol).toBe('CUSTOM_USDC');
    });

    it('should cache resolved symbols for subsequent calls', async () => {
      const usdcAddress = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const getSymbolForAsset = (aaveDataService as any).getSymbolForAsset.bind(aaveDataService);
      
      // First call
      const symbol1 = await getSymbolForAsset(usdcAddress);
      expect(symbol1).toBe('USDC');
      expect(logSpy).toHaveBeenCalledTimes(1);
      
      logSpy.mockClear();
      
      // Second call - should use cache (no additional log)
      const symbol2 = await getSymbolForAsset(usdcAddress);
      expect(symbol2).toBe('USDC');
      expect(logSpy).not.toHaveBeenCalled(); // Already warned once

      logSpy.mockRestore();
    });

    it('should handle unknown addresses with on-chain fallback', async () => {
      const unknownAddress = '0x1234567890123456789012345678901234567890';
      
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      // Without a working provider, on-chain will fail and use negative cache
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const getSymbolForAsset = (aaveDataService as any).getSymbolForAsset.bind(aaveDataService);
      const symbol = await getSymbolForAsset(unknownAddress);

      // Should return UNKNOWN after on-chain fetch fails
      expect(symbol).toBe('UNKNOWN');
      
      // Should log symbol_missing from TokenMetadataRegistry (on-chain fetch failed)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[token-registry] symbol_missing')
      );

      warnSpy.mockRestore();
    });
  });

  describe('Fallback without TokenMetadataRegistry', () => {
    it('should use hardcoded mappings when TokenMetadataRegistry is not set', async () => {
      // Create service without TokenMetadataRegistry
      const serviceWithoutRegistry = new AaveDataService(mockProvider, mockAaveMetadata);
      
      const usdcAddress = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const getSymbolForAsset = (serviceWithoutRegistry as any).getSymbolForAsset.bind(serviceWithoutRegistry);
      const symbol = await getSymbolForAsset(usdcAddress);

      // Should still resolve via hardcoded mapping
      expect(symbol).toBe('USDC');
    });

    it('should emit symbol_missing warning for unknown addresses without registry', async () => {
      const serviceWithoutRegistry = new AaveDataService(mockProvider, mockAaveMetadata);
      
      const unknownAddress = '0x1234567890123456789012345678901234567890';
      mockAaveMetadata.getReserve.mockReturnValue(undefined);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const getSymbolForAsset = (serviceWithoutRegistry as any).getSymbolForAsset.bind(serviceWithoutRegistry);
      const symbol = await getSymbolForAsset(unknownAddress);

      expect(symbol).toBe('UNKNOWN');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );

      warnSpy.mockRestore();
    });
  });
});
