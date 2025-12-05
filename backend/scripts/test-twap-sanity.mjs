#!/usr/bin/env node
/**
 * test-twap-sanity.mjs
 *
 * Validates TWAP oracle sanity by comparing against Chainlink prices.
 *
 * Purpose:
 * - Compute TWAP over configured window for each asset
 * - Compare TWAP against Chainlink oracle prices
 * - Report delta vs threshold and overall pass/fail
 *
 * Usage:
 *   node scripts/test-twap-sanity.mjs
 *   RPC_URL=https://mainnet.base.org TWAP_POOLS='[...]' node scripts/test-twap-sanity.mjs
 *   TWAP_WINDOW_SEC=600 TWAP_DELTA_PCT=0.02 node scripts/test-twap-sanity.mjs
 *
 * Environment variables:
 *   - RPC_URL: Base RPC endpoint (required)
 *   - TWAP_POOLS: JSON array of pool configs (required)
 *   - TWAP_WINDOW_SEC: TWAP observation window in seconds (default: 300)
 *   - TWAP_DELTA_PCT: Max allowed delta percentage (default: 0.012 = 1.2%)
 *   - CHAINLINK_FEEDS: Comma-separated "SYMBOL:ADDRESS" pairs
 */

import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

// Uniswap V3 Pool ABI (minimal for TWAP)
const POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function observe(uint32[] calldata secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
];

// Chainlink Aggregator ABI
const CHAINLINK_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
];

/**
 * Parse TWAP_POOLS from JSON string
 */
function parseTwapPools(poolsEnv) {
  if (!poolsEnv || !poolsEnv.trim()) {
    return [];
  }
  try {
    return JSON.parse(poolsEnv);
  } catch (err) {
    throw new Error(`Failed to parse TWAP_POOLS: ${err.message}`);
  }
}

/**
 * Parse Chainlink feeds from env
 */
function parseChainlinkFeeds(feedsEnv) {
  if (!feedsEnv || !feedsEnv.trim()) {
    return {};
  }

  const feeds = {};
  const pairs = feedsEnv.split(",");
  for (const pair of pairs) {
    const [symbol, address] = pair.split(":").map((s) => s.trim());
    if (symbol && address) {
      feeds[symbol.toUpperCase()] = address;
    }
  }
  return feeds;
}

/**
 * Compute TWAP from Uniswap V3 pool observations
 */
async function computeTwap(provider, poolAddress, windowSec) {
  const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);

  try {
    // Query observations at [now, now - windowSec]
    const secondsAgos = [0, windowSec];
    const [tickCumulatives] = await pool.observe(secondsAgos);

    const tickCumulativeStart = tickCumulatives[1];
    const tickCumulativeEnd = tickCumulatives[0];
    const timeDelta = BigInt(windowSec);

    // Average tick over window
    const tickDelta = tickCumulativeEnd - tickCumulativeStart;
    const avgTick = Number(tickDelta) / Number(timeDelta);

    // Convert tick to price: price = 1.0001^tick
    const price = Math.pow(1.0001, avgTick);

    return { success: true, price, avgTick };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Fetch Chainlink price
 */
async function fetchChainlinkPrice(provider, feedAddress) {
  const feed = new ethers.Contract(feedAddress, CHAINLINK_ABI, provider);

  try {
    const [decimals, latestRound] = await Promise.all([
      feed.decimals(),
      feed.latestRoundData(),
    ]);

    const price = Number(latestRound.answer) / Math.pow(10, decimals);
    const updatedAt = Number(latestRound.updatedAt);
    const age = Math.floor(Date.now() / 1000) - updatedAt;

    return { success: true, price, decimals, updatedAt, age };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Compare TWAP vs Chainlink price
 */
function comparePrices(twapPrice, chainlinkPrice, maxDeltaPct) {
  const delta = Math.abs(twapPrice - chainlinkPrice);
  const deltaPct = (delta / chainlinkPrice) * 100;
  const withinThreshold = deltaPct <= maxDeltaPct * 100;

  return { delta, deltaPct, withinThreshold };
}

/**
 * Main sanity check logic
 */
async function main() {
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    console.error("Error: RPC_URL environment variable is required");
    process.exit(1);
  }

  const poolsEnv = process.env.TWAP_POOLS;
  if (!poolsEnv) {
    console.error("Error: TWAP_POOLS environment variable is required");
    console.error('Example: TWAP_POOLS=\'[{"symbol":"WETH","pool":"0x...","dex":"uniswap_v3"}]\'');
    process.exit(1);
  }

  const windowSec = parseInt(process.env.TWAP_WINDOW_SEC || "300", 10);
  const maxDeltaPct = parseFloat(process.env.TWAP_DELTA_PCT || "0.012");
  const chainlinkFeedsEnv = process.env.CHAINLINK_FEEDS || "";

  console.log("🔍 TWAP Sanity Check");
  console.log("=========================================\n");
  console.log(`RPC URL: ${rpcUrl}`);
  console.log(`TWAP Window: ${windowSec}s`);
  console.log(`Max Delta: ${(maxDeltaPct * 100).toFixed(2)}%\n`);

  const pools = parseTwapPools(poolsEnv);
  const chainlinkFeeds = parseChainlinkFeeds(chainlinkFeedsEnv);

  if (pools.length === 0) {
    console.log("❌ No pools configured in TWAP_POOLS");
    process.exit(1);
  }

  console.log(`Testing ${pools.length} pool(s)...\n`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const results = [];

  for (const poolConfig of pools) {
    const { symbol, pool: poolAddress, dex } = poolConfig;

    console.log(`📊 ${symbol} (${dex})`);
    console.log("-".repeat(60));
    console.log(`Pool: ${poolAddress}`);

    // Compute TWAP
    const twapResult = await computeTwap(provider, poolAddress, windowSec);
    if (!twapResult.success) {
      console.log(`  ❌ TWAP computation failed: ${twapResult.error}\n`);
      results.push({ symbol, success: false, reason: "twap_failed" });
      continue;
    }

    console.log(`  TWAP Price: ${twapResult.price.toFixed(6)} (avg tick: ${twapResult.avgTick.toFixed(2)})`);

    // Fetch Chainlink price if available
    const chainlinkFeed = chainlinkFeeds[symbol];
    if (!chainlinkFeed) {
      console.log(`  ⚠️  No Chainlink feed configured for ${symbol}, skipping comparison`);
      console.log(`     Configure CHAINLINK_FEEDS to enable sanity checking\n`);
      results.push({ 
        symbol, 
        success: true, 
        twapPrice: twapResult.price, 
        chainlinkPrice: null,
        skipped: true,
        reason: 'no_chainlink_feed'
      });
      continue;
    }

    const chainlinkResult = await fetchChainlinkPrice(provider, chainlinkFeed);
    if (!chainlinkResult.success) {
      console.log(`  ❌ Chainlink fetch failed: ${chainlinkResult.error}\n`);
      results.push({ symbol, success: false, reason: "chainlink_failed" });
      continue;
    }

    console.log(`  Chainlink Price: ${chainlinkResult.price.toFixed(6)} (age: ${chainlinkResult.age}s)`);

    // Compare
    const comparison = comparePrices(
      twapResult.price,
      chainlinkResult.price,
      maxDeltaPct
    );

    console.log(`  Delta: ${comparison.delta.toFixed(6)} (${comparison.deltaPct.toFixed(2)}%)`);
    if (comparison.withinThreshold) {
      console.log(`  ✅ PASS - Delta within threshold\n`);
    } else {
      console.log(`  ❌ FAIL - Delta exceeds threshold\n`);
    }

    results.push({
      symbol,
      success: comparison.withinThreshold,
      twapPrice: twapResult.price,
      chainlinkPrice: chainlinkResult.price,
      delta: comparison.delta,
      deltaPct: comparison.deltaPct,
    });
  }

  // Summary
  console.log("\n✨ Summary");
  console.log("=========================================\n");

  const passed = results.filter((r) => r.success && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.length - passed - skipped;

  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  if (skipped > 0) {
    console.log(`Skipped: ${skipped} (no Chainlink feed configured)`);
  }
  console.log(`Failed: ${failed}\n`);

  for (const result of results) {
    if (result.skipped) {
      const status = "⚠️  SKIP";
      console.log(`  ${status} ${result.symbol} (no Chainlink feed)`);
    } else {
      const status = result.success ? "✅ PASS" : "❌ FAIL";
      const deltaStr = result.deltaPct
        ? ` (Δ ${result.deltaPct.toFixed(2)}%)`
        : "";
      console.log(`  ${status} ${result.symbol}${deltaStr}`);
    }
  }

  if (failed === 0 && skipped < results.length) {
    console.log("\n✅ All TWAP sanity checks passed\n");
  } else if (failed === 0 && skipped === results.length) {
    console.log("\n⚠️  All checks skipped - configure CHAINLINK_FEEDS to enable validation\n");
  } else {
    console.log("\n⚠️  Some TWAP sanity checks failed - review deltas and configuration\n");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
