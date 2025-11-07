import { describe, it, expect, beforeEach } from 'vitest';

import { CandidateManager } from '../../src/services/CandidateManager.js';

describe('CandidateManager', () => {
  let manager: CandidateManager;

  beforeEach(() => {
    manager = new CandidateManager({ maxCandidates: 5 });
  });

  describe('add', () => {
    it('should add a new candidate', () => {
      manager.add('0x123');
      expect(manager.size()).toBe(1);
      expect(manager.get('0x123')).toBeDefined();
    });

    it('should add candidate with HF', () => {
      manager.add('0x123', 0.95);
      const candidate = manager.get('0x123');
      expect(candidate?.lastHF).toBe(0.95);
      expect(candidate?.lastCheck).toBeGreaterThan(0);
    });

    it('should update existing candidate', () => {
      manager.add('0x123', 0.95);
      const first = manager.get('0x123');
      
      // Wait a bit to ensure timestamp changes
      const delay = new Promise(resolve => setTimeout(resolve, 10));
      return delay.then(() => {
        manager.add('0x123', 0.98);
        const updated = manager.get('0x123');
        expect(updated?.lastHF).toBe(0.98);
        expect(updated?.touchedAt).toBeGreaterThanOrEqual(first!.touchedAt);
      });
    });

    it('should evict when exceeding max candidates', () => {
      // Add 5 candidates (at max)
      manager.add('0x1', 1.5);
      manager.add('0x2', 1.4);
      manager.add('0x3', 0.95);
      manager.add('0x4', 0.90);
      manager.add('0x5', 1.2);
      expect(manager.size()).toBe(5);

      // Add 6th candidate - should evict healthiest (highest HF)
      manager.add('0x6', 0.85);
      expect(manager.size()).toBe(5);
      expect(manager.get('0x6')).toBeDefined();
      
      // One of the healthy ones should be evicted
      // (either 0x1 with 1.5 or 0x2 with 1.4)
      const has1 = manager.get('0x1') !== undefined;
      const has2 = manager.get('0x2') !== undefined;
      expect(has1 || has2).toBe(true); // at least one healthy survives
      expect(has1 && has2).toBe(false); // but not both
    });
  });

  describe('updateHF', () => {
    it('should update HF for existing candidate', () => {
      manager.add('0x123', 0.95);
      manager.updateHF('0x123', 0.98);
      expect(manager.get('0x123')?.lastHF).toBe(0.98);
    });

    it('should not error for non-existent candidate', () => {
      expect(() => manager.updateHF('0xnone', 0.95)).not.toThrow();
    });
  });

  describe('touch', () => {
    it('should update touchedAt timestamp', () => {
      manager.add('0x123', 0.95);
      const before = manager.get('0x123')?.touchedAt || 0;
      
      const delay = new Promise(resolve => setTimeout(resolve, 10));
      return delay.then(() => {
        manager.touch('0x123');
        const after = manager.get('0x123')?.touchedAt || 0;
        expect(after).toBeGreaterThanOrEqual(before);
      });
    });
  });

  describe('getLowestHF', () => {
    it('should return candidate with lowest HF', () => {
      manager.add('0x1', 1.5);
      manager.add('0x2', 0.90);
      manager.add('0x3', 0.95);
      
      const lowest = manager.getLowestHF();
      expect(lowest?.address).toBe('0x2');
      expect(lowest?.lastHF).toBe(0.90);
    });

    it('should return null when no candidates have HF', () => {
      manager.add('0x1');
      manager.add('0x2');
      expect(manager.getLowestHF()).toBeNull();
    });

    it('should return null when no candidates', () => {
      expect(manager.getLowestHF()).toBeNull();
    });
  });

  describe('getStale', () => {
    it('should return candidates past staleness threshold', async () => {
      manager.add('0x1', 0.95);
      
      // Wait 20ms
      await new Promise(resolve => setTimeout(resolve, 20));
      
      manager.add('0x2', 0.98);
      
      // 0x1 checked 20ms+ ago, should be stale with 15ms threshold
      const stale = manager.getStale(15);
      expect(stale.length).toBe(1);
      expect(stale[0].address).toBe('0x1');
    });

    it('should return empty when all fresh', () => {
      manager.add('0x1', 0.95);
      manager.add('0x2', 0.98);
      
      const stale = manager.getStale(10000); // 10s threshold
      expect(stale.length).toBe(0);
    });
  });

  describe('bulk operations', () => {
    it('should add multiple candidates at once', () => {
      manager.addBulk(['0x1', '0x2', '0x3']);
      expect(manager.size()).toBe(3);
      expect(manager.get('0x1')).toBeDefined();
      expect(manager.get('0x2')).toBeDefined();
      expect(manager.get('0x3')).toBeDefined();
    });

    it('should get all addresses', () => {
      manager.add('0x1');
      manager.add('0x2');
      const addresses = manager.getAddresses();
      expect(addresses).toContain('0x1');
      expect(addresses).toContain('0x2');
      expect(addresses.length).toBe(2);
    });

    it('should get all candidates', () => {
      manager.add('0x1', 0.95);
      manager.add('0x2', 0.98);
      const all = manager.getAll();
      expect(all.length).toBe(2);
    });
  });

  describe('clear and remove', () => {
    it('should remove specific candidate', () => {
      manager.add('0x1');
      manager.add('0x2');
      manager.remove('0x1');
      expect(manager.size()).toBe(1);
      expect(manager.get('0x1')).toBeUndefined();
      expect(manager.get('0x2')).toBeDefined();
    });

    it('should clear all candidates', () => {
      manager.add('0x1');
      manager.add('0x2');
      manager.clear();
      expect(manager.size()).toBe(0);
    });
  });

  describe('reserve tracking', () => {
    it('should track reserve associations via touch', () => {
      manager.add('0xuser1');
      manager.touch('0xuser1', '0xETH');
      
      const users = manager.getUsersForReserve('0xETH');
      expect(users).toContain('0xuser1');
    });

    it('should track reserve associations via touchReserve', () => {
      manager.add('0xuser1');
      manager.touchReserve('0xuser1', '0xUSDC');
      
      const users = manager.getUsersForReserve('0xUSDC');
      expect(users).toContain('0xuser1');
    });

    it('should normalize reserve addresses to lowercase', () => {
      manager.add('0xuser1');
      manager.touchReserve('0xuser1', '0xETH');
      
      const users = manager.getUsersForReserve('0xeth');
      expect(users).toContain('0xuser1');
    });

    it('should return multiple users for same reserve', () => {
      manager.add('0xuser1');
      manager.add('0xuser2');
      manager.touchReserve('0xuser1', '0xETH');
      manager.touchReserve('0xuser2', '0xETH');
      
      const users = manager.getUsersForReserve('0xETH');
      expect(users).toContain('0xuser1');
      expect(users).toContain('0xuser2');
      expect(users.length).toBe(2);
    });

    it('should return empty array for unknown reserve', () => {
      const users = manager.getUsersForReserve('0xunknown');
      expect(users).toEqual([]);
    });

    it('should limit reserves per user to 5', () => {
      manager.add('0xuser1');
      manager.touchReserve('0xuser1', '0xreserve1');
      manager.touchReserve('0xuser1', '0xreserve2');
      manager.touchReserve('0xuser1', '0xreserve3');
      manager.touchReserve('0xuser1', '0xreserve4');
      manager.touchReserve('0xuser1', '0xreserve5');
      manager.touchReserve('0xuser1', '0xreserve6');
      
      // Should have evicted oldest reserve
      const allReserves = [
        manager.getUsersForReserve('0xreserve1'),
        manager.getUsersForReserve('0xreserve2'),
        manager.getUsersForReserve('0xreserve3'),
        manager.getUsersForReserve('0xreserve4'),
        manager.getUsersForReserve('0xreserve5'),
        manager.getUsersForReserve('0xreserve6')
      ];
      
      const nonEmpty = allReserves.filter(arr => arr.length > 0);
      expect(nonEmpty.length).toBe(5);
    });

    it('should clean up reserve associations when removing candidate', () => {
      manager.add('0xuser1');
      manager.touchReserve('0xuser1', '0xETH');
      
      manager.remove('0xuser1');
      
      const users = manager.getUsersForReserve('0xETH');
      expect(users).not.toContain('0xuser1');
    });

    it('should clean up all reserve associations when clearing', () => {
      manager.add('0xuser1');
      manager.add('0xuser2');
      manager.touchReserve('0xuser1', '0xETH');
      manager.touchReserve('0xuser2', '0xUSDC');
      
      manager.clear();
      
      expect(manager.getUsersForReserve('0xETH')).toEqual([]);
      expect(manager.getUsersForReserve('0xUSDC')).toEqual([]);
    });
  });
});
