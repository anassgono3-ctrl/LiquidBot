#!/usr/bin/env node
/**
 * check-ocr2-feeds.mjs
 *
 * Lightweight confirmation script for Chainlink feed connectivity on Base.
 * Validates OCR2 + polling fallback behavior introduced in PR #87.
 *
 * Usage:
 *   npm run check:feeds
 *   FEED_SYMBOL=cbETH LOOKBACK_BLOCKS=5000 npm run check:feeds
 *
 * Environment variables:
 *   - RPC_URL || HTTP_RPC_URL || BACKFILL_RPC_URL: RPC endpoint
 *   - CHAINLINK_FEEDS: "SYMBOL:0xaddr,SYMBOL2:0xaddr2,..." format
 *   - LOOKBACK_BLOCKS: number of blocks to scan for logs (default: 3000)
 *   - FEED_SYMBOL: optional filter to check only one feed symbol
 */

import { ethers } from "ethers";

/**
 * Parse CHAINLINK_FEEDS env into array of feed objects
 * @param {string} feedsEnv - "SYMBOL:0xaddr,SYMBOL2:0xaddr2,..."
 * @returns {Array<{symbol: string, address: string}>}
 */
function parseFeeds(feedsEnv) {
  if (!feedsEnv || !feedsEnv.trim()) {
    return [];
  }

  return feedsEnv.split(",").map((pair) => {
    const [symbol, address] = pair.split(":").map((s) => s.trim());
    if (!symbol || !address) {
      throw new Error(`Invalid feed pair format: "${pair}". Expected "SYMBOL:0xADDRESS"`);
    }
    return { symbol: symbol.toUpperCase(), address };
  });
}

/**
 * Fetch logs for a feed address over a block range
 * @param {ethers.Provider} provider
 * @param {string} address - Feed address
 * @param {number} fromBlock
 * @param {number} toBlock
 * @returns {Promise<Array<ethers.Log>>}
 */
async function fetchFeedLogs(provider, address, fromBlock, toBlock) {
  try {
    const logs = await provider.getLogs({
      address,
      fromBlock,
      toBlock,
    });
    return logs;
  } catch (err) {
    console.warn(`Warning: Failed to fetch logs for ${address}: ${err.message}`);
    return [];
  }
}

/**
 * Query latestRoundData from Chainlink aggregator
 * @param {ethers.Provider} provider
 * @param {string} address - Feed address
 * @returns {Promise<object|null>}
 */
async function fetchLatestRoundData(provider, address) {
  const aggregatorAbi = [
    "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  ];

  try {
    const contract = new ethers.Contract(address, aggregatorAbi, provider);
    const roundData = await contract.latestRoundData();

    return {
      roundId: roundData.roundId.toString(),
      answer: roundData.answer.toString(),
      startedAt: Number(roundData.startedAt),
      updatedAt: Number(roundData.updatedAt),
      answeredInRound: roundData.answeredInRound.toString(),
    };
  } catch (err) {
    console.warn(`Warning: Failed to fetch latestRoundData for ${address}: ${err.message}`);
    return null;
  }
}

/**
 * Main script logic
 */
async function main() {
  // 1. Read RPC URL (priority: RPC_URL || HTTP_RPC_URL || BACKFILL_RPC_URL)
  const rpcUrl = process.env.RPC_URL || process.env.HTTP_RPC_URL || process.env.BACKFILL_RPC_URL;
  if (!rpcUrl) {
    console.error(
      "Error: No RPC URL found. Set RPC_URL, HTTP_RPC_URL, or BACKFILL_RPC_URL in .env",
    );
    process.exit(1);
  }

  // 2. Read and parse CHAINLINK_FEEDS
  const feedsEnv = process.env.CHAINLINK_FEEDS;
  if (!feedsEnv) {
    console.error("Error: CHAINLINK_FEEDS not set in .env");
    console.error('Expected format: "SYMBOL:0xaddr,SYMBOL2:0xaddr2,..."');
    process.exit(1);
  }

  let feeds;
  try {
    feeds = parseFeeds(feedsEnv);
  } catch (err) {
    console.error(`Error parsing CHAINLINK_FEEDS: ${err.message}`);
    process.exit(1);
  }

  if (feeds.length === 0) {
    console.error("Error: No feeds found in CHAINLINK_FEEDS");
    process.exit(1);
  }

  // 3. Read environment knobs
  const lookbackBlocks = parseInt(process.env.LOOKBACK_BLOCKS || "3000", 10);
  const filterSymbol = process.env.FEED_SYMBOL ? process.env.FEED_SYMBOL.toUpperCase() : null;

  // 4. Filter feeds if FEED_SYMBOL is set
  let feedsToCheck = feeds;
  if (filterSymbol) {
    feedsToCheck = feeds.filter((f) => f.symbol === filterSymbol);
    if (feedsToCheck.length === 0) {
      console.error(`Error: Feed symbol "${filterSymbol}" not found in CHAINLINK_FEEDS`);
      console.error(`Available symbols: ${feeds.map((f) => f.symbol).join(", ")}`);
      process.exit(1);
    }
  }

  // 5. Connect to provider
  let provider;
  try {
    provider = new ethers.JsonRpcProvider(rpcUrl);
    // Test connection
    await provider.getBlockNumber();
  } catch (err) {
    console.error(`Error: Failed to connect to RPC at ${rpcUrl}: ${err.message}`);
    process.exit(1);
  }

  // 6. Get current block number
  let currentBlock;
  try {
    currentBlock = await provider.getBlockNumber();
  } catch (err) {
    console.error(`Error: Failed to get current block number: ${err.message}`);
    process.exit(1);
  }

  const fromBlock = Math.max(0, currentBlock - lookbackBlocks);
  const toBlock = currentBlock;

  // 7. Iterate feeds and gather data
  console.log(`Checking ${feedsToCheck.length} feed(s) from block ${fromBlock} to ${toBlock}...`);
  console.log("");

  for (const feed of feedsToCheck) {
    // Fetch logs
    const logs = await fetchFeedLogs(provider, feed.address, fromBlock, toBlock);

    // Extract sample topics (up to 2)
    const sampleTopics = logs.slice(0, 2).map((log) => log.topics[0] || "0x");

    // Fetch latestRoundData
    const latestRoundData = await fetchLatestRoundData(provider, feed.address);

    // Build JSON summary
    const summary = {
      symbol: feed.symbol,
      address: feed.address,
      blockWindow: {
        from: fromBlock,
        to: toBlock,
      },
      logsInWindow: logs.length,
      sampleTopics,
      latestRoundData,
    };

    // Print compact JSON per feed
    console.log(JSON.stringify(summary, null, 2));
  }

  console.log("");
  console.log("Check complete.");
}

// Run main and handle errors
main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
