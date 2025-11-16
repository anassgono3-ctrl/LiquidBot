import { describe, it, expect, beforeEach } from 'vitest';
import { SecondOrderChainer } from '../../../src/exec/fastpath/SecondOrderChainer.js';

describe('SecondOrderChainer', () => {
  let chainer: SecondOrderChainer;
  const user1 = '0x1111111111111111111111111111111111111111';
  const user2 = '0x2222222222222222222222222222222222222222';
  const user3 = '0x3333333333333333333333333333333333333333';
  const collateralAsset = '0xCollateral';
  const debtAsset = '0xDebt';

  beforeEach(() => {
    chainer = new SecondOrderChainer(true);
    chainer.reset();
  });

  describe('onCompetitorLiquidation', () => {
    it('should queue affected user', () => {
      const candidates = chainer.onCompetitorLiquidation(
        user1,
        collateralAsset,
        debtAsset,
        new Set()
      );

      expect(candidates).toHaveLength(1);
      expect(candidates[0].user).toBe(user1);
      expect(candidates[0].reason).toBe('affected_user');
    });

    it('should queue collateral borrowers', () => {
      const borrowers = new Set([user2, user3]);
      const candidates = chainer.onCompetitorLiquidation(
        user1,
        collateralAsset,
        debtAsset,
        borrowers
      );

      expect(candidates).toHaveLength(3); // user1 + 2 borrowers
      expect(candidates.some(c => c.user === user1)).toBe(true);
      expect(candidates.some(c => c.user === user2)).toBe(true);
      expect(candidates.some(c => c.user === user3)).toBe(true);
    });

    it('should not duplicate users', () => {
      chainer.onCompetitorLiquidation(user1, collateralAsset, debtAsset, new Set());
      const candidates2 = chainer.onCompetitorLiquidation(
        user1,
        collateralAsset,
        debtAsset,
        new Set()
      );

      expect(candidates2).toHaveLength(0);
    });

    it('should not queue liquidated user as borrower', () => {
      const borrowers = new Set([user1, user2]); // user1 is also liquidated
      const candidates = chainer.onCompetitorLiquidation(
        user1,
        collateralAsset,
        debtAsset,
        borrowers
      );

      // Should only have user1 (affected) and user2 (borrower), not user1 twice
      expect(candidates).toHaveLength(2);
      expect(candidates.filter(c => c.user === user1)).toHaveLength(1);
    });

    it('should return empty array when disabled', () => {
      const disabledChainer = new SecondOrderChainer(false);
      const candidates = disabledChainer.onCompetitorLiquidation(
        user1,
        collateralAsset,
        debtAsset,
        new Set([user2])
      );

      expect(candidates).toHaveLength(0);
    });
  });

  describe('filterByHealthFactor', () => {
    it('should filter candidates by HF threshold', () => {
      const candidates = [
        { user: user1, reason: 'affected_user' as const, queuedAt: Date.now() },
        { user: user2, reason: 'collateral_borrower' as const, queuedAt: Date.now() },
        { user: user3, reason: 'collateral_borrower' as const, queuedAt: Date.now() }
      ];

      const healthFactors = new Map([
        [user1.toLowerCase(), 1.01], // Below threshold
        [user2.toLowerCase(), 1.05], // Above threshold
        [user3.toLowerCase(), 1.02]  // Below threshold
      ]);

      const filtered = chainer.filterByHealthFactor(candidates, healthFactors);
      
      expect(filtered).toHaveLength(2);
      expect(filtered.some(c => c.user === user1)).toBe(true);
      expect(filtered.some(c => c.user === user3)).toBe(true);
      expect(filtered.some(c => c.user === user2)).toBe(false);
    });

    it('should update health factor in candidates', () => {
      const candidates = [
        { user: user1, reason: 'affected_user' as const, queuedAt: Date.now() }
      ];

      const healthFactors = new Map([[user1.toLowerCase(), 1.01]]);
      const filtered = chainer.filterByHealthFactor(candidates, healthFactors);

      expect(filtered[0].healthFactor).toBe(1.01);
    });
  });

  describe('queue management', () => {
    it('should dequeue candidates in order', () => {
      chainer.onCompetitorLiquidation(user1, collateralAsset, debtAsset, new Set([user2]));

      const first = chainer.dequeue();
      expect(first?.user).toBe(user1);

      const second = chainer.dequeue();
      expect(second?.user).toBe(user2);

      const third = chainer.dequeue();
      expect(third).toBeUndefined();
    });

    it('should return queue', () => {
      chainer.onCompetitorLiquidation(user1, collateralAsset, debtAsset, new Set([user2]));

      const queue = chainer.getQueue();
      expect(queue).toHaveLength(2);
    });
  });

  describe('markExecuted', () => {
    it('should record execution metric', () => {
      expect(() => chainer.markExecuted(user1)).not.toThrow();
    });
  });

  describe('clearProcessed', () => {
    it('should allow reprocessing of users', () => {
      chainer.onCompetitorLiquidation(user1, collateralAsset, debtAsset, new Set());
      chainer.clearProcessed();
      
      const candidates = chainer.onCompetitorLiquidation(
        user1,
        collateralAsset,
        debtAsset,
        new Set()
      );
      
      expect(candidates).toHaveLength(1);
    });
  });

  describe('clearQueue', () => {
    it('should clear the queue', () => {
      chainer.onCompetitorLiquidation(user1, collateralAsset, debtAsset, new Set([user2]));
      expect(chainer.getQueue()).toHaveLength(2);
      
      chainer.clearQueue();
      expect(chainer.getQueue()).toHaveLength(0);
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      chainer.onCompetitorLiquidation(user1, collateralAsset, debtAsset, new Set([user2]));
      
      chainer.reset();
      
      expect(chainer.getQueue()).toHaveLength(0);
      // Should allow reprocessing
      const candidates = chainer.onCompetitorLiquidation(
        user1,
        collateralAsset,
        debtAsset,
        new Set()
      );
      expect(candidates).toHaveLength(1);
    });
  });

  describe('setHfThreshold', () => {
    it('should update HF threshold', () => {
      chainer.setHfThreshold(1.05);
      
      const candidates = [
        { user: user1, reason: 'affected_user' as const, queuedAt: Date.now() }
      ];
      
      const healthFactors = new Map([[user1.toLowerCase(), 1.04]]);
      const filtered = chainer.filterByHealthFactor(candidates, healthFactors);
      
      expect(filtered).toHaveLength(1);
    });
  });

  describe('isEnabled', () => {
    it('should return true when enabled', () => {
      expect(chainer.isEnabled()).toBe(true);
    });

    it('should return false when disabled', () => {
      const disabledChainer = new SecondOrderChainer(false);
      expect(disabledChainer.isEnabled()).toBe(false);
    });
  });
});
