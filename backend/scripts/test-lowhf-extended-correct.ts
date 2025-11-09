#!/usr/bin/env tsx
/**
 * Manual Test Script for Low HF Tracker - Extended Mode with Correct HF Calculations
 * 
 * This script demonstrates the extended Low HF Tracker functionality with
 * mathematically correct health factor calculations.
 * 
 * HF = (sum of collateralUsd * liquidationThreshold) / totalDebtUsd
 * 
 * Usage:
 *   API_KEY=test-key JWT_SECRET=test-secret npx tsx scripts/test-lowhf-extended-correct.ts
 */

// Set minimal env vars to avoid config errors
process.env.API_KEY = process.env.API_KEY || 'test-key-12345';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-12345';
process.env.USE_MOCK_SUBGRAPH = 'true';

import { LowHFTracker, ReserveData } from '../src/services/LowHFTracker.js';

/**
 * Calculate health factor from reserves
 */
function calculateHF(reserves: ReserveData[], totalDebtUsd: number): number {
  if (totalDebtUsd === 0 || totalDebtUsd < 1e-9) {
    return Infinity;
  }

  let weightedThreshold = 0;
  for (const reserve of reserves) {
    if (reserve.collateralUsd > 0) {
      weightedThreshold += reserve.collateralUsd * reserve.liquidationThreshold;
    }
  }

  return weightedThreshold / totalDebtUsd;
}

async function main() {
  console.log('[test] Starting Low HF Tracker Extended Mode Test with Correct HF\n');

  // Create tracker instance with extended enabled
  const tracker = new LowHFTracker({
    maxEntries: 100,
    recordMode: 'all',
    extendedEnabled: true,
    dumpOnShutdown: false,
    summaryIntervalSec: 0
  });

  console.log('[test] Created tracker with config:');
  console.log('  Mode: all');
  console.log('  Extended: enabled');
  console.log('  Max entries: 100\n');

  console.log('[test] Recording sample low-HF entries with correct HF calculations...');

  // Entry 1: Single collateral (WETH), single debt (USDC)
  const reserves1: ReserveData[] = [
    {
      asset: '0x4200000000000000000000000000000000000006',
      symbol: 'WETH',
      ltv: 0.80,
      liquidationThreshold: 0.825,
      collateralUsd: 10000.00,
      debtUsd: 0,
      sourcePrice: 'chainlink:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70'
    },
    {
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      symbol: 'USDC',
      ltv: 0.75,
      liquidationThreshold: 0.78,
      collateralUsd: 0,
      debtUsd: 9000.00,
      sourcePrice: 'chainlink:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B'
    }
  ];
  const totalCollateral1 = 10000.00;
  const totalDebt1 = 9000.00;
  const hf1 = calculateHF(reserves1, totalDebt1);

  tracker.record(
    '0x1234567890abcdef1234567890abcdef12345678',
    hf1,
    12345678,
    'head',
    totalCollateral1,
    totalDebt1,
    reserves1
  );
  console.log(`  Entry 1: HF=${hf1.toFixed(6)} (WETH collateral $10k, USDC debt $9k)`);

  // Entry 2: Two collaterals (WETH + USDC), one debt (USDC)
  const reserves2: ReserveData[] = [
    {
      asset: '0x4200000000000000000000000000000000000006',
      symbol: 'WETH',
      ltv: 0.80,
      liquidationThreshold: 0.825,
      collateralUsd: 20000.00,
      debtUsd: 0,
      sourcePrice: 'chainlink:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70'
    },
    {
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      symbol: 'USDC',
      ltv: 0.75,
      liquidationThreshold: 0.78,
      collateralUsd: 5000.00,
      debtUsd: 22000.00,
      sourcePrice: 'chainlink:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B'
    }
  ];
  const totalCollateral2 = 25000.00;
  const totalDebt2 = 22000.00;
  const hf2 = calculateHF(reserves2, totalDebt2);

  tracker.record(
    '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    hf2,
    12345679,
    'head',
    totalCollateral2,
    totalDebt2,
    reserves2
  );
  console.log(`  Entry 2: HF=${hf2.toFixed(6)} (WETH $20k + USDC $5k collateral, USDC $22k debt)`);

  // Entry 3: Very low HF
  const reserves3: ReserveData[] = [
    {
      asset: '0x4200000000000000000000000000000000000006',
      symbol: 'WETH',
      ltv: 0.80,
      liquidationThreshold: 0.825,
      collateralUsd: 10000.00,
      debtUsd: 0,
      sourcePrice: 'chainlink:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70'
    },
    {
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      symbol: 'USDC',
      ltv: 0.75,
      liquidationThreshold: 0.78,
      collateralUsd: 0,
      debtUsd: 9500.00,
      sourcePrice: 'chainlink:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B'
    }
  ];
  const totalCollateral3 = 10000.00;
  const totalDebt3 = 9500.00;
  const hf3 = calculateHF(reserves3, totalDebt3);

  tracker.record(
    '0x9876543210fedcba9876543210fedcba98765432',
    hf3,
    12345680,
    'head',
    totalCollateral3,
    totalDebt3,
    reserves3
  );
  console.log(`  Entry 3: HF=${hf3.toFixed(6)} (WETH $10k collateral, USDC $9.5k debt)`);

  console.log('');

  // Display stats
  console.log('[test] Tracker statistics:');
  const stats = tracker.getStats();
  console.log(`  Total entries: ${stats.count}`);
  console.log(`  Min HF: ${stats.minHF?.toFixed(4) ?? 'N/A'}`);
  console.log('');

  // Dump to file
  console.log('[test] Dumping to file...');
  const filepath = await tracker.dumpToFile('/tmp/lowhf-extended-correct');
  console.log(`[test] Dump written to: ${filepath}`);
  console.log('');

  // Cleanup
  tracker.stop();

  console.log('[test] ✅ Extended mode test completed successfully!');
  console.log('');
  console.log('[test] To verify the dump file (should show 0 mismatches), run:');
  console.log(`  npm run verify:lowhf ${filepath}`);
}

main().catch(err => {
  console.error('[test] Error:', err);
  process.exit(1);
});
