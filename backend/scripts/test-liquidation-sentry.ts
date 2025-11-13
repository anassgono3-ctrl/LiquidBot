#!/usr/bin/env tsx
/**
 * Liquidation Sentry Test Harness
 * 
 * Synthetic test script for validating miss classification across scenarios.
 * Prints classification results for manual verification.
 */

import { LiquidationMissClassifier, type ClassifierConfig, type MissReason } from '../src/services/LiquidationMissClassifier.js';
import { ExecutionDecisionsStore, type ExecutionDecision } from '../src/services/executionDecisions.js';

// Test scenario interface
interface TestScenario {
  name: string;
  setup: (classifier: LiquidationMissClassifier, decisionsStore: ExecutionDecisionsStore, user: string) => void;
  expectedReason: MissReason;
}

// Configuration for the test classifier
const testConfig: ClassifierConfig = {
  enabled: true,
  transientBlocks: 3,
  minProfitUsd: 10,
  gasThresholdGwei: 50,
  enableProfitCheck: true
};

// Test scenarios
const scenarios: TestScenario[] = [
  {
    name: 'User not in watch set',
    setup: (_classifier, _decisionsStore, _user) => {
      // No setup needed - wasInWatchSet will be false
    },
    expectedReason: 'not_in_watch_set'
  },
  {
    name: 'Raced - no decision found',
    setup: (_classifier, _decisionsStore, _user) => {
      // No decision recorded
    },
    expectedReason: 'raced'
  },
  {
    name: 'HF transient - liquidatable for 2 blocks only',
    setup: (classifier, _decisionsStore, user) => {
      classifier.recordFirstSeen(user, 12343, 0.98);
    },
    expectedReason: 'hf_transient'
  },
  {
    name: 'Execution filtered - dust guard',
    setup: (_classifier, decisionsStore, user) => {
      const decision: ExecutionDecision = {
        user,
        timestamp: Date.now() - 5000,
        blockNumber: 12344,
        type: 'skip',
        reason: 'dust_guard',
        debtUsd: 5
      };
      decisionsStore.record(decision);
    },
    expectedReason: 'execution_filtered'
  },
  {
    name: 'Insufficient profit',
    setup: (_classifier, decisionsStore, user) => {
      const decision: ExecutionDecision = {
        user,
        timestamp: Date.now() - 5000,
        blockNumber: 12344,
        type: 'skip',
        reason: 'unprofitable',
        debtUsd: 100,
        profitEstimateUsd: 5 // Below threshold
      };
      decisionsStore.record(decision);
    },
    expectedReason: 'insufficient_profit'
  },
  {
    name: 'Revert - health factor check failed',
    setup: (_classifier, decisionsStore, user) => {
      const decision: ExecutionDecision = {
        user,
        timestamp: Date.now() - 5000,
        blockNumber: 12344,
        type: 'revert',
        reason: 'HEALTH_FACTOR_NOT_BELOW_THRESHOLD',
        txHash: '0x' + 'a'.repeat(64),
        gasPriceGwei: 45
      };
      decisionsStore.record(decision);
    },
    expectedReason: 'revert'
  },
  {
    name: 'Gas outbid - skip with low gas',
    setup: (_classifier, decisionsStore, user) => {
      const decision: ExecutionDecision = {
        user,
        timestamp: Date.now() - 5000,
        blockNumber: 12344,
        type: 'skip',
        reason: 'gas_price_too_high',
        debtUsd: 100,
        gasPriceGwei: 30 // Below threshold of 50
      };
      decisionsStore.record(decision);
    },
    expectedReason: 'gas_outbid'
  },
  {
    name: 'Gas outbid - attempt with low gas',
    setup: (_classifier, decisionsStore, user) => {
      const decision: ExecutionDecision = {
        user,
        timestamp: Date.now() - 5000,
        blockNumber: 12344,
        type: 'attempt',
        debtUsd: 100,
        gasPriceGwei: 40, // Below threshold
        txHash: '0x' + 'b'.repeat(64)
      };
      decisionsStore.record(decision);
    },
    expectedReason: 'gas_outbid'
  },
  {
    name: 'Raced - attempt with high gas',
    setup: (_classifier, decisionsStore, user) => {
      const decision: ExecutionDecision = {
        user,
        timestamp: Date.now() - 5000,
        blockNumber: 12344,
        type: 'attempt',
        debtUsd: 100,
        gasPriceGwei: 60, // Above threshold
        txHash: '0x' + 'c'.repeat(64)
      };
      decisionsStore.record(decision);
    },
    expectedReason: 'raced'
  }
];

// Run all scenarios
function runScenarios() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       Liquidation Sentry Test Harness                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    
    // Create fresh instances for each scenario
    const decisionsStore = new ExecutionDecisionsStore(1000, 300000);
    const classifier = new LiquidationMissClassifier(testConfig, decisionsStore);
    
    // Generate a unique user address for this scenario
    const userIndex = i.toString(16).padStart(2, '0');
    const user = '0x' + userIndex.repeat(20);
    const liquidator = '0x' + 'f'.repeat(40);
    const wasInWatchSet = scenario.expectedReason !== 'not_in_watch_set';
    
    // Setup the scenario
    scenario.setup(classifier, decisionsStore, user);
    
    // Classify
    const result = classifier.classify(
      user,
      liquidator,
      Date.now(),
      12345,
      wasInWatchSet
    );
    
    // Check result
    const isSuccess = result.reason === scenario.expectedReason;
    if (isSuccess) {
      passed++;
    } else {
      failed++;
    }
    
    // Print result
    console.log(`\n[${isSuccess ? '✓' : '✗'}] Scenario ${i + 1}: ${scenario.name}`);
    console.log(`   Expected: ${scenario.expectedReason}`);
    console.log(`   Got:      ${result.reason}`);
    
    if (result.blocksSinceFirstSeen !== undefined) {
      console.log(`   Blocks since first seen: ${result.blocksSinceFirstSeen}`);
    }
    
    if (result.profitEstimateUsd !== undefined) {
      console.log(`   Profit estimate: $${result.profitEstimateUsd.toFixed(2)}`);
    }
    
    if (result.gasPriceGweiAtDecision !== undefined) {
      console.log(`   Gas price: ${result.gasPriceGweiAtDecision.toFixed(2)} Gwei`);
    }
    
    if (result.notes.length > 0) {
      console.log('   Notes:');
      result.notes.forEach(note => {
        console.log(`     - ${note}`);
      });
    }
    
    // Cleanup
    decisionsStore.destroy();
  }
  
  // Summary
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  Summary: ${passed}/${scenarios.length} scenarios passed`);
  if (failed > 0) {
    console.log(`║  ${failed} scenario(s) failed`);
  }
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  
  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

// Test profit estimation
function testProfitEstimation() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  Testing Profit Estimation                               ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  
  const decisionsStore = new ExecutionDecisionsStore(1000, 300000);
  const classifier = new LiquidationMissClassifier(testConfig, decisionsStore);
  
  const testCases = [
    { debtUsd: 100, bonus: 0.05, expected: 5 },
    { debtUsd: 1000, bonus: 0.10, expected: 100 },
    { debtUsd: 50, bonus: 0.05, expected: 2.5 }
  ];
  
  let allPassed = true;
  
  testCases.forEach((tc, i) => {
    const result = classifier.estimateProfit(tc.debtUsd, tc.bonus);
    const passed = result === tc.expected;
    
    if (!passed) allPassed = false;
    
    console.log(`[${passed ? '✓' : '✗'}] Test ${i + 1}: debt=$${tc.debtUsd}, bonus=${(tc.bonus * 100).toFixed(0)}%`);
    console.log(`   Expected: $${tc.expected.toFixed(2)}`);
    console.log(`   Got:      $${result?.toFixed(2) || 'null'}\n`);
  });
  
  decisionsStore.destroy();
  
  return allPassed;
}

// Main execution
console.log('Starting Liquidation Sentry Test Harness...\n');

const profitTestsPassed = testProfitEstimation();
runScenarios();

if (!profitTestsPassed) {
  console.error('Profit estimation tests failed!');
  process.exit(1);
}
