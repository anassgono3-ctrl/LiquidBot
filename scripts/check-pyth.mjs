#!/usr/bin/env node
/**
 * check-pyth.mjs
 *
 * Validates Pyth Hermes REST and SSE connectivity for early-warning price feeds.
 * Tests both REST API for latest prices and SSE streaming for real-time updates.
 *
 * Usage:
 *   npm run check:pyth
 *   PYTH_ASSETS=ETH,BTC npm run check:pyth
 *   PYTH_STALE_SECS=60 npm run check:pyth
 *
 * Environment variables:
 *   - PYTH_HTTP_URL: REST endpoint (default: https://hermes.pyth.network)
 *   - PYTH_SSE_URL: SSE streaming endpoint (default: https://hermes.pyth.network/v2/updates/stream)
 *   - PYTH_ASSETS: Comma-separated asset symbols (default: "ETH,BTC,USDC")
 *   - PYTH_FEED_MAP_PATH: Path to feed ID JSON map (optional)
 *   - PYTH_STALE_SECS: Staleness threshold in seconds (default: 60)
 */

import { readFileSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default configuration
const PYTH_HTTP_URL = process.env.PYTH_HTTP_URL || "https://hermes.pyth.network";
const PYTH_SSE_URL =
  process.env.PYTH_SSE_URL || "https://hermes.pyth.network/v2/updates/stream";
const PYTH_STALE_SECS = parseInt(process.env.PYTH_STALE_SECS || "60", 10);
const PYTH_ASSETS = (process.env.PYTH_ASSETS || "ETH,BTC,USDC")
  .split(",")
  .map((s) => s.trim().toUpperCase());

// Default feed IDs (subset of config/pyth-feeds.example.json)
const DEFAULT_FEED_MAP = {
  "ETH/USD": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  "BTC/USD": "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  "USDC/USD": "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  "WETH/USD": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  "AAVE/USD": "0x2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445",
  "DAI/USD": "0xb0948a5e5313200c632b51bb5ca32f6de0d36e9950a942d19751e833f70dabfd",
};

/**
 * Load feed map from JSON file or use defaults
 */
function loadFeedMap() {
  const feedMapPath = process.env.PYTH_FEED_MAP_PATH;

  if (feedMapPath) {
    try {
      const content = readFileSync(feedMapPath, "utf-8");
      const parsed = JSON.parse(content);

      // Convert from example format to simple map
      const feedMap = {};
      if (parsed.feeds) {
        for (const [key, value] of Object.entries(parsed.feeds)) {
          feedMap[key] = value.id;
        }
      }
      console.log(`✅ Loaded feed map from: ${feedMapPath}\n`);
      return feedMap;
    } catch (err) {
      console.warn(`Warning: Failed to load feed map from ${feedMapPath}: ${err.message}`);
      console.warn("Falling back to default feed map\n");
    }
  }

  return DEFAULT_FEED_MAP;
}

/**
 * Resolve asset symbols to feed IDs
 */
function resolveFeedIds(assets, feedMap) {
  const feedIds = [];
  const symbolToId = {};

  for (const asset of assets) {
    // Try exact match first
    let feedId = feedMap[`${asset}/USD`];

    // Try variations
    if (!feedId) {
      feedId =
        feedMap[`${asset}`] ||
        feedMap[`${asset.replace("W", "")}/USD`] || // WETH -> ETH
        feedMap[`${asset}/ETH`];
    }

    if (feedId && feedId !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
      feedIds.push(feedId);
      symbolToId[asset] = feedId;
      console.log(`  ✓ ${asset} -> ${feedId.substring(0, 10)}...`);
    } else {
      console.warn(`  ⚠️  ${asset} -> No feed ID found, skipping`);
    }
  }

  return { feedIds, symbolToId };
}

/**
 * Fetch latest prices via REST API
 */
async function fetchLatestPrices(feedIds) {
  const idsParam = feedIds.map((id) => `ids[]=${id}`).join("&");
  const url = `${PYTH_HTTP_URL}/v2/updates/price/latest?${idsParam}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data.parsed || [];
  } catch (err) {
    throw new Error(`Failed to fetch prices from ${PYTH_HTTP_URL}: ${err.message}`);
  }
}

/**
 * Subscribe to SSE stream and collect updates for a duration
 */
async function subscribeSSE(feedIds, durationMs = 10000) {
  return new Promise((resolve, reject) => {
    const updates = [];
    const idsParam = feedIds.map((id) => `ids[]=${id}`).join("&");
    const url = `${PYTH_SSE_URL}?${idsParam}`;

    console.log(`🔌 Connecting to SSE stream: ${url.substring(0, 80)}...`);
    console.log(`   Listening for ${durationMs / 1000} seconds...\n`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      resolve(updates);
    }, durationMs);

    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("data:")) {
                try {
                  const data = JSON.parse(line.substring(5));
                  if (data.parsed) {
                    updates.push(...data.parsed);
                  }
                } catch (parseErr) {
                  // Ignore parse errors for SSE
                }
              }
            }
          }
        } catch (err) {
          if (err.name !== "AbortError") {
            console.warn(`SSE read error: ${err.message}`);
          }
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          clearTimeout(timeoutId);
          reject(err);
        }
      });
  });
}

/**
 * Format price for display
 */
function formatPrice(price, expo) {
  const value = Number(price) * Math.pow(10, Number(expo));
  return value.toFixed(Math.abs(Number(expo)));
}

/**
 * Check if price is stale
 */
function isStale(publishTime, thresholdSecs) {
  const now = Math.floor(Date.now() / 1000);
  const age = now - publishTime;
  return age > thresholdSecs;
}

/**
 * Main validation logic
 */
async function main() {
  console.log("🔍 Pyth Hermes Connectivity Check\n");
  console.log(`REST URL: ${PYTH_HTTP_URL}`);
  console.log(`SSE URL: ${PYTH_SSE_URL}`);
  console.log(`Staleness threshold: ${PYTH_STALE_SECS}s\n`);

  // 1. Load feed map
  const feedMap = loadFeedMap();

  // 2. Resolve feed IDs
  console.log("Resolving feed IDs...");
  const { feedIds, symbolToId } = resolveFeedIds(PYTH_ASSETS, feedMap);
  console.log("");

  if (feedIds.length === 0) {
    console.error("❌ No valid feed IDs found. Check PYTH_ASSETS and feed map.");
    process.exit(1);
  }

  // 3. Test REST API
  console.log("📡 Testing REST API...\n");
  let restPrices = [];
  try {
    restPrices = await fetchLatestPrices(feedIds);
    console.log(`✅ Received ${restPrices.length} price update(s) via REST\n`);
  } catch (err) {
    console.error(`❌ REST API test failed: ${err.message}\n`);
    process.exit(1);
  }

  // 4. Display REST results
  console.log("REST API Results:");
  console.log("─".repeat(80));

  const idToSymbol = Object.fromEntries(Object.entries(symbolToId).map(([k, v]) => [v, k]));

  for (const priceData of restPrices) {
    const symbol = idToSymbol[priceData.id] || priceData.id.substring(0, 10);
    const price = formatPrice(priceData.price.price, priceData.price.expo);
    const conf = formatPrice(priceData.price.conf, priceData.price.expo);
    const publishTime = priceData.price.publish_time;
    const stale = isStale(publishTime, PYTH_STALE_SECS);

    const staleMark = stale ? "⚠️  STALE" : "✓";
    const ageSeconds = Math.floor(Date.now() / 1000) - publishTime;

    console.log(`${symbol}:`);
    console.log(`  Price: ${price} ± ${conf}`);
    console.log(`  Published: ${new Date(publishTime * 1000).toISOString()} (${ageSeconds}s ago) ${staleMark}`);
    console.log("");
  }

  // 5. Test SSE streaming
  console.log("📡 Testing SSE streaming...\n");
  let sseUpdates = [];
  try {
    sseUpdates = await subscribeSSE(feedIds, 10000);
    console.log(`✅ Received ${sseUpdates.length} price update(s) via SSE\n`);
  } catch (err) {
    console.error(`❌ SSE test failed: ${err.message}\n`);
    // Don't exit - SSE is optional for some use cases
  }

  // 6. Display SSE results
  if (sseUpdates.length > 0) {
    console.log("SSE Streaming Results (sample):");
    console.log("─".repeat(80));

    // Group by feed ID and show latest update per asset
    const latestByFeed = {};
    for (const update of sseUpdates) {
      latestByFeed[update.id] = update;
    }

    for (const [feedId, priceData] of Object.entries(latestByFeed)) {
      const symbol = idToSymbol[feedId] || feedId.substring(0, 10);
      const price = formatPrice(priceData.price.price, priceData.price.expo);
      const conf = formatPrice(priceData.price.conf, priceData.price.expo);
      const publishTime = priceData.price.publish_time;

      console.log(`${symbol}:`);
      console.log(`  Price: ${price} ± ${conf}`);
      console.log(`  Published: ${new Date(publishTime * 1000).toISOString()}`);
      console.log("");
    }
  } else {
    console.log("⚠️  No SSE updates received during test period");
    console.log("   This may be normal if prices haven't changed recently\n");
  }

  // 7. Summary
  console.log("─".repeat(80));
  console.log("✅ Pyth connectivity check complete!\n");

  const staleCount = restPrices.filter((p) => isStale(p.price.publish_time, PYTH_STALE_SECS)).length;
  if (staleCount > 0) {
    console.log(`⚠️  ${staleCount} feed(s) exceeded staleness threshold of ${PYTH_STALE_SECS}s`);
    console.log("   Consider increasing PYTH_STALE_SECS or check feed availability\n");
  }

  console.log("Next steps:");
  console.log("  - Verify feed IDs match your target assets");
  console.log("  - Adjust PYTH_STALE_SECS based on your risk tolerance");
  console.log("  - Run check:oracles to compare with Chainlink and TWAP\n");
}

// Run main
main().catch((err) => {
  console.error("Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
