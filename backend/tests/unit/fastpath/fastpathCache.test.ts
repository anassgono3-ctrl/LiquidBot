/**
 * FastpathPriceGasCache Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { PriceCache, GasCache, FastpathCache } from '../../../src/fastpath/FastpathPriceGasCache.js';

describe('PriceCache', () => {
  let cache: PriceCache;

  beforeEach(() => {
    cache = new PriceCache(1000); // 1 second TTL for tests
  });

  it('should store and retrieve prices', () => {
    const token = '0x1234';
    const price = BigInt('100000000'); // 1e8

    cache.set(token, price);
    expect(cache.get(token)).toBe(price);
    expect(cache.has(token)).toBe(true);
  });

  it('should be case-insensitive for tokens', () => {
    const token = '0xAbCd';
    const price = BigInt('100000000');

    cache.set(token, price);
    expect(cache.get('0xABCD')).toBe(price);
    expect(cache.get('0xabcd')).toBe(price);
  });

  it('should expire old entries', async () => {
    vi.useFakeTimers();
    const token = '0x1234';
    const price = BigInt('100000000');

    cache.set(token, price);
    expect(cache.get(token)).toBe(price);

    // Fast-forward time to expire TTL
    vi.advanceTimersByTime(1100);

    expect(cache.get(token)).toBe(null);
    expect(cache.has(token)).toBe(false);
    
    vi.useRealTimers();
  });

  it('should clear all entries', () => {
    cache.set('0x1234', BigInt('100000000'));
    cache.set('0x5678', BigInt('200000000'));
    expect(cache.size()).toBe(2);

    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get('0x1234')).toBe(null);
  });
});

describe('GasCache', () => {
  let cache: GasCache;

  beforeEach(() => {
    cache = new GasCache(1000); // 1 second TTL for tests
  });

  it('should store and retrieve gas prices', () => {
    const gasPrice = 50; // Gwei

    cache.set(gasPrice);
    expect(cache.get()).toBe(gasPrice);
    expect(cache.has()).toBe(true);
  });

  it('should support keyed entries', () => {
    cache.set(50, 'fast');
    cache.set(30, 'normal');
    cache.set(10, 'slow');

    expect(cache.get('fast')).toBe(50);
    expect(cache.get('normal')).toBe(30);
    expect(cache.get('slow')).toBe(10);
  });

  it('should expire old entries', async () => {
    vi.useFakeTimers();
    cache.set(50);
    expect(cache.get()).toBe(50);

    // Fast-forward time to expire TTL
    vi.advanceTimersByTime(1100);

    expect(cache.get()).toBe(null);
    expect(cache.has()).toBe(false);
    
    vi.useRealTimers();
  });

  it('should clear all entries', () => {
    cache.set(50, 'fast');
    cache.set(30, 'normal');
    expect(cache.size()).toBe(2);

    cache.clear();
    expect(cache.size()).toBe(0);
  });
});

describe('FastpathCache', () => {
  let cache: FastpathCache;

  beforeEach(() => {
    cache = new FastpathCache();
  });

  it('should provide access to both caches', () => {
    expect(cache.prices).toBeDefined();
    expect(cache.gas).toBeDefined();
  });

  it('should clear all caches', () => {
    cache.prices.set('0x1234', BigInt('100000000'));
    cache.gas.set(50);

    expect(cache.prices.size()).toBe(1);
    expect(cache.gas.size()).toBe(1);

    cache.clearAll();

    expect(cache.prices.size()).toBe(0);
    expect(cache.gas.size()).toBe(0);
  });

  it('should provide stats', () => {
    cache.prices.set('0x1234', BigInt('100000000'));
    cache.prices.set('0x5678', BigInt('200000000'));
    cache.gas.set(50);

    const stats = cache.getStats();
    expect(stats.priceEntries).toBe(2);
    expect(stats.gasEntries).toBe(1);
  });
});
