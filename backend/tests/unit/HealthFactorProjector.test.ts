import { describe, it, expect, beforeEach } from 'vitest';
import { HealthFactorProjector, type AccountSnapshot, type PriceTrend, type DebtIndexTrend } from '../../src/services/HealthFactorProjector.js';

describe('HealthFactorProjector', () => {
  let projector: HealthFactorProjector;

  beforeEach(() => {
    projector = new HealthFactorProjector({
      criticalHfMin: 1.00,
      criticalHfMax: 1.03,
      projectionBlocks: 1
    });
  });

  it('should initialize with correct parameters', () => {
    expect(projector).toBeDefined();
    expect(projector.isInCriticalBand(1.02)).toBe(true);
    expect(projector.isInCriticalBand(0.99)).toBe(false);
    expect(projector.isInCriticalBand(1.05)).toBe(false);
  });

  it('should identify accounts in critical band', () => {
    expect(projector.isInCriticalBand(1.00)).toBe(true);
    expect(projector.isInCriticalBand(1.01)).toBe(true);
    expect(projector.isInCriticalBand(1.03)).toBe(true);
    expect(projector.isInCriticalBand(0.95)).toBe(false);
    expect(projector.isInCriticalBand(1.10)).toBe(false);
  });

  it('should update price history', () => {
    projector.updatePriceHistory('WETH', 3000);
    projector.updatePriceHistory('WETH', 3010);
    
    const trend = projector.getPriceTrend('WETH');
    expect(trend).not.toBeNull();
    expect(trend?.symbol).toBe('WETH');
    expect(trend?.currentPrice).toBe(3010);
  });

  it('should update debt index history', () => {
    projector.updateDebtIndexHistory('0xReserve1', 1000000000000000000000000000n);
    projector.updateDebtIndexHistory('0xReserve1', 1000100000000000000000000000n);
    
    const trend = projector.getDebtIndexTrend('0xReserve1');
    expect(trend).not.toBeNull();
    expect(trend?.reserve).toBe('0xReserve1');
  });

  it('should project HF for account in critical band', () => {
    const snapshot: AccountSnapshot = {
      address: '0xUser1',
      healthFactor: 1.02,
      totalCollateralBase: 10000n,
      totalDebtBase: 9800n,
      blockNumber: 1000,
      timestamp: Date.now()
    };

    const priceTrends: PriceTrend[] = [
      {
        symbol: 'WETH',
        currentPrice: 3000,
        priceChange: -0.01, // 1% price drop
        blockWindow: 5
      }
    ];

    const debtIndexTrends: DebtIndexTrend[] = [
      {
        reserve: '0xReserve1',
        currentIndex: 1000100000000000000000000000n,
        indexChange: 100000000000000000000000n, // ~0.01% growth
        blockWindow: 5
      }
    ];

    const result = projector.projectHealthFactor(snapshot, priceTrends, debtIndexTrends);
    
    expect(result).not.toBeNull();
    expect(result?.address).toBe('0xUser1');
    expect(result?.currentHf).toBe(1.02);
    expect(result?.projectedHf).toBeLessThan(1.02); // Should project lower HF due to price drop
    expect(result?.projectedAtBlock).toBe(1001);
    expect(['high', 'medium', 'low']).toContain(result?.likelihood);
  });

  it('should not project for account outside critical band', () => {
    const snapshot: AccountSnapshot = {
      address: '0xUser2',
      healthFactor: 2.0, // Well above critical band
      totalCollateralBase: 10000n,
      totalDebtBase: 5000n,
      blockNumber: 1000,
      timestamp: Date.now()
    };

    const result = projector.projectHealthFactor(snapshot, [], []);
    expect(result).toBeNull();
  });

  it('should handle batch projection', () => {
    const snapshots: AccountSnapshot[] = [
      {
        address: '0xUser1',
        healthFactor: 1.02,
        totalCollateralBase: 10000n,
        totalDebtBase: 9800n,
        blockNumber: 1000,
        timestamp: Date.now()
      },
      {
        address: '0xUser2',
        healthFactor: 1.01,
        totalCollateralBase: 5000n,
        totalDebtBase: 4950n,
        blockNumber: 1000,
        timestamp: Date.now()
      },
      {
        address: '0xUser3',
        healthFactor: 2.0, // Outside critical band
        totalCollateralBase: 10000n,
        totalDebtBase: 5000n,
        blockNumber: 1000,
        timestamp: Date.now()
      }
    ];

    const results = projector.batchProject(snapshots, [], []);
    
    // Should only project for accounts in critical band
    expect(results.length).toBe(2);
    expect(results.every(r => r.currentHf <= 1.03 && r.currentHf >= 1.00)).toBe(true);
  });

  it('should record projection accuracy', () => {
    const projection = {
      address: '0xUser1',
      currentHf: 1.02,
      projectedHf: 0.98,
      projectedAtBlock: 1001,
      likelihood: 'high' as const,
      factors: {
        priceImpact: -0.05,
        debtGrowthImpact: 0.01
      }
    };

    // Test true positive
    expect(() => projector.recordAccuracy(projection, 0.97, true)).not.toThrow();
    
    // Test false positive
    expect(() => projector.recordAccuracy(projection, 1.05, false)).not.toThrow();
  });

  it('should clear history', () => {
    projector.updatePriceHistory('WETH', 3000);
    projector.updateDebtIndexHistory('0xReserve1', 1000000000000000000000000000n);
    
    const statsBefore = projector.getHistoryStats();
    expect(statsBefore.prices).toBeGreaterThan(0);
    
    projector.clearHistory();
    
    const statsAfter = projector.getHistoryStats();
    expect(statsAfter.prices).toBe(0);
    expect(statsAfter.debtIndices).toBe(0);
  });

  it('should maintain limited history window', () => {
    // Add more than history window entries
    for (let i = 0; i < 20; i++) {
      projector.updatePriceHistory('WETH', 3000 + i);
    }
    
    const trend = projector.getPriceTrend('WETH');
    expect(trend).not.toBeNull();
    // History should be capped (internal window is 10)
  });
});
