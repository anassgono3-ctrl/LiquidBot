#!/usr/bin/env tsx
/**
 * ocr-evaluator.ts
 *
 * Real-time OCR feed evaluator for Chainlink aggregators on Base.
 * Monitors feed updates and validates data quality with ethers v6 APIs.
 *
 * Usage:
 *   tsx scripts/ocr-evaluator.ts
 *   RPC_URL=<url> FEED_ADDRESS=<address> tsx scripts/ocr-evaluator.ts
 *
 * Environment variables:
 *   - RPC_URL: RPC endpoint (required)
 *   - FEED_ADDRESS: Chainlink aggregator address to monitor (required)
 *   - NETWORK_CHAIN_ID: Chain ID for network validation (default: 8453 for Base)
 */

import 'dotenv/config';
import { JsonRpcProvider, Contract, getAddress } from 'ethers';

// Chainlink Aggregator ABI subset
const AGGREGATOR_ABI = [
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
  'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)',
];

interface RoundData {
  roundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
}

/**
 * Validate and normalize an Ethereum address
 */
function validateAddress(address: string): string {
  try {
    return getAddress(address);
  } catch (error) {
    throw new Error(`Invalid Ethereum address: ${address}`);
  }
}

/**
 * Fetch latest round data from aggregator
 */
async function fetchLatestRound(contract: Contract): Promise<RoundData> {
  const result = await contract.latestRoundData();
  return {
    roundId: result.roundId as bigint,
    answer: result.answer as bigint,
    startedAt: result.startedAt as bigint,
    updatedAt: result.updatedAt as bigint,
    answeredInRound: result.answeredInRound as bigint,
  };
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: bigint): string {
  const date = new Date(Number(timestamp) * 1000);
  return date.toISOString();
}

/**
 * Main monitoring logic
 */
async function main(): Promise<void> {
  // Read environment variables
  const rpcUrl = process.env.RPC_URL;
  const feedAddress = process.env.FEED_ADDRESS;
  const chainId = parseInt(process.env.NETWORK_CHAIN_ID || '8453', 10);

  if (!rpcUrl) {
    console.error('Error: RPC_URL environment variable is required');
    process.exit(1);
  }

  if (!feedAddress) {
    console.error('Error: FEED_ADDRESS environment variable is required');
    process.exit(1);
  }

  // Validate and normalize feed address
  const normalizedAddress = validateAddress(feedAddress);

  console.log('OCR Feed Evaluator Starting...');
  console.log(`RPC URL: ${rpcUrl}`);
  console.log(`Feed Address: ${normalizedAddress}`);
  console.log(`Chain ID: ${chainId}`);
  console.log('');

  // Initialize provider with ethers v6 API
  const provider = new JsonRpcProvider(rpcUrl, chainId);

  // Verify connection
  try {
    const blockNumber = await provider.getBlockNumber();
    console.log(`Connected to network at block ${blockNumber}`);
  } catch (error) {
    console.error(`Failed to connect to RPC: ${error}`);
    process.exit(1);
  }

  // Create contract instance
  const aggregator = new Contract(normalizedAddress, AGGREGATOR_ABI, provider);

  // Fetch and display feed metadata
  try {
    const decimals = await aggregator.decimals();
    const description = await aggregator.description();
    console.log(`Feed: ${description}`);
    console.log(`Decimals: ${decimals}`);
    console.log('');
  } catch (error) {
    console.error(`Failed to fetch feed metadata: ${error}`);
    process.exit(1);
  }

  // Fetch initial round data
  try {
    const roundData = await fetchLatestRound(aggregator);
    console.log('Initial Round Data:');
    console.log(`  Round ID: ${roundData.roundId}`);
    console.log(`  Answer: ${roundData.answer}`);
    console.log(`  Updated At: ${formatTimestamp(roundData.updatedAt)}`);
    console.log('');
  } catch (error) {
    console.error(`Failed to fetch initial round data: ${error}`);
    process.exit(1);
  }

  // Set up real-time monitoring with typed block listener
  console.log('Monitoring for feed updates...');
  console.log('Press Ctrl+C to stop');
  console.log('');

  let lastRoundId = 0n;

  // Block listener with explicit type annotation
  provider.on('block', async (blockNumber: number) => {
    try {
      const roundData = await fetchLatestRound(aggregator);

      // Only log if round has changed
      if (roundData.roundId !== lastRoundId) {
        console.log(`[Block ${blockNumber}] New Round Detected:`);
        console.log(`  Round ID: ${roundData.roundId}`);
        console.log(`  Answer: ${roundData.answer}`);
        console.log(`  Updated At: ${formatTimestamp(roundData.updatedAt)}`);
        console.log('');

        lastRoundId = roundData.roundId;
      }
    } catch (error) {
      console.error(`Error fetching round data at block ${blockNumber}: ${error}`);
    }
  });

  // Keep process alive
  await new Promise(() => {});
}

// Run main and handle errors
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
