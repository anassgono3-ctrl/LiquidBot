/**
 * Unit tests for RpcBudget token bucket rate limiter
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { RpcBudget, getGlobalRpcBudget, resetGlobalRpcBudget } from '../../src/rpc/RpcBudget.js';

describe('RpcBudget', () => {
  describe('Token Bucket', () => {
    it('should start with full capacity', () => {
      const budget = new RpcBudget({ capacity: 100, refillRate: 50 });
      const metrics = budget.getMetrics();
      
      expect(metrics.currentTokens).toBe(100);
      expect(metrics.queueLength).toBe(0);
      expect(metrics.acquiredTotal).toBe(0);
    });

    it('should acquire tokens immediately when available', async () => {
      const budget = new RpcBudget({ capacity: 100, refillRate: 50, minSpacingMs: 0 });
      
      await budget.acquire(10);
      const metrics = budget.getMetrics();
      
      expect(metrics.acquiredTotal).toBe(1);
      expect(metrics.currentTokens).toBeLessThan(100);
    });

    it('should try acquire without blocking', () => {
      const budget = new RpcBudget({ capacity: 100, refillRate: 50, minSpacingMs: 0 });
      
      const acquired = budget.tryAcquire(10);
      expect(acquired).toBe(true);
      
      const metrics = budget.getMetrics();
      expect(metrics.acquiredTotal).toBe(1);
    });

    it('should queue requests when tokens exhausted', async () => {
      const budget = new RpcBudget({ capacity: 10, refillRate: 50, minSpacingMs: 0 });
      
      // Exhaust tokens
      await budget.acquire(10);
      
      // This should queue
      const promise = budget.acquire(5);
      
      // Check queue length before resolution
      const metrics = budget.getMetrics();
      expect(metrics.queueLength).toBeGreaterThan(0);
      
      // Wait for refill and processing
      await promise;
    }, 10000);

    it('should refill tokens over time', async () => {
      const budget = new RpcBudget({ capacity: 100, refillRate: 100, minSpacingMs: 0 });
      
      // Consume some tokens
      await budget.acquire(50);
      const metrics1 = budget.getMetrics();
      expect(metrics1.currentTokens).toBeLessThan(100);
      
      // Wait for refill (100 tokens/sec = 50 tokens in 500ms)
      await new Promise(resolve => setTimeout(resolve, 600));
      
      const metrics2 = budget.getMetrics();
      expect(metrics2.currentTokens).toBeGreaterThan(metrics1.currentTokens);
    }, 10000);

    it('should respect minimum spacing', async () => {
      const budget = new RpcBudget({ 
        capacity: 100, 
        refillRate: 1000, 
        minSpacingMs: 50,
        jitterMs: 0
      });
      
      const start = Date.now();
      await budget.acquire(1);
      await budget.acquire(1);
      const elapsed = Date.now() - start;
      
      // Should take at least minSpacingMs
      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow slight variance
    }, 10000);

    it('should add jitter to prevent thundering herd', async () => {
      const budget = new RpcBudget({ 
        capacity: 100, 
        refillRate: 1000, 
        minSpacingMs: 10,
        jitterMs: 20
      });
      
      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        const start = Date.now();
        await budget.acquire(1);
        times.push(Date.now() - start);
      }
      
      // Check that times vary (jitter is working)
      const allSame = times.every(t => t === times[0]);
      expect(allSame).toBe(false);
    }, 10000);

    it('should reset metrics', () => {
      const budget = new RpcBudget({ capacity: 100, refillRate: 50 });
      budget.tryAcquire(10);
      
      let metrics = budget.getMetrics();
      expect(metrics.acquiredTotal).toBe(1);
      
      budget.resetMetrics();
      
      metrics = budget.getMetrics();
      expect(metrics.acquiredTotal).toBe(0);
      expect(metrics.avgWaitMs).toBe(0);
    });
  });

  describe('Global Singleton', () => {
    beforeEach(() => {
      resetGlobalRpcBudget();
    });

    it('should return same instance on multiple calls', () => {
      const budget1 = getGlobalRpcBudget();
      const budget2 = getGlobalRpcBudget();
      
      expect(budget1).toBe(budget2);
    });

    it('should reset global instance', () => {
      const budget1 = getGlobalRpcBudget();
      resetGlobalRpcBudget();
      const budget2 = getGlobalRpcBudget();
      
      expect(budget1).not.toBe(budget2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent acquisitions', async () => {
      const budget = new RpcBudget({ capacity: 100, refillRate: 100, minSpacingMs: 0 });
      
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(budget.acquire(5));
      }
      
      await Promise.all(promises);
      
      const metrics = budget.getMetrics();
      expect(metrics.acquiredTotal).toBe(10);
    }, 10000);
  });
});
