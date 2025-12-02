/**
 * Unit tests for TokenMetadataRegistry
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

import { TokenMetadataRegistry } from '../../src/services/TokenMetadataRegistry.js';

describe('TokenMetadataRegistry', () => {
  let mockProvider: ethers.JsonRpcProvider;
  let registry: TokenMetadataRegistry;

  beforeEach(() => {
    mockProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 8453n })
    } as unknown as ethers.JsonRpcProvider;

    registry = new TokenMetadataRegistry(mockProvider);
  });

  describe('Metadata Resolution Hierarchy', () => {
    it('should use base metadata when available', async () => {
      const mockAaveMetadata = {
        getReserve: vi.fn().mockReturnValue({
          symbol: 'USDC',
          decimals: 6
        })
      };

      registry.setAaveMetadata(mockAaveMetadata);

      const metadata = await registry.getMetadata('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');

      expect(metadata.source).toBe('base');
      expect(metadata.symbol).toBe('USDC');
      expect(metadata.decimals).toBe(6);
    });

    it('should use overrides when base metadata missing', async () => {
      const mockAaveMetadata = {
        getReserve: vi.fn().mockReturnValue(null)
      };

      registry.setAaveMetadata(mockAaveMetadata);

      // cbBTC is in overrides
      const metadata = await registry.getMetadata('0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf');

      expect(metadata.source).toBe('override');
      expect(metadata.symbol).toBe('cbBTC');
      expect(metadata.decimals).toBe(8);
    });

    it('should normalize addresses to lowercase', async () => {
      const mockAaveMetadata = {
        getReserve: vi.fn().mockReturnValue(null)
      };

      registry.setAaveMetadata(mockAaveMetadata);

      // USDC with mixed case
      const metadata = await registry.getMetadata('0x833589FCD6edb6E08f4c7C32D4f71b54bdA02913');

      expect(metadata.source).toBe('override');
      expect(metadata.symbol).toBe('USDC');
      expect(metadata.address).toBe('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
    });

    it('should not overwrite base metadata with overrides', async () => {
      const mockAaveMetadata = {
        getReserve: vi.fn().mockReturnValue({
          symbol: 'BASE_USDC', // Base has different symbol
          decimals: 6
        })
      };

      registry.setAaveMetadata(mockAaveMetadata);

      const metadata = await registry.getMetadata('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');

      // Should use base metadata, not override
      expect(metadata.source).toBe('base');
      expect(metadata.symbol).toBe('BASE_USDC');
    });
  });

  describe('On-Chain Fetch', () => {
    it('should fetch from on-chain when not in base or overrides', async () => {
      const mockAaveMetadata = {
        getReserve: vi.fn().mockReturnValue(null)
      };

      registry.setAaveMetadata(mockAaveMetadata);

      // Mock Contract constructor and methods
      const mockContract = {
        symbol: vi.fn().mockResolvedValue('TEST'),
        decimals: vi.fn().mockResolvedValue(18)
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(ethers, 'Contract').mockReturnValue(mockContract as any);

      const metadata = await registry.getMetadata('0x1234567890123456789012345678901234567890');

      expect(metadata.source).toBe('onchain');
      expect(metadata.symbol).toBe('TEST');
      expect(metadata.decimals).toBe(18);
    });

    it('should cache on-chain results', async () => {
      const mockAaveMetadata = {
        getReserve: vi.fn().mockReturnValue(null)
      };

      registry.setAaveMetadata(mockAaveMetadata);

      const mockContract = {
        symbol: vi.fn().mockResolvedValue('TEST'),
        decimals: vi.fn().mockResolvedValue(18)
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(ethers, 'Contract').mockReturnValue(mockContract as any);

      const address = '0x1234567890123456789012345678901234567890';

      // First call should fetch
      await registry.getMetadata(address);
      expect(mockContract.symbol).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await registry.getMetadata(address);
      expect(mockContract.symbol).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should return UNKNOWN on fetch error and retry', async () => {
      const mockAaveMetadata = {
        getReserve: vi.fn().mockReturnValue(null)
      };

      registry.setAaveMetadata(mockAaveMetadata);

      const mockContract = {
        symbol: vi.fn().mockRejectedValue(new Error('RPC error')),
        decimals: vi.fn().mockRejectedValue(new Error('RPC error'))
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(ethers, 'Contract').mockReturnValue(mockContract as any);

      const address = '0x1234567890123456789012345678901234567890';
      const metadata = await registry.getMetadata(address);

      expect(metadata.source).toBe('unknown');
      expect(metadata.symbol).toBe('UNKNOWN');
      expect(metadata.decimals).toBe(18); // Default
    });
  });

  describe('Convenience Methods', () => {
    it('should get symbol only', async () => {
      const mockAaveMetadata = {
        getReserve: vi.fn().mockReturnValue({
          symbol: 'USDC',
          decimals: 6
        })
      };

      registry.setAaveMetadata(mockAaveMetadata);

      const symbol = await registry.getSymbol('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
      expect(symbol).toBe('USDC');
    });

    it('should get decimals only', async () => {
      const mockAaveMetadata = {
        getReserve: vi.fn().mockReturnValue({
          symbol: 'USDC',
          decimals: 6
        })
      };

      registry.setAaveMetadata(mockAaveMetadata);

      const decimals = await registry.getDecimals('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
      expect(decimals).toBe(6);
    });
  });

  describe('Cache Management', () => {
    it('should clear cache', async () => {
      const mockAaveMetadata = {
        getReserve: vi.fn().mockReturnValue(null)
      };

      registry.setAaveMetadata(mockAaveMetadata);

      const mockContract = {
        symbol: vi.fn().mockResolvedValue('TEST'),
        decimals: vi.fn().mockResolvedValue(18)
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(ethers, 'Contract').mockReturnValue(mockContract as any);

      const address = '0x1234567890123456789012345678901234567890';

      // Fetch to populate cache
      await registry.getMetadata(address);

      // Clear cache
      registry.clearCache();

      // Fetch again should hit contract
      await registry.getMetadata(address);
      expect(mockContract.symbol).toHaveBeenCalledTimes(2);
    });

    it('should provide cache stats', async () => {
      const mockAaveMetadata = {
        getReserve: vi.fn().mockReturnValue(null)
      };

      registry.setAaveMetadata(mockAaveMetadata);

      const mockContract = {
        symbol: vi.fn().mockResolvedValue('TEST'),
        decimals: vi.fn().mockResolvedValue(18)
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(ethers, 'Contract').mockReturnValue(mockContract as any);

      // Fetch some metadata
      await registry.getMetadata('0x1234567890123456789012345678901234567890');
      await registry.getMetadata('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');

      const stats = registry.getCacheStats();
      expect(stats.totalEntries).toBe(2);
      expect(stats.validEntries).toBe(2);
    });
  });

  describe('Known Token Overrides', () => {
    beforeEach(() => {
      const mockAaveMetadata = {
        getReserve: vi.fn().mockReturnValue(null)
      };
      registry.setAaveMetadata(mockAaveMetadata);
    });

    it('should resolve USDC', async () => {
      const metadata = await registry.getMetadata('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
      expect(metadata.symbol).toBe('USDC');
      expect(metadata.decimals).toBe(6);
    });

    it('should resolve WETH', async () => {
      const metadata = await registry.getMetadata('0x4200000000000000000000000000000000000006');
      expect(metadata.symbol).toBe('WETH');
      expect(metadata.decimals).toBe(18);
    });

    it('should resolve cbBTC', async () => {
      const metadata = await registry.getMetadata('0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf');
      expect(metadata.symbol).toBe('cbBTC');
      expect(metadata.decimals).toBe(8);
    });

    it('should resolve wstETH', async () => {
      const metadata = await registry.getMetadata('0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452');
      expect(metadata.symbol).toBe('wstETH');
      expect(metadata.decimals).toBe(18);
    });

    it('should resolve GHO', async () => {
      const metadata = await registry.getMetadata('0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee');
      expect(metadata.symbol).toBe('GHO');
      expect(metadata.decimals).toBe(18);
    });
  });
});
