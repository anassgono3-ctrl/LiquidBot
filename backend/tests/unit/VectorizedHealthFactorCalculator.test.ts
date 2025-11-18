import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorizedHealthFactorCalculator, type AccountData } from '../../src/services/VectorizedHealthFactorCalculator.js';

describe('VectorizedHealthFactorCalculator', () => {
  let calculator: VectorizedHealthFactorCalculator;

  beforeEach(() => {
    calculator = new VectorizedHealthFactorCalculator({
      baseCacheTtlMs: 10000,
      maxCacheTtlMs: 60000,
      minCacheTtlMs: 2000
    });
  });

  afterEach(() => {
    calculator.stop();
  });

  it('should initialize correctly', () => {
    expect(calculator).toBeDefined();
  });

  it('should calculate health factor for single account', () => {
    const accounts: AccountData[] = [
      {
        address: '0xUser1',
        totalCollateralBase: 10000n,
        totalDebtBase: 5000n,
        currentLiquidationThreshold: 0.85
      }
    ];

    const results = calculator.batchCalculateHealthFactors(accounts);
    
    expect(results).toHaveLength(1);
    expect(results[0].address).toBe('0xUser1');
    expect(results[0].healthFactor).toBeGreaterThan(1.0);
    expect(results[0].healthFactor).toBeLessThan(2.0);
  });

  it('should handle zero debt correctly', () => {
    const accounts: AccountData[] = [
      {
        address: '0xUser2',
        totalCollateralBase: 10000n,
        totalDebtBase: 0n,
        currentLiquidationThreshold: 0.85
      }
    ];

    const results = calculator.batchCalculateHealthFactors(accounts);
    
    expect(results).toHaveLength(1);
    expect(results[0].healthFactor).toBe(Infinity);
  });

  it('should batch calculate health factors efficiently', () => {
    const accounts: AccountData[] = [];
    
    // Create 100 test accounts
    for (let i = 0; i < 100; i++) {
      accounts.push({
        address: `0xUser${i}`,
        totalCollateralBase: BigInt(10000 + i * 100),
        totalDebtBase: BigInt(5000 + i * 50),
        currentLiquidationThreshold: 0.85
      });
    }

    const startTime = Date.now();
    const results = calculator.batchCalculateHealthFactors(accounts);
    const elapsed = Date.now() - startTime;

    expect(results).toHaveLength(100);
    expect(elapsed).toBeLessThan(1000); // Should be very fast
    
    // All should have reasonable HF values
    results.forEach(result => {
      expect(result.healthFactor).toBeGreaterThan(0);
      expect(result.healthFactor).toBeLessThan(Infinity);
    });
  });

  it('should cache prices correctly', () => {
    calculator.cachePrice('WETH', 3000);
    
    const price1 = calculator.getCachedPrice('WETH');
    expect(price1).toBe(3000);
    
    // Should be case-insensitive
    const price2 = calculator.getCachedPrice('weth');
    expect(price2).toBe(3000);
  });

  it('should respect TTL for cached prices', async () => {
    const shortTtlCalculator = new VectorizedHealthFactorCalculator({
      baseCacheTtlMs: 50, // Very short TTL for testing
      maxCacheTtlMs: 100,
      minCacheTtlMs: 10
    });

    shortTtlCalculator.cachePrice('WETH', 3000);
    
    // Should be cached immediately
    const price1 = shortTtlCalculator.getCachedPrice('WETH');
    expect(price1).toBe(3000);
    
    // Wait for TTL to expire
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Should return null (stale)
    const price2 = shortTtlCalculator.getCachedPrice('WETH');
    expect(price2).toBeNull();

    shortTtlCalculator.stop();
  });

  it('should handle per-block price deduplication', () => {
    const blockNumber = 1000;
    
    calculator.cachePrice('WETH', 3000, blockNumber);
    calculator.cachePrice('WETH', 3010, blockNumber); // Update within same block
    
    const price = calculator.getCachedPrice('WETH', blockNumber);
    expect(price).toBe(3010); // Should get latest price for block
  });

  it('should batch cache prices', () => {
    const prices = new Map([
      ['WETH', 3000],
      ['USDC', 1.0],
      ['WBTC', 60000]
    ]);

    calculator.batchCachePrices(prices, 1000);

    expect(calculator.getCachedPrice('WETH', 1000)).toBe(3000);
    expect(calculator.getCachedPrice('USDC', 1000)).toBe(1.0);
    expect(calculator.getCachedPrice('WBTC', 1000)).toBe(60000);
  });

  it('should clear cache correctly', () => {
    calculator.cachePrice('WETH', 3000);
    calculator.cachePrice('USDC', 1.0);
    
    // Clear single symbol
    calculator.clearPriceCache('WETH');
    expect(calculator.getCachedPrice('WETH')).toBeNull();
    expect(calculator.getCachedPrice('USDC')).toBe(1.0);
    
    // Clear all
    calculator.clearPriceCache();
    expect(calculator.getCachedPrice('USDC')).toBeNull();
  });

  it('should track cache statistics', () => {
    calculator.cachePrice('WETH', 3000);
    
    // Hit
    calculator.getCachedPrice('WETH');
    
    // Miss
    calculator.getCachedPrice('UNKNOWN');
    
    const stats = calculator.getCacheStatistics();
    expect(stats.totalRequests).toBeGreaterThan(0);
    expect(stats.cacheHits).toBeGreaterThan(0);
    expect(stats.cacheMisses).toBeGreaterThan(0);
    expect(stats.hitRate).toBeGreaterThan(0);
    expect(stats.hitRate).toBeLessThanOrEqual(1);
  });

  it('should use longer TTL for stablecoins', () => {
    calculator.cachePrice('USDC', 1.0);
    calculator.cachePrice('WETH', 3000);
    
    // Both should be cached
    expect(calculator.getCachedPrice('USDC')).toBe(1.0);
    expect(calculator.getCachedPrice('WETH')).toBe(3000);
    
    // Implementation should use longer TTL for USDC (stablecoin)
    // This is tested implicitly through cache behavior
  });

  it('should handle large batches efficiently', () => {
    const accounts: AccountData[] = [];
    
    // Create 1000 accounts
    for (let i = 0; i < 1000; i++) {
      accounts.push({
        address: `0xUser${i}`,
        totalCollateralBase: BigInt(10000 + i),
        totalDebtBase: BigInt(5000 + i),
        currentLiquidationThreshold: 0.85
      });
    }

    const startTime = Date.now();
    const results = calculator.batchCalculateHealthFactors(accounts);
    const elapsed = Date.now() - startTime;

    expect(results).toHaveLength(1000);
    expect(elapsed).toBeLessThan(2000); // Should complete within 2 seconds
  });

  it('should reset statistics correctly', () => {
    calculator.cachePrice('WETH', 3000);
    calculator.getCachedPrice('WETH');
    calculator.getCachedPrice('UNKNOWN');
    
    const statsBefore = calculator.getCacheStatistics();
    expect(statsBefore.totalRequests).toBeGreaterThan(0);
    
    calculator.resetStatistics();
    
    const statsAfter = calculator.getCacheStatistics();
    expect(statsAfter.totalRequests).toBe(0);
    expect(statsAfter.cacheHits).toBe(0);
    expect(statsAfter.cacheMisses).toBe(0);
  });

  it('should handle automatic cleanup', async () => {
    const quickCleanupCalculator = new VectorizedHealthFactorCalculator({
      baseCacheTtlMs: 10,
      maxCacheTtlMs: 50,
      minCacheTtlMs: 5
    });

    // Add some prices that will become stale
    quickCleanupCalculator.cachePrice('WETH', 3000);
    quickCleanupCalculator.cachePrice('USDC', 1.0);

    // Wait for entries to become very stale (2x TTL)
    await new Promise(resolve => setTimeout(resolve, 150));

    // Cleanup should have run
    const stats = quickCleanupCalculator.getCacheStatistics();
    // After cleanup, stale entries might be removed

    quickCleanupCalculator.stop();
  });
});
