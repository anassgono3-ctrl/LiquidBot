/**
 * Replay mode entry point
 * Usage: REPLAY=1 REPLAY_BLOCK_RANGE=START-END npm run replay
 */

import { createLogger, format, transports } from 'winston';

import { config } from '../config/index.js';

import { ReplayService } from './ReplayService.js';
import type { ReplayConfig } from './types.js';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

async function main() {
  logger.info('[replay] Starting replay mode...');

  // Validate configuration
  if (!config.replayEnabled) {
    logger.error('[replay] REPLAY=1 not set. Exiting.');
    process.exit(1);
  }

  if (!config.replayBlockRange) {
    logger.error('[replay] REPLAY_BLOCK_RANGE not set. Expected format: START-END');
    process.exit(1);
  }

  // Parse block range
  const rangeParts = config.replayBlockRange.split('-');
  if (rangeParts.length !== 2) {
    logger.error('[replay] Invalid REPLAY_BLOCK_RANGE format. Expected: START-END');
    process.exit(1);
  }

  const startBlock = parseInt(rangeParts[0], 10);
  const endBlock = parseInt(rangeParts[1], 10);

  if (isNaN(startBlock) || isNaN(endBlock)) {
    logger.error('[replay] Invalid block numbers in REPLAY_BLOCK_RANGE');
    process.exit(1);
  }

  if (startBlock > endBlock) {
    logger.error('[replay] Start block must be less than or equal to end block');
    process.exit(1);
  }

  // Validate RPC URL
  const rpcUrl = config.replayRpcUrl;
  if (!rpcUrl) {
    logger.error('[replay] REPLAY_RPC_URL or RPC_URL not set');
    process.exit(1);
  }

  // Build replay config
  const replayConfig: ReplayConfig = {
    enabled: true,
    blockRange: config.replayBlockRange,
    rpcUrl,
    startBlock,
    endBlock
  };

  logger.info('[replay] Configuration:', {
    startBlock,
    endBlock,
    totalBlocks: endBlock - startBlock + 1,
    rpcUrl: rpcUrl.substring(0, 30) + '...'
  });

  // Run replay
  try {
    const replayService = new ReplayService(replayConfig);
    await replayService.run();
    
    logger.info('[replay] Replay completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('[replay] Replay failed:', error);
    process.exit(1);
  }
}

// Handle errors
process.on('unhandledRejection', (error) => {
  logger.error('[replay] Unhandled rejection:', error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('[replay] Uncaught exception:', error);
  process.exit(1);
});

// Run
main().catch((error) => {
  logger.error('[replay] Fatal error:', error);
  process.exit(1);
});
