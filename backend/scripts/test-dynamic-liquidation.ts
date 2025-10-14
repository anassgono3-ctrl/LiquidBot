#!/usr/bin/env tsx
/**
 * Test script for dynamic liquidation sizing
 * Demonstrates the functionality without requiring actual on-chain execution
 * 
 * Usage:
 *   API_KEY=test JWT_SECRET=test USE_MOCK_SUBGRAPH=true npx tsx scripts/test-dynamic-liquidation.ts
 */

import { ProfitCalculator } from '../src/services/ProfitCalculator.js';
import { config } from '../src/config/index.js';

console.log('=== Dynamic Liquidation Sizing Test ===\n');

// Display configuration
console.log('Configuration:');
console.log(`  CLOSE_FACTOR_EXECUTION_MODE: ${config.closeFactorExecutionMode}`);
console.log(`  AAVE_PROTOCOL_DATA_PROVIDER: ${config.aaveProtocolDataProvider}`);
console.log(`  AAVE_ORACLE: ${config.aaveOracle}`);
console.log('');

// Test scenario parameters
const totalDebtUsd = 2000;
const liquidationBonusPct = 0.05; // 5% (fetched from Aave reserve config)

console.log('Test Scenario:');
console.log(`  Total Debt: $${totalDebtUsd}`);
console.log(`  Liquidation Bonus: ${(liquidationBonusPct * 100).toFixed(2)}%`);
console.log('');

// Initialize profit calculator
const calculator = new ProfitCalculator({
  feeBps: 30,      // 0.3%
  gasCostUsd: 0.5  // $0.50
});

// Test fixed50 mode
console.log('--- Mode: fixed50 (50% of debt) ---');
const fixed50DebtToCover = totalDebtUsd / 2;
const fixed50Profit = calculator.estimateProfitWithBonus(fixed50DebtToCover, liquidationBonusPct);

console.log(`  Debt to Cover: $${fixed50DebtToCover.toFixed(2)}`);
console.log(`  Expected Collateral: $${(fixed50DebtToCover * (1 + liquidationBonusPct)).toFixed(2)}`);
console.log(`  Bonus Value: $${fixed50Profit.bonusValue.toFixed(2)}`);
console.log(`  Gross Profit: $${fixed50Profit.gross.toFixed(2)}`);
console.log(`  Fees: $${fixed50Profit.fees.toFixed(2)}`);
console.log(`  Gas Cost: $${fixed50Profit.gasCost.toFixed(2)}`);
console.log(`  Net Profit: $${fixed50Profit.net.toFixed(2)}`);
console.log('');

// Test full mode
console.log('--- Mode: full (100% of debt) ---');
const fullDebtToCover = totalDebtUsd;
const fullProfit = calculator.estimateProfitWithBonus(fullDebtToCover, liquidationBonusPct);

console.log(`  Debt to Cover: $${fullDebtToCover.toFixed(2)}`);
console.log(`  Expected Collateral: $${(fullDebtToCover * (1 + liquidationBonusPct)).toFixed(2)}`);
console.log(`  Bonus Value: $${fullProfit.bonusValue.toFixed(2)}`);
console.log(`  Gross Profit: $${fullProfit.gross.toFixed(2)}`);
console.log(`  Fees: $${fullProfit.fees.toFixed(2)}`);
console.log(`  Gas Cost: $${fullProfit.gasCost.toFixed(2)}`);
console.log(`  Net Profit: $${fullProfit.net.toFixed(2)}`);
console.log('');

// Compare modes
console.log('--- Mode Comparison ---');
console.log(`  fixed50 Net Profit: $${fixed50Profit.net.toFixed(2)}`);
console.log(`  full Net Profit: $${fullProfit.net.toFixed(2)}`);
console.log(`  Profit Difference: $${(fullProfit.net - fixed50Profit.net).toFixed(2)}`);
console.log(`  Capital Required (fixed50): $${fixed50DebtToCover.toFixed(2)}`);
console.log(`  Capital Required (full): $${fullDebtToCover.toFixed(2)}`);
console.log(`  Capital Difference: $${(fullDebtToCover - fixed50DebtToCover).toFixed(2)}`);
console.log('');

// Test with different liquidation bonuses
console.log('--- Different Liquidation Bonuses (fixed50 mode) ---');
const bonusTests = [
  { pct: 0.025, label: '2.5%' },
  { pct: 0.05, label: '5.0%' },
  { pct: 0.075, label: '7.5%' },
  { pct: 0.10, label: '10.0%' }
];

for (const test of bonusTests) {
  const profit = calculator.estimateProfitWithBonus(fixed50DebtToCover, test.pct);
  console.log(`  ${test.label} bonus: Net Profit = $${profit.net.toFixed(2)}, Bonus Value = $${profit.bonusValue.toFixed(2)}`);
}
console.log('');

// Test profitability threshold
console.log('--- Minimum Profitable Debt Amount (5% bonus, fixed50) ---');
let minProfitableDebt = 0;
for (let debt = 10; debt <= 100; debt += 10) {
  const profit = calculator.estimateProfitWithBonus(debt / 2, liquidationBonusPct);
  if (profit.net > 0 && minProfitableDebt === 0) {
    minProfitableDebt = debt;
  }
  const status = profit.net > 0 ? '✓ Profitable' : '✗ Not Profitable';
  console.log(`  Total Debt $${debt}: Net = $${profit.net.toFixed(2)} ${status}`);
}
console.log(`\n  Minimum profitable total debt: ~$${minProfitableDebt}`);
console.log('');

// Safety checks demonstration
console.log('--- Safety Checks ---');
console.log('  ✓ Health Factor recheck at latest block before execution');
console.log('  ✓ Skip if HF >= 1.0 (user_not_liquidatable)');
console.log('  ✓ Skip if total debt = 0 (zero_debt)');
console.log('  ✓ Skip if calculated debtToCover = 0');
console.log('  ✓ Fetch live debt from Protocol Data Provider (real-time path)');
console.log('  ✓ Fetch dynamic liquidation bonus per reserve');
console.log('');

console.log('=== Test Complete ===');
console.log('\nTo use in production:');
console.log('1. Set CLOSE_FACTOR_EXECUTION_MODE=fixed50 (default, safer)');
console.log('2. Or set CLOSE_FACTOR_EXECUTION_MODE=full (experimental, higher profit)');
console.log('3. Configure Aave addresses if different from defaults');
console.log('4. Enable execution with EXECUTION_ENABLED=true');
console.log('5. Test in dry-run mode first: DRY_RUN_EXECUTION=true');
