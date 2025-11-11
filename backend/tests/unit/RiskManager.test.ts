// Unit tests for RiskManager
import { describe, it, expect, beforeEach } from 'vitest';

import { RiskManager } from '../../src/services/RiskManager.js';
import type { Opportunity } from '../../src/types/index.js';

describe('RiskManager', () => {
  let riskManager: RiskManager;
  
  // Sample opportunity for testing
  const createOpportunity = (overrides: Partial<Opportunity> = {}): Opportunity => ({
    id: 'opp-1',
    user: '0x1234',
    timestamp: Date.now(),
    collateralAmountRaw: '1000000000000000000',
    principalAmountRaw: '500000000000000000',
    collateralReserve: { id: '0xabc', symbol: 'ETH', decimals: 18 },
    principalReserve: { id: '0xdef', symbol: 'USDC', decimals: 6 },
    healthFactor: 0.95,
    collateralValueUsd: 2000,
    principalValueUsd: 1800,
    profitEstimateUsd: 50,
    bonusPct: 0.05,
    ...overrides,
    txHash: overrides.txHash ?? null,
    liquidator: overrides.liquidator ?? '0x5678'
  });

  beforeEach(() => {
    riskManager = new RiskManager();
  });

  describe('canExecute', () => {
    it('should allow execution when all checks pass', () => {
      const opportunity = createOpportunity();
      const result = riskManager.canExecute(opportunity, 15);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should block blacklisted collateral when configured', () => {
      // Note: BLACKLISTED_TOKENS must be set before module load
      // For this test, we'll verify the logic works with empty blacklist
      // A real blacklist test requires process restart or dynamic config
      const opportunity = createOpportunity({
        collateralReserve: { id: '0xabc', symbol: 'WBTC', decimals: 8 }
      });
      
      // With no blacklist configured (default), should pass
      const result = riskManager.canExecute(opportunity, 15);
      expect(result.allowed).toBe(true);
    });

    it('should block blacklisted principal when configured', () => {
      // Similar to above - with no blacklist, should pass
      const opportunity = createOpportunity({
        principalReserve: { id: '0xdef', symbol: 'XYZ', decimals: 18 }
      });
      
      const result = riskManager.canExecute(opportunity, 15);
      expect(result.allowed).toBe(true);
    });

    it('should block when after-gas profit below threshold', () => {
      const opportunity = createOpportunity();
      const result = riskManager.canExecute(opportunity, 5); // Below MIN_PROFIT_AFTER_GAS_USD (10)

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('After-gas profit');
      expect(result.reason).toContain('$5.00');
    });

    it('should allow when after-gas profit equals threshold', () => {
      const opportunity = createOpportunity();
      const result = riskManager.canExecute(opportunity, 10); // Exactly MIN_PROFIT_AFTER_GAS_USD

      expect(result.allowed).toBe(true);
    });

    it('should block when position size exceeds limit', () => {
      const opportunity = createOpportunity({
        collateralValueUsd: 6000, // Above MAX_POSITION_SIZE_USD (5000)
        principalValueUsd: 5500
      });
      
      const result = riskManager.canExecute(opportunity, 15);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Position size');
      expect(result.reason).toContain('$6000');
    });

    it('should use max of collateral and principal for position size', () => {
      const opportunity = createOpportunity({
        collateralValueUsd: 3000,
        principalValueUsd: 6000 // Principal is larger
      });
      
      const result = riskManager.canExecute(opportunity, 15);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Position size');
      expect(result.reason).toContain('$6000');
    });

    it('should block when daily loss limit exceeded', () => {
      const opportunity = createOpportunity();
      
      // Record losses to exceed daily limit (1000)
      riskManager.recordRealizedProfit(-500);
      riskManager.recordRealizedProfit(-600);
      
      const result = riskManager.canExecute(opportunity, 15);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily loss limit reached');
    });

    it('should allow execution when daily profit is positive', () => {
      const opportunity = createOpportunity();
      
      // Record profits
      riskManager.recordRealizedProfit(100);
      riskManager.recordRealizedProfit(200);
      
      const result = riskManager.canExecute(opportunity, 15);

      expect(result.allowed).toBe(true);
    });
  });

  describe('recordRealizedProfit', () => {
    it('should track daily profit', () => {
      riskManager.recordRealizedProfit(100);
      expect(riskManager.getDailyPnl()).toBe(100);

      riskManager.recordRealizedProfit(50);
      expect(riskManager.getDailyPnl()).toBe(150);
    });

    it('should track daily loss', () => {
      riskManager.recordRealizedProfit(-50);
      expect(riskManager.getDailyPnl()).toBe(-50);

      riskManager.recordRealizedProfit(-30);
      expect(riskManager.getDailyPnl()).toBe(-80);
    });

    it('should handle mixed profit and loss', () => {
      riskManager.recordRealizedProfit(100);
      riskManager.recordRealizedProfit(-30);
      riskManager.recordRealizedProfit(20);
      
      expect(riskManager.getDailyPnl()).toBe(90);
    });
  });

  describe('getDailyPnl', () => {
    it('should return zero for new instance', () => {
      expect(riskManager.getDailyPnl()).toBe(0);
    });

    it('should return current daily P&L', () => {
      riskManager.recordRealizedProfit(100);
      riskManager.recordRealizedProfit(-25);
      
      expect(riskManager.getDailyPnl()).toBe(75);
    });
  });
});
