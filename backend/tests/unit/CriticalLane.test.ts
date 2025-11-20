/**
 * Critical Lane Unit Tests
 * 
 * Tests for the critical lane fast-path execution logic
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

import { CriticalLane, type BorrowerState } from '../../src/exec/fastpath/CriticalLane.js';
import { ProfitEstimator } from '../../src/services/ProfitEstimator.js';
import { initMetricsOnce } from '../../src/metrics/index.js';

// Mock AaveDataService
class MockAaveDataService {
  async getAllUserReserves() {
    return [
      {
        asset: '0xdebt',
        symbol: 'USDC',
        totalDebt: BigInt('100000000'), // 100 USDC
        decimals: 6,
        priceRaw: BigInt('100000000'), // $1
        debtValueUsd: 100,
        aTokenBalance: 0n,
        usageAsCollateralEnabled: false
      },
      {
        asset: '0xcoll',
        symbol: 'WETH',
        totalDebt: 0n,
        decimals: 18,
        priceRaw: BigInt('200000000000'), // $2000
        debtValueUsd: 0,
        aTokenBalance: BigInt('100000000000000000'), // 0.1 WETH
        collateralValueUsd: 200,
        usageAsCollateralEnabled: true
      }
    ];
  }

  async getLiquidationBonusPct() {
    return 0.05; // 5%
  }

  async getAssetPrice(asset: string) {
    if (asset === '0xdebt') return BigInt('100000000'); // $1
    if (asset === '0xcoll') return BigInt('200000000000'); // $2000
    return BigInt(0);
  }
}

describe('CriticalLane', () => {
  let criticalLane: CriticalLane;
  let mockAaveDataService: MockAaveDataService;
  let profitEstimator: ProfitEstimator;

  beforeAll(() => {
    // Initialize metrics once for all tests
    initMetricsOnce();
  });

  beforeEach(() => {
    mockAaveDataService = new MockAaveDataService();
    profitEstimator = new ProfitEstimator();
    
    // @ts-expect-error - using mock
    criticalLane = new CriticalLane(mockAaveDataService, profitEstimator);
  });

  describe('shouldProcess', () => {
    it('should return true for HF < 1.0', () => {
      const borrower: BorrowerState = {
        address: '0x123',
        currentHF: 0.999,
        totalDebtBase: BigInt('100000000000000000000'), // 100 USD
        totalCollateralBase: BigInt('99000000000000000000'), // 99 USD
        blockNumber: 1000,
        timestamp: Date.now()
      };

      expect(criticalLane.shouldProcess(borrower)).toBe(true);
    });

    it('should return false for HF >= 1.0', () => {
      const borrower: BorrowerState = {
        address: '0x123',
        currentHF: 1.0,
        totalDebtBase: BigInt('100000000000000000000'),
        totalCollateralBase: BigInt('100000000000000000000'),
        blockNumber: 1000,
        timestamp: Date.now()
      };

      expect(criticalLane.shouldProcess(borrower)).toBe(false);
    });

    it('should return false for HF > 1.0', () => {
      const borrower: BorrowerState = {
        address: '0x123',
        currentHF: 1.001,
        totalDebtBase: BigInt('100000000000000000000'),
        totalCollateralBase: BigInt('100100000000000000000'),
        blockNumber: 1000,
        timestamp: Date.now()
      };

      expect(criticalLane.shouldProcess(borrower)).toBe(false);
    });

    it('should use strict numeric comparison without rounding', () => {
      // Test edge case: 0.99995 displayed as 1.0000 but should still process
      const borrower: BorrowerState = {
        address: '0x123',
        currentHF: 0.99995,
        totalDebtBase: BigInt('100000000000000000000'),
        totalCollateralBase: BigInt('99995000000000000000'),
        blockNumber: 1000,
        timestamp: Date.now()
      };

      expect(criticalLane.shouldProcess(borrower)).toBe(true);
    });
  });

  describe('isEnabled', () => {
    it('should return enabled status from config', () => {
      expect(typeof criticalLane.isEnabled()).toBe('boolean');
    });
  });
});
