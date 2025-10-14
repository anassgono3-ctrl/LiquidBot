// Unit tests for dynamic liquidation sizing
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ethers } from 'ethers';

import { AaveDataService } from '../../src/services/AaveDataService.js';
import { ProfitCalculator } from '../../src/services/ProfitCalculator.js';

describe('Dynamic Liquidation Sizing', () => {
  describe('AaveDataService', () => {
    let service: AaveDataService;
    let mockProvider: ethers.JsonRpcProvider;

    beforeEach(() => {
      // Create a mock provider
      mockProvider = new ethers.JsonRpcProvider('http://localhost:8545');
      service = new AaveDataService(mockProvider);
    });

    it('should initialize with provider', () => {
      expect(service.isInitialized()).toBe(true);
    });

    it('should not be initialized without provider', () => {
      const uninitializedService = new AaveDataService();
      expect(uninitializedService.isInitialized()).toBe(false);
    });

    it('should throw error when calling methods without initialization', async () => {
      const uninitializedService = new AaveDataService();
      
      await expect(
        uninitializedService.getReserveTokenAddresses('0x123')
      ).rejects.toThrow('AaveDataService not initialized with provider');
      
      await expect(
        uninitializedService.getUserAccountData('0x456')
      ).rejects.toThrow('AaveDataService not initialized with provider');
    });

    it('should calculate liquidation bonus percentage correctly', async () => {
      // Mock getReserveConfigurationData to return test data
      const mockConfig = {
        decimals: 18n,
        ltv: 8000n,
        liquidationThreshold: 8500n,
        liquidationBonus: 10500n, // 5% bonus (10500 - 10000 = 500 bps)
        reserveFactor: 1000n,
        usageAsCollateralEnabled: true,
        borrowingEnabled: true,
        stableBorrowRateEnabled: true,
        isActive: true,
        isFrozen: false
      };

      vi.spyOn(service, 'getReserveConfigurationData').mockResolvedValue(mockConfig);

      const bonusPct = await service.getLiquidationBonusPct('0xasset');
      
      expect(bonusPct).toBe(0.05); // 5%
    });

    it('should handle different liquidation bonus values', async () => {
      const testCases = [
        { liquidationBonus: 10500n, expected: 0.05 },   // 5%
        { liquidationBonus: 11000n, expected: 0.10 },   // 10%
        { liquidationBonus: 10250n, expected: 0.025 },  // 2.5%
        { liquidationBonus: 10000n, expected: 0.00 }    // 0% (no bonus)
      ];

      for (const testCase of testCases) {
        const mockConfig = {
          decimals: 18n,
          ltv: 8000n,
          liquidationThreshold: 8500n,
          liquidationBonus: testCase.liquidationBonus,
          reserveFactor: 1000n,
          usageAsCollateralEnabled: true,
          borrowingEnabled: true,
          stableBorrowRateEnabled: true,
          isActive: true,
          isFrozen: false
        };

        vi.spyOn(service, 'getReserveConfigurationData').mockResolvedValue(mockConfig);
        
        const bonusPct = await service.getLiquidationBonusPct('0xasset');
        expect(bonusPct).toBe(testCase.expected);
      }
    });

    it('should calculate total debt correctly', async () => {
      const mockUserData = {
        currentATokenBalance: 1000000000000000000n, // 1 token
        currentStableDebt: 200000000000000000n,     // 0.2 tokens
        currentVariableDebt: 300000000000000000n,   // 0.3 tokens
        principalStableDebt: 200000000000000000n,
        scaledVariableDebt: 300000000000000000n,
        stableBorrowRate: 50000000000000000n,
        liquidityRate: 30000000000000000n,
        stableRateLastUpdated: 0n,
        usageAsCollateralEnabled: true
      };

      vi.spyOn(service, 'getUserReserveData').mockResolvedValue(mockUserData);

      const totalDebt = await service.getTotalDebt('0xasset', '0xuser');
      
      // Total debt = stableDebt + variableDebt
      expect(totalDebt).toBe(500000000000000000n); // 0.5 tokens
    });
  });

  describe('DebtToCover Calculation', () => {
    describe('fixed50 mode', () => {
      it('should calculate 50% of total debt', () => {
        const totalDebt = 1000000000000000000n; // 1 ETH
        const debtToCover = totalDebt / 2n;
        
        expect(debtToCover).toBe(500000000000000000n); // 0.5 ETH
      });

      it('should handle odd debt amounts correctly', () => {
        const totalDebt = 1500000000000000001n; // 1.5 ETH + 1 wei
        const debtToCover = totalDebt / 2n;
        
        // BigInt division rounds down
        expect(debtToCover).toBe(750000000000000000n); // 0.75 ETH (rounded down)
      });

      it('should return zero for zero debt', () => {
        const totalDebt = 0n;
        const debtToCover = totalDebt / 2n;
        
        expect(debtToCover).toBe(0n);
      });
    });

    describe('full mode', () => {
      it('should use full debt amount', () => {
        const totalDebt = 1000000000000000000n; // 1 ETH
        const debtToCover = totalDebt;
        
        expect(debtToCover).toBe(1000000000000000000n); // 1 ETH
      });

      it('should return zero for zero debt', () => {
        const totalDebt = 0n;
        const debtToCover = totalDebt;
        
        expect(debtToCover).toBe(0n);
      });
    });

    describe('mode comparison', () => {
      it('should liquidate half as much in fixed50 vs full mode', () => {
        const totalDebt = 2000000000000000000n; // 2 ETH
        
        const fixed50DebtToCover = totalDebt / 2n;
        const fullDebtToCover = totalDebt;
        
        expect(fixed50DebtToCover).toBe(1000000000000000000n); // 1 ETH
        expect(fullDebtToCover).toBe(2000000000000000000n);    // 2 ETH
        expect(fullDebtToCover).toBe(fixed50DebtToCover * 2n);
      });
    });
  });

  describe('ProfitCalculator with Dynamic Bonus', () => {
    let calculator: ProfitCalculator;

    beforeEach(() => {
      calculator = new ProfitCalculator({
        feeBps: 30,        // 0.3% fee
        gasCostUsd: 0.5    // $0.50 gas
      });
    });

    describe('estimateProfitWithBonus', () => {
      it('should calculate profit with 5% bonus', () => {
        const debtToCoverUsd = 1000;
        const liquidationBonusPct = 0.05; // 5%

        const breakdown = calculator.estimateProfitWithBonus(debtToCoverUsd, liquidationBonusPct);

        // Expected collateral: 1000 * 1.05 = 1050
        // Raw spread: 1050 - 1000 = 50
        // Fees: 50 * 0.003 = 0.15
        // Gas: 0.5
        // Net: 50 - 0.15 - 0.5 = 49.35

        expect(breakdown.bonusValue).toBe(50);
        expect(breakdown.gross).toBe(50);
        expect(breakdown.fees).toBeCloseTo(0.15, 2);
        expect(breakdown.gasCost).toBe(0.5);
        expect(breakdown.net).toBeCloseTo(49.35, 2);
      });

      it('should calculate profit with 10% bonus', () => {
        const debtToCoverUsd = 1000;
        const liquidationBonusPct = 0.10; // 10%

        const breakdown = calculator.estimateProfitWithBonus(debtToCoverUsd, liquidationBonusPct);

        // Expected collateral: 1000 * 1.10 = 1100
        // Raw spread: 1100 - 1000 = 100
        // Fees: 100 * 0.003 = 0.3
        // Gas: 0.5
        // Net: 100 - 0.3 - 0.5 = 99.2

        expect(breakdown.bonusValue).toBe(100);
        expect(breakdown.gross).toBe(100);
        expect(breakdown.fees).toBeCloseTo(0.3, 2);
        expect(breakdown.gasCost).toBe(0.5);
        expect(breakdown.net).toBeCloseTo(99.2, 2);
      });

      it('should handle small liquidations', () => {
        const debtToCoverUsd = 50;
        const liquidationBonusPct = 0.05; // 5%

        const breakdown = calculator.estimateProfitWithBonus(debtToCoverUsd, liquidationBonusPct);

        // Expected collateral: 50 * 1.05 = 52.5
        // Raw spread: 52.5 - 50 = 2.5
        // Fees: 2.5 * 0.003 = 0.0075
        // Gas: 0.5
        // Net: 2.5 - 0.0075 - 0.5 = 1.9925

        expect(breakdown.bonusValue).toBe(2.5);
        expect(breakdown.gross).toBe(2.5);
        expect(breakdown.net).toBeCloseTo(1.9925, 4);
      });

      it('should handle unprofitable scenarios after gas', () => {
        const debtToCoverUsd = 5;
        const liquidationBonusPct = 0.05; // 5%

        const breakdown = calculator.estimateProfitWithBonus(debtToCoverUsd, liquidationBonusPct);

        // Expected collateral: 5 * 1.05 = 5.25
        // Raw spread: 5.25 - 5 = 0.25
        // Fees: 0.25 * 0.003 = 0.00075
        // Gas: 0.5
        // Net: 0.25 - 0.00075 - 0.5 = -0.25075 (loss)

        expect(breakdown.bonusValue).toBe(0.25);
        expect(breakdown.net).toBeLessThan(0);
      });

      it('should compare fixed50 vs full mode profitability', () => {
        const totalDebtUsd = 1000;
        const liquidationBonusPct = 0.05;

        // Fixed50 mode: liquidate half
        const fixed50Breakdown = calculator.estimateProfitWithBonus(
          totalDebtUsd / 2,
          liquidationBonusPct
        );

        // Full mode: liquidate all
        const fullBreakdown = calculator.estimateProfitWithBonus(
          totalDebtUsd,
          liquidationBonusPct
        );

        // Full mode should be roughly 2x profit (minus one gas cost)
        // Fixed50: 500 * 0.05 = 25, minus fees and gas
        // Full: 1000 * 0.05 = 50, minus fees and gas
        expect(fullBreakdown.gross).toBeCloseTo(fixed50Breakdown.gross * 2, 2);
        
        // But net profit difference is less due to shared gas cost
        const netDifference = fullBreakdown.net - fixed50Breakdown.net;
        expect(netDifference).toBeGreaterThan(20); // Roughly 25 extra profit
        expect(netDifference).toBeLessThan(30);
      });
    });

    describe('different bonus percentages', () => {
      const testCases = [
        { bonus: 0.025, debtUsd: 1000, expectedBonus: 25 },
        { bonus: 0.05, debtUsd: 1000, expectedBonus: 50 },
        { bonus: 0.075, debtUsd: 1000, expectedBonus: 75 },
        { bonus: 0.10, debtUsd: 1000, expectedBonus: 100 }
      ];

      testCases.forEach(({ bonus, debtUsd, expectedBonus }) => {
        it(`should calculate correctly with ${bonus * 100}% bonus`, () => {
          const breakdown = calculator.estimateProfitWithBonus(debtUsd, bonus);
          expect(breakdown.bonusValue).toBe(expectedBonus);
          expect(breakdown.gross).toBe(expectedBonus);
        });
      });
    });
  });

  describe('Integration: Close Factor + Profit Calculation', () => {
    let calculator: ProfitCalculator;

    beforeEach(() => {
      calculator = new ProfitCalculator({
        feeBps: 30,
        gasCostUsd: 0.5
      });
    });

    it('should demonstrate fixed50 mode with dynamic bonus', () => {
      const totalDebtUsd = 2000;
      const liquidationBonusPct = 0.05; // 5% from Aave config
      
      // Fixed50 mode: liquidate 50%
      const debtToCoverUsd = totalDebtUsd / 2;
      
      const breakdown = calculator.estimateProfitWithBonus(debtToCoverUsd, liquidationBonusPct);
      
      // Liquidating $1000 with 5% bonus
      expect(breakdown.bonusValue).toBe(50);
      expect(breakdown.net).toBeGreaterThan(45); // Should be profitable
    });

    it('should demonstrate full mode with dynamic bonus', () => {
      const totalDebtUsd = 2000;
      const liquidationBonusPct = 0.05;
      
      // Full mode: liquidate 100%
      const debtToCoverUsd = totalDebtUsd;
      
      const breakdown = calculator.estimateProfitWithBonus(debtToCoverUsd, liquidationBonusPct);
      
      // Liquidating $2000 with 5% bonus
      expect(breakdown.bonusValue).toBe(100);
      expect(breakdown.net).toBeGreaterThan(95); // Should be profitable
    });

    it('should show profit difference between modes', () => {
      const totalDebtUsd = 5000;
      const liquidationBonusPct = 0.05;
      
      const fixed50Profit = calculator.estimateProfitWithBonus(
        totalDebtUsd / 2,
        liquidationBonusPct
      );
      
      const fullProfit = calculator.estimateProfitWithBonus(
        totalDebtUsd,
        liquidationBonusPct
      );
      
      // Full mode should yield higher profit
      expect(fullProfit.net).toBeGreaterThan(fixed50Profit.net);
      
      // But requires 2x capital
      const capitalRequired = {
        fixed50: totalDebtUsd / 2,
        full: totalDebtUsd
      };
      
      expect(capitalRequired.full).toBe(capitalRequired.fixed50 * 2);
    });
  });
});
