#!/usr/bin/env tsx
/**
 * Replay CLI - Command-line interface for historical replay
 * 
 * Usage: npm run replay <startBlock> <endBlock>
 * Example: npm run replay 38393176 38395221
 */

import dotenv from 'dotenv';
import { ReplayController, parseBlockRange, createReplayConfigFromEnv } from '../src/replay/ReplayController.js';
import { config } from '../src/config/index.js';

// Load environment variables
dotenv.config();

async function main() {
  const args = process.argv.slice(2);
  
  // Parse command line arguments
  let startBlock: number;
  let endBlock: number;
  
  if (args.length === 2) {
    // Block range from CLI args
    startBlock = parseInt(args[0], 10);
    endBlock = parseInt(args[1], 10);
    
    if (isNaN(startBlock) || isNaN(endBlock)) {
      console.error('Error: Invalid block numbers');
      console.error('Usage: npm run replay <startBlock> <endBlock>');
      process.exit(1);
    }
    
    if (startBlock > endBlock) {
      console.error('Error: Start block must be <= end block');
      process.exit(1);
    }
  } else if (config.replayBlockRange) {
    // Block range from env var
    const parsed = parseBlockRange(config.replayBlockRange);
    startBlock = parsed.startBlock;
    endBlock = parsed.endBlock;
  } else {
    console.error('Error: No block range specified');
    console.error('Usage: npm run replay <startBlock> <endBlock>');
    console.error('Or set REPLAY_BLOCK_RANGE environment variable');
    process.exit(1);
  }
  
  // Validate configuration
  if (!config.rpcUrl) {
    console.error('Error: RPC_URL environment variable not set');
    process.exit(1);
  }
  
  // Force safe replay mode
  if (config.executionEnabled) {
    console.warn('WARNING: Execution is enabled but will be forced OFF for replay safety');
  }
  
  // Create replay config
  const replayConfig = {
    ...createReplayConfigFromEnv(),
    startBlock,
    endBlock
  };
  
  // Create controller
  const controller = new ReplayController(replayConfig);
  
  // Execute replay
  try {
    await controller.execute();
    console.log('\n✓ Replay completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Replay failed:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
