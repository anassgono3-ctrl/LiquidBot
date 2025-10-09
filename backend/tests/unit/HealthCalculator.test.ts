// Unit tests for HealthCalculator
import { describe, it, expect } from 'vitest';

import { HealthCalculator } from '../../src/services/HealthCalculator.js';
import type { User } from '../../src/types/index.js';

describe('HealthCalculator', () => {
  const calculator = new HealthCalculator();

  describe('calculateHealthFactor', () => {
    it('should return Infinity for zero debt', () => {
      const user: User = {
        id: '0x123',
        borrowedReservesCount: 0,
        reserves: [
          {
            currentATokenBalance: '1000000000', // 1000 USDC (6 decimals)
            currentVariableDebt: '0',
            currentStableDebt: '0',
            reserve: {
              id: '0xusdc',
              symbol: 'USDC',
              name: 'USD Coin',
              decimals: 6,
              reserveLiquidationThreshold: 8500, // 85%
              usageAsCollateralEnabled: true,
              price: {
                priceInEth: '500000000000000', // ~$2000 ETH price
              },
            },
          },
        ],
      };

      const result = calculator.calculateHealthFactor(user);
      expect(result.healthFactor).toBe(Infinity);
      expect(result.totalDebtETH).toBe(0);
      expect(result.isAtRisk).toBe(false);
    });

    it('should calculate health factor for single asset', () => {
      const user: User = {
        id: '0x456',
        borrowedReservesCount: 1,
        reserves: [
          {
            currentATokenBalance: '2000000000', // 2000 USDC
            currentVariableDebt: '1000000000', // 1000 USDC debt
            currentStableDebt: '0',
            reserve: {
              id: '0xusdc',
              symbol: 'USDC',
              name: 'USD Coin',
              decimals: 6,
              reserveLiquidationThreshold: 8500, // 85%
              usageAsCollateralEnabled: true,
              price: {
                priceInEth: '500000000000000',
              },
            },
          },
        ],
      };

      const result = calculator.calculateHealthFactor(user);
      
      // Collateral: 2000 * 0.0005 = 1 ETH
      // Weighted: 1 * 0.85 = 0.85 ETH
      // Debt: 1000 * 0.0005 = 0.5 ETH
      // HF: 0.85 / 0.5 = 1.7
      
      expect(result.healthFactor).toBeCloseTo(1.7, 1);
      expect(result.isAtRisk).toBe(false);
    });

    it('should detect at-risk positions (HF < 1.1)', () => {
      const user: User = {
        id: '0x789',
        borrowedReservesCount: 1,
        reserves: [
          {
            currentATokenBalance: '1200000000', // 1200 USDC
            currentVariableDebt: '1000000000', // 1000 USDC debt
            currentStableDebt: '0',
            reserve: {
              id: '0xusdc',
              symbol: 'USDC',
              name: 'USD Coin',
              decimals: 6,
              reserveLiquidationThreshold: 8500, // 85%
              usageAsCollateralEnabled: true,
              price: {
                priceInEth: '500000000000000',
              },
            },
          },
        ],
      };

      const result = calculator.calculateHealthFactor(user);
      
      // Collateral: 1200 * 0.0005 = 0.6 ETH
      // Weighted: 0.6 * 0.85 = 0.51 ETH
      // Debt: 1000 * 0.0005 = 0.5 ETH
      // HF: 0.51 / 0.5 = 1.02
      
      expect(result.healthFactor).toBeLessThan(1.1);
      expect(result.isAtRisk).toBe(true);
    });

    it('should handle mixed collateral and debt assets', () => {
      const user: User = {
        id: '0xabc',
        borrowedReservesCount: 2,
        reserves: [
          {
            currentATokenBalance: '1000000000', // 1000 USDC collateral
            currentVariableDebt: '0',
            currentStableDebt: '0',
            reserve: {
              id: '0xusdc',
              symbol: 'USDC',
              name: 'USD Coin',
              decimals: 6,
              reserveLiquidationThreshold: 8500,
              usageAsCollateralEnabled: true,
              price: { priceInEth: '500000000000000' },
            },
          },
          {
            currentATokenBalance: '0',
            currentVariableDebt: '500000000000000000', // 0.5 ETH debt
            currentStableDebt: '0',
            reserve: {
              id: '0xweth',
              symbol: 'WETH',
              name: 'Wrapped Ether',
              decimals: 18,
              reserveLiquidationThreshold: 8000,
              usageAsCollateralEnabled: true,
              price: { priceInEth: '1000000000000000000' },
            },
          },
        ],
      };

      const result = calculator.calculateHealthFactor(user);
      
      // Collateral: 1000 * 0.0005 = 0.5 ETH
      // Weighted: 0.5 * 0.85 = 0.425 ETH
      // Debt: 0.5 * 1 = 0.5 ETH
      // HF: 0.425 / 0.5 = 0.85
      
      expect(result.healthFactor).toBeLessThan(1.0);
      expect(result.isAtRisk).toBe(true);
    });
  });

  describe('batchCalculateHealthFactors', () => {
    it('should calculate health factors for multiple users', () => {
      const users: User[] = [
        {
          id: '0x111',
          borrowedReservesCount: 0,
          reserves: [],
        },
        {
          id: '0x222',
          borrowedReservesCount: 1,
          reserves: [
            {
              currentATokenBalance: '2000000000',
              currentVariableDebt: '1000000000',
              currentStableDebt: '0',
              reserve: {
                id: '0xusdc',
                symbol: 'USDC',
                name: 'USD Coin',
                decimals: 6,
                reserveLiquidationThreshold: 8500,
                usageAsCollateralEnabled: true,
                price: { priceInEth: '500000000000000' },
              },
            },
          ],
        },
      ];

      const results = calculator.batchCalculateHealthFactors(users);
      
      expect(results).toHaveLength(2);
      expect(results[0].userId).toBe('0x111');
      expect(results[1].userId).toBe('0x222');
    });
  });
});
