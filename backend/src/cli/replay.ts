#!/usr/bin/env node
// CLI entry point for historical replay mode
import dotenv from 'dotenv';

import { EventGroundTruthLoader } from '../replay/EventGroundTruthLoader.js';
import { ReplayController } from '../replay/ReplayController.js';
import { Reporter } from '../replay/Reporter.js';

// Load environment variables
dotenv.config();

// Force EXECUTE=false in replay mode to prevent accidental transactions
process.env.EXECUTE = 'false';
process.env.EXECUTION_ENABLED = 'false';

async function main() {
  console.log('[Replay] Starting historical replay mode');
  console.log('[Replay] EXECUTION FORCIBLY DISABLED');

  // Parse command line args
  const args = process.argv.slice(2);
  const startBlock = args[0] ? parseInt(args[0], 10) : undefined;
  const endBlock = args[1] ? parseInt(args[1], 10) : undefined;
  const startTimestamp = args[2] ? parseInt(args[2], 10) : undefined;
  const endTimestamp = args[3] ? parseInt(args[3], 10) : undefined;

  // Get config from environment
  const graphApiKey = process.env.GRAPH_API_KEY;
  const subgraphUrl = process.env.SUBGRAPH_URL || 'https://gateway.thegraph.com/api/subgraphs/id/GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF';
  const pageSize = parseInt(process.env.SUBGRAPH_PAGE_SIZE || '1000', 10);
  const maxPages = parseInt(process.env.SUBGRAPH_MAX_PAGES || '500', 10);
  const requestIntervalMs = parseInt(process.env.SUBGRAPH_REQUEST_INTERVAL_MS || '350', 10);
  const abortOnAuthError = (process.env.REPLAY_SUBGRAPH_ABORT_ON_AUTH_ERROR || 'true').toLowerCase() === 'true';

  // Validate API key (warning only, continue in fallback mode if missing)
  if (!graphApiKey) {
    console.warn('[Replay] WARNING: GRAPH_API_KEY not set - will attempt without auth (may fail)');
    console.warn('[Replay] Continuing in fallback mode...');
  }

  console.log(`[Replay] Configuration:`);
  console.log(`  Subgraph URL: ${subgraphUrl}`);
  console.log(`  API Key: ${graphApiKey ? '***' + graphApiKey.slice(-4) : 'NOT SET'}`);
  console.log(`  Page Size: ${pageSize}`);
  console.log(`  Max Pages: ${maxPages}`);
  console.log(`  Request Interval: ${requestIntervalMs}ms`);
  console.log(`  Abort on Auth Error: ${abortOnAuthError}`);
  console.log(`  Block Range: ${startBlock || 'N/A'} -> ${endBlock || 'N/A'}`);
  console.log(`  Timestamp Range: ${startTimestamp || 'N/A'} -> ${endTimestamp || 'N/A'}`);

  // Create components
  const loader = new EventGroundTruthLoader({
    endpoint: subgraphUrl,
    apiKey: graphApiKey,
    startTimestamp,
    endTimestamp,
    pageSize,
    maxPages,
    requestIntervalMs,
    abortOnAuthError
  });

  const reporter = new Reporter();
  const controller = new ReplayController(loader, reporter);

  try {
    // Initialize and load ground truth
    const context = await controller.initialize({
      startBlock,
      endBlock,
      startTimestamp,
      endTimestamp
    });

    console.log(`[Replay] Initialization complete:`);
    console.log(`  Ground truth available: ${context.groundTruthAvailable}`);
    console.log(`  Ground truth events: ${context.groundTruth.length}`);
    if (context.groundTruthError) {
      console.log(`  Error: ${context.groundTruthError}`);
    }
    if (context.groundTruthPartial) {
      console.log(`  WARNING: Partial data only (some pages failed)`);
    }

    // Process block range if specified
    if (startBlock && endBlock) {
      console.log(`[Replay] Processing block range ${startBlock} to ${endBlock}...`);
      await controller.processBlockRange(startBlock, endBlock);
    } else {
      console.log('[Replay] No block range specified, skipping block processing');
      console.log('[Replay] Use: npm run replay <startBlock> <endBlock> [startTimestamp] [endTimestamp]');
    }

    // Finalize and print summary
    controller.finalize();
    
    console.log('[Replay] Replay complete');
    process.exit(0);
  } catch (error) {
    console.error('[Replay] Fatal error:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('[Replay] Unhandled error:', error);
  process.exit(1);
});
