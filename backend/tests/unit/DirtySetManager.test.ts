import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DirtySetManager } from '../../src/services/DirtySetManager.js';

describe('DirtySetManager', () => {
  let manager: DirtySetManager;

  beforeEach(() => {
    manager = new DirtySetManager({ ttlSec: 10 });
    // Mock Date.now for predictable testing
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('mark', () => {
    it('should mark a user as dirty', () => {
      manager.mark('0xUser1', 'borrow');
      expect(manager.isDirty('0xUser1')).toBe(true);
      expect(manager.size()).toBe(1);
    });

    it('should normalize addresses to lowercase', () => {
      manager.mark('0xUSER1', 'borrow');
      expect(manager.isDirty('0xuser1')).toBe(true);
      expect(manager.isDirty('0xUSER1')).toBe(true);
    });

    it('should add multiple reasons for the same user', () => {
      manager.mark('0xUser1', 'borrow');
      manager.mark('0xUser1', 'repay');
      
      const entry = manager.get('0xUser1');
      expect(entry).toBeDefined();
      expect(entry?.reasons.has('borrow')).toBe(true);
      expect(entry?.reasons.has('repay')).toBe(true);
      expect(manager.size()).toBe(1);
    });

    it('should update lastMarkedAt when remarking', () => {
      const now = Date.now();
      manager.mark('0xUser1', 'borrow');
      
      vi.advanceTimersByTime(5000); // Advance 5 seconds
      manager.mark('0xUser1', 'repay');
      
      const entry = manager.get('0xUser1');
      expect(entry?.lastMarkedAt).toBeGreaterThan(now);
    });
  });

  describe('markBulk', () => {
    it('should mark multiple users with the same reason', () => {
      manager.markBulk(['0xUser1', '0xUser2', '0xUser3'], 'price');
      
      expect(manager.size()).toBe(3);
      expect(manager.isDirty('0xUser1')).toBe(true);
      expect(manager.isDirty('0xUser2')).toBe(true);
      expect(manager.isDirty('0xUser3')).toBe(true);
    });
  });

  describe('consume', () => {
    it('should remove a dirty user', () => {
      manager.mark('0xUser1', 'borrow');
      expect(manager.isDirty('0xUser1')).toBe(true);
      
      const entry = manager.consume('0xUser1');
      expect(entry).toBeDefined();
      expect(entry?.address).toBe('0xuser1');
      expect(manager.isDirty('0xUser1')).toBe(false);
      expect(manager.size()).toBe(0);
    });

    it('should return undefined for non-existent user', () => {
      const entry = manager.consume('0xNonExistent');
      expect(entry).toBeUndefined();
    });
  });

  describe('consumeBulk', () => {
    it('should consume multiple users', () => {
      manager.markBulk(['0xUser1', '0xUser2', '0xUser3'], 'event');
      
      const consumed = manager.consumeBulk(['0xUser1', '0xUser3']);
      expect(consumed.size).toBe(2);
      expect(consumed.has('0xUser1')).toBe(true);
      expect(consumed.has('0xUser3')).toBe(true);
      
      expect(manager.size()).toBe(1);
      expect(manager.isDirty('0xUser2')).toBe(true);
    });
  });

  describe('getIntersection', () => {
    it('should find dirty users in a given set', () => {
      manager.markBulk(['0xUser1', '0xUser2', '0xUser3'], 'event');
      
      const candidates = ['0xUser2', '0xUser4', '0xUser5'];
      const intersection = manager.getIntersection(candidates);
      
      expect(intersection).toHaveLength(1);
      expect(intersection[0]).toBe('0xUser2');
    });

    it('should work with Set input', () => {
      manager.markBulk(['0xUser1', '0xUser2'], 'event');
      
      const candidateSet = new Set(['0xUser1', '0xUser4']);
      const intersection = manager.getIntersection(candidateSet);
      
      expect(intersection).toHaveLength(1);
      expect(intersection[0]).toBe('0xUser1');
    });

    it('should return empty array when no intersection', () => {
      manager.mark('0xUser1', 'event');
      
      const candidates = ['0xUser2', '0xUser3'];
      const intersection = manager.getIntersection(candidates);
      
      expect(intersection).toHaveLength(0);
    });
  });

  describe('getReasonStats', () => {
    it('should return counts for each reason', () => {
      manager.mark('0xUser1', 'borrow');
      manager.mark('0xUser2', 'borrow');
      manager.mark('0xUser3', 'price');
      manager.mark('0xUser1', 'repay'); // User1 has both borrow and repay
      
      const stats = manager.getReasonStats();
      expect(stats['borrow']).toBe(2);
      expect(stats['price']).toBe(1);
      expect(stats['repay']).toBe(1);
    });

    it('should return empty object when no entries', () => {
      const stats = manager.getReasonStats();
      expect(stats).toEqual({});
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', () => {
      manager.mark('0xUser1', 'borrow');
      expect(manager.isDirty('0xUser1')).toBe(true);
      expect(manager.size()).toBe(1);
      
      // Advance time beyond TTL (10 seconds)
      vi.advanceTimersByTime(11000);
      
      expect(manager.isDirty('0xUser1')).toBe(false);
      expect(manager.size()).toBe(0);
    });

    it('should not expire entries within TTL', () => {
      manager.mark('0xUser1', 'borrow');
      expect(manager.isDirty('0xUser1')).toBe(true);
      
      // Advance time within TTL (5 seconds out of 10)
      vi.advanceTimersByTime(5000);
      
      expect(manager.isDirty('0xUser1')).toBe(true);
      expect(manager.size()).toBe(1);
    });

    it('should refresh TTL when user is remarked', () => {
      manager.mark('0xUser1', 'borrow');
      
      // Advance 8 seconds (close to TTL)
      vi.advanceTimersByTime(8000);
      
      // Remark user (refreshes TTL)
      manager.mark('0xUser1', 'repay');
      
      // Advance another 8 seconds (would have expired without refresh)
      vi.advanceTimersByTime(8000);
      
      // Should still be dirty because TTL was refreshed
      expect(manager.isDirty('0xUser1')).toBe(true);
    });

    it('should expire some entries while keeping others', () => {
      manager.mark('0xUser1', 'borrow');
      
      // Advance 5 seconds
      vi.advanceTimersByTime(5000);
      
      manager.mark('0xUser2', 'borrow');
      
      // Advance 7 more seconds (total 12 for User1, 7 for User2)
      vi.advanceTimersByTime(7000);
      
      expect(manager.isDirty('0xUser1')).toBe(false); // Expired
      expect(manager.isDirty('0xUser2')).toBe(true);  // Still valid
      expect(manager.size()).toBe(1);
    });
  });

  describe('getAllEntries', () => {
    it('should return all entries with details', () => {
      manager.mark('0xUser1', 'borrow');
      manager.mark('0xUser2', 'price');
      
      const entries = manager.getAllEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].address).toBeDefined();
      expect(entries[0].reasons).toBeInstanceOf(Set);
      expect(entries[0].firstMarkedAt).toBeDefined();
      expect(entries[0].lastMarkedAt).toBeDefined();
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      manager.markBulk(['0xUser1', '0xUser2', '0xUser3'], 'event');
      expect(manager.size()).toBe(3);
      
      manager.clear();
      expect(manager.size()).toBe(0);
      expect(manager.getAll()).toHaveLength(0);
    });
  });

  describe('deduplication within short windows', () => {
    it('should deduplicate marks in the same operation', () => {
      manager.mark('0xUser1', 'borrow');
      manager.mark('0xUser1', 'borrow'); // Same reason
      manager.mark('0xUser1', 'borrow'); // Same reason again
      
      const entry = manager.get('0xUser1');
      expect(entry?.reasons.size).toBe(1);
      expect(entry?.reasons.has('borrow')).toBe(true);
    });
  });
});
