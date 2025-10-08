// Unit tests for OpportunityService
import { describe, it, expect, beforeEach } from 'vitest';

import { OpportunityService } from '../../src/services/OpportunityService.js';
import { PriceService } from '../../src/services/PriceService.js';
import type { LiquidationCall, HealthSnapshot } from '../../src/types/index.js';

describe('OpportunityService', () => {
  let opportunityService: OpportunityService;
  let priceService: PriceService;

  beforeEach(() => {
    priceService = new PriceService();
    opportunityService = new OpportunityService({ priceService });
  });

  describe('buildOpportunities', () => {
    it('should build opportunity from liquidation call', async () => {
      const liquidations: LiquidationCall[] = [
        {
          id: 'liq-1',
          timestamp: 1234567890,
          user: '0xUser123',
          liquidator: '0xLiquidator456',
          collateralAmount: '1000000000', // 1000 USDC (6 decimals)
          principalAmount: '500000000000000000', // 0.5 WETH (18 decimals)
          txHash: '0xtxhash123',
          collateralReserve: { id: '0xusdc', symbol: 'USDC', decimals: 6 },
          principalReserve: { id: '0xweth', symbol: 'WETH', decimals: 18 }
        }
      ];

      const opportunities = await opportunityService.buildOpportunities(liquidations);

      expect(opportunities).toHaveLength(1);
      expect(opportunities[0].id).toBe('liq-1');
      expect(opportunities[0].user).toBe('0xUser123');
      expect(opportunities[0].collateralValueUsd).toBeGreaterThan(0);
      expect(opportunities[0].principalValueUsd).toBeGreaterThan(0);
      expect(opportunities[0].profitEstimateUsd).toBeDefined();
    });

    it('should calculate profit estimate', async () => {
      const liquidations: LiquidationCall[] = [
        {
          id: 'liq-2',
          timestamp: 1234567890,
          user: '0xUser123',
          liquidator: '0xLiquidator456',
          collateralAmount: '2000000000', // 2000 USDC (actual seized, already includes bonus)
          principalAmount: '1000000000', // 1000 USDC (actual debt repaid)
          txHash: null,
          collateralReserve: { id: '0xusdc', symbol: 'USDC', decimals: 6 },
          principalReserve: { id: '0xusdc2', symbol: 'USDC', decimals: 6 }
        }
      ];

      const opportunities = await opportunityService.buildOpportunities(liquidations);

      // POST-EVENT CALCULATION (no bonus re-applied):
      // Collateral: 2000 USD (already includes liquidation bonus)
      // Principal: 1000 USD
      // Raw spread: 1000 USD
      // Bonus applied: 0 (event amounts already reflect seized collateral)
      // Gross: 1000 USD
      // Fees: 1000 * 0.003 = 3.0 USD
      // Gas cost: 0.5 USD (default)
      // Net profit: ~996.5 USD

      expect(opportunities[0].profitEstimateUsd).toBeGreaterThan(990);
      expect(opportunities[0].profitEstimateUsd).toBeLessThan(1000);
    });

    it('should include health factor when snapshot provided', async () => {
      const liquidations: LiquidationCall[] = [
        {
          id: 'liq-3',
          timestamp: 1234567890,
          user: '0xUser123',
          liquidator: '0xLiquidator456',
          collateralAmount: '1000000000',
          principalAmount: '500000000',
          txHash: null,
          collateralReserve: { id: '0xusdc', symbol: 'USDC', decimals: 6 },
          principalReserve: { id: '0xusdc2', symbol: 'USDC', decimals: 6 }
        }
      ];

      const healthSnapshots = new Map<string, HealthSnapshot>([
        ['0xUser123', {
          userId: '0xUser123',
          healthFactor: 0.98,
          totalCollateralETH: 1.5,
          totalDebtETH: 1.53,
          timestamp: Date.now()
        }]
      ]);

      const opportunities = await opportunityService.buildOpportunities(liquidations, healthSnapshots);

      expect(opportunities[0].healthFactor).toBe(0.98);
    });

    it('should handle liquidation without health snapshot', async () => {
      const liquidations: LiquidationCall[] = [
        {
          id: 'liq-4',
          timestamp: 1234567890,
          user: '0xUser123',
          liquidator: '0xLiquidator456',
          collateralAmount: '1000000000',
          principalAmount: '500000000',
          txHash: null,
          collateralReserve: { id: '0xusdc', symbol: 'USDC', decimals: 6 },
          principalReserve: { id: '0xusdc2', symbol: 'USDC', decimals: 6 }
        }
      ];

      const opportunities = await opportunityService.buildOpportunities(liquidations);

      expect(opportunities[0].healthFactor).toBeNull();
    });

    it('should handle missing reserve info gracefully', async () => {
      const liquidations: LiquidationCall[] = [
        {
          id: 'liq-5',
          timestamp: 1234567890,
          user: '0xUser123',
          liquidator: '0xLiquidator456',
          collateralAmount: '1000000000',
          principalAmount: '500000000',
          txHash: null,
          collateralReserve: null,
          principalReserve: null
        }
      ];

      const opportunities = await opportunityService.buildOpportunities(liquidations);

      expect(opportunities).toHaveLength(1);
      expect(opportunities[0].collateralReserve.id).toBe('unknown');
      expect(opportunities[0].principalReserve.id).toBe('unknown');
    });
  });

  describe('filterProfitableOpportunities', () => {
    it('should filter opportunities by profit threshold', async () => {
      const liquidations: LiquidationCall[] = [
        {
          id: 'liq-high',
          timestamp: 1234567890,
          user: '0xUser1',
          liquidator: '0xLiq1',
          collateralAmount: '2000000000', // 2000 USDC
          principalAmount: '500000000', // 500 USDC - high profit
          txHash: null,
          collateralReserve: { id: '0xusdc', symbol: 'USDC', decimals: 6 },
          principalReserve: { id: '0xusdc2', symbol: 'USDC', decimals: 6 }
        },
        {
          id: 'liq-low',
          timestamp: 1234567890,
          user: '0xUser2',
          liquidator: '0xLiq2',
          collateralAmount: '1010000000', // 1010 USDC
          principalAmount: '1000000000', // 1000 USDC - low profit
          txHash: null,
          collateralReserve: { id: '0xusdc', symbol: 'USDC', decimals: 6 },
          principalReserve: { id: '0xusdc2', symbol: 'USDC', decimals: 6 }
        }
      ];

      const opportunities = await opportunityService.buildOpportunities(liquidations);
      const profitable = opportunityService.filterProfitableOpportunities(opportunities);

      // With PROFIT_MIN_USD=10, the high profit should pass, low might not
      expect(profitable.length).toBeGreaterThanOrEqual(1);
      expect(profitable[0].id).toBe('liq-high');
    });
  });
});
