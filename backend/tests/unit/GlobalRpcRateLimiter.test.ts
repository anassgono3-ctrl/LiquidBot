import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GlobalRpcRateLimiter } from '../../src/services/GlobalRpcRateLimiter.js';

describe('GlobalRpcRateLimiter', () => {
  let limiter: GlobalRpcRateLimiter;

  beforeEach(() => {
    limiter = new GlobalRpcRateLimiter({
      rateLimit: 10, // 10 calls/sec for testing
      burstCapacity: 20,
      refillIntervalMs: 100
    });
  });

  afterEach(() => {
    limiter.stop();
  });

  describe('acquire', () => {
    it('should allow acquisition when tokens available', async () => {
      const acquired = await limiter.acquire({ cost: 1 });
      expect(acquired).toBe(true);
    });

    it('should deduct tokens on acquisition', async () => {
      const initialTokens = limiter.getTokens();
      await limiter.acquire({ cost: 5 });
      
      const remainingTokens = limiter.getTokens();
      expect(remainingTokens).toBe(initialTokens - 5);
    });

    it('should drop request when no tokens and no timeout', async () => {
      // Exhaust all tokens
      await limiter.acquire({ cost: 20 });
      
      // Next request should be dropped (no timeout)
      const acquired = await limiter.acquire({ cost: 1 });
      expect(acquired).toBe(false);
    });

    it('should wait and acquire when timeout provided', async () => {
      // Exhaust all tokens
      await limiter.acquire({ cost: 20 });
      
      // Wait with timeout - should acquire after refill
      const acquired = await limiter.acquire({ 
        cost: 1, 
        timeoutMs: 200 // Wait up to 200ms
      });
      
      expect(acquired).toBe(true);
    }, 10000); // 10s test timeout

    it('should timeout if tokens not available in time', async () => {
      // Exhaust all tokens
      await limiter.acquire({ cost: 20 });
      
      // Request more than refill rate with short timeout
      const acquired = await limiter.acquire({ 
        cost: 100, 
        timeoutMs: 50 
      });
      
      expect(acquired).toBe(false);
    });

    it('should handle multiple concurrent acquisitions', async () => {
      const results = await Promise.all([
        limiter.acquire({ cost: 5 }),
        limiter.acquire({ cost: 5 }),
        limiter.acquire({ cost: 5 })
      ]);
      
      // First two should succeed, third might fail
      expect(results[0]).toBe(true);
      expect(results[1]).toBe(true);
      // Third depends on exact timing, so we just check it's boolean
      expect(typeof results[2]).toBe('boolean');
    });
  });

  describe('getTokens', () => {
    it('should return current token count', async () => {
      const tokens = limiter.getTokens();
      expect(tokens).toBeGreaterThan(0);
    });

    it('should refill tokens over time', async () => {
      // Exhaust tokens
      await limiter.acquire({ cost: 20 });
      const exhausted = limiter.getTokens();
      
      // Wait for refill (100ms interval)
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const refilled = limiter.getTokens();
      expect(refilled).toBeGreaterThan(exhausted);
    });
  });

  describe('getStats', () => {
    it('should track statistics', async () => {
      await limiter.acquire({ cost: 5 });
      
      const stats = limiter.getStats();
      expect(stats.tokens).toBeLessThan(stats.burstCapacity);
      expect(stats.rateLimit).toBe(10);
      expect(stats.burstCapacity).toBe(20);
    });

    it('should track waits and drops', async () => {
      // Exhaust tokens
      await limiter.acquire({ cost: 20 });
      
      // Drop a request
      await limiter.acquire({ cost: 1 });
      
      // Wait for a request
      await limiter.acquire({ cost: 1, timeoutMs: 200 });
      
      const stats = limiter.getStats();
      expect(stats.totalDrops).toBeGreaterThan(0);
      expect(stats.totalWaits).toBeGreaterThan(0);
    }, 10000);
  });

  describe('reset', () => {
    it('should reset tokens to full capacity', async () => {
      await limiter.acquire({ cost: 15 });
      
      limiter.reset();
      
      const tokens = limiter.getTokens();
      expect(tokens).toBe(20); // burst capacity
    });
  });
});
