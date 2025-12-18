import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScanConcurrencyController } from '../../src/services/ScanConcurrencyController.js';

describe('ScanConcurrencyController', () => {
  let controller: ScanConcurrencyController;

  beforeEach(() => {
    controller = new ScanConcurrencyController();
    vi.useFakeTimers();
  });

  it('should acquire lock for new scan', () => {
    const acquired = controller.tryAcquireLock('price', 12345);
    expect(acquired).toBe(true);
  });

  it('should prevent duplicate price-trigger scans for same block', () => {
    const first = controller.tryAcquireLock('price', 12345);
    const second = controller.tryAcquireLock('price', 12345);
    
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('should allow different trigger types concurrently', () => {
    const priceAcquired = controller.tryAcquireLock('price', 12345);
    const headAcquired = controller.tryAcquireLock('head', 12345);
    
    expect(priceAcquired).toBe(true);
    expect(headAcquired).toBe(true);
  });

  it('should allow same trigger type for different blocks', () => {
    const block1 = controller.tryAcquireLock('price', 12345);
    const block2 = controller.tryAcquireLock('price', 12346);
    
    expect(block1).toBe(true);
    expect(block2).toBe(true);
  });

  it('should release lock and allow re-acquisition', () => {
    const first = controller.tryAcquireLock('price', 12345);
    controller.releaseLock('price', 12345);
    const second = controller.tryAcquireLock('price', 12345);
    
    expect(first).toBe(true);
    expect(second).toBe(true);
  });

  it('should handle reserve-specific locks', () => {
    const reserve1 = controller.tryAcquireLock('reserve', 12345, '0xabc');
    const reserve2 = controller.tryAcquireLock('reserve', 12345, '0xdef');
    
    expect(reserve1).toBe(true);
    expect(reserve2).toBe(true);
  });

  it('should prevent duplicate reserve scans', () => {
    const first = controller.tryAcquireLock('reserve', 12345, '0xabc');
    const second = controller.tryAcquireLock('reserve', 12345, '0xabc');
    
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('should expire stale locks', () => {
    controller.tryAcquireLock('price', 12345);
    
    // Advance time by 31 seconds (past 30s timeout)
    vi.advanceTimersByTime(31000);
    
    const secondAttempt = controller.tryAcquireLock('price', 12345);
    expect(secondAttempt).toBe(true);
  });

  it('should clean up expired locks', () => {
    controller.tryAcquireLock('price', 12345);
    controller.tryAcquireLock('head', 12346);
    
    expect(controller.getActiveLockCount()).toBe(2);
    
    // Advance time to expire locks
    vi.advanceTimersByTime(31000);
    
    const cleaned = controller.cleanupExpired();
    expect(cleaned).toBe(2);
    expect(controller.getActiveLockCount()).toBe(0);
  });

  it('should check if scan is in-flight', () => {
    controller.tryAcquireLock('price', 12345);
    
    expect(controller.isInFlight('price', 12345)).toBe(true);
    expect(controller.isInFlight('price', 12346)).toBe(false);
    
    controller.releaseLock('price', 12345);
    expect(controller.isInFlight('price', 12345)).toBe(false);
  });
});
