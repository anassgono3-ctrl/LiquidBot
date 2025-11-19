#!/usr/bin/env node
/**
 * Replay CLI: Entry point for historical replay mode
 * 
 * Usage:
 *   REPLAY=1 REPLAY_BLOCK_RANGE=38393176-38395221 npm run replay
 * 
 * This CLI validates the replay environment variables, parses the block range,
 * and invokes the ReplayRunner to execute the historical replay.
 */

import { config } from '../config/index.js';
import { parseBlockRange, runReplay } from './ReplayRunner.js';

async function main() {
  console.log('[replay-cli] Starting historical replay mode');
  
  // Validate replay mode is enabled
  if (!config.replay) {
    console.error('[replay-cli] ERROR: REPLAY must be set to 1 to enable replay mode');
    console.error('[replay-cli] Usage: REPLAY=1 REPLAY_BLOCK_RANGE=START-END npm run replay');
    process.exit(1);
  }
  
  // Validate block range is provided
  if (!config.replayBlockRange) {
    console.error('[replay-cli] ERROR: REPLAY_BLOCK_RANGE required when REPLAY=1');
    console.error('[replay-cli] Format: START-END (e.g., 38393176-38395221)');
    process.exit(1);
  }
  
  // Parse block range
  let startBlock: number;
  let endBlock: number;
  
  try {
    const range = parseBlockRange(config.replayBlockRange);
    startBlock = range.start;
    endBlock = range.end;
    console.log(`[replay-cli] Parsed block range: ${startBlock} to ${endBlock}`);
  } catch (error) {
    console.error('[replay-cli] ERROR:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  
  // Log replay configuration
  console.log('[replay-cli] Replay configuration:');
  console.log(`[replay-cli]   Block range: ${startBlock}-${endBlock}`);
  console.log(`[replay-cli]   Total blocks: ${endBlock - startBlock + 1}`);
  console.log(`[replay-cli]   RPC URL: ${process.env.RPC_URL || process.env.WS_RPC_URL || 'NOT SET'}`);
  console.log('[replay-cli]   Safety overrides: EXECUTE=false, DRY_RUN_EXECUTION=true');
  
  // Verify safety overrides
  if (config.executionEnabled && !config.dryRunExecution) {
    console.warn('[replay-cli] WARNING: Execution is enabled with dry-run disabled!');
    console.warn('[replay-cli] Forcing safety overrides: EXECUTE=false, DRY_RUN=true');
  }
  
  // Run replay
  try {
    await runReplay(startBlock, endBlock);
    console.log('[replay-cli] Replay completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('[replay-cli] FATAL ERROR during replay:', error);
    process.exit(1);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[replay-cli] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run main
main().catch((error) => {
  console.error('[replay-cli] Fatal error:', error);
  process.exit(1);
});
