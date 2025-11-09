import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DirtySetManager } from '../../src/services/DirtySetManager.js';
import { HotlistManager } from '../../src/services/HotlistManager.js';

describe('Dirty Pipeline Integration', () => {
  let dirtySet: DirtySetManager;
  let hotlist: HotlistManager;

  beforeEach(() => {
    dirtySet = new DirtySetManager({ ttlSec: 90 });
    hotlist = new HotlistManager({
      maxEntries: 100,
      minHf: 0.98,
      maxHf: 1.05,
      minDebtUsd: 100
    });
  });

  afterEach(() => {
    dirtySet.clear();
    hotlist.clear();
  });

  describe('Event-driven flow', () => {
    it('should mark users as dirty from events', () => {
      // Simulate Aave events
      dirtySet.mark('0xUser1', 'borrow');
      dirtySet.mark('0xUser2', 'repay');
      dirtySet.mark('0xUser3', 'supply');

      expect(dirtySet.size()).toBe(3);
      expect(dirtySet.isDirty('0xUser1')).toBe(true);
      expect(dirtySet.isDirty('0xUser2')).toBe(true);
      expect(dirtySet.isDirty('0xUser3')).toBe(true);
    });

    it('should track multiple reasons for the same user', () => {
      dirtySet.mark('0xUser1', 'borrow');
      dirtySet.mark('0xUser1', 'supply');

      const entry = dirtySet.get('0xUser1');
      expect(entry).toBeDefined();
      expect(entry?.reasons.has('borrow')).toBe(true);
      expect(entry?.reasons.has('supply')).toBe(true);
      expect(dirtySet.size()).toBe(1);
    });

    it('should generate reason stats', () => {
      dirtySet.mark('0xUser1', 'borrow');
      dirtySet.mark('0xUser2', 'borrow');
      dirtySet.mark('0xUser3', 'supply');
      dirtySet.mark('0xUser4', 'price');

      const stats = dirtySet.getReasonStats();
      expect(stats['borrow']).toBe(2);
      expect(stats['supply']).toBe(1);
      expect(stats['price']).toBe(1);
    });
  });

  describe('Price-trigger flow', () => {
    it('should mark users as dirty from price drops', () => {
      // Simulate price trigger marking multiple users
      const affectedUsers = ['0xUser1', '0xUser2', '0xUser3', '0xUser4'];
      dirtySet.markBulk(affectedUsers, 'price');

      expect(dirtySet.size()).toBe(4);
      
      const stats = dirtySet.getReasonStats();
      expect(stats['price']).toBe(4);
    });

    it('should combine price and event reasons', () => {
      dirtySet.mark('0xUser1', 'borrow');
      dirtySet.mark('0xUser1', 'price'); // User affected by both event and price

      const entry = dirtySet.get('0xUser1');
      expect(entry?.reasons.has('borrow')).toBe(true);
      expect(entry?.reasons.has('price')).toBe(true);
      expect(entry?.reasons.size).toBe(2);
    });
  });

  describe('Head page integration', () => {
    it('should find intersection of dirty users with page candidates', () => {
      // Mark some users as dirty
      dirtySet.mark('0xUser2', 'borrow');
      dirtySet.mark('0xUser4', 'repay');
      dirtySet.mark('0xUser6', 'price');

      // Simulate page containing a subset of these users
      const pageCandidates = ['0xUser1', '0xUser2', '0xUser3', '0xUser4', '0xUser5'];
      const dirtyOnPage = dirtySet.getIntersection(pageCandidates);

      // Should find users 2 and 4 (which are both dirty and on page)
      expect(dirtyOnPage).toHaveLength(2);
      expect(dirtyOnPage).toContain('0xUser2');
      expect(dirtyOnPage).toContain('0xUser4');
    });

    it('should consume dirty users after checking', () => {
      dirtySet.mark('0xUser1', 'borrow');
      dirtySet.mark('0xUser2', 'repay');

      expect(dirtySet.size()).toBe(2);

      // Simulate consuming users after head check
      const consumed1 = dirtySet.consume('0xUser1');
      expect(consumed1).toBeDefined();
      expect(consumed1?.reasons.has('borrow')).toBe(true);
      expect(dirtySet.size()).toBe(1);

      const consumed2 = dirtySet.consume('0xUser2');
      expect(consumed2).toBeDefined();
      expect(dirtySet.size()).toBe(0);
    });
  });

  describe('Hotlist integration', () => {
    it('should promote users with HF near 1.0 and meaningful debt', () => {
      // Users meeting hotlist criteria
      expect(hotlist.consider('0xUser1', 1.02, 500)).toBe(true);
      expect(hotlist.consider('0xUser2', 1.00, 1000)).toBe(true);
      expect(hotlist.consider('0xUser3', 0.99, 200)).toBe(true);

      expect(hotlist.size()).toBe(3);
    });

    it('should reject users outside HF range', () => {
      // HF too low
      expect(hotlist.consider('0xUser1', 0.95, 500)).toBe(false);
      // HF too high
      expect(hotlist.consider('0xUser2', 1.10, 500)).toBe(false);
      // Debt too low
      expect(hotlist.consider('0xUser3', 1.02, 50)).toBe(false);

      expect(hotlist.size()).toBe(0);
    });

    it('should prioritize users closer to HF=1.0', () => {
      hotlist.consider('0xUserFar', 1.04, 500);
      hotlist.consider('0xUserClose', 1.01, 500);
      hotlist.consider('0xUserAtEdge', 1.00, 500);

      const all = hotlist.getAll();
      // Closest to 1.0 should be first
      expect(all[0].address).toBe('0xuseratedge');
      expect(all[1].address).toBe('0xuserclose');
      expect(all[2].address).toBe('0xuserfar');
    });

    it('should identify users needing revisit', () => {
      hotlist.consider('0xUser1', 1.02, 500);
      hotlist.consider('0xUser2', 1.03, 600);

      // Initially, no users need revisit (just added)
      let needRevisit = hotlist.getNeedingRevisit(5);
      expect(needRevisit).toHaveLength(0);

      // Manually set lastCheck to simulate time passing
      const entry1 = hotlist.get('0xUser1');
      const entry2 = hotlist.get('0xUser2');
      if (entry1) entry1.lastCheck = Date.now() - 10000; // 10 seconds ago
      if (entry2) entry2.lastCheck = Date.now() - 2000;  // 2 seconds ago

      needRevisit = hotlist.getNeedingRevisit(5);
      // Only User1 needs revisit (older than 5 seconds)
      expect(needRevisit).toHaveLength(1);
      expect(needRevisit[0]).toBe('0xuser1');
    });
  });

  describe('Combined workflow', () => {
    it('should handle typical liquidation detection flow', () => {
      // Step 1: Event marks user as dirty
      dirtySet.mark('0xUser1', 'borrow');

      // Step 2: Head page finds dirty user
      const pageCandidates = ['0xUser1', '0xUser2', '0xUser3'];
      const dirtyOnPage = dirtySet.getIntersection(pageCandidates);
      expect(dirtyOnPage).toContain('0xUser1');

      // Step 3: HF check reveals low HF, promote to hotlist
      const lowHf = 1.02;
      const debt = 500;
      hotlist.consider('0xUser1', lowHf, debt);
      expect(hotlist.has('0xUser1')).toBe(true);

      // Step 4: Consume dirty entry after check
      const consumed = dirtySet.consume('0xUser1');
      expect(consumed).toBeDefined();
      expect(consumed?.reasons.has('borrow')).toBe(true);

      // Step 5: Hotlist tracks for frequent revisit
      expect(hotlist.size()).toBe(1);
    });

    it('should handle price-triggered emergency scan workflow', () => {
      // Step 1: Price drops, mark multiple users as dirty
      const exposedUsers = ['0xUser1', '0xUser2', '0xUser3'];
      dirtySet.markBulk(exposedUsers, 'price');

      // Step 2: Emergency scan checks these users
      const stats = dirtySet.getReasonStats();
      expect(stats['price']).toBe(3);

      // Step 3: Some users are near liquidation, add to hotlist
      hotlist.consider('0xUser1', 1.01, 600);
      hotlist.consider('0xUser2', 1.03, 400);

      expect(hotlist.size()).toBe(2);

      // Step 4: Consume dirty entries
      dirtySet.consumeBulk(exposedUsers);
      expect(dirtySet.size()).toBe(0);
    });
  });

  describe('Schema compatibility', () => {
    it('should support trigger reasons for dump compatibility', () => {
      // Mark user with multiple reasons
      dirtySet.mark('0xUser1', 'borrow');
      dirtySet.mark('0xUser1', 'supply');

      const entry = dirtySet.get('0xUser1');
      expect(entry).toBeDefined();

      // Convert to array for schema (backward compatible)
      const triggerReasons = Array.from(entry!.reasons);
      expect(triggerReasons).toContain('borrow');
      expect(triggerReasons).toContain('supply');

      // Schema can use this for triggerReasons field
      const schemaEntry = {
        address: entry!.address,
        triggerType: 'event' as const, // Can be 'event', 'price', or 'head'
        triggerReasons: triggerReasons.length > 0 ? triggerReasons : undefined
      };

      expect(schemaEntry.triggerType).toBe('event');
      expect(schemaEntry.triggerReasons).toEqual(expect.arrayContaining(['borrow', 'supply']));
    });
  });
});
