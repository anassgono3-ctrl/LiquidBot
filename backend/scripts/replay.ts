#!/usr/bin/env node
/**
 * replay.ts: Entrypoint for historical replay harness
 * 
 * Usage: REPLAY=1 REPLAY_BLOCK_RANGE=38393176-38395221 npm run replay
 */

import { ethers } from 'ethers';

import { config } from '../src/config/index.js';
import { ReplayRangeParser } from '../src/replay/ReplayRangeParser.js';
import { ReplayRunner } from '../src/replay/ReplayRunner.js';

async function main() {
  console.log('[replay] Historical Replay Harness\n');

  // Validate replay mode is enabled
  if (!config.replay) {
    console.error('ERROR: REPLAY must be set to 1 to run replay mode');
    console.error('Usage: REPLAY=1 REPLAY_BLOCK_RANGE=start-end npm run replay');
    process.exit(1);
  }

  // Parse and validate block range
  let range;
  try {
    range = ReplayRangeParser.parse(config.replayBlockRange);
    console.log(`[replay] Block range: ${range.start} to ${range.end} (${ReplayRangeParser.getBlockCount(range)} blocks)`);
  } catch (error) {
    console.error('ERROR:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Override execution flags for safety
  if (process.env.EXECUTION_ENABLED === 'true' || process.env.DRY_RUN_EXECUTION === 'false') {
    console.warn('[replay] WARNING: Forcing EXECUTION_ENABLED=false and DRY_RUN_EXECUTION=true for replay safety');
  }
  process.env.EXECUTION_ENABLED = 'false';
  process.env.DRY_RUN_EXECUTION = 'true';

  // Initialize provider
  const rpcUrl = config.rpcUrl || process.env.RPC_URL;
  if (!rpcUrl) {
    console.error('ERROR: RPC_URL is required for replay mode');
    process.exit(1);
  }

  console.log(`[replay] Connecting to RPC: ${rpcUrl}`);
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // Test provider connectivity and archival support
  try {
    const currentBlock = await provider.getBlockNumber();
    console.log(`[replay] Current block: ${currentBlock}`);

    if (range.end > currentBlock) {
      console.error(`ERROR: End block ${range.end} is beyond current block ${currentBlock}`);
      process.exit(1);
    }

    // Test archival access
    console.log(`[replay] Testing archival access at block ${range.start}...`);
    await provider.getBlock(range.start);
    console.log('[replay] ✓ Archival access confirmed\n');
  } catch (error) {
    console.error('ERROR: Provider test failed:', error instanceof Error ? error.message : String(error));
    console.error('This RPC endpoint may not support archival block access.');
    process.exit(1);
  }

  // Get contract addresses
  const poolAddress = config.aavePoolAddress || config.aavePool;
  const oracleAddress = config.aaveOracle;

  if (!poolAddress || !oracleAddress) {
    console.error('ERROR: AAVE_POOL_ADDRESS and AAVE_ORACLE must be configured');
    process.exit(1);
  }

  console.log(`[replay] Aave Pool: ${poolAddress}`);
  console.log(`[replay] Aave Oracle: ${oracleAddress}\n`);

  // Create and run replay
  const runner = new ReplayRunner(provider, poolAddress, oracleAddress, range);

  try {
    await runner.run();
    process.exit(0);
  } catch (error) {
    console.error('[replay] FATAL ERROR:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main().catch(error => {
  console.error('[replay] Unhandled error:', error);
  process.exit(1);
});
