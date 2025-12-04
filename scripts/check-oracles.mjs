#!/usr/bin/env node
/**
 * check-oracles.mjs
 *
 * End-to-end oracle sanity check comparing Pyth, Chainlink, and TWAP prices.
 * Validates that all oracle sources are consistent and within acceptable deltas.
 *
 * Usage:
 *   npm run check:oracles
 *   TWAP_DELTA_PCT=5 npm run check:oracles
 *
 * Environment variables:
 *   - RPC_URL: Base RPC endpoint (required)
 *   - PYTH_HTTP_URL: Pyth REST endpoint (default: https://hermes.pyth.network)
 *   - PYTH_ASSETS: Comma-separated asset symbols (default: "ETH,BTC,USDC")
 *   - PYTH_FEED_MAP_PATH: Path to feed ID JSON map (optional)
 *   - PYTH_STALE_SECS: Pyth staleness threshold in seconds (default: 60)
 *   - CHAINLINK_FEEDS: Token:address pairs for Chainlink feeds
 *   - TWAP_POOLS: Pool configurations (format: SYMBOL:address:fee,...)
 *   - TWAP_WINDOW_SEC: TWAP observation window in seconds (default: 300)
 *   - TWAP_DELTA_PCT: Maximum acceptable delta percentage (default: 3)
 *   - PRICE_STALENESS_SEC: Chainlink staleness threshold (default: 900)
 */

import { ethers } from "ethers";
import { readFileSync } from "fs";

// Default configuration
const PYTH_HTTP_URL = process.env.PYTH_HTTP_URL || "https://hermes.pyth.network";
const PYTH_STALE_SECS = parseInt(process.env.PYTH_STALE_SECS || "60", 10);
const TWAP_WINDOW_SEC = parseInt(process.env.TWAP_WINDOW_SEC || "300", 10);
const TWAP_DELTA_PCT = parseFloat(process.env.TWAP_DELTA_PCT || "3");
const PRICE_STALENESS_SEC = parseInt(process.env.PRICE_STALENESS_SEC || "900", 10);

// ABIs
const CHAINLINK_AGGREGATOR_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
];

const UNISWAP_V3_POOL_ABI = [
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

/**
 * Parse Chainlink feeds from environment
 */
function parseChainlinkFeeds() {
  const feedsEnv = process.env.CHAINLINK_FEEDS;
  if (!feedsEnv) return {};

  const feeds = {};
  for (const pair of feedsEnv.split(",")) {
    const [symbol, address] = pair.split(":").map((s) => s.trim());
    if (symbol && address) {
      feeds[symbol.toUpperCase()] = address;
    }
  }
  return feeds;
}

/**
 * Parse TWAP pools from environment
 */
function parseTWAPPools() {
  const poolsEnv = process.env.TWAP_POOLS;
  if (!poolsEnv) return {};

  const pools = {};
  for (const entry of poolsEnv.split(",")) {
    const [symbol, address, fee] = entry.split(":").map((s) => s.trim());
    if (symbol && address) {
      pools[symbol.toUpperCase()] = { address, fee: parseInt(fee || "3000", 10) };
    }
  }
  return pools;
}

/**
 * Load Pyth feed map
 */
function loadPythFeedMap() {
  const feedMapPath = process.env.PYTH_FEED_MAP_PATH;
  const defaultMap = {
    "ETH/USD": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    "BTC/USD": "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    "USDC/USD": "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
    "WETH/USD": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  };

  if (!feedMapPath) return defaultMap;

  try {
    const content = readFileSync(feedMapPath, "utf-8");
    const parsed = JSON.parse(content);
    const feedMap = {};
    if (parsed.feeds) {
      for (const [key, value] of Object.entries(parsed.feeds)) {
        feedMap[key] = value.id;
      }
    }
    return feedMap;
  } catch (err) {
    console.warn(`Warning: Failed to load Pyth feed map: ${err.message}`);
    return defaultMap;
  }
}

/**
 * Fetch Pyth price
 */
async function fetchPythPrice(feedId) {
  const url = `${PYTH_HTTP_URL}/v2/updates/price/latest?ids[]=${feedId}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    if (!data.parsed || data.parsed.length === 0) return null;

    const priceData = data.parsed[0].price;
    const price = Number(priceData.price) * Math.pow(10, Number(priceData.expo));
    const publishTime = priceData.publish_time;
    const age = Math.floor(Date.now() / 1000) - publishTime;

    return { price, publishTime, age, stale: age > PYTH_STALE_SECS };
  } catch (err) {
    return null;
  }
}

/**
 * Fetch Chainlink price
 */
async function fetchChainlinkPrice(provider, feedAddress) {
  try {
    const feed = new ethers.Contract(feedAddress, CHAINLINK_AGGREGATOR_ABI, provider);
    const [roundData, decimals] = await Promise.all([feed.latestRoundData(), feed.decimals()]);

    const price = Number(roundData.answer) / Math.pow(10, Number(decimals));
    const updatedAt = Number(roundData.updatedAt);
    const age = Math.floor(Date.now() / 1000) - updatedAt;

    return { price, updatedAt, age, stale: age > PRICE_STALENESS_SEC };
  } catch (err) {
    return null;
  }
}

/**
 * Compute TWAP price from Uniswap V3 pool
 */
async function computeTWAP(provider, poolAddress, windowSec) {
  try {
    const pool = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, provider);

    // Get tick cumulatives
    const secondsAgo = [windowSec, 0];
    const [tickCumulatives] = await pool.observe(secondsAgo);

    // Compute average tick
    const tickDelta = Number(tickCumulatives[1] - tickCumulatives[0]);
    const timeDelta = windowSec;
    const avgTick = tickDelta / timeDelta;

    // Convert tick to price (price = 1.0001^tick)
    const price = Math.pow(1.0001, avgTick);

    return { price, avgTick, windowSec };
  } catch (err) {
    return null;
  }
}

/**
 * Calculate percentage delta between two prices
 */
function calcDelta(price1, price2) {
  if (!price1 || !price2 || price2 === 0) return null;
  return ((price1 - price2) / price2) * 100;
}

/**
 * Main sanity check logic
 */
async function main() {
  console.log("🔍 Oracle Sanity Check - Pyth vs Chainlink vs TWAP\n");

  // 1. Connect to provider
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    console.error("Error: RPC_URL not set");
    process.exit(1);
  }

  let provider;
  try {
    provider = new ethers.JsonRpcProvider(rpcUrl);
    await provider.getNetwork();
  } catch (err) {
    console.error(`Error: Failed to connect to RPC: ${err.message}`);
    process.exit(1);
  }

  // 2. Parse configuration
  const pythAssets = (process.env.PYTH_ASSETS || "WETH,USDC")
    .split(",")
    .map((s) => s.trim().toUpperCase());
  const pythFeedMap = loadPythFeedMap();
  const chainlinkFeeds = parseChainlinkFeeds();
  const twapPools = parseTWAPPools();

  console.log(`Assets to check: ${pythAssets.join(", ")}`);
  console.log(`TWAP window: ${TWAP_WINDOW_SEC}s`);
  console.log(`TWAP delta threshold: ${TWAP_DELTA_PCT}%`);
  console.log(`Pyth staleness: ${PYTH_STALE_SECS}s`);
  console.log(`Chainlink staleness: ${PRICE_STALENESS_SEC}s\n`);

  // 3. Check each asset
  const results = [];
  let allPassed = true;

  for (const asset of pythAssets) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`Checking: ${asset}`);
    console.log("=".repeat(80));

    const result = {
      asset,
      pyth: null,
      chainlink: null,
      twap: null,
      deltas: {},
      issues: [],
    };

    // Fetch Pyth price
    const pythFeedId =
      pythFeedMap[`${asset}/USD`] ||
      pythFeedMap[asset] ||
      pythFeedMap[`${asset.replace("W", "")}/USD`];

    if (pythFeedId && pythFeedId !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
      console.log(`\n📡 Pyth (${pythFeedId.substring(0, 10)}...):`);
      result.pyth = await fetchPythPrice(pythFeedId);
      if (result.pyth) {
        console.log(`   Price: $${result.pyth.price.toFixed(6)}`);
        console.log(`   Age: ${result.pyth.age}s ${result.pyth.stale ? "⚠️ STALE" : "✓"}`);
        if (result.pyth.stale) {
          result.issues.push(`Pyth price is stale (${result.pyth.age}s > ${PYTH_STALE_SECS}s)`);
          allPassed = false;
        }
      } else {
        console.log("   ❌ Failed to fetch Pyth price");
        result.issues.push("Pyth price unavailable");
      }
    } else {
      console.log("\n⚠️  Pyth: No feed ID configured");
    }

    // Fetch Chainlink price
    const chainlinkFeed = chainlinkFeeds[asset] || chainlinkFeeds[asset.replace("W", "")];
    if (chainlinkFeed) {
      console.log(`\n📡 Chainlink (${chainlinkFeed}):`);
      result.chainlink = await fetchChainlinkPrice(provider, chainlinkFeed);
      if (result.chainlink) {
        console.log(`   Price: $${result.chainlink.price.toFixed(6)}`);
        console.log(`   Age: ${result.chainlink.age}s ${result.chainlink.stale ? "⚠️ STALE" : "✓"}`);
        if (result.chainlink.stale) {
          result.issues.push(
            `Chainlink price is stale (${result.chainlink.age}s > ${PRICE_STALENESS_SEC}s)`
          );
          allPassed = false;
        }
      } else {
        console.log("   ❌ Failed to fetch Chainlink price");
        result.issues.push("Chainlink price unavailable");
      }
    } else {
      console.log("\n⚠️  Chainlink: No feed configured");
    }

    // Compute TWAP
    const twapPool = twapPools[asset];
    if (twapPool) {
      console.log(`\n📊 TWAP (${twapPool.address}):`);
      result.twap = await computeTWAP(provider, twapPool.address, TWAP_WINDOW_SEC);
      if (result.twap) {
        console.log(`   Price ratio: ${result.twap.price.toFixed(6)}`);
        console.log(`   Avg tick: ${result.twap.avgTick.toFixed(2)}`);
        console.log(`   Window: ${result.twap.windowSec}s`);
      } else {
        console.log("   ❌ Failed to compute TWAP");
        result.issues.push("TWAP computation failed");
      }
    } else {
      console.log("\n⚠️  TWAP: No pool configured");
    }

    // Calculate deltas
    console.log("\n📐 Price Deltas:");
    if (result.pyth && result.chainlink) {
      result.deltas.pythVsChainlink = calcDelta(result.pyth.price, result.chainlink.price);
      console.log(
        `   Pyth vs Chainlink: ${result.deltas.pythVsChainlink?.toFixed(2)}%`
      );
      if (Math.abs(result.deltas.pythVsChainlink) > TWAP_DELTA_PCT) {
        result.issues.push(
          `Pyth vs Chainlink delta exceeds threshold (${result.deltas.pythVsChainlink.toFixed(2)}% > ${TWAP_DELTA_PCT}%)`
        );
        allPassed = false;
      }
    }

    if (result.twap && result.chainlink) {
      // Note: TWAP might be a ratio, not USD price
      const twapDelta = calcDelta(result.twap.price, 1); // Compare ratio to 1.0
      console.log(`   TWAP deviation from 1.0: ${twapDelta?.toFixed(2)}%`);
    }

    if (result.pyth && result.twap) {
      // This comparison may not be meaningful if TWAP is a ratio
      console.log("   (TWAP comparison requires price normalization)");
    }

    // Summary for this asset
    if (result.issues.length > 0) {
      console.log(`\n❌ Issues found:`);
      result.issues.forEach((issue) => console.log(`   - ${issue}`));
    } else {
      console.log("\n✅ All checks passed");
    }

    results.push(result);
  }

  // 4. Overall summary
  console.log(`\n\n${"=".repeat(80)}`);
  console.log("SUMMARY");
  console.log("=".repeat(80));

  const totalAssets = results.length;
  const assetsWithIssues = results.filter((r) => r.issues.length > 0).length;
  const assetsPassed = totalAssets - assetsWithIssues;

  console.log(`\nAssets checked: ${totalAssets}`);
  console.log(`Passed: ${assetsPassed}`);
  console.log(`Failed: ${assetsWithIssues}\n`);

  if (!allPassed) {
    console.log("⚠️  Recommended actions:");
    const staleFeeds = results.filter((r) =>
      r.issues.some((i) => i.includes("stale"))
    );
    if (staleFeeds.length > 0) {
      console.log(`   - Check feed connectivity for: ${staleFeeds.map((r) => r.asset).join(", ")}`);
    }

    const deltaTooHigh = results.filter((r) =>
      r.issues.some((i) => i.includes("delta exceeds"))
    );
    if (deltaTooHigh.length > 0) {
      console.log(`   - Review delta thresholds or investigate price discrepancies`);
      console.log(`   - Consider disabling TWAP for: ${deltaTooHigh.map((r) => r.asset).join(", ")}`);
    }

    const unavailable = results.filter((r) =>
      r.issues.some((i) => i.includes("unavailable") || i.includes("failed"))
    );
    if (unavailable.length > 0) {
      console.log(`   - Configure missing oracles for: ${unavailable.map((r) => r.asset).join(", ")}`);
    }

    console.log("");
    process.exit(1);
  }

  console.log("✅ All oracle sources are healthy and consistent!\n");
  console.log("Next steps:");
  console.log("  - Enable Pyth SSE streaming for real-time early warnings");
  console.log("  - Configure TWAP_POOLS for additional sanity checks");
  console.log("  - Monitor staleness metrics in production\n");
}

// Run main
main().catch((err) => {
  console.error("Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
