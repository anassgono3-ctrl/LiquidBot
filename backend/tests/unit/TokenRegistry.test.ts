// Unit tests for TokenRegistry service
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { TokenRegistry } from '../../src/services/TokenRegistry.js';

// Mock Redis client
const mockRedis = {
  get: vi.fn(),
  setex: vi.fn()
} as any;

// Simple mock provider
const createMockProvider = (responses: Record<string, any> = {}) => {
  return {
    call: vi.fn().mockImplementation(async (tx) => {
      // Mock symbol() and decimals() calls based on data selector
      const selector = tx.data.substring(0, 10);
      if (responses[selector]) {
        return responses[selector];
      }
      throw new Error('Method not mocked');
    })
  } as any;
};

describe('TokenRegistry', () => {
  let registry: TokenRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new TokenRegistry({
      redisClient: mockRedis,
      cacheTtlMs: 1000 // 1 second for testing
    });
  });

  describe('getTokenMeta', () => {
    it('should return metadata for known USDC token without RPC call', async () => {
      const usdcAddress = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
      
      const metadata = await registry.getTokenMeta(usdcAddress);
      
      expect(metadata.address).toBe(usdcAddress.toLowerCase());
      expect(metadata.symbol).toBe('USDC');
      expect(metadata.decimals).toBe(6);
    });

    it('should return metadata for known WETH token without RPC call', async () => {
      const wethAddress = '0x4200000000000000000000000000000000000006';
      
      const metadata = await registry.getTokenMeta(wethAddress);
      
      expect(metadata.address).toBe(wethAddress.toLowerCase());
      expect(metadata.symbol).toBe('WETH');
      expect(metadata.decimals).toBe(18);
    });

    it('should return metadata for known cbBTC token', async () => {
      const cbBtcAddress = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
      
      const metadata = await registry.getTokenMeta(cbBtcAddress);
      
      expect(metadata.address).toBe(cbBtcAddress.toLowerCase());
      expect(metadata.symbol).toBe('cbBTC');
      expect(metadata.decimals).toBe(8);
    });

    it('should normalize addresses to lowercase', async () => {
      const upperCaseAddress = '0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913';
      const lowerCaseAddress = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
      
      const metadata1 = await registry.getTokenMeta(upperCaseAddress);
      const metadata2 = await registry.getTokenMeta(lowerCaseAddress);
      
      expect(metadata1.address).toBe(lowerCaseAddress);
      expect(metadata2.address).toBe(lowerCaseAddress);
      expect(metadata1.symbol).toBe(metadata2.symbol);
    });

    it('should throw error when provider not configured and token unknown', async () => {
      const registryNoProvider = new TokenRegistry(); // No provider
      const unknownAddress = '0x1234567890123456789012345678901234567890';
      
      await expect(registryNoProvider.getTokenMeta(unknownAddress))
        .rejects.toThrow('Unable to resolve metadata');
    });

    it('should use Redis cache when available', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const cachedData = {
        symbol: 'CACHED',
        decimals: 12,
        timestamp: Date.now()
      };
      
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedData));
      
      const metadata = await registry.getTokenMeta(address);
      
      expect(metadata.symbol).toBe('CACHED');
      expect(metadata.decimals).toBe(12);
      expect(mockRedis.get).toHaveBeenCalled();
    });

    it('should handle expired Redis cache', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      const expiredData = {
        symbol: 'EXPIRED',
        decimals: 12,
        timestamp: Date.now() - 10000 // 10 seconds ago, expired
      };
      
      mockRedis.get.mockResolvedValue(JSON.stringify(expiredData));
      
      await expect(registry.getTokenMeta(address))
        .rejects.toThrow('Unable to resolve metadata');
    });
  });

  describe('getTokenMetaBatch', () => {
    it('should fetch metadata for multiple known tokens', async () => {
      const addresses = [
        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
        '0x4200000000000000000000000000000000000006'  // WETH
      ];
      
      const results = await registry.getTokenMetaBatch(addresses);
      
      expect(results.size).toBe(2);
      expect(results.get(addresses[0].toLowerCase())?.symbol).toBe('USDC');
      expect(results.get(addresses[1].toLowerCase())?.symbol).toBe('WETH');
    });

    it('should handle empty array', async () => {
      const results = await registry.getTokenMetaBatch([]);
      
      expect(results.size).toBe(0);
    });

    it('should skip unknown tokens without provider', async () => {
      const addresses = [
        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC (known)
        '0x1234567890123456789012345678901234567890'  // Unknown
      ];
      
      const results = await registry.getTokenMetaBatch(addresses);
      
      // Only known token should be in results
      expect(results.size).toBe(1);
      expect(results.get(addresses[0].toLowerCase())?.symbol).toBe('USDC');
    });
  });

  describe('preloadKnownTokens', () => {
    it('should populate cache with all known tokens', async () => {
      await registry.preloadKnownTokens();
      
      const stats = registry.getCacheStats();
      expect(stats.memorySize).toBeGreaterThan(0);
      
      // Query a known token - should be cached
      const usdcMetadata = await registry.getTokenMeta('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
      const wethMetadata = await registry.getTokenMeta('0x4200000000000000000000000000000000000006');
      
      expect(usdcMetadata.symbol).toBe('USDC');
      expect(wethMetadata.symbol).toBe('WETH');
    });
  });

  describe('pruneMemoryCache', () => {
    it('should remove expired entries from memory cache', async () => {
      // Use very short TTL
      const shortTtlRegistry = new TokenRegistry({
        cacheTtlMs: 10 // 10ms
      });
      
      // Preload to populate cache
      await shortTtlRegistry.preloadKnownTokens();
      
      const statsBefore = shortTtlRegistry.getCacheStats();
      expect(statsBefore.memorySize).toBeGreaterThan(0);
      
      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Prune expired entries
      shortTtlRegistry.pruneMemoryCache();
      
      const statsAfter = shortTtlRegistry.getCacheStats();
      expect(statsAfter.memorySize).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', () => {
      const stats = registry.getCacheStats();
      
      expect(stats).toHaveProperty('memorySize');
      expect(stats).toHaveProperty('ttlMs');
      expect(typeof stats.memorySize).toBe('number');
      expect(typeof stats.ttlMs).toBe('number');
    });

    it('should show increased size after preloading', async () => {
      const statsBefore = registry.getCacheStats();
      
      await registry.preloadKnownTokens();
      
      const statsAfter = registry.getCacheStats();
      expect(statsAfter.memorySize).toBeGreaterThan(statsBefore.memorySize);
    });
  });

  describe('Redis integration', () => {
    it('should cache known tokens to Redis during preload', async () => {
      await registry.preloadKnownTokens();
      
      // Redis setex should have been called for each known token
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('should handle Redis write failures gracefully', async () => {
      mockRedis.setex.mockRejectedValue(new Error('Redis write failed'));
      
      // Should not throw - just log warning
      await expect(registry.preloadKnownTokens()).resolves.not.toThrow();
    });

    it('should handle Redis read failures gracefully', async () => {
      const unknownAddress = '0x1234567890123456789012345678901234567890';
      mockRedis.get.mockRejectedValue(new Error('Redis read failed'));
      
      // Should continue to other fallbacks
      await expect(registry.getTokenMeta(unknownAddress))
        .rejects.toThrow('Unable to resolve metadata');
    });
  });
});
