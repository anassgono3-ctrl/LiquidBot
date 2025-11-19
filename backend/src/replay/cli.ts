#!/usr/bin/env node
// CLI entry point for historical replay mode

import { config } from '../config/index.js';
import { parseReplayBlockRange, validateReplayConfig } from './validation.js';
import { runReplay } from './ReplayRunner.js';

/**
 * Main CLI function for replay mode
 * 
 * Validates environment configuration and executes replay
 */
async function main(): Promise<void> {
  try {
    // Validate replay configuration
    validateReplayConfig(config.isReplay, config.replayBlockRange);

    if (!config.isReplay) {
      console.error('[replay] Error: REPLAY must be set to true to run replay mode');
      console.error('[replay] Set REPLAY=1 or REPLAY=true in your environment');
      process.exit(1);
    }

    if (!config.replayBlockRange) {
      console.error('[replay] Error: REPLAY_BLOCK_RANGE is required');
      console.error('[replay] Format: REPLAY_BLOCK_RANGE=start-end (e.g., REPLAY_BLOCK_RANGE=38393176-38395221)');
      process.exit(1);
    }

    // Parse block range
    const { start, end } = parseReplayBlockRange(config.replayBlockRange);

    console.log('[replay] Configuration validated');
    console.log(`[replay] Block range: ${start} to ${end} (${end - start + 1} blocks)`);
    console.log('[replay] Starting replay...\n');

    // Execute replay
    await runReplay(start, end);

    console.log('\n[replay] Replay completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('[replay] Fatal error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  console.error('[replay] Unhandled error:', error);
  process.exit(1);
});
