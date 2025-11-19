/**
 * Predictive HF Harness
 * 
 * Development harness to test the predictive HF engine with sample data
 */

import { PredictiveEngine } from '../../src/risk/PredictiveEngine.js';
import { HFCalculator, UserSnapshot } from '../../src/risk/HFCalculator.js';
import { PriceWindow } from '../../src/risk/PriceWindow.js';
import { config } from '../../src/config/index.js';

async function main(): Promise<void> {
  console.log('[predictive-harness] Starting predictive HF engine harness');
  console.log('[predictive-harness] Configuration:');
  console.log(`  - Enabled: ${config.predictiveEnabled}`);
  console.log(`  - HF Buffer: ${config.predictiveHfBufferBps} bps`);
  console.log(`  - Max Users Per Tick: ${config.predictiveMaxUsersPerTick}`);
  console.log(`  - Horizon: ${config.predictiveHorizonSec}s`);
  console.log(`  - Scenarios: ${config.predictiveScenarios.join(', ')}`);
  console.log('');

  // Create engine instance
  const engine = new PredictiveEngine();

  if (!engine.isEnabled()) {
    console.log('[predictive-harness] Predictive engine is disabled. Set PREDICTIVE_ENABLED=true to enable.');
    return;
  }

  // Simulate price updates
  console.log('[predictive-harness] Simulating price updates...');
  const currentBlock = 10000000;
  const now = Date.now();

  engine.updatePrice('ETH', 2000, now - 180000, currentBlock - 15);
  engine.updatePrice('ETH', 2010, now - 120000, currentBlock - 10);
  engine.updatePrice('ETH', 1990, now - 60000, currentBlock - 5);
  engine.updatePrice('ETH', 1980, now, currentBlock);

  engine.updatePrice('USDC', 1.0, now - 180000, currentBlock - 15);
  engine.updatePrice('USDC', 1.0, now - 120000, currentBlock - 10);
  engine.updatePrice('USDC', 1.0, now - 60000, currentBlock - 5);
  engine.updatePrice('USDC', 1.0, now, currentBlock);

  // Create sample user snapshots
  console.log('[predictive-harness] Creating sample user snapshots...');
  
  const sampleUsers: UserSnapshot[] = [
    {
      address: '0x1111111111111111111111111111111111111111',
      block: currentBlock,
      reserves: [
        { asset: 'ETH', debtUsd: 5000, collateralUsd: 10000, liquidationThreshold: 0.80 },
        { asset: 'USDC', debtUsd: 0, collateralUsd: 2000, liquidationThreshold: 0.90 }
      ]
    },
    {
      address: '0x2222222222222222222222222222222222222222',
      block: currentBlock,
      reserves: [
        { asset: 'ETH', debtUsd: 8000, collateralUsd: 10000, liquidationThreshold: 0.80 },
        { asset: 'USDC', debtUsd: 2000, collateralUsd: 1000, liquidationThreshold: 0.90 }
      ]
    },
    {
      address: '0x3333333333333333333333333333333333333333',
      block: currentBlock,
      reserves: [
        { asset: 'ETH', debtUsd: 9500, collateralUsd: 10000, liquidationThreshold: 0.80 },
        { asset: 'USDC', debtUsd: 0, collateralUsd: 500, liquidationThreshold: 0.90 }
      ]
    }
  ];

  // Calculate current HFs
  console.log('[predictive-harness] Current health factors:');
  for (const user of sampleUsers) {
    const hf = HFCalculator.calculateHF(user);
    const totalDebt = user.reserves.reduce((sum, r) => sum + r.debtUsd, 0);
    const totalCollateral = user.reserves.reduce((sum, r) => sum + r.collateralUsd, 0);
    console.log(`  ${user.address}: HF=${hf.toFixed(4)}, Debt=${totalDebt} USD, Collateral=${totalCollateral} USD`);
  }
  console.log('');

  // Run predictive evaluation
  console.log('[predictive-harness] Running predictive evaluation...');
  const startMs = Date.now();
  const candidates = await engine.evaluate(sampleUsers, currentBlock);
  const elapsedMs = Date.now() - startMs;

  console.log(`[predictive-harness] Evaluation completed in ${elapsedMs}ms`);
  console.log(`[predictive-harness] Generated ${candidates.length} predictive candidates:`);
  console.log('');

  for (const candidate of candidates) {
    console.log(`  User: ${candidate.address}`);
    console.log(`    Scenario: ${candidate.scenario}`);
    console.log(`    Current HF: ${candidate.hfCurrent.toFixed(4)}`);
    console.log(`    Projected HF: ${candidate.hfProjected.toFixed(4)}`);
    console.log(`    ETA to threshold: ${candidate.etaSec}s`);
    console.log(`    Total Debt: ${candidate.totalDebtUsd.toFixed(2)} USD`);
    console.log(`    Total Collateral: ${candidate.totalCollateralUsd.toFixed(2)} USD`);
    console.log(`    Impacted Reserves: ${candidate.impactedReserves.join(', ')}`);
    console.log('');
  }

  // Display engine stats
  const stats = engine.getStats();
  console.log('[predictive-harness] Engine statistics:');
  console.log(`  - Enabled: ${stats.enabled}`);
  console.log(`  - Price Windows: ${stats.priceWindowsCount}`);
  console.log(`  - Last Tick: ${new Date(stats.lastTickMs).toISOString()}`);
  console.log('');

  console.log('[predictive-harness] Harness complete');
}

// Run harness
main().catch((err) => {
  console.error('[predictive-harness] Error:', err);
  process.exit(1);
});
