#!/usr/bin/env tsx
// Priority Sweep Test Harness
// End-to-end validation script for priority sweep logic

// Set required config for testing BEFORE any imports
process.env.API_KEY = process.env.API_KEY || 'test-api-key';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.USE_MOCK_SUBGRAPH = 'true';
process.env.PRIORITY_SWEEP_ENABLED = 'true';
process.env.PRIORITY_SWEEP_LOG_SUMMARY = 'true';
process.env.PRIORITY_SWEEP_METRICS_ENABLED = 'false';
process.env.PRIORITY_TARGET_SIZE = '100';
process.env.PRIORITY_MAX_SCAN_USERS = '500';

import dotenv from 'dotenv';
dotenv.config();

import { PrioritySweepRunner } from '../src/priority/prioritySweep.js';
import { computeScore, shouldInclude } from '../src/priority/scoring.js';
import type { UserData, ScoringConfig } from '../src/priority/scoring.js';

async function main() {
  console.log('=== Priority Sweep Test Harness ===\n');

  // Test 1: Scoring utilities
  console.log('Test 1: Scoring Utilities');
  const config: ScoringConfig = {
    debtWeight: 1.0,
    collateralWeight: 0.8,
    hfPenalty: 2.5,
    hfCeiling: 1.20,
    lowHfBoost: 1.1,
    minDebtUsd: 500,
    minCollateralUsd: 1500,
    hotlistMaxHf: 1.05
  };

  const testUsers: UserData[] = [
    {
      address: '0xuser1',
      totalCollateralUSD: 10000,
      totalDebtUSD: 5000,
      healthFactor: 1.03 // Low HF - should get boost
    },
    {
      address: '0xuser2',
      totalCollateralUSD: 20000,
      totalDebtUSD: 10000,
      healthFactor: 1.50 // Medium HF
    },
    {
      address: '0xuser3',
      totalCollateralUSD: 5000,
      totalDebtUSD: 2000,
      healthFactor: 2.50 // High HF - should be penalized
    },
    {
      address: '0xuser4',
      totalCollateralUSD: 100,
      totalDebtUSD: 100,
      healthFactor: 1.20 // Below threshold - should be filtered
    }
  ];

  console.log('\nUser Scoring Results:');
  for (const user of testUsers) {
    const score = computeScore(user, config);
    const included = shouldInclude(user, config);
    console.log(`  ${user.address.slice(0, 10)}... HF=${user.healthFactor.toFixed(2)} Score=${score.toFixed(2)} Included=${included}`);
  }

  // Test 2: Priority Sweep Runner
  console.log('\n\nTest 2: Priority Sweep Runner');
  const runner = new PrioritySweepRunner();

  console.log('Initial priority set:', runner.getPrioritySet());

  try {
    console.log('\nRunning priority sweep...');
    const startTime = Date.now();
    
    const result = await runner.runSweep();
    
    const duration = Date.now() - startTime;
    
    console.log('\nSweep Results:');
    console.log(`  Version: ${result.version}`);
    console.log(`  Generated At: ${new Date(result.generatedAt).toISOString()}`);
    console.log(`  Users Seen: ${result.stats.usersSeen}`);
    console.log(`  Users Filtered: ${result.stats.usersFiltered}`);
    console.log(`  Users Selected: ${result.stats.usersSelected}`);
    console.log(`  Top Score: ${result.stats.topScore.toFixed(2)}`);
    console.log(`  Median HF: ${result.stats.medianHf.toFixed(3)}`);
    console.log(`  Avg Debt USD: ${result.stats.avgDebt.toFixed(2)}`);
    console.log(`  Avg Collateral USD: ${result.stats.avgCollateral.toFixed(2)}`);
    console.log(`  Duration: ${duration}ms`);
    console.log(`  Heap Peak: ${result.stats.heapPeakMb.toFixed(1)}MB`);
    
    if (result.users.length > 0) {
      console.log(`\nTop 10 Users:`);
      result.users.slice(0, 10).forEach((addr, i) => {
        console.log(`  ${i + 1}. ${addr}`);
      });
    }

    // Test 3: Multiple runs
    console.log('\n\nTest 3: Multiple Runs (version increment)');
    const result2 = await runner.runSweep();
    console.log(`  First run version: ${result.version}`);
    console.log(`  Second run version: ${result2.version}`);
    console.log(`  Version incremented: ${result2.version > result.version ? '✓' : '✗'}`);

    // Test 4: Abort signal
    console.log('\n\nTest 4: Abort Signal');
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 100);
    
    try {
      await runner.runSweep(abortController.signal);
      console.log('  Abort test: ✗ (should have aborted)');
    } catch (error) {
      if (error instanceof Error && error.message.includes('abort')) {
        console.log('  Abort test: ✓ (correctly aborted)');
      } else {
        console.log(`  Abort test: ? (unexpected error: ${error})`);
      }
    }

    console.log('\n=== All Tests Completed ===\n');
  } catch (error) {
    console.error('\n❌ Error during sweep:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
