#!/usr/bin/env tsx
/**
 * Manual Test Script for Low HF Tracker
 * 
 * This script demonstrates the Low HF Tracker functionality by:
 * 1. Creating a tracker instance
 * 2. Recording sample low-HF entries
 * 3. Displaying stats and entries
 * 4. Dumping to a file
 * 5. Running verification
 * 
 * Usage:
 *   API_KEY=test JWT_SECRET=test tsx scripts/test-lowhf-tracker.ts
 */

// Set minimal env vars to avoid config errors
process.env.API_KEY = process.env.API_KEY || 'test-key';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.USE_MOCK_SUBGRAPH = 'true';

import { LowHFTracker } from '../src/services/LowHFTracker.js';

async function main() {
  console.log('[test] Starting Low HF Tracker manual test\n');

  // Create tracker instance
  const tracker = new LowHFTracker({
    maxEntries: 100,
    recordMode: 'all',
    dumpOnShutdown: false,
    summaryIntervalSec: 0 // Disable periodic logging
  });

  console.log('[test] Created tracker with config:');
  console.log('  Mode: all');
  console.log('  Max entries: 100\n');

  // Simulate recording low-HF candidates from batch checks
  console.log('[test] Recording sample low-HF entries...');

  const sampleEntries = [
    { address: '0x1234567890abcdef1234567890abcdef12345678', hf: 0.95, collateral: 15234.56, debt: 14890.23 },
    { address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', hf: 0.88, collateral: 25000.00, debt: 23500.00 },
    { address: '0x9876543210fedcba9876543210fedcba98765432', hf: 1.02, collateral: 10000.00, debt: 9500.00 },
    { address: '0xfedcbafedcbafedcbafedcbafedcbafedcbafed', hf: 0.92, collateral: 50000.00, debt: 48000.00 },
    { address: '0x1111111111111111111111111111111111111111', hf: 1.05, collateral: 8000.00, debt: 7500.00 },
    { address: '0x2222222222222222222222222222222222222222', hf: 0.85, collateral: 30000.00, debt: 28500.00 },
    { address: '0x3333333333333333333333333333333333333333', hf: 0.98, collateral: 12000.00, debt: 11500.00 },
    { address: '0x4444444444444444444444444444444444444444', hf: 1.08, collateral: 20000.00, debt: 18500.00 }
  ];

  // Mock reserve data for demonstration
  const mockReserves = [
    [
      { asset: '0x4200000000000000000000000000000000000006', symbol: 'WETH', ltv: 0.80, liquidationThreshold: 0.825, collateralUsd: 10000.00, debtUsd: 0, sourcePrice: 'chainlink:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70' },
      { asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', ltv: 0.77, liquidationThreshold: 0.80, collateralUsd: 5234.56, debtUsd: 14890.23, sourcePrice: 'chainlink:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B' }
    ],
    [
      { asset: '0x4200000000000000000000000000000000000006', symbol: 'WETH', ltv: 0.80, liquidationThreshold: 0.825, collateralUsd: 25000.00, debtUsd: 23500.00, sourcePrice: 'chainlink:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70' }
    ],
    [
      { asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', ltv: 0.77, liquidationThreshold: 0.80, collateralUsd: 10000.00, debtUsd: 9500.00, sourcePrice: 'chainlink:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B' }
    ],
    [
      { asset: '0x4200000000000000000000000000000000000006', symbol: 'WETH', ltv: 0.80, liquidationThreshold: 0.825, collateralUsd: 35000.00, debtUsd: 0, sourcePrice: 'chainlink:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70' },
      { asset: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', symbol: 'cbBTC', ltv: 0.73, liquidationThreshold: 0.78, collateralUsd: 15000.00, debtUsd: 48000.00, sourcePrice: 'chainlink:0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D' }
    ]
  ];

  const blockNumber = 12345678;
  for (let i = 0; i < sampleEntries.length; i++) {
    const entry = sampleEntries[i];
    // Include reserves for first 4 entries to demonstrate extended tracking
    const reserves = i < mockReserves.length ? mockReserves[i] : undefined;
    
    tracker.record(
      entry.address,
      entry.hf,
      blockNumber + i,
      'head',
      entry.collateral,
      entry.debt,
      reserves
    );
    const reserveInfo = reserves ? ` (${reserves.length} reserves)` : '';
    console.log(`  Recorded: ${entry.address.substring(0, 10)}... HF=${entry.hf.toFixed(4)}${reserveInfo}`);
  }

  console.log('');

  // Display stats
  console.log('[test] Tracker statistics:');
  const stats = tracker.getStats();
  console.log(`  Total entries: ${stats.count}`);
  console.log(`  Extended entries (with reserves): ${stats.extendedCount}`);
  console.log(`  Min HF: ${stats.minHF?.toFixed(4) ?? 'N/A'}`);
  console.log(`  Mode: ${stats.mode}`);
  console.log(`  Max capacity: ${stats.maxEntries}`);
  console.log('');

  // Display all entries
  console.log('[test] All tracked entries:');
  const entries = tracker.getAll();
  entries.forEach((entry, index) => {
    console.log(`  ${index + 1}. ${entry.address}`);
    console.log(`     HF: ${entry.lastHF.toFixed(4)}, Block: ${entry.blockNumber}, Trigger: ${entry.triggerType}`);
    console.log(`     Collateral: $${entry.totalCollateralUsd.toFixed(2)}, Debt: $${entry.totalDebtUsd.toFixed(2)}`);
  });
  console.log('');

  // Test pagination
  console.log('[test] Testing pagination (limit=3, offset=0):');
  const page1 = tracker.getPaginated(3, 0);
  page1.forEach((entry, index) => {
    console.log(`  ${index + 1}. ${entry.address.substring(0, 10)}... HF=${entry.lastHF.toFixed(4)}`);
  });
  console.log('');

  console.log('[test] Testing pagination (limit=3, offset=3):');
  const page2 = tracker.getPaginated(3, 3);
  page2.forEach((entry, index) => {
    console.log(`  ${index + 1}. ${entry.address.substring(0, 10)}... HF=${entry.lastHF.toFixed(4)}`);
  });
  console.log('');

  // Dump to file
  console.log('[test] Dumping to file...');
  const filepath = await tracker.dumpToFile('/tmp/lowhf-test');
  console.log(`[test] Dump written to: ${filepath}`);
  console.log('');

  // Cleanup
  tracker.stop();

  console.log('[test] ✅ Manual test completed successfully!');
  console.log('');
  console.log('[test] To verify the dump file, run:');
  console.log(`  npm run verify:lowhf ${filepath}`);
  console.log('');
  console.log('[test] To test HTTP endpoints in a running bot:');
  console.log('  curl http://localhost:3000/status');
  console.log('  curl http://localhost:3000/lowhf?limit=10');
}

main().catch(err => {
  console.error('[test] Error:', err);
  process.exit(1);
});
