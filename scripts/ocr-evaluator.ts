#!/usr/bin/env tsx
/**
 * ocr-evaluator.ts
 *
 * OCR (Off-Chain Reporting) feed evaluator for Chainlink aggregators.
 * Monitors OCR2 price feeds and evaluates their performance on Base network.
 *
 * This script connects to Chainlink price feeds via WebSocket, subscribes to
 * block updates, and evaluates OCR feed behavior and latency.
 *
 * Usage:
 *   tsx scripts/ocr-evaluator.ts
 *   RPC_URL=<your-rpc> CHAINLINK_FEEDS=<feeds> tsx scripts/ocr-evaluator.ts
 *
 * Environment variables:
 *   - RPC_URL: WebSocket RPC endpoint (required)
 *   - CHAINLINK_FEEDS: Comma-separated list of "SYMBOL:ADDRESS" pairs
 *   - LOOKBACK_BLOCKS: Number of blocks to analyze (default: 1000)
 */

import { JsonRpcProvider, getAddress, Log } from 'ethers';

// Configuration
const RPC_URL = process.env.RPC_URL || process.env.WS_RPC_URL;
const LOOKBACK_BLOCKS = parseInt(process.env.LOOKBACK_BLOCKS || '1000', 10);

interface FeedConfig {
  symbol: string;
  address: string;
}

interface FeedMetrics {
  symbol: string;
  address: string;
  eventsCount: number;
  lastUpdateBlock: number | null;
  averageLatency: number | null;
}

/**
 * Parse CHAINLINK_FEEDS environment variable
 */
function parseFeeds(feedsEnv: string): FeedConfig[] {
  if (!feedsEnv || !feedsEnv.trim()) {
    return [];
  }

  return feedsEnv.split(',').map((pair) => {
    const [symbol, address] = pair.split(':').map((s) => s.trim());
    if (!symbol || !address) {
      throw new Error(`Invalid feed pair format: "${pair}". Expected "SYMBOL:0xADDRESS"`);
    }
    // Use getAddress to normalize address (ethers v6 style)
    return { symbol: symbol.toUpperCase(), address: getAddress(address) };
  });
}

/**
 * Fetch recent events for a feed
 */
async function fetchFeedEvents(
  provider: JsonRpcProvider,
  address: string,
  fromBlock: number,
  toBlock: number
): Promise<Log[]> {
  try {
    const logs = await provider.getLogs({
      address: getAddress(address),
      fromBlock,
      toBlock,
    });
    return logs;
  } catch (err: any) {
    console.warn(`Warning: Failed to fetch logs for ${address}: ${err.message}`);
    return [];
  }
}

/**
 * Evaluate OCR feed performance
 */
async function evaluateFeed(
  provider: JsonRpcProvider,
  feed: FeedConfig,
  currentBlock: number
): Promise<FeedMetrics> {
  const fromBlock = Math.max(0, currentBlock - LOOKBACK_BLOCKS);
  const logs = await fetchFeedEvents(provider, feed.address, fromBlock, currentBlock);

  const metrics: FeedMetrics = {
    symbol: feed.symbol,
    address: feed.address,
    eventsCount: logs.length,
    lastUpdateBlock: logs.length > 0 ? logs[logs.length - 1].blockNumber : null,
    averageLatency: null,
  };

  if (logs.length > 1) {
    const blockDeltas = logs.slice(1).map((log, i) => log.blockNumber - logs[i].blockNumber);
    metrics.averageLatency = blockDeltas.reduce((a, b) => a + b, 0) / blockDeltas.length;
  }

  return metrics;
}

/**
 * Monitor blocks and evaluate feeds
 */
async function monitorFeeds(
  provider: JsonRpcProvider,
  feeds: FeedConfig[]
): Promise<void> {
  console.log('Starting OCR feed monitor...');
  console.log(`Monitoring ${feeds.length} feed(s)`);

  // Subscribe to new blocks
  provider.on('block', (blockNumber: number) => {
    console.log(`\nNew block: ${blockNumber}`);
    
    // Evaluate all feeds
    Promise.all(feeds.map((feed) => evaluateFeed(provider, feed, blockNumber)))
      .then((results) => {
        results.forEach((metrics) => {
          console.log(`  ${metrics.symbol}:`);
          console.log(`    Address: ${metrics.address}`);
          console.log(`    Events in window: ${metrics.eventsCount}`);
          console.log(`    Last update block: ${metrics.lastUpdateBlock || 'N/A'}`);
          console.log(`    Avg latency: ${metrics.averageLatency?.toFixed(2) || 'N/A'} blocks`);
        });
      })
      .catch((err) => {
        console.error(`Error evaluating feeds: ${err.message}`);
      });
  });
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Validate RPC URL
  if (!RPC_URL) {
    console.error('Error: RPC_URL or WS_RPC_URL environment variable is required');
    process.exit(1);
  }

  // Parse feeds
  const feedsEnv = process.env.CHAINLINK_FEEDS;
  if (!feedsEnv) {
    console.error('Error: CHAINLINK_FEEDS environment variable is required');
    console.error('Expected format: "SYMBOL:0xaddr,SYMBOL2:0xaddr2,..."');
    process.exit(1);
  }

  let feeds: FeedConfig[];
  try {
    feeds = parseFeeds(feedsEnv);
  } catch (err: any) {
    console.error(`Error parsing CHAINLINK_FEEDS: ${err.message}`);
    process.exit(1);
  }

  if (feeds.length === 0) {
    console.error('Error: No feeds found in CHAINLINK_FEEDS');
    process.exit(1);
  }

  // Connect to provider (ethers v6 style)
  let provider: JsonRpcProvider;
  try {
    provider = new JsonRpcProvider(RPC_URL);
    await provider.getBlockNumber();
    console.log('Connected to RPC successfully');
  } catch (err: any) {
    console.error(`Error: Failed to connect to RPC at ${RPC_URL}: ${err.message}`);
    process.exit(1);
  }

  // Start monitoring
  await monitorFeeds(provider, feeds);

  // Keep the process alive
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    process.exit(0);
  });
}

// Run
if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
