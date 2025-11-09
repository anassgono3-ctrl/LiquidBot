#!/usr/bin/env tsx
/**
 * Manual Test Script for Low HF Tracker - Extended Mode
 * 
 * This script demonstrates the extended Low HF Tracker functionality by:
 * 1. Creating a tracker instance with extended mode enabled
 * 2. Recording sample low-HF entries WITH reserve details
 * 3. Dumping to a file with schema version 1.1
 * 4. Verifying extended entries are captured
 * 
 * Usage:
 *   API_KEY=test-key JWT_SECRET=test-secret npx tsx scripts/test-lowhf-extended.ts
 */

// Set minimal env vars to avoid config errors
process.env.API_KEY = process.env.API_KEY || 'test-key-12345';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-12345';
process.env.USE_MOCK_SUBGRAPH = 'true';

import { LowHFTracker, ReserveData } from '../src/services/LowHFTracker.js';

async function main() {
  console.log('[test] Starting Low HF Tracker Extended Mode Test\n');

  // Create tracker instance with extended enabled
  const tracker = new LowHFTracker({
    maxEntries: 100,
    recordMode: 'all',
    extendedEnabled: true,
    dumpOnShutdown: false,
    summaryIntervalSec: 0 // Disable periodic logging
  });

  console.log('[test] Created tracker with config:');
  console.log('  Mode: all');
  console.log('  Extended: enabled');
  console.log('  Max entries: 100\n');

  // Simulate recording low-HF candidates with reserve details
  console.log('[test] Recording sample low-HF entries with reserve details...');

  const sampleReserves: ReserveData[] = [
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
      collateralUsd: 5000.00,
      debtUsd: 4500.00,
      sourcePrice: 'chainlink:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B'
    }
  ];

  const sampleEntries = [
    { 
      address: '0x1234567890abcdef1234567890abcdef12345678', 
      hf: 0.95, 
      collateral: 15000.00, 
      debt: 14500.00,
      reserves: [sampleReserves[0], { ...sampleReserves[1], collateralUsd: 5000, debtUsd: 4500 }]
    },
    { 
      address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', 
      hf: 0.88, 
      collateral: 25000.00, 
      debt: 23500.00,
      reserves: [{ ...sampleReserves[0], collateralUsd: 20000 }, { ...sampleReserves[1], collateralUsd: 5000, debtUsd: 3500 }]
    },
    { 
      address: '0x9876543210fedcba9876543210fedcba98765432', 
      hf: 1.02, 
      collateral: 10000.00, 
      debt: 9500.00,
      reserves: [{ ...sampleReserves[0], collateralUsd: 10000, debtUsd: 0 }]
    },
    { 
      address: '0xfedcbafedcbafedcbafedcbafedcbafedcbafed', 
      hf: 0.92, 
      collateral: 50000.00, 
      debt: 48000.00,
      reserves: [
        { ...sampleReserves[0], collateralUsd: 35000, debtUsd: 0 },
        { ...sampleReserves[1], collateralUsd: 15000, debtUsd: 8000 }
      ]
    }
  ];

  const blockNumber = 12345678;
  for (let i = 0; i < sampleEntries.length; i++) {
    const entry = sampleEntries[i];
    tracker.record(
      entry.address,
      entry.hf,
      blockNumber + i,
      'head',
      entry.collateral,
      entry.debt,
      entry.reserves
    );
    console.log(`  Recorded: ${entry.address.substring(0, 10)}... HF=${entry.hf.toFixed(4)} with ${entry.reserves.length} reserves`);
  }

  console.log('');

  // Display stats
  console.log('[test] Tracker statistics:');
  const stats = tracker.getStats();
  console.log(`  Total entries: ${stats.count}`);
  console.log(`  Min HF: ${stats.minHF?.toFixed(4) ?? 'N/A'}`);
  console.log(`  Mode: ${stats.mode}`);
  console.log(`  Max capacity: ${stats.maxEntries}`);
  console.log('');

  // Display all entries with reserve counts
  console.log('[test] All tracked entries:');
  const entries = tracker.getAll();
  entries.forEach((entry, index) => {
    console.log(`  ${index + 1}. ${entry.address}`);
    console.log(`     HF: ${entry.lastHF.toFixed(4)}, Block: ${entry.blockNumber}, Trigger: ${entry.triggerType}`);
    console.log(`     Collateral: $${entry.totalCollateralUsd.toFixed(2)}, Debt: $${entry.totalDebtUsd.toFixed(2)}`);
    console.log(`     Reserves: ${entry.reserves ? entry.reserves.length + ' included' : 'none'}`);
  });
  console.log('');

  // Dump to file
  console.log('[test] Dumping to file...');
  const filepath = await tracker.dumpToFile('/tmp/lowhf-extended-test');
  console.log(`[test] Dump written to: ${filepath}`);
  console.log('');

  // Cleanup
  tracker.stop();

  console.log('[test] ✅ Extended mode test completed successfully!');
  console.log('');
  console.log('[test] To verify the dump file, run:');
  console.log(`  npm run verify:lowhf ${filepath}`);
  console.log('');
  console.log('[test] Expected output: All entries verified successfully (0 mismatches)');
}

main().catch(err => {
  console.error('[test] Error:', err);
  process.exit(1);
});
