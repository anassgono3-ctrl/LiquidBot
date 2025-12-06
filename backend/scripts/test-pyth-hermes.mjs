#!/usr/bin/env node
/**
 * test-pyth-hermes.mjs
 *
 * Validates Pyth Hermes connectivity (REST + SSE) for oracle early-warning.
 *
 * Purpose:
 * - REST: Fetch latest price updates for configured feeds and check staleness
 * - SSE: Subscribe to price update stream and report tick frequency
 * - Validate feed IDs and endpoint configuration
 *
 * Usage:
 *   node scripts/test-pyth-hermes.mjs
 *   PYTH_HTTP_URL=https://hermes.pyth.network node scripts/test-pyth-hermes.mjs
 *   PYTH_ASSETS=WETH,cbETH PYTH_STALE_SECS=15 node scripts/test-pyth-hermes.mjs
 *
 * Environment variables:
 *   - PYTH_HTTP_URL: Pyth Hermes REST endpoint (default: https://hermes.pyth.network)
 *   - PYTH_ASSETS: Comma-separated asset symbols (default: WETH,WBTC,cbETH,USDC)
 *   - PYTH_FEED_MAP_PATH: Path to feed map JSON (optional)
 *   - PYTH_STALE_SECS: Staleness threshold in seconds (default: 10)
 *   - SSE_DURATION_SEC: How long to stream SSE updates (default: 10)
 */

import https from "https";
import http from "http";
import { readFileSync } from "fs";

import dotenv from "dotenv";

dotenv.config();

/**
 * Load feed map from JSON file
 */
function loadFeedMap(path) {
  if (!path) {
    return null;
  }
  try {
    const data = readFileSync(path, "utf-8");
    const parsed = JSON.parse(data);
    return parsed.feeds || {};
  } catch (err) {
    console.warn(`Warning: Failed to load feed map from ${path}: ${err.message}`);
    return null;
  }
}

/**
 * Parse asset symbols from env
 */
function parseAssets(assetsEnv) {
  if (!assetsEnv || !assetsEnv.trim()) {
    return [];
  }
  return assetsEnv
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
}

/**
 * Fetch data from Hermes REST endpoint
 */
function fetchRest(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(
              new Error(
                `HTTP ${res.statusCode}: ${res.statusMessage}\n${data}`
              )
            );
          } else {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(new Error(`Failed to parse JSON: ${err.message}`));
            }
          }
        });
      })
      .on("error", (err) => {
        reject(err);
      });
  });
}

/**
 * Test REST endpoint for a single feed
 */
async function testRestFeed(httpUrl, feedId, symbol, staleSecs) {
  const url = `${httpUrl}/v2/updates/price/latest?ids[]=${feedId}`;
  try {
    const data = await fetchRest(url);
    if (!data.parsed || data.parsed.length === 0) {
      console.log(`  ❌ No price data returned for ${symbol} (${feedId})`);
      return { success: false, reason: "no_data" };
    }

    const priceData = data.parsed[0];
    const price = priceData.price;
    const publishTime = priceData.metadata?.publish_time || 0;
    const conf = priceData.price?.conf || "N/A";
    const expo = priceData.price?.expo || 0;

    const now = Math.floor(Date.now() / 1000);
    const age = now - publishTime;
    const isStale = age > staleSecs;

    console.log(`  ✅ ${symbol} (${feedId}):`);
    console.log(`     Price: ${price.price} (expo: ${expo}, conf: ${conf})`);
    console.log(`     Publish Time: ${publishTime} (${new Date(publishTime * 1000).toISOString()})`);
    console.log(`     Age: ${age}s ${isStale ? "⚠️  STALE" : "✅ FRESH"}`);

    return { success: true, isStale, age, price: price.price };
  } catch (err) {
    console.log(`  ❌ REST failed for ${symbol}: ${err.message}`);
    return { success: false, reason: err.message };
  }
}

/**
 * Test SSE streaming endpoint
 */
async function testSseStream(httpUrl, feedIds, durationSec) {
  console.log(`\n📡 Testing SSE stream for ${durationSec}s...`);
  console.log("-".repeat(60));

  const idsParam = feedIds.map((id) => `ids[]=${id}`).join("&");
  const url = `${httpUrl}/v2/updates/price/stream?${idsParam}`;

  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    const ticks = {};
    let tickCount = 0;

    const req = client.get(url, (res) => {
      console.log(`SSE stream connected (status: ${res.statusCode})`);

      res.on("data", (chunk) => {
        const lines = chunk
          .toString()
          .split("\n")
          .filter((line) => line.startsWith("data:"));
        for (const line of lines) {
          try {
            const jsonStr = line.replace(/^data:\s*/, "");
            const data = JSON.parse(jsonStr);
            if (data.parsed && data.parsed.length > 0) {
              for (const update of data.parsed) {
                const feedId = update.id;
                ticks[feedId] = (ticks[feedId] || 0) + 1;
                tickCount++;
              }
            }
          } catch (err) {
            // Ignore parse errors for SSE keep-alive messages
          }
        }
      });

      res.on("end", () => {
        console.log("SSE stream ended by server");
      });
    });

    req.on("error", (err) => {
      console.error(`SSE error: ${err.message}`);
    });

    setTimeout(() => {
      req.destroy();
      console.log(`\n📊 SSE Summary (${durationSec}s):`);
      console.log(`   Total ticks: ${tickCount}`);
      console.log(`   Unique feeds: ${Object.keys(ticks).length}`);
      for (const [feedId, count] of Object.entries(ticks)) {
        console.log(`   ${feedId.slice(0, 10)}...: ${count} updates`);
      }
      resolve({ tickCount, ticks });
    }, durationSec * 1000);
  });
}

/**
 * Main test logic
 */
async function main() {
  const httpUrl =
    process.env.PYTH_HTTP_URL || "https://hermes.pyth.network";
  const assetsEnv = process.env.PYTH_ASSETS || "WETH,WBTC,cbETH,USDC";
  const feedMapPath = process.env.PYTH_FEED_MAP_PATH || "";
  const staleSecs = parseInt(process.env.PYTH_STALE_SECS || "10", 10);
  const sseDuration = parseInt(process.env.SSE_DURATION_SEC || "10", 10);

  console.log("🔍 Pyth Hermes Connectivity Test");
  console.log("=========================================\n");
  console.log(`HTTP URL: ${httpUrl}`);
  console.log(`Assets: ${assetsEnv}`);
  console.log(`Feed Map Path: ${feedMapPath || "(none - using defaults)"}`);
  console.log(`Staleness Threshold: ${staleSecs}s\n`);

  const assets = parseAssets(assetsEnv);
  const feedMap = loadFeedMap(feedMapPath);

  // Default feed IDs for common assets (fallback if no map provided)
  const defaultFeeds = {
    WETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    WBTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    CBBTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    USDC: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
    CBETH: "0x15ecddd26d49e1a8f1de9376ebebc03916ede873447c1255d2d5891b92ce5717",
  };

  // Resolve feed IDs
  const feedsToTest = [];
  for (const symbol of assets) {
    let feedId = null;
    if (feedMap && feedMap[symbol]) {
      feedId = feedMap[symbol].feedId;
    } else if (defaultFeeds[symbol]) {
      feedId = defaultFeeds[symbol];
    }

    if (!feedId) {
      console.log(`❌ No feed ID found for ${symbol}, skipping`);
      continue;
    }

    feedsToTest.push({ symbol, feedId });
  }

  if (feedsToTest.length === 0) {
    console.log("❌ No valid feeds to test. Check PYTH_ASSETS and PYTH_FEED_MAP_PATH.");
    process.exit(1);
  }

  // Test REST endpoint
  console.log("\n📡 Testing REST API...");
  console.log("-".repeat(60));

  const restResults = [];
  for (const { symbol, feedId } of feedsToTest) {
    const result = await testRestFeed(httpUrl, feedId, symbol, staleSecs);
    restResults.push({ symbol, ...result });
  }

  // Test SSE streaming
  const feedIds = feedsToTest.map((f) => f.feedId);
  const sseResults = await testSseStream(httpUrl, feedIds, sseDuration);

  // Summary
  console.log("\n\n✨ Test Summary");
  console.log("=========================================\n");

  const restPassed = restResults.filter((r) => r.success).length;
  const restFailed = restResults.length - restPassed;
  const staleCount = restResults.filter((r) => r.isStale).length;

  console.log(`REST Tests: ${restPassed}/${restResults.length} passed`);
  if (restFailed > 0) {
    console.log(`  ❌ ${restFailed} failed`);
  }
  if (staleCount > 0) {
    console.log(`  ⚠️  ${staleCount} stale`);
  }

  console.log(
    `\nSSE Tests: ${sseResults.tickCount} ticks received in ${sseDuration}s`
  );
  if (sseResults.tickCount === 0) {
    console.log(
      `  ⚠️  No SSE updates received. Check network and feed configuration.`
    );
  }

  const overallPass =
    restPassed === restResults.length && sseResults.tickCount > 0;
  if (overallPass) {
    console.log("\n✅ All tests passed - Pyth Hermes connectivity confirmed");
  } else {
    console.log(
      "\n⚠️  Some tests failed - review configuration and network connectivity"
    );
  }

  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
