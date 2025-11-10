#!/usr/bin/env node
/**
 * audit-chainlink-aggregators.mjs
 *
 * Diagnostic script that resolves underlying aggregators behind Chainlink proxy feeds
 * and enumerates recent OCR2/legacy events to confirm price update emission patterns.
 *
 * Purpose:
 * - Distinguish between "no events on proxy" vs "no events on underlying aggregator"
 * - Identify which event types appear (OCR2 NewTransmission vs legacy AnswerUpdated)
 * - Validate updatedAt freshness vs event cadence
 *
 * Usage:
 *   npm run audit:feeds
 *   FEED_SYMBOL=cbETH LOOKBACK_BLOCKS=5000 npm run audit:feeds
 *   INCLUDE_PROXY_LOGS=false npm run audit:feeds
 *
 * Environment variables:
 *   - RPC_URL || HTTP_RPC_URL || BACKFILL_RPC_URL: RPC endpoint
 *   - CHAINLINK_FEEDS: "SYMBOL:0xaddr,SYMBOL2:0xaddr2,..." format
 *   - LOOKBACK_BLOCKS: number of blocks to scan (default: 3000)
 *   - FEED_SYMBOL: optional filter to check only one feed symbol
 *   - INCLUDE_PROXY_LOGS: include proxy logs in analysis (default: true)
 *   - RAW_TOPICS_SAMPLE_COUNT: number of sample topic0 hashes to include (default: 3)
 */

import { ethers } from "ethers";

// Minimal ABIs for proxy and aggregator interactions
const PROXY_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function aggregator() view returns (address)",
  "function proposedAggregator() view returns (address)",
];

// Event signatures (topic0)
const EVENT_SIGNATURES = {
  AnswerUpdated: ethers.id("AnswerUpdated(int256,uint256,uint256)"),
  NewTransmission: ethers.id("NewTransmission(uint32,int192,address,int192[],bytes,bytes32)"),
};

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
 * Attempt to resolve aggregator address from proxy
 * @param {ethers.Provider} provider
 * @param {string} proxyAddress
 * @returns {Promise<{aggregator: string|null, proposedAggregator: string|null, failed: boolean}>}
 */
async function resolveAggregator(provider, proxyAddress) {
  const contract = new ethers.Contract(proxyAddress, PROXY_ABI, provider);
  
  let aggregator = null;
  let proposedAggregator = null;
  let failed = false;

  // Try to get aggregator()
  try {
    aggregator = await contract.aggregator();
  } catch (err) {
    failed = true;
    console.warn(`Warning: Failed to resolve aggregator() for ${proxyAddress}: ${err.message}`);
  }

  // Try to get proposedAggregator() (optional)
  try {
    proposedAggregator = await contract.proposedAggregator();
  } catch (err) {
    // This is optional, so we don't mark as failed
  }

  return { aggregator, proposedAggregator, failed };
}

/**
 * Fetch logs for an address over a block range
 * @param {ethers.Provider} provider
 * @param {string} address
 * @param {number} fromBlock
 * @param {number} toBlock
 * @param {string|null} topic0 - Optional event signature filter
 * @returns {Promise<Array<ethers.Log>>}
 */
async function fetchLogs(provider, address, fromBlock, toBlock, topic0 = null) {
  try {
    const filter = {
      address,
      fromBlock,
      toBlock,
    };
    
    if (topic0) {
      filter.topics = [topic0];
    }

    const logs = await provider.getLogs(filter);
    return logs;
  } catch (err) {
    console.warn(`Warning: Failed to fetch logs for ${address}: ${err.message}`);
    return [];
  }
}

/**
 * Count events by signature
 * @param {ethers.Provider} provider
 * @param {string} address
 * @param {number} fromBlock
 * @param {number} toBlock
 * @returns {Promise<{total: number, answerUpdated: number, newTransmission: number, sampleTopics: string[]}>}
 */
async function countEventsBySignature(provider, address, fromBlock, toBlock, sampleCount) {
  // Get total logs (unfiltered)
  const allLogs = await fetchLogs(provider, address, fromBlock, toBlock);
  
  // Get AnswerUpdated logs
  const answerUpdatedLogs = await fetchLogs(
    provider,
    address,
    fromBlock,
    toBlock,
    EVENT_SIGNATURES.AnswerUpdated
  );
  
  // Get NewTransmission logs
  const newTransmissionLogs = await fetchLogs(
    provider,
    address,
    fromBlock,
    toBlock,
    EVENT_SIGNATURES.NewTransmission
  );

  // Extract sample topic0 hashes
  const sampleTopics = allLogs
    .slice(0, sampleCount)
    .map((log) => log.topics[0] || "0x");

  return {
    total: allLogs.length,
    answerUpdated: answerUpdatedLogs.length,
    newTransmission: newTransmissionLogs.length,
    sampleTopics,
  };
}

/**
 * Fetch latestRoundData from an address
 * @param {ethers.Provider} provider
 * @param {string} address
 * @returns {Promise<object|null>}
 */
async function fetchLatestRoundData(provider, address) {
  const contract = new ethers.Contract(address, PROXY_ABI, provider);

  try {
    const roundData = await contract.latestRoundData();
    const now = Math.floor(Date.now() / 1000);
    const updatedAt = Number(roundData.updatedAt);
    const ageSeconds = now - updatedAt;

    return {
      roundId: roundData.roundId.toString(),
      answer: roundData.answer.toString(),
      updatedAt,
      ageSeconds,
    };
  } catch (err) {
    console.warn(`Warning: Failed to fetch latestRoundData for ${address}: ${err.message}`);
    return null;
  }
}

/**
 * Calculate mismatch between two latestRoundData results
 * @param {object|null} proxyData
 * @param {object|null} aggregatorData
 * @returns {object|null}
 */
function calculateMismatch(proxyData, aggregatorData) {
  if (!proxyData || !aggregatorData) {
    return null;
  }

  const answerDiff = BigInt(proxyData.answer) - BigInt(aggregatorData.answer);
  const updatedAtDiff = proxyData.updatedAt - aggregatorData.updatedAt;

  return {
    answerDiff: answerDiff.toString(),
    updatedAtDiff,
  };
}

/**
 * Process a single feed
 * @param {ethers.Provider} provider
 * @param {object} feed - {symbol, address}
 * @param {number} fromBlock
 * @param {number} toBlock
 * @param {boolean} includeProxyLogs
 * @param {number} sampleCount
 * @returns {Promise<object>}
 */
async function processFeed(provider, feed, fromBlock, toBlock, includeProxyLogs, sampleCount) {
  const result = {
    symbol: feed.symbol,
    proxyAddress: feed.address,
    aggregatorAddress: null,
    aggregatorResolutionFailed: false,
    blockWindow: { from: fromBlock, to: toBlock },
    proxyLogs: 0,
    aggregatorLogs: 0,
    answerUpdatedCount: 0,
    newTransmissionCount: 0,
    latestRoundDataProxy: null,
    latestRoundDataAggregator: null,
    mismatch: null,
  };

  // Resolve aggregator
  const aggregatorInfo = await resolveAggregator(provider, feed.address);
  result.aggregatorAddress = aggregatorInfo.aggregator;
  result.aggregatorResolutionFailed = aggregatorInfo.failed;

  // Fetch proxy logs if enabled
  if (includeProxyLogs) {
    const proxyCounts = await countEventsBySignature(
      provider,
      feed.address,
      fromBlock,
      toBlock,
      sampleCount
    );
    result.proxyLogs = proxyCounts.total;
    // Note: We don't add proxy event counts to totals to avoid confusion
  }

  // Fetch aggregator logs if resolved
  if (result.aggregatorAddress && result.aggregatorAddress !== ethers.ZeroAddress) {
    const aggCounts = await countEventsBySignature(
      provider,
      result.aggregatorAddress,
      fromBlock,
      toBlock,
      sampleCount
    );
    result.aggregatorLogs = aggCounts.total;
    result.answerUpdatedCount = aggCounts.answerUpdated;
    result.newTransmissionCount = aggCounts.newTransmission;
    result.rawTopicsSample = aggCounts.sampleTopics;
  }

  // Fetch latestRoundData from proxy
  result.latestRoundDataProxy = await fetchLatestRoundData(provider, feed.address);

  // Fetch latestRoundData from aggregator if different
  if (
    result.aggregatorAddress &&
    result.aggregatorAddress !== ethers.ZeroAddress &&
    result.aggregatorAddress.toLowerCase() !== feed.address.toLowerCase()
  ) {
    result.latestRoundDataAggregator = await fetchLatestRoundData(
      provider,
      result.aggregatorAddress
    );
  }

  // Calculate mismatch
  result.mismatch = calculateMismatch(
    result.latestRoundDataProxy,
    result.latestRoundDataAggregator
  );

  return result;
}

/**
 * Main script logic
 */
async function main() {
  // 1. Read RPC URL (priority: RPC_URL || HTTP_RPC_URL || BACKFILL_RPC_URL)
  const rpcUrl = process.env.RPC_URL || process.env.HTTP_RPC_URL || process.env.BACKFILL_RPC_URL;
  if (!rpcUrl) {
    console.error(
      "Error: No RPC URL found. Set RPC_URL, HTTP_RPC_URL, or BACKFILL_RPC_URL in .env"
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
  const includeProxyLogs = process.env.INCLUDE_PROXY_LOGS !== "false";
  const sampleCount = parseInt(process.env.RAW_TOPICS_SAMPLE_COUNT || "3", 10);

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

  // 7. Process each feed and output NDJSON
  for (const feed of feedsToCheck) {
    try {
      const result = await processFeed(
        provider,
        feed,
        fromBlock,
        toBlock,
        includeProxyLogs,
        sampleCount
      );
      
      // Output as compact NDJSON (one JSON object per line)
      console.log(JSON.stringify(result));
    } catch (err) {
      // Gracefully handle per-feed errors
      console.error(
        JSON.stringify({
          symbol: feed.symbol,
          proxyAddress: feed.address,
          error: err.message,
        })
      );
    }
  }
}

// Run main and handle errors
main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
