#!/usr/bin/env node
/**
 * Replay mode CLI entry point
 * 
 * This script is the main entry point for running historical blockchain data replay.
 * It validates the environment configuration and invokes the replay logic.
 */

import dotenv from 'dotenv';

import { env } from '../config/envSchema.js';

import { runReplay } from './runReplay.js';

// Load environment variables
dotenv.config();

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  console.log('Starting replay mode...\n');
  
  // Check if replay context is available
  if (!env.replay) {
    console.error('ERROR: Replay mode is not configured.');
    console.error('');
    console.error('To run replay mode, set the following environment variables:');
    console.error('  REPLAY=1');
    console.error('  REPLAY_BLOCK_RANGE=START-END');
    console.error('');
    console.error('Example:');
    console.error('  REPLAY=1 REPLAY_BLOCK_RANGE=38393480-38393500 npm run replay');
    console.error('');
    console.error('Optional environment variables:');
    console.error('  REPLAY_RPC_URL - Custom RPC URL for replay (defaults to RPC_URL)');
    process.exit(1);
  }
  
  // Log replay parameters
  console.log('Replay configuration:');
  console.log(`  Block range: ${env.replay.startBlock} to ${env.replay.endBlock}`);
  console.log(`  Span: ${env.replay.span} blocks`);
  console.log(`  Cache prefix: ${env.replay.cachePrefix}`);
  console.log(`  Dry run: ${env.replay.dryRun}`);
  console.log(`  Execute: ${env.replay.execute}`);
  if (env.replay.rpcUrl) {
    console.log(`  RPC URL: ${env.replay.rpcUrl}`);
  }
  console.log('');
  
  try {
    // Run replay with full config
    await runReplay(env);
    console.log('\nReplay completed successfully.');
  } catch (error) {
    console.error('\nReplay failed with error:');
    console.error(error);
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  console.error('Unhandled error in replay CLI:');
  console.error(error);
  process.exit(1);
});
