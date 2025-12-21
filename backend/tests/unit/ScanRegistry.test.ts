import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ScanRegistry } from '../../src/services/ScanRegistry.js';

describe('ScanRegistry', () => {
  let registry: ScanRegistry;

  beforeEach(() => {
    registry = new ScanRegistry({
      defaultTtlMs: 1000, // 1 second for testing
      maxRecentlyCompletedSize: 10,
      avgBlockTimeMs: 2000
    });
  });

  afterEach(() => {
    registry.clear();
  });

  describe('acquire', () => {
    it('should allow first acquisition', () => {
      const scanKey = {
        triggerType: 'price' as const,
        symbolOrReserve: 'WETH',
        blockTag: 100
      };

      const acquired = registry.acquire(scanKey);
      expect(acquired).toBe(true);
    });

    it('should prevent duplicate acquisition for same key', () => {
      const scanKey = {
        triggerType: 'price' as const,
        symbolOrReserve: 'WETH',
        blockTag: 100
      };

      const first = registry.acquire(scanKey);
      const second = registry.acquire(scanKey);

      expect(first).toBe(true);
      expect(second).toBe(false);
    });

    it('should allow acquisition of different assets in same block', () => {
      const wethKey = {
        triggerType: 'price' as const,
        symbolOrReserve: 'WETH',
        blockTag: 100
      };

      const usdcKey = {
        triggerType: 'price' as const,
        symbolOrReserve: 'USDC',
        blockTag: 100
      };

      const weth = registry.acquire(wethKey);
      const usdc = registry.acquire(usdcKey);

      expect(weth).toBe(true);
      expect(usdc).toBe(true);
    });

    it('should allow acquisition in different blocks', () => {
      const key1 = {
        triggerType: 'price' as const,
        symbolOrReserve: 'WETH',
        blockTag: 100
      };

      const key2 = {
        triggerType: 'price' as const,
        symbolOrReserve: 'WETH',
        blockTag: 101
      };

      const first = registry.acquire(key1);
      const second = registry.acquire(key2);

      expect(first).toBe(true);
      expect(second).toBe(true);
    });

    it('should prevent acquisition when recently completed within TTL', () => {
      const scanKey = {
        triggerType: 'reserve' as const,
        symbolOrReserve: '0x1234567890',
        blockTag: 200
      };

      // Acquire and release
      registry.acquire(scanKey);
      registry.release(scanKey);

      // Try to acquire again immediately - should be blocked by recently-completed
      const reacquired = registry.acquire(scanKey);
      expect(reacquired).toBe(false);
    });
  });

  describe('release', () => {
    it('should move scan from in-flight to recently-completed', () => {
      const scanKey = {
        triggerType: 'price' as const,
        symbolOrReserve: 'WETH',
        blockTag: 100
      };

      registry.acquire(scanKey);
      registry.release(scanKey);

      const stats = registry.getStats();
      expect(stats.inFlight).toBe(0);
      expect(stats.recentlyCompleted).toBe(1);
    });
  });

  describe('isInFlight', () => {
    it('should return true for in-flight scan', () => {
      const scanKey = {
        triggerType: 'price' as const,
        symbolOrReserve: 'WETH',
        blockTag: 100
      };

      registry.acquire(scanKey);
      
      const inFlight = registry.isInFlight(scanKey);
      expect(inFlight).toBe(true);
    });

    it('should return false for released scan', () => {
      const scanKey = {
        triggerType: 'price' as const,
        symbolOrReserve: 'WETH',
        blockTag: 100
      };

      registry.acquire(scanKey);
      registry.release(scanKey);
      
      const inFlight = registry.isInFlight(scanKey);
      expect(inFlight).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      const scanKey = {
        triggerType: 'price' as const,
        symbolOrReserve: 'WETH',
        blockTag: 100
      };

      registry.acquire(scanKey);
      
      // Wait for TTL to expire (1 second in test config)
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const cleaned = registry.cleanup();
      expect(cleaned).toBeGreaterThan(0);
      
      const stats = registry.getStats();
      expect(stats.inFlight).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', () => {
      const key1 = {
        triggerType: 'price' as const,
        symbolOrReserve: 'WETH',
        blockTag: 100
      };

      const key2 = {
        triggerType: 'reserve' as const,
        symbolOrReserve: '0x1234567890',
        blockTag: 200
      };

      registry.acquire(key1);
      registry.acquire(key2);
      registry.release(key2);

      const stats = registry.getStats();
      expect(stats.inFlight).toBe(1);
      expect(stats.recentlyCompleted).toBe(1);
    });
  });
});
