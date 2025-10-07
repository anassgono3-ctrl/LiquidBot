import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GraphQLClient } from 'graphql-request';

import { HealthFactorResolver } from '../../src/services/HealthFactorResolver.js';

describe('HealthFactorResolver', () => {
  let mockClient: Pick<GraphQLClient, 'request'>;
  let resolver: HealthFactorResolver;

  beforeEach(() => {
    mockClient = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      request: vi.fn() as any
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      resolver = new HealthFactorResolver({
        client: mockClient as GraphQLClient
      });
      
      const stats = resolver.getCacheStats();
      expect(stats.ttlMs).toBe(60000);
      expect(stats.maxBatchSize).toBe(25);
    });

    it('should initialize with custom options', () => {
      resolver = new HealthFactorResolver({
        client: mockClient as GraphQLClient,
        cacheTtlMs: 30000,
        maxBatchSize: 10
      });
      
      const stats = resolver.getCacheStats();
      expect(stats.ttlMs).toBe(30000);
      expect(stats.maxBatchSize).toBe(10);
    });
  });

  describe('getHealthFactorsForUsers', () => {
    beforeEach(() => {
      resolver = new HealthFactorResolver({
        client: mockClient as GraphQLClient,
        cacheTtlMs: 60000,
        maxBatchSize: 25
      });
    });

    it('should fetch single user health factor', async () => {
      const mockUser = {
        id: '0xuser1',
        borrowedReservesCount: 1,
        reserves: [
          {
            currentATokenBalance: '1000000000000000000', // 1 token
            currentVariableDebt: '500000000000000000', // 0.5 token
            currentStableDebt: '0',
            reserve: {
              symbol: 'WETH',
              decimals: 18,
              reserveLiquidationThreshold: 8250, // 82.5%
              usageAsCollateralEnabled: true,
              price: {
                priceInEth: '1.0'
              }
            }
          }
        ]
      };

      (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        user: mockUser
      });

      const result = await resolver.getHealthFactorsForUsers(['0xuser1']);
      
      expect(result.size).toBe(1);
      expect(result.get('0xuser1')).toBeCloseTo(1.65, 2); // (1 * 0.825) / 0.5 = 1.65
      expect(mockClient.request).toHaveBeenCalledTimes(1);
    });

    it('should return null for user with zero debt', async () => {
      const mockUser = {
        id: '0xuser2',
        borrowedReservesCount: 0,
        reserves: [
          {
            currentATokenBalance: '1000000000000000000',
            currentVariableDebt: '0',
            currentStableDebt: '0',
            reserve: {
              symbol: 'WETH',
              decimals: 18,
              reserveLiquidationThreshold: 8250,
              usageAsCollateralEnabled: true,
              price: {
                priceInEth: '1.0'
              }
            }
          }
        ]
      };

      (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        user: mockUser
      });

      const result = await resolver.getHealthFactorsForUsers(['0xuser2']);
      
      expect(result.size).toBe(1);
      expect(result.get('0xuser2')).toBe(null);
    });

    it('should batch query for multiple users', async () => {
      const mockUsers = [
        {
          id: '0xuser1',
          borrowedReservesCount: 1,
          reserves: [
            {
              currentATokenBalance: '2000000000000000000',
              currentVariableDebt: '1000000000000000000',
              currentStableDebt: '0',
              reserve: {
                symbol: 'WETH',
                decimals: 18,
                reserveLiquidationThreshold: 8000,
                usageAsCollateralEnabled: true,
                price: { priceInEth: '1.0' }
              }
            }
          ]
        },
        {
          id: '0xuser2',
          borrowedReservesCount: 1,
          reserves: [
            {
              currentATokenBalance: '3000000000000000000',
              currentVariableDebt: '1000000000000000000',
              currentStableDebt: '0',
              reserve: {
                symbol: 'WETH',
                decimals: 18,
                reserveLiquidationThreshold: 8000,
                usageAsCollateralEnabled: true,
                price: { priceInEth: '1.0' }
              }
            }
          ]
        },
        {
          id: '0xuser3',
          borrowedReservesCount: 1,
          reserves: [
            {
              currentATokenBalance: '4000000000000000000',
              currentVariableDebt: '2000000000000000000',
              currentStableDebt: '0',
              reserve: {
                symbol: 'WETH',
                decimals: 18,
                reserveLiquidationThreshold: 8000,
                usageAsCollateralEnabled: true,
                price: { priceInEth: '1.0' }
              }
            }
          ]
        }
      ];

      (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        users: mockUsers
      });

      const result = await resolver.getHealthFactorsForUsers(['0xuser1', '0xuser2', '0xuser3']);
      
      expect(result.size).toBe(3);
      expect(result.get('0xuser1')).toBeCloseTo(1.6, 2);
      expect(result.get('0xuser2')).toBeCloseTo(2.4, 2);
      expect(result.get('0xuser3')).toBeCloseTo(1.6, 2);
      // Should make only one batch query for 3 users
      expect(mockClient.request).toHaveBeenCalledTimes(1);
    });

    it('should use cache for subsequent requests', async () => {
      const mockUser = {
        id: '0xuser1',
        borrowedReservesCount: 1,
        reserves: [
          {
            currentATokenBalance: '1000000000000000000',
            currentVariableDebt: '500000000000000000',
            currentStableDebt: '0',
            reserve: {
              symbol: 'WETH',
              decimals: 18,
              reserveLiquidationThreshold: 8000,
              usageAsCollateralEnabled: true,
              price: { priceInEth: '1.0' }
            }
          }
        ]
      };

      (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        user: mockUser
      });

      // First call - cache miss
      const result1 = await resolver.getHealthFactorsForUsers(['0xuser1']);
      expect(result1.get('0xuser1')).toBeCloseTo(1.6, 2);
      expect(mockClient.request).toHaveBeenCalledTimes(1);

      // Second call - cache hit (should not call client again)
      const result2 = await resolver.getHealthFactorsForUsers(['0xuser1']);
      expect(result2.get('0xuser1')).toBeCloseTo(1.6, 2);
      expect(mockClient.request).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should expire cache after TTL', async () => {
      vi.useFakeTimers();
      
      resolver = new HealthFactorResolver({
        client: mockClient as GraphQLClient,
        cacheTtlMs: 1000, // 1 second TTL
        maxBatchSize: 25
      });

      const mockUser = {
        id: '0xuser1',
        borrowedReservesCount: 1,
        reserves: [
          {
            currentATokenBalance: '1000000000000000000',
            currentVariableDebt: '500000000000000000',
            currentStableDebt: '0',
            reserve: {
              symbol: 'WETH',
              decimals: 18,
              reserveLiquidationThreshold: 8000,
              usageAsCollateralEnabled: true,
              price: { priceInEth: '1.0' }
            }
          }
        ]
      };

      (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        user: mockUser
      });

      // First call
      await resolver.getHealthFactorsForUsers(['0xuser1']);
      expect(mockClient.request).toHaveBeenCalledTimes(1);

      // Advance time by 500ms (within TTL)
      vi.advanceTimersByTime(500);
      await resolver.getHealthFactorsForUsers(['0xuser1']);
      expect(mockClient.request).toHaveBeenCalledTimes(1); // Cache hit

      // Advance time past TTL (total 1500ms)
      vi.advanceTimersByTime(1000);
      await resolver.getHealthFactorsForUsers(['0xuser1']);
      expect(mockClient.request).toHaveBeenCalledTimes(2); // Cache expired

      vi.useRealTimers();
    });

    it('should split large batches according to maxBatchSize', async () => {
      resolver = new HealthFactorResolver({
        client: mockClient as GraphQLClient,
        cacheTtlMs: 60000,
        maxBatchSize: 2 // Small batch size for testing
      });

      // Mock response for batch queries
      (mockClient.request as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          users: [
            { id: '0xuser1', borrowedReservesCount: 0, reserves: [] },
            { id: '0xuser2', borrowedReservesCount: 0, reserves: [] }
          ]
        })
        .mockResolvedValueOnce({
          users: [
            { id: '0xuser3', borrowedReservesCount: 0, reserves: [] }
          ]
        });

      const result = await resolver.getHealthFactorsForUsers(['0xuser1', '0xuser2', '0xuser3']);
      
      expect(result.size).toBe(3);
      // Should make 2 batch queries: one for [user1, user2], one for [user3]
      expect(mockClient.request).toHaveBeenCalledTimes(2);
    });

    it('should handle query errors gracefully', async () => {
      (mockClient.request as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('GraphQL query failed')
      );

      const result = await resolver.getHealthFactorsForUsers(['0xuser1']);
      
      expect(result.size).toBe(1);
      expect(result.get('0xuser1')).toBe(null); // Returns null on error
    });

    it('should handle user not found', async () => {
      (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        user: null
      });

      const result = await resolver.getHealthFactorsForUsers(['0xnonexistent']);
      
      expect(result.size).toBe(1);
      expect(result.get('0xnonexistent')).toBe(null);
    });

    it('should handle mixed cache hits and misses', async () => {
      const mockUser2 = {
        id: '0xuser2',
        borrowedReservesCount: 1,
        reserves: [
          {
            currentATokenBalance: '1000000000000000000',
            currentVariableDebt: '500000000000000000',
            currentStableDebt: '0',
            reserve: {
              symbol: 'WETH',
              decimals: 18,
              reserveLiquidationThreshold: 8000,
              usageAsCollateralEnabled: true,
              price: { priceInEth: '1.0' }
            }
          }
        ]
      };

      // Prime cache with user1
      (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        user: { id: '0xuser1', borrowedReservesCount: 0, reserves: [] }
      });
      await resolver.getHealthFactorsForUsers(['0xuser1']);
      
      // Request both user1 (cached) and user2 (not cached)
      (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        user: mockUser2
      });
      const result = await resolver.getHealthFactorsForUsers(['0xuser1', '0xuser2']);
      
      expect(result.size).toBe(2);
      expect(result.get('0xuser1')).toBe(null); // From cache
      expect(result.get('0xuser2')).toBeCloseTo(1.6, 2); // Fetched
      // First call + one for user2 only
      expect(mockClient.request).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearCache', () => {
    it('should clear the cache', async () => {
      resolver = new HealthFactorResolver({
        client: mockClient as GraphQLClient
      });

      const mockUser = {
        id: '0xuser1',
        borrowedReservesCount: 0,
        reserves: []
      };

      (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        user: mockUser
      });

      // Prime cache
      await resolver.getHealthFactorsForUsers(['0xuser1']);
      expect(resolver.getCacheStats().size).toBe(1);

      // Clear cache
      resolver.clearCache();
      expect(resolver.getCacheStats().size).toBe(0);

      // Next call should fetch again
      await resolver.getHealthFactorsForUsers(['0xuser1']);
      expect(mockClient.request).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', async () => {
      resolver = new HealthFactorResolver({
        client: mockClient as GraphQLClient,
        cacheTtlMs: 30000,
        maxBatchSize: 10
      });

      const stats = resolver.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.ttlMs).toBe(30000);
      expect(stats.maxBatchSize).toBe(10);

      // Add some entries
      (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        users: [
          { id: '0xuser1', borrowedReservesCount: 0, reserves: [] },
          { id: '0xuser2', borrowedReservesCount: 0, reserves: [] }
        ]
      });
      await resolver.getHealthFactorsForUsers(['0xuser1', '0xuser2']);

      const stats2 = resolver.getCacheStats();
      expect(stats2.size).toBe(2);
    });
  });
});
