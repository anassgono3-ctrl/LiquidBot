import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { HotlistManager } from '../../src/services/HotlistManager.js';

describe('HotlistManager', () => {
  let manager: HotlistManager;

  beforeEach(() => {
    manager = new HotlistManager({
      maxEntries: 10,
      minHf: 0.98,
      maxHf: 1.05,
      minDebtUsd: 100
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('consider', () => {
    it('should add user meeting criteria', () => {
      const result = manager.consider('0xUser1', 1.02, 500);
      expect(result).toBe(true);
      expect(manager.size()).toBe(1);
      expect(manager.has('0xUser1')).toBe(true);
    });

    it('should reject user with HF too low', () => {
      const result = manager.consider('0xUser1', 0.95, 500);
      expect(result).toBe(false);
      expect(manager.size()).toBe(0);
    });

    it('should reject user with HF too high', () => {
      const result = manager.consider('0xUser1', 1.10, 500);
      expect(result).toBe(false);
      expect(manager.size()).toBe(0);
    });

    it('should reject user with debt too low', () => {
      const result = manager.consider('0xUser1', 1.02, 50);
      expect(result).toBe(false);
      expect(manager.size()).toBe(0);
    });

    it('should update existing entry', () => {
      manager.consider('0xUser1', 1.02, 500);
      const firstEntry = manager.get('0xUser1');
      const firstCheckTime = firstEntry!.lastCheck;
      
      vi.advanceTimersByTime(1000);
      
      manager.consider('0xUser1', 1.03, 600);
      const updatedEntry = manager.get('0xUser1');
      
      expect(updatedEntry?.healthFactor).toBe(1.03);
      expect(updatedEntry?.totalDebtUsd).toBe(600);
      expect(updatedEntry?.lastCheck).toBeGreaterThanOrEqual(firstCheckTime + 1000);
    });

    it('should remove user from hotlist when criteria no longer met', () => {
      manager.consider('0xUser1', 1.02, 500);
      expect(manager.has('0xUser1')).toBe(true);
      
      // Update with HF outside range
      manager.consider('0xUser1', 1.10, 500);
      expect(manager.has('0xUser1')).toBe(false);
    });
  });

  describe('eviction when at capacity', () => {
    it('should evict lowest priority entry when adding new higher priority user', () => {
      // Fill hotlist to capacity with users of varying priority
      for (let i = 0; i < 10; i++) {
        const hf = 1.00 + (i * 0.005); // HF from 1.00 to 1.045
        const debt = 200 + (i * 50);
        manager.consider(`0xUser${i}`, hf, debt);
      }
      
      expect(manager.size()).toBe(10);
      
      // Add a higher priority user (closer to 1.0 with more debt)
      const result = manager.consider('0xHighPriority', 1.01, 1000);
      
      expect(result).toBe(true);
      expect(manager.size()).toBe(10); // Still at capacity
      expect(manager.has('0xHighPriority')).toBe(true);
    });

    it('should not add lower priority user when at capacity', () => {
      // Fill hotlist with high-priority users
      for (let i = 0; i < 10; i++) {
        manager.consider(`0xUser${i}`, 1.00, 1000);
      }
      
      // Try to add a lower priority user (further from 1.0 with less debt)
      const result = manager.consider('0xLowPriority', 1.04, 150);
      
      expect(result).toBe(false);
      expect(manager.size()).toBe(10);
      expect(manager.has('0xLowPriority')).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return entries sorted by priority', () => {
      manager.consider('0xUser1', 1.04, 200); // Low priority (far from 1.0, low debt)
      manager.consider('0xUser2', 1.00, 1000); // High priority (at 1.0, high debt)
      manager.consider('0xUser3', 1.02, 500); // Medium priority
      
      const all = manager.getAll();
      expect(all).toHaveLength(3);
      
      // First should be highest priority (closest to 1.0 with high debt)
      expect(all[0].address).toBe('0xuser2');
      // Last should be lowest priority
      expect(all[2].address).toBe('0xuser1');
    });
  });

  describe('touch', () => {
    it('should update lastCheck timestamp', () => {
      manager.consider('0xUser1', 1.02, 500);
      const initialEntry = manager.get('0xUser1');
      const initialCheckTime = initialEntry!.lastCheck;
      
      vi.advanceTimersByTime(5000);
      manager.touch('0xUser1');
      
      const updatedEntry = manager.get('0xUser1');
      expect(updatedEntry?.lastCheck).toBeGreaterThanOrEqual(initialCheckTime + 5000);
    });

    it('should not fail for non-existent user', () => {
      expect(() => manager.touch('0xNonExistent')).not.toThrow();
    });
  });

  describe('getNeedingRevisit', () => {
    it('should return users that haven\'t been checked recently', () => {
      manager.consider('0xUser1', 1.02, 500);
      manager.consider('0xUser2', 1.03, 600);
      
      // Advance time for User1 only
      vi.advanceTimersByTime(10000);
      manager.touch('0xUser2'); // Update User2's lastCheck
      
      const needRevisit = manager.getNeedingRevisit(5);
      expect(needRevisit).toHaveLength(1);
      expect(needRevisit[0]).toBe('0xuser1');
    });

    it('should return empty array when all users recently checked', () => {
      manager.consider('0xUser1', 1.02, 500);
      manager.consider('0xUser2', 1.03, 600);
      
      vi.advanceTimersByTime(2000); // Only 2 seconds
      
      const needRevisit = manager.getNeedingRevisit(5);
      expect(needRevisit).toHaveLength(0);
    });

    it('should return all users when none checked recently', () => {
      manager.consider('0xUser1', 1.02, 500);
      manager.consider('0xUser2', 1.03, 600);
      manager.consider('0xUser3', 1.01, 700);
      
      vi.advanceTimersByTime(10000);
      
      const needRevisit = manager.getNeedingRevisit(5);
      expect(needRevisit).toHaveLength(3);
    });
  });

  describe('priority calculation', () => {
    it('should prioritize users closer to HF=1.0', () => {
      manager.consider('0xUserCloser', 1.01, 500);
      manager.consider('0xUserFarther', 1.04, 500);
      
      const all = manager.getAll();
      expect(all[0].address).toBe('0xusercloser');
    });

    it('should consider debt size in priority', () => {
      manager.consider('0xUserBigDebt', 1.02, 2000);
      manager.consider('0xUserSmallDebt', 1.02, 200);
      
      const all = manager.getAll();
      expect(all[0].address).toBe('0xuserbigdebt');
    });

    it('should weight HF proximity more than debt size', () => {
      // User very close to 1.0 with small debt
      manager.consider('0xCloseSmall', 1.005, 150);
      // User farther from 1.0 with large debt
      manager.consider('0xFarLarge', 1.04, 5000);
      
      const all = manager.getAll();
      // Closer HF should win despite smaller debt
      expect(all[0].address).toBe('0xclosesmall');
    });
  });

  describe('edge cases', () => {
    it('should handle exact HF boundaries', () => {
      expect(manager.consider('0xMinHf', 0.98, 500)).toBe(true);
      expect(manager.consider('0xMaxHf', 1.05, 500)).toBe(true);
      expect(manager.consider('0xBelowMin', 0.979, 500)).toBe(false);
      expect(manager.consider('0xAboveMax', 1.051, 500)).toBe(false);
    });

    it('should handle exact debt boundary', () => {
      expect(manager.consider('0xMinDebt', 1.02, 100)).toBe(true);
      expect(manager.consider('0xBelowMinDebt', 1.02, 99.99)).toBe(false);
    });

    it('should normalize addresses', () => {
      manager.consider('0xUSER1', 1.02, 500);
      expect(manager.has('0xuser1')).toBe(true);
      expect(manager.has('0xUSER1')).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      manager.consider('0xUser1', 1.02, 500);
      manager.consider('0xUser2', 1.03, 600);
      expect(manager.size()).toBe(2);
      
      manager.clear();
      expect(manager.size()).toBe(0);
      expect(manager.getAll()).toHaveLength(0);
    });
  });

  describe('getConfig', () => {
    it('should return configuration', () => {
      const config = manager.getConfig();
      expect(config.maxEntries).toBe(10);
      expect(config.minHf).toBe(0.98);
      expect(config.maxHf).toBe(1.05);
      expect(config.minDebtUsd).toBe(100);
    });
  });
});
