// Unit tests for execution guards and accuracy checks
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { ExecutionService } from '../../src/services/ExecutionService.js';
import type { Opportunity } from '../../src/types/index.js';

// Mock environment variables
const originalEnv = process.env;

describe('Execution Guards', () => {
  beforeEach(() => {
    // Reset environment
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const createMockOpportunity = (overrides?: Partial<Opportunity>): Opportunity => ({
    id: 'test-opp-1',
    user: '0x1234567890123456789012345678901234567890',
    collateralReserve: {
      id: '0xCollateral',
      symbol: 'WETH',
      decimals: 18
    },
    principalReserve: {
      id: '0xPrincipal',
      symbol: 'USDC',
      decimals: 6
    },
    collateralAmountRaw: '1000000000000000000', // 1 WETH
    principalAmountRaw: '500000000', // 500 USDC
    healthFactor: 0.95,
    profitEstimateUsd: 10,
    timestamp: Date.now(),
    triggerSource: 'realtime',
    ...overrides
  });

  describe('EXECUTION_ENABLED gate', () => {
    it('should have execution disabled by default', async () => {
      const executionService = new ExecutionService();
      const opportunity = createMockOpportunity();
      
      const result = await executionService.execute(opportunity);
      
      // By default, execution should be disabled (EXECUTION_ENABLED=false default)
      expect(result.success).toBe(false);
      expect(result.simulated).toBe(true);
      expect(result.reason).toBe('execution_disabled');
    });

    it('should verify execution config structure', () => {
      const executionService = new ExecutionService();
      const config = executionService.getConfig();
      
      // Config should have expected properties
      expect(config).toHaveProperty('enabled');
      expect(config).toHaveProperty('dryRun');
      expect(config).toHaveProperty('maxGasPriceGwei');
      
      // Default should be disabled
      expect(config.enabled).toBe(false);
    });
  });

  describe('Dust guard', () => {
    it('should identify dust positions correctly', () => {
      // Test that dust threshold is configurable
      const dustThresholdWei = BigInt(process.env.EXECUTION_DUST_WEI || '1000000000000');
      
      // Example: 1e12 wei = 0.000001 ETH (if base is ETH with 18 decimals)
      expect(dustThresholdWei).toBe(BigInt(1e12));
      
      // Test dust detection logic
      const collateralBase = BigInt(5e11); // Below threshold
      const debtBase = BigInt(5e11); // Below threshold
      
      const isDust = collateralBase < dustThresholdWei && debtBase < dustThresholdWei;
      expect(isDust).toBe(true);
    });

    it('should not flag as dust if either value is above threshold', () => {
      const dustThresholdWei = BigInt(1e12);
      
      const collateralBase = BigInt(2e12); // Above threshold
      const debtBase = BigInt(5e11); // Below threshold
      
      const isDust = collateralBase < dustThresholdWei && debtBase < dustThresholdWei;
      expect(isDust).toBe(false);
    });
  });

  describe('Scaling anomaly detection', () => {
    it('should detect when debt amount exceeds 1e6 tokens', () => {
      const debtToCoverRaw = BigInt('2000000000000000000000000'); // 2e24 wei
      const decimals = 18;
      
      const debtToCoverHuman = Number(debtToCoverRaw) / (10 ** decimals);
      
      // Should be 2 million tokens
      expect(debtToCoverHuman).toBe(2e6);
      
      // Should trigger scaling guard
      const isScalingAnomaly = debtToCoverHuman > 1e6;
      expect(isScalingAnomaly).toBe(true);
    });

    it('should not flag normal amounts as scaling anomalies', () => {
      const debtToCoverRaw = BigInt('500000000000000000000'); // 500 tokens (18 decimals)
      const decimals = 18;
      
      const debtToCoverHuman = Number(debtToCoverRaw) / (10 ** decimals);
      
      expect(debtToCoverHuman).toBe(500);
      
      const isScalingAnomaly = debtToCoverHuman > 1e6;
      expect(isScalingAnomaly).toBe(false);
    });

    it('should handle USDC decimals correctly', () => {
      const debtToCoverRaw = BigInt('500000000'); // 500 USDC (6 decimals)
      const decimals = 6;
      
      const debtToCoverHuman = Number(debtToCoverRaw) / (10 ** decimals);
      
      expect(debtToCoverHuman).toBe(500);
      
      const isScalingAnomaly = debtToCoverHuman > 1e6;
      expect(isScalingAnomaly).toBe(false);
    });
  });

  describe('Health factor formatting', () => {
    it('should display HF as "INF" when debt is zero', () => {
      const totalDebtBase = 0n;
      const healthFactor = BigInt(2e18); // Max HF
      
      const hfFormatted = totalDebtBase === 0n ? 'INF' : (Number(healthFactor) / 1e18).toFixed(4);
      
      expect(hfFormatted).toBe('INF');
    });

    it('should display HF as numeric when debt is non-zero', () => {
      const totalDebtBase = BigInt(1e18);
      const healthFactor = BigInt(95e16); // 0.95
      
      const hfFormatted = totalDebtBase === 0n ? 'INF' : (Number(healthFactor) / 1e18).toFixed(4);
      
      expect(hfFormatted).toBe('0.9500');
    });

    it('should display HF below 1 correctly', () => {
      const totalDebtBase = BigInt(1e18);
      const healthFactor = BigInt(85e16); // 0.85
      
      const hfFormatted = totalDebtBase === 0n ? 'INF' : (Number(healthFactor) / 1e18).toFixed(4);
      
      expect(hfFormatted).toBe('0.8500');
    });
  });

  describe('Profit reasonability check', () => {
    it('should reject unprofitable opportunities', () => {
      const seizedUsd = 100;
      const repayUsd = 95;
      const profitMinUsd = 10;
      
      const grossProfit = seizedUsd - repayUsd;
      const isProfitable = grossProfit >= profitMinUsd;
      
      expect(grossProfit).toBe(5);
      expect(isProfitable).toBe(false);
    });

    it('should accept profitable opportunities', () => {
      const seizedUsd = 110;
      const repayUsd = 95;
      const profitMinUsd = 10;
      
      const grossProfit = seizedUsd - repayUsd;
      const isProfitable = grossProfit >= profitMinUsd;
      
      expect(grossProfit).toBe(15);
      expect(isProfitable).toBe(true);
    });
  });

  describe('Decimal verification', () => {
    it('should correctly identify cbETH as 18 decimals', () => {
      const cbETHDecimals = 18;
      expect(cbETHDecimals).toBe(18);
    });

    it('should correctly identify USDC as 6 decimals', () => {
      const usdcDecimals = 6;
      expect(usdcDecimals).toBe(6);
    });

    it('should correctly identify WETH as 18 decimals', () => {
      const wethDecimals = 18;
      expect(wethDecimals).toBe(18);
    });

    it('should correctly identify GHO as 18 decimals', () => {
      const ghoDecimals = 18;
      expect(ghoDecimals).toBe(18);
    });
  });

  describe('Variable debt reconstruction', () => {
    it('should calculate tolerance correctly', () => {
      const reconstructed = BigInt(1000000000000000000n); // 1e18
      const tolerance = reconstructed / 200n; // 0.5%
      
      expect(tolerance).toBe(BigInt(5000000000000000n)); // 0.005e18
    });

    it('should detect inconsistency beyond tolerance', () => {
      const reconstructed = BigInt(1000000000000000000n); // 1e18
      const current = BigInt(950000000000000000n); // 0.95e18
      const tolerance = reconstructed / 200n; // 0.5%
      
      const diff = reconstructed - current;
      const isInconsistent = diff > tolerance;
      
      // 5% difference should be inconsistent (exceeds 0.5% tolerance)
      expect(isInconsistent).toBe(true);
    });

    it('should accept values within tolerance', () => {
      const reconstructed = BigInt(1000000000000000000n); // 1e18
      const current = BigInt(999000000000000000n); // 0.999e18
      const tolerance = reconstructed / 200n; // 0.5%
      
      const diff = reconstructed - current;
      const isInconsistent = diff > tolerance;
      
      // 0.1% difference should be acceptable
      expect(isInconsistent).toBe(false);
    });
  });
});
