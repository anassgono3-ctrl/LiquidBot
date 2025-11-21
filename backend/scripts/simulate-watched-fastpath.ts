#!/usr/bin/env tsx
/**
 * simulate-watched-fastpath.ts
 * 
 * CLI tool to simulate watched fast-path flow for a specific user
 * Verifies: detection → attempt → notify sequence
 * 
 * Usage:
 *   tsx scripts/simulate-watched-fastpath.ts <userAddress>
 * 
 * Example:
 *   tsx scripts/simulate-watched-fastpath.ts 0x1234567890123456789012345678901234567890
 */

import { JsonRpcProvider, Contract } from 'ethers';

import { config } from '../src/config/index.js';
import { HotSetTracker } from '../src/services/HotSetTracker.js';
import { LowHFTracker } from '../src/services/LowHFTracker.js';
import { WatchSet } from '../src/watch/WatchSet.js';
import { ExecutionService } from '../src/services/ExecutionService.js';
import { NotificationService } from '../src/services/NotificationService.js';

const AAVE_POOL_ABI = [
  'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
];

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: tsx scripts/simulate-watched-fastpath.ts <userAddress>');
    console.error('');
    console.error('Example:');
    console.error('  tsx scripts/simulate-watched-fastpath.ts 0x1234567890123456789012345678901234567890');
    process.exit(1);
  }

  const userAddress = args[0];
  console.log('[simulate-watched-fastpath] Starting simulation for user:', userAddress);
  console.log('');

  // Initialize trackers
  console.log('[1/5] Initializing trackers...');
  const hotSetTracker = new HotSetTracker({
    hotSetHfMax: config.hotSetHfMax,
    warmSetHfMax: config.warmSetHfMax,
    maxHotSize: config.maxHotSize,
    maxWarmSize: config.maxWarmSize
  });
  
  const lowHfTracker = new LowHFTracker({
    maxEntries: config.lowHfTrackerMax,
    recordMode: config.lowHfRecordMode,
    dumpOnShutdown: false,
    summaryIntervalSec: 0
  });
  
  const watchSet = new WatchSet({
    hotSetTracker,
    lowHFTracker: lowHfTracker
  });

  console.log('  ✓ HotSetTracker initialized');
  console.log('  ✓ LowHFTracker initialized');
  console.log('  ✓ WatchSet initialized');
  console.log('');

  // Check if user is watched
  console.log('[2/5] Checking if user is in watched set...');
  const isWatched = watchSet.isWatched(userAddress);
  console.log(`  User is ${isWatched ? 'WATCHED' : 'NOT WATCHED'}`);
  
  if (!isWatched) {
    console.log('  Adding user to hot set for simulation...');
    hotSetTracker.update(userAddress, 1.01, 12345, 'head', 1000, 500);
    console.log(`  ✓ User added to hot set`);
  }
  console.log('');

  // Query on-chain HF
  console.log('[3/5] Querying on-chain health factor...');
  // Use config module for RPC URL instead of direct process.env access
  const rpcUrl = config.wsRpcUrl;
  if (!rpcUrl) {
    console.error('  ✗ No RPC URL configured. Set WS_RPC_URL or RPC_URL environment variable.');
    process.exit(1);
  }

  try {
    const provider = new JsonRpcProvider(rpcUrl);
    const aavePool = config.aavePool;
    
    const poolContract = new Contract(aavePool, AAVE_POOL_ABI, provider);
    const accountData = await poolContract.getUserAccountData(userAddress);
    
    const healthFactor = Number(accountData.healthFactor) / 1e18;
    const totalDebt = Number(accountData.totalDebtBase) / 1e8; // Base currency is 8 decimals
    
    console.log(`  Health Factor: ${healthFactor.toFixed(4)}`);
    console.log(`  Total Debt: $${totalDebt.toFixed(2)}`);
    
    const executionThreshold = config.executionHfThresholdBps / 10000;
    console.log(`  Execution Threshold: ${executionThreshold.toFixed(4)}`);
    
    if (healthFactor >= executionThreshold) {
      console.log(`  ⚠ User HF (${healthFactor.toFixed(4)}) >= threshold (${executionThreshold.toFixed(4)})`);
      console.log(`  Fast-path would NOT be triggered`);
    } else {
      console.log(`  ✓ User HF (${healthFactor.toFixed(4)}) < threshold (${executionThreshold.toFixed(4)})`);
      console.log(`  Fast-path WOULD be triggered`);
    }
    console.log('');

    // Simulate execution service call
    console.log('[4/5] Simulating ExecutionService.prepareActionableOpportunityFastpath...');
    const executionService = new ExecutionService();
    
    try {
      const result = await executionService.prepareActionableOpportunityFastpath(userAddress, 'watched_fastpath');
      
      if (result.success) {
        console.log('  ✓ Plan prepared successfully');
        console.log(`    Debt Asset: ${result.plan.debtAssetSymbol}`);
        console.log(`    Collateral Asset: ${result.plan.collateralSymbol}`);
        console.log(`    Debt to Cover: $${result.plan.debtToCoverUsd.toFixed(2)}`);
        console.log(`    Liquidation Bonus: ${result.plan.liquidationBonusPct}%`);
      } else {
        console.log(`  ⚠ Plan preparation failed: ${result.skipReason}`);
        if (result.details) {
          console.log(`    Details: ${result.details}`);
        }
      }
    } catch (error) {
      console.log(`  ⚠ ExecutionService call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log('');

    // Simulate notification
    console.log('[5/5] Simulating NotificationService.notifyWatchedFastpathAttempt...');
    const notificationService = new NotificationService();
    
    if (notificationService.isEnabled()) {
      console.log('  ℹ Telegram notifications are enabled');
      console.log('  (Would send notification to Telegram)');
    } else {
      console.log('  ℹ Telegram notifications are disabled (no credentials configured)');
      console.log('  (Notification would be sent if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID were set)');
    }
    console.log('');

    // Summary
    console.log('═'.repeat(60));
    console.log('SIMULATION SUMMARY');
    console.log('═'.repeat(60));
    console.log(`User: ${userAddress}`);
    console.log(`Watched: ${watchSet.isWatched(userAddress) ? 'YES' : 'NO'}`);
    console.log(`Health Factor: ${healthFactor.toFixed(4)}`);
    console.log(`Would trigger fast-path: ${healthFactor < executionThreshold ? 'YES' : 'NO'}`);
    console.log('');
    console.log('Expected log sequence if HF < threshold:');
    console.log('  1. [watched-fastpath-publish] - RealTimeHFService detects HF < 1.0');
    console.log('  2. [watched-fastpath-attempt] - ExecutionService prepares plan');
    console.log('  3. [watched-fastpath-submit] - CriticalLaneExecutor submits tx');
    console.log('  4. [watched-fastpath-outcome] - Result logged');
    console.log('');
    console.log('Telegram notification:');
    console.log('  → "Liquidation Opportunity (Fast-path: watched)" sent BEFORE execution');
    console.log('  → No "raced" spam if competitor wins');
    console.log('═'.repeat(60));

  } catch (error) {
    console.error('  ✗ Error querying on-chain data:', error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[simulate-watched-fastpath] Fatal error:', err);
  process.exit(1);
});
