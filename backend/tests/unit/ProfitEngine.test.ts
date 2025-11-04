// ProfitEngine Tests: Verify profit simulation with correct scaling
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ProfitEngine } from '../../src/services/ProfitEngine.js';
import type { RiskEngine, UserRiskSnapshot } from '../../src/services/RiskEngine.js';

describe('ProfitEngine', () => {
  let mockProvider: any;
  let mockRiskEngine: any;
  
  beforeEach(() => {
    mockProvider = {};
    mockRiskEngine = {
      getBaseCurrencyUnit: vi.fn().mockResolvedValue(10n ** 8n)
    } as Partial<RiskEngine>;
  });
  
  describe('simulate', () => {
    it('should calculate profit for 18-decimal collateral and 6-decimal debt', async () => {
      const engine = new ProfitEngine({
        provider: mockProvider,
        riskEngine: mockRiskEngine as RiskEngine,
        minProfitUsd: 10,
        maxSlippageBps: 50, // 0.5%
        gasCostUsd: 1,
        closeFactorBps: 5000 // 50%
      });
      
      const snapshot: UserRiskSnapshot = {
        userAddress: '0x1234',
        blockNumber: 1000,
        healthFactor: 95n * (10n ** 16n), // 0.95
        totalCollateralBase: 10000n * (10n ** 8n),
        totalDebtBase: 8000n * (10n ** 8n),
        currentLiquidationThreshold: 8000n,
        ltv: 7500n,
        eModeCategory: 0n,
        isLiquidatable: true,
        reserves: [
          {
            asset: '0xWETH',
            symbol: 'WETH',
            decimals: 18,
            aTokenBalance: 5n * (10n ** 18n), // 5 WETH
            stableDebt: 0n,
            variableDebt: 0n,
            totalDebt: 0n,
            priceInBase: 2000n * (10n ** 8n), // $2000
            liquidationThreshold: 8000n,
            liquidationBonus: 500n, // 5%
            usageAsCollateralEnabled: true,
            isActive: true,
            isFrozen: false,
            collateralValueBase: 10000n * (10n ** 8n),
            debtValueBase: 0n
          },
          {
            asset: '0xUSDC',
            symbol: 'USDC',
            decimals: 6,
            aTokenBalance: 0n,
            stableDebt: 0n,
            variableDebt: 8000n * (10n ** 6n), // 8000 USDC
            totalDebt: 8000n * (10n ** 6n),
            priceInBase: 1n * (10n ** 8n), // $1
            liquidationThreshold: 8500n,
            liquidationBonus: 450n,
            usageAsCollateralEnabled: false,
            isActive: true,
            isFrozen: false,
            collateralValueBase: 0n,
            debtValueBase: 8000n * (10n ** 8n)
          }
        ]
      };
      
      const result = await engine.simulate(snapshot);
      
      // Repay 50% of debt = 4000 USDC
      expect(result.repayAmount).toBe(4000n * (10n ** 6n));
      
      // Seize amount = repay * (1 + bonus) * (debtPrice / collateralPrice)
      // = 4000 * 1.05 * (1 / 2000) = 2.1 WETH
      // In wei: (4000 * 10^6) * 10500 * (1 * 10^8) * (10^18) / (10000 * (2000 * 10^8) * 10^6)
      const expectedSeize = (4000n * (10n ** 6n) * 10500n * 1n * (10n ** 8n) * (10n ** 18n)) / 
                           (10000n * (2000n * (10n ** 8n)) * (10n ** 6n));
      expect(result.seizeAmount).toBe(expectedSeize);
      
      // Gross profit should be positive (seize value > repay value due to bonus)
      expect(result.grossProfitUsd).toBeGreaterThan(0n);
      
      expect(result.profitable).toBe(true);
    });
    
    it('should handle 8-decimal WBTC collateral', async () => {
      const engine = new ProfitEngine({
        provider: mockProvider,
        riskEngine: mockRiskEngine as RiskEngine,
        minProfitUsd: 10,
        maxSlippageBps: 80,
        gasCostUsd: 0,
        closeFactorBps: 5000
      });
      
      const snapshot: UserRiskSnapshot = {
        userAddress: '0x5678',
        blockNumber: 1000,
        healthFactor: 98n * (10n ** 16n),
        totalCollateralBase: 40000n * (10n ** 8n),
        totalDebtBase: 35000n * (10n ** 8n),
        currentLiquidationThreshold: 7500n,
        ltv: 7000n,
        eModeCategory: 0n,
        isLiquidatable: true,
        reserves: [
          {
            asset: '0xWBTC',
            symbol: 'WBTC',
            decimals: 8,
            aTokenBalance: 1n * (10n ** 8n), // 1 WBTC
            stableDebt: 0n,
            variableDebt: 0n,
            totalDebt: 0n,
            priceInBase: 40000n * (10n ** 8n),
            liquidationThreshold: 7500n,
            liquidationBonus: 600n, // 6%
            usageAsCollateralEnabled: true,
            isActive: true,
            isFrozen: false,
            collateralValueBase: 40000n * (10n ** 8n),
            debtValueBase: 0n
          },
          {
            asset: '0xUSDC',
            symbol: 'USDC',
            decimals: 6,
            aTokenBalance: 0n,
            stableDebt: 0n,
            variableDebt: 35000n * (10n ** 6n),
            totalDebt: 35000n * (10n ** 6n),
            priceInBase: 1n * (10n ** 8n),
            liquidationThreshold: 8500n,
            liquidationBonus: 450n,
            usageAsCollateralEnabled: false,
            isActive: true,
            isFrozen: false,
            collateralValueBase: 0n,
            debtValueBase: 35000n * (10n ** 8n)
          }
        ]
      };
      
      const result = await engine.simulate(snapshot);
      
      // Repay 50% = 17500 USDC
      expect(result.repayAmount).toBe(17500n * (10n ** 6n));
      
      // Should be profitable due to 6% bonus
      expect(result.liquidationBonus).toBe(600n);
      expect(result.profitable).toBe(true);
    });
    
    it('should return unprofitable if net profit < min profit', async () => {
      const engine = new ProfitEngine({
        provider: mockProvider,
        riskEngine: mockRiskEngine as RiskEngine,
        minProfitUsd: 100, // High threshold
        maxSlippageBps: 100,
        gasCostUsd: 5,
        closeFactorBps: 5000
      });
      
      const snapshot: UserRiskSnapshot = {
        userAddress: '0xABCD',
        blockNumber: 1000,
        healthFactor: 99n * (10n ** 16n),
        totalCollateralBase: 1000n * (10n ** 8n),
        totalDebtBase: 950n * (10n ** 8n),
        currentLiquidationThreshold: 8000n,
        ltv: 7500n,
        eModeCategory: 0n,
        isLiquidatable: true,
        reserves: [
          {
            asset: '0xWETH',
            symbol: 'WETH',
            decimals: 18,
            aTokenBalance: 5n * (10n ** 17n), // 0.5 WETH
            stableDebt: 0n,
            variableDebt: 0n,
            totalDebt: 0n,
            priceInBase: 2000n * (10n ** 8n),
            liquidationThreshold: 8000n,
            liquidationBonus: 500n,
            usageAsCollateralEnabled: true,
            isActive: true,
            isFrozen: false,
            collateralValueBase: 1000n * (10n ** 8n),
            debtValueBase: 0n
          },
          {
            asset: '0xUSDC',
            symbol: 'USDC',
            decimals: 6,
            aTokenBalance: 0n,
            stableDebt: 0n,
            variableDebt: 950n * (10n ** 6n),
            totalDebt: 950n * (10n ** 6n),
            priceInBase: 1n * (10n ** 8n),
            liquidationThreshold: 8500n,
            liquidationBonus: 450n,
            usageAsCollateralEnabled: false,
            isActive: true,
            isFrozen: false,
            collateralValueBase: 0n,
            debtValueBase: 950n * (10n ** 8n)
          }
        ]
      };
      
      const result = await engine.simulate(snapshot);
      
      expect(result.profitable).toBe(false);
      expect(result.skipReason).toBe('not_profitable');
    });
    
    it('should apply slippage cost correctly', async () => {
      const engine = new ProfitEngine({
        provider: mockProvider,
        riskEngine: mockRiskEngine as RiskEngine,
        minProfitUsd: 1,
        maxSlippageBps: 100, // 1%
        gasCostUsd: 0,
        closeFactorBps: 5000
      });
      
      const snapshot: UserRiskSnapshot = {
        userAddress: '0x9999',
        blockNumber: 1000,
        healthFactor: 97n * (10n ** 16n),
        totalCollateralBase: 5000n * (10n ** 8n),
        totalDebtBase: 4500n * (10n ** 8n),
        currentLiquidationThreshold: 8000n,
        ltv: 7500n,
        eModeCategory: 0n,
        isLiquidatable: true,
        reserves: [
          {
            asset: '0xWETH',
            symbol: 'WETH',
            decimals: 18,
            aTokenBalance: 25n * (10n ** 17n), // 2.5 WETH
            stableDebt: 0n,
            variableDebt: 0n,
            totalDebt: 0n,
            priceInBase: 2000n * (10n ** 8n),
            liquidationThreshold: 8000n,
            liquidationBonus: 500n,
            usageAsCollateralEnabled: true,
            isActive: true,
            isFrozen: false,
            collateralValueBase: 5000n * (10n ** 8n),
            debtValueBase: 0n
          },
          {
            asset: '0xDAI',
            symbol: 'DAI',
            decimals: 18,
            aTokenBalance: 0n,
            stableDebt: 0n,
            variableDebt: 4500n * (10n ** 18n),
            totalDebt: 4500n * (10n ** 18n),
            priceInBase: 1n * (10n ** 8n),
            liquidationThreshold: 8500n,
            liquidationBonus: 450n,
            usageAsCollateralEnabled: false,
            isActive: true,
            isFrozen: false,
            collateralValueBase: 0n,
            debtValueBase: 4500n * (10n ** 8n)
          }
        ]
      };
      
      const result = await engine.simulate(snapshot);
      
      // Slippage cost should be 1% of seize value
      const expectedSlippage = (result.seizeAmountUsd * 100n) / 10000n;
      expect(result.slippageCostUsd).toBe(expectedSlippage);
      
      // Net profit = gross - slippage - gas
      expect(result.netProfitUsd).toBe(
        result.grossProfitUsd - result.slippageCostUsd - result.gasCostUsd
      );
    });
    
    it('should handle no valid assets', async () => {
      const engine = new ProfitEngine({
        provider: mockProvider,
        riskEngine: mockRiskEngine as RiskEngine
      });
      
      const snapshot: UserRiskSnapshot = {
        userAddress: '0xEMPTY',
        blockNumber: 1000,
        healthFactor: 95n * (10n ** 16n),
        totalCollateralBase: 0n,
        totalDebtBase: 0n,
        currentLiquidationThreshold: 0n,
        ltv: 0n,
        eModeCategory: 0n,
        isLiquidatable: false,
        reserves: []
      };
      
      const result = await engine.simulate(snapshot);
      
      expect(result.profitable).toBe(false);
      expect(result.skipReason).toBe('no_valid_assets');
    });
  });
  
  describe('formatUsd', () => {
    it('should format USD amounts correctly', () => {
      expect(ProfitEngine.formatUsd(100n * (10n ** 8n))).toBe('100.00');
      expect(ProfitEngine.formatUsd(1550n * (10n ** 8n))).toBe('1550.00');
      expect(ProfitEngine.formatUsd(99n * (10n ** 8n) / 100n)).toBe('0.99');
      expect(ProfitEngine.formatUsd(12345n * (10n ** 8n))).toBe('12345.00');
    });
  });
});
