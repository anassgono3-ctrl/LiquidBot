/**
 * Unit tests for MicroVerifyCache
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MicroVerifyCache, type CachedHFResult } from '../../../src/services/microVerify/MicroVerifyCache.js';

describe('MicroVerifyCache', () => {
  let cache: MicroVerifyCache;

  beforeEach(() => {
    cache = new MicroVerifyCache(2000); // 2 second TTL
  });

  describe('Basic caching', () => {
    it('should store and retrieve cached results', () => {
      const result: CachedHFResult = {
        user: '0x123',
        blockTag: 'latest',
        hf: 1.05,
        totalCollateralBase: 1000n,
        totalDebtBase: 900n,
        availableBorrowsBase: 100n,
        currentLiquidationThreshold: 8000n,
        ltv: 7000n,
        timestamp: Date.now()
      };

      cache.set('0x123', 'latest', result);
      const retrieved = cache.get('0x123', 'latest');

      expect(retrieved).toBeDefined();
      expect(retrieved?.hf).toBe(1.05);
      expect(retrieved?.user).toBe('0x123');
    });

    it('should return null for cache miss', () => {
      const result = cache.get('0xNONEXISTENT', 'latest');
      expect(result).toBeNull();
    });

    it('should handle case-insensitive user addresses', () => {
      const result: CachedHFResult = {
        user: '0xABC',
        blockTag: 100,
        hf: 1.1,
        totalCollateralBase: 2000n,
        totalDebtBase: 1800n,
        availableBorrowsBase: 200n,
        currentLiquidationThreshold: 8500n,
        ltv: 7500n,
        timestamp: Date.now()
      };

      cache.set('0xABC', 100, result);
      
      // Should work with lowercase
      const retrieved = cache.get('0xabc', 100);
      expect(retrieved).toBeDefined();
      expect(retrieved?.hf).toBe(1.1);
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      const shortCache = new MicroVerifyCache(100); // 100ms TTL
      
      const result: CachedHFResult = {
        user: '0x456',
        blockTag: 200,
        hf: 1.2,
        totalCollateralBase: 3000n,
        totalDebtBase: 2500n,
        availableBorrowsBase: 500n,
        currentLiquidationThreshold: 9000n,
        ltv: 8000n,
        timestamp: Date.now()
      };

      shortCache.set('0x456', 200, result);
      expect(shortCache.get('0x456', 200)).toBeDefined();

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(shortCache.get('0x456', 200)).toBeNull();
    });
  });

  describe('User invalidation', () => {
    it('should invalidate all entries for a user', () => {
      const user = '0x789';
      
      const result1: CachedHFResult = {
        user,
        blockTag: 100,
        hf: 1.05,
        totalCollateralBase: 1000n,
        totalDebtBase: 900n,
        availableBorrowsBase: 100n,
        currentLiquidationThreshold: 8000n,
        ltv: 7000n,
        timestamp: Date.now()
      };

      const result2: CachedHFResult = {
        user,
        blockTag: 101,
        hf: 1.04,
        totalCollateralBase: 1000n,
        totalDebtBase: 950n,
        availableBorrowsBase: 50n,
        currentLiquidationThreshold: 8000n,
        ltv: 7000n,
        timestamp: Date.now()
      };

      cache.set(user, 100, result1);
      cache.set(user, 101, result2);

      expect(cache.get(user, 100)).toBeDefined();
      expect(cache.get(user, 101)).toBeDefined();

      cache.invalidateUser(user);

      expect(cache.get(user, 100)).toBeNull();
      expect(cache.get(user, 101)).toBeNull();
    });
  });

  describe('In-flight request deduplication', () => {
    it('should deduplicate concurrent requests', async () => {
      let callCount = 0;
      
      const factory = async () => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
          user: '0xDEDUP',
          blockTag: 'latest',
          hf: 1.1,
          totalCollateralBase: 1000n,
          totalDebtBase: 900n,
          availableBorrowsBase: 100n,
          currentLiquidationThreshold: 8000n,
          ltv: 7000n,
          timestamp: Date.now()
        };
      };

      // Start multiple concurrent requests
      const promises = [
        cache.getOrCreateInflight('0xDEDUP', 'latest', factory),
        cache.getOrCreateInflight('0xDEDUP', 'latest', factory),
        cache.getOrCreateInflight('0xDEDUP', 'latest', factory)
      ];

      const results = await Promise.all(promises);

      // All should return same result
      expect(results[0]).toBeDefined();
      expect(results[1]).toBeDefined();
      expect(results[2]).toBeDefined();
      
      // Factory should only be called once
      expect(callCount).toBe(1);
      
      // Result should now be cached
      const cached = cache.get('0xDEDUP', 'latest');
      expect(cached).toBeDefined();
    });
  });

  describe('Statistics', () => {
    it('should track hits and misses', () => {
      const user = '0xSTATS';
      const result: CachedHFResult = {
        user,
        blockTag: 500,
        hf: 1.15,
        totalCollateralBase: 5000n,
        totalDebtBase: 4000n,
        availableBorrowsBase: 1000n,
        currentLiquidationThreshold: 8500n,
        ltv: 7500n,
        timestamp: Date.now()
      };

      // Miss
      cache.get(user, 500);
      
      // Set
      cache.set(user, 500, result);
      
      // Hit
      cache.get(user, 500);
      cache.get(user, 500);
      
      // Miss
      cache.get('0xOTHER', 600);

      const stats = cache.getStats();
      
      expect(stats.hits).toBeGreaterThanOrEqual(2);
      expect(stats.misses).toBeGreaterThanOrEqual(2);
      expect(stats.cacheSize).toBeGreaterThanOrEqual(1);
    });

    it('should calculate hit rate correctly', () => {
      const user = '0xHITRATE';
      const result: CachedHFResult = {
        user,
        blockTag: 700,
        hf: 1.08,
        totalCollateralBase: 2000n,
        totalDebtBase: 1850n,
        availableBorrowsBase: 150n,
        currentLiquidationThreshold: 8200n,
        ltv: 7200n,
        timestamp: Date.now()
      };

      cache.set(user, 700, result);
      
      // 3 hits
      cache.get(user, 700);
      cache.get(user, 700);
      cache.get(user, 700);
      
      // 1 miss
      cache.get('0xOTHER', 800);

      const stats = cache.getStats();
      
      // Should be 75% hit rate (3 hits / 4 total)
      expect(stats.hitRate).toBeGreaterThan(0.5);
      expect(stats.hitRate).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Cleanup', () => {
    it('should remove expired entries during cleanup', async () => {
      const shortCache = new MicroVerifyCache(50); // 50ms TTL
      
      const result: CachedHFResult = {
        user: '0xCLEANUP',
        blockTag: 900,
        hf: 1.03,
        totalCollateralBase: 1500n,
        totalDebtBase: 1450n,
        availableBorrowsBase: 50n,
        currentLiquidationThreshold: 8100n,
        ltv: 7100n,
        timestamp: Date.now()
      };

      shortCache.set('0xCLEANUP', 900, result);
      expect(shortCache.getStats().cacheSize).toBe(1);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      // Run cleanup
      shortCache.cleanup();

      expect(shortCache.getStats().cacheSize).toBe(0);
    });
  });

  describe('Disabled cache', () => {
    it('should not cache when TTL is 0', () => {
      const disabledCache = new MicroVerifyCache(0);
      
      const result: CachedHFResult = {
        user: '0xDISABLED',
        blockTag: 1000,
        hf: 1.0,
        totalCollateralBase: 1000n,
        totalDebtBase: 1000n,
        availableBorrowsBase: 0n,
        currentLiquidationThreshold: 8000n,
        ltv: 7000n,
        timestamp: Date.now()
      };

      expect(disabledCache.isEnabled()).toBe(false);
      
      disabledCache.set('0xDISABLED', 1000, result);
      expect(disabledCache.get('0xDISABLED', 1000)).toBeNull();
    });
  });
});
