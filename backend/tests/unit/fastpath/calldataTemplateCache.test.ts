import { describe, it, expect, beforeEach } from 'vitest';
import { CalldataTemplateCache } from '../../../src/exec/fastpath/CalldataTemplateCache.js';

describe('CalldataTemplateCache', () => {
  let cache: CalldataTemplateCache;
  const user = '0x1234567890123456789012345678901234567890';
  const debtAsset = '0xDebtAsset';
  const collateralAsset = '0xCollateralAsset';
  const mode = 0;
  const template = '0xabcdef';
  const debtIndex = 1000000n;

  beforeEach(() => {
    cache = new CalldataTemplateCache(true, 10);
    cache.clear();
  });

  describe('set and get', () => {
    it('should store and retrieve template', () => {
      cache.set(user, debtAsset, collateralAsset, mode, template, debtIndex);
      
      const retrieved = cache.get(user, debtAsset, collateralAsset, mode, debtIndex);
      expect(retrieved).toBe(template);
    });

    it('should handle case-insensitive addresses', () => {
      cache.set(user.toUpperCase(), debtAsset, collateralAsset, mode, template, debtIndex);
      
      const retrieved = cache.get(user.toLowerCase(), debtAsset, collateralAsset, mode, debtIndex);
      expect(retrieved).toBe(template);
    });

    it('should return null for cache miss', () => {
      const retrieved = cache.get(user, debtAsset, collateralAsset, mode, debtIndex);
      expect(retrieved).toBeNull();
    });
  });

  describe('index-based refresh', () => {
    it('should invalidate template when debt index changes significantly', () => {
      cache.set(user, debtAsset, collateralAsset, mode, template, debtIndex);
      
      // Index change > 10 bps (0.10%)
      const newIndex = debtIndex + (debtIndex * 11n) / 10000n;
      const retrieved = cache.get(user, debtAsset, collateralAsset, mode, newIndex);
      
      expect(retrieved).toBeNull();
    });

    it('should keep template when debt index change is small', () => {
      cache.set(user, debtAsset, collateralAsset, mode, template, debtIndex);
      
      // Index change < 10 bps
      const newIndex = debtIndex + (debtIndex * 5n) / 10000n;
      const retrieved = cache.get(user, debtAsset, collateralAsset, mode, newIndex);
      
      expect(retrieved).toBe(template);
    });
  });

  describe('invalidateUser', () => {
    it('should invalidate all templates for a user', () => {
      cache.set(user, debtAsset, collateralAsset, 0, template, debtIndex);
      cache.set(user, debtAsset, collateralAsset, 1, template, debtIndex);
      cache.set('0xOtherUser', debtAsset, collateralAsset, 0, template, debtIndex);
      
      expect(cache.getStats().size).toBe(3);
      
      cache.invalidateUser(user);
      expect(cache.getStats().size).toBe(1);
    });
  });

  describe('invalidateAsset', () => {
    it('should invalidate templates for debt asset', () => {
      cache.set(user, debtAsset, collateralAsset, 0, template, debtIndex);
      cache.set(user, '0xOtherDebt', collateralAsset, 0, template, debtIndex);
      
      expect(cache.getStats().size).toBe(2);
      
      cache.invalidateAsset(debtAsset);
      expect(cache.getStats().size).toBe(1);
    });

    it('should invalidate templates for collateral asset', () => {
      cache.set(user, debtAsset, collateralAsset, 0, template, debtIndex);
      cache.set(user, debtAsset, '0xOtherCollateral', 0, template, debtIndex);
      
      expect(cache.getStats().size).toBe(2);
      
      cache.invalidateAsset(collateralAsset);
      expect(cache.getStats().size).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all templates', () => {
      cache.set(user, debtAsset, collateralAsset, 0, template, debtIndex);
      cache.set(user, debtAsset, collateralAsset, 1, template, debtIndex);
      
      expect(cache.getStats().size).toBe(2);
      
      cache.clear();
      expect(cache.getStats().size).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', () => {
      cache.set(user, debtAsset, collateralAsset, 0, template, debtIndex);
      
      const stats = cache.getStats();
      expect(stats.size).toBe(1);
      expect(stats.enabled).toBe(true);
      expect(stats.refreshIndexBps).toBe(10);
    });
  });

  describe('getAll', () => {
    it('should return all cached templates', () => {
      cache.set(user, debtAsset, collateralAsset, 0, template, debtIndex);
      cache.set(user, debtAsset, collateralAsset, 1, template + '2', debtIndex);
      
      const all = cache.getAll();
      expect(all).toHaveLength(2);
    });
  });

  describe('disabled mode', () => {
    beforeEach(() => {
      cache = new CalldataTemplateCache(false, 10);
    });

    it('should not cache when disabled', () => {
      cache.set(user, debtAsset, collateralAsset, 0, template, debtIndex);
      
      const retrieved = cache.get(user, debtAsset, collateralAsset, 0, debtIndex);
      expect(retrieved).toBeNull();
    });

    it('should return false for isEnabled', () => {
      expect(cache.isEnabled()).toBe(false);
    });
  });

  describe('isEnabled', () => {
    it('should return true when enabled', () => {
      expect(cache.isEnabled()).toBe(true);
    });
  });
});
