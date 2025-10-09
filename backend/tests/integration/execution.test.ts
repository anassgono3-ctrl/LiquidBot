// Integration tests for execution pipeline
import { describe, it, expect, beforeEach } from 'vitest';

import { ExecutionService } from '../../src/services/ExecutionService.js';
import { RiskManager } from '../../src/services/RiskManager.js';
import { OpportunityService } from '../../src/services/OpportunityService.js';
import type { LiquidationCall } from '../../src/types/index.js';

describe('Execution Pipeline Integration', () => {
  let executionService: ExecutionService;
  let riskManager: RiskManager;
  let opportunityService: OpportunityService;

  beforeEach(() => {
    executionService = new ExecutionService();
    riskManager = new RiskManager();
    opportunityService = new OpportunityService();
  });

  const createMockLiquidation = (): LiquidationCall => ({
    id: 'liq-test-1',
    timestamp: Date.now(),
    liquidator: '0x5678',
    user: '0x1234',
    principalAmount: '500000000', // 500 USDC (6 decimals)
    collateralAmount: '1000000000000000000', // 1 ETH
    txHash: '0xabc',
    principalReserve: {
      id: '0xusdc',
      symbol: 'USDC',
      decimals: 6
    },
    collateralReserve: {
      id: '0xeth',
      symbol: 'ETH',
      decimals: 18
    },
    healthFactor: 0.95
  });

  it('should process opportunity through complete pipeline without errors', async () => {
    const liquidation = createMockLiquidation();
    
    // Build opportunity
    const opportunities = await opportunityService.buildOpportunities([liquidation]);
    expect(opportunities.length).toBe(1);
    
    const opportunity = opportunities[0];
    expect(opportunity.id).toBe('liq-test-1');
    expect(opportunity.profitEstimateUsd).toBeDefined();
    
    // Calculate after-gas profit
    const gasCostUsd = 0.5;
    const afterGasProfit = (opportunity.profitEstimateUsd || 0) - gasCostUsd;
    
    // Check risk - should pass with default config
    const riskCheck = riskManager.canExecute(opportunity, afterGasProfit);
    expect(riskCheck).toBeDefined();
    
    // Execute (will be skipped due to EXECUTION_ENABLED=false default)
    const result = await executionService.execute(opportunity);
    expect(result).toBeDefined();
    expect(result.simulated).toBe(true);
    expect(result.reason).toBe('execution_disabled');
  });

  it('should skip opportunities that fail risk checks', async () => {
    const liquidation = createMockLiquidation();
    
    // Build opportunity
    const opportunities = await opportunityService.buildOpportunities([liquidation]);
    const opportunity = opportunities[0];
    
    // Set very low after-gas profit (below MIN_PROFIT_AFTER_GAS_USD default of 10)
    const afterGasProfit = 5;
    
    // Should fail risk check
    const riskCheck = riskManager.canExecute(opportunity, afterGasProfit);
    expect(riskCheck.allowed).toBe(false);
    expect(riskCheck.reason).toContain('After-gas profit');
  });

  it('should handle multiple opportunities in sequence', async () => {
    const liquidations = [
      createMockLiquidation(),
      { ...createMockLiquidation(), id: 'liq-test-2', user: '0x9999' },
      { ...createMockLiquidation(), id: 'liq-test-3', user: '0x8888' }
    ];
    
    // Build opportunities
    const opportunities = await opportunityService.buildOpportunities(liquidations);
    expect(opportunities.length).toBe(3);
    
    // Process each through risk checks
    let processedCount = 0;
    for (const op of opportunities) {
      const gasCostUsd = 0.5;
      const afterGasProfit = (op.profitEstimateUsd || 0) - gasCostUsd;
      
      const riskCheck = riskManager.canExecute(op, afterGasProfit);
      
      if (riskCheck.allowed) {
        const result = await executionService.execute(op);
        expect(result).toBeDefined();
        processedCount++;
      }
    }
    
    // All should reach execution service (though will be disabled)
    expect(processedCount).toBeGreaterThan(0);
  });

  it('should track daily P&L across multiple executions', () => {
    // Simulate multiple executions
    riskManager.recordRealizedProfit(100);
    riskManager.recordRealizedProfit(50);
    riskManager.recordRealizedProfit(-20);
    
    const dailyPnl = riskManager.getDailyPnl();
    expect(dailyPnl).toBe(130);
  });

  it('should block execution after daily loss limit', async () => {
    const liquidation = createMockLiquidation();
    const opportunities = await opportunityService.buildOpportunities([liquidation]);
    const opportunity = opportunities[0];
    
    // Record large losses to exceed DAILY_LOSS_LIMIT_USD (default 1000)
    riskManager.recordRealizedProfit(-600);
    riskManager.recordRealizedProfit(-500);
    
    // Should fail risk check due to daily loss limit
    const riskCheck = riskManager.canExecute(opportunity, 15);
    expect(riskCheck.allowed).toBe(false);
    expect(riskCheck.reason).toContain('Daily loss limit');
  });

  it('should get execution service configuration', () => {
    const config = executionService.getConfig();
    
    expect(config).toHaveProperty('enabled');
    expect(config).toHaveProperty('dryRun');
    expect(config).toHaveProperty('maxGasPriceGwei');
    
    // Check defaults
    expect(config.enabled).toBe(false);
    expect(config.dryRun).toBe(true);
    expect(config.maxGasPriceGwei).toBe(50);
  });
});
