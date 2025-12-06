#!/usr/bin/env node
/**
 * discover-twap-pools.mjs
 *
 * Discovers and ranks Uniswap V3 pools for TWAP oracle usage on Base.
 *
 * Purpose:
 * - Resolves token addresses from symbols (via curated list or Aave Protocol Data Provider)
 * - Queries Uniswap V3 Factory for pools vs common quote tokens (USDC, WETH)
 * - Ranks pools by liquidity metrics (sqrtPriceX96, liquidity)
 * - Outputs ready-to-paste TWAP_POOLS JSON string
 *
 * Usage:
 *   node scripts/discover-twap-pools.mjs
 *   node scripts/discover-twap-pools.mjs --assets WETH,cbETH --quotes USDC,WETH --feeTiers 500,3000
 *   RPC_URL=https://mainnet.base.org node scripts/discover-twap-pools.mjs
 *
 * CLI Options:
 *   --assets: Comma-separated asset symbols to discover pools for (overrides TWAP_TARGETS env var)
 *   --quotes: Comma-separated quote token symbols (default: USDC,WETH)
 *   --feeTiers: Comma-separated fee tiers in bps (default: 500,3000,10000)
 *   --timeoutMs: Timeout in milliseconds for RPC requests (default: 10000)
 *
 * Environment variables:
 *   - RPC_URL: Base RPC endpoint (required)
 *   - TWAP_TARGETS: Comma-separated asset symbols to discover pools for (default: WETH,cbETH,cbBTC,weETH)
 *   - AAVE_PROTOCOL_DATA_PROVIDER: Aave Protocol Data Provider address
 *   - MIN_LIQUIDITY: Minimum pool liquidity threshold (default: 0)
 */

import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

// Base network configuration
const UNISWAP_V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD"; // Uniswap V3 Factory on Base
const BASE_TOKENS = {
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  USDbC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
  DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
  cbETH: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
  WBTC: "0x1a35EE4640b0A3B87705B0A4B45D227Ba60Ca2ad", // WBTC on Base
  cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // Coinbase Wrapped BTC
  weETH: "0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A", // Wrapped eETH
  AAVE: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", // Placeholder - update with actual
};

const DEFAULT_FEE_TIERS = [500, 3000, 10000]; // 0.05%, 0.3%, 1%
const DEFAULT_QUOTE_TOKENS = ["USDC", "WETH"]; // Common quote tokens for pairing
const DEFAULT_TARGETS = ["WETH", "cbETH", "cbBTC", "weETH"]; // Base-native assets

// ABIs
const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
];

const POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
];

const AAVE_PROTOCOL_DATA_PROVIDER_ABI = [
  "function getAllReservesTokens() view returns (tuple(string symbol, address tokenAddress)[])",
];

/**
 * Parse comma-separated list of asset symbols
 */
function parseTargets(targetsEnv) {
  if (!targetsEnv || !targetsEnv.trim()) {
    return [];
  }
  return targetsEnv
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
}

/**
 * Parse command-line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    assets: null,
    quotes: null,
    feeTiers: null,
    timeoutMs: 10000,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (key === "assets" && value) {
        options.assets = parseTargets(value);
        i++;
      } else if (key === "quotes" && value) {
        options.quotes = parseTargets(value);
        i++;
      } else if (key === "feeTiers" && value) {
        options.feeTiers = value.split(",").map((f) => parseInt(f.trim(), 10));
        i++;
      } else if (key === "timeoutMs" && value) {
        options.timeoutMs = parseInt(value, 10);
        i++;
      }
    }
  }

  return options;
}

/**
 * Resolve token address from symbol
 */
async function resolveTokenAddress(provider, symbol, aaveDataProviderAddress) {
  // Check curated list first
  if (BASE_TOKENS[symbol]) {
    return BASE_TOKENS[symbol];
  }

  // Try Aave Protocol Data Provider if available
  if (aaveDataProviderAddress) {
    try {
      const dataProvider = new ethers.Contract(
        aaveDataProviderAddress,
        AAVE_PROTOCOL_DATA_PROVIDER_ABI,
        provider
      );
      const reserves = await dataProvider.getAllReservesTokens();
      const match = reserves.find((r) => r.symbol.toUpperCase() === symbol);
      if (match) {
        return match.tokenAddress;
      }
    } catch (err) {
      console.warn(
        `Warning: Failed to query Aave Data Provider for ${symbol}: ${err.message}`
      );
    }
  }

  return null;
}

/**
 * Discover pool for token pair and fee tier
 */
async function discoverPool(factory, token0, token1, fee) {
  try {
    const poolAddress = await factory.getPool(token0, token1, fee);
    if (poolAddress === ethers.ZeroAddress) {
      return null;
    }
    return poolAddress;
  } catch (err) {
    console.warn(
      `Warning: Failed to query pool for ${token0}/${token1} fee ${fee}: ${err.message}`
    );
    return null;
  }
}

/**
 * Get pool metrics
 */
async function getPoolMetrics(provider, poolAddress) {
  try {
    const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
    const [token0, token1, fee, liquidity, slot0] = await Promise.all([
      pool.token0(),
      pool.token1(),
      pool.fee(),
      pool.liquidity(),
      pool.slot0(),
    ]);

    return {
      address: poolAddress,
      token0,
      token1,
      fee,
      liquidity: liquidity.toString(),
      sqrtPriceX96: slot0.sqrtPriceX96.toString(),
      tick: slot0.tick,
      observationCardinality: slot0.observationCardinality,
    };
  } catch (err) {
    console.warn(
      `Warning: Failed to fetch metrics for pool ${poolAddress}: ${err.message}`
    );
    return null;
  }
}

/**
 * Rank pools by liquidity
 */
function rankPools(pools) {
  return pools.sort((a, b) => {
    const aLiq = BigInt(a.liquidity);
    const bLiq = BigInt(b.liquidity);
    if (aLiq > bLiq) return -1;
    if (aLiq < bLiq) return 1;
    return 0;
  });
}

/**
 * Format pool for output (with BigInt serialization fix)
 */
function formatPoolConfig(symbol, pool, quoteSymbol) {
  return {
    symbol,
    pool: pool.address,
    dex: "uniswap_v3",
    fee: pool.fee,
    quote: quoteSymbol,
  };
}

/**
 * Custom JSON serializer to handle BigInt values
 */
function safeStringify(obj, indent = 2) {
  return JSON.stringify(
    obj,
    (key, value) => (typeof value === "bigint" ? value.toString() : value),
    indent
  );
}

/**
 * Main discovery logic
 */
async function main() {
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    console.error("Error: RPC_URL environment variable is required");
    process.exit(1);
  }

  // Parse CLI arguments
  const cliOptions = parseArgs();
  
  // Determine targets: CLI > env var > default
  let targets = cliOptions.assets;
  if (!targets || targets.length === 0) {
    const envTargets = parseTargets(process.env.TWAP_TARGETS);
    targets = envTargets.length > 0 ? envTargets : DEFAULT_TARGETS;
  }
  
  // Determine quote tokens: CLI > default
  const quoteTokens = cliOptions.quotes || DEFAULT_QUOTE_TOKENS;
  
  // Determine fee tiers: CLI > default
  const feeTiers = cliOptions.feeTiers || DEFAULT_FEE_TIERS;
  
  const aaveDataProvider =
    process.env.AAVE_PROTOCOL_DATA_PROVIDER ||
    "0xC4Fcf9893072d61Cc2899C0054877Cb752587981";
  const minLiquidity = BigInt(process.env.MIN_LIQUIDITY || "0");

  console.log("🔍 TWAP Pool Discovery for Base Network");
  console.log("=========================================\n");
  console.log(`RPC URL: ${rpcUrl}`);
  console.log(`Targets: ${targets.join(", ")}`);
  console.log(`Quote Tokens: ${quoteTokens.join(", ")}`);
  console.log(`Fee Tiers: ${feeTiers.join(", ")}`);
  console.log(`Timeout: ${cliOptions.timeoutMs}ms\n`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const factory = new ethers.Contract(
    UNISWAP_V3_FACTORY,
    FACTORY_ABI,
    provider
  );

  const results = [];

  for (const symbol of targets) {
    console.log(`\n📊 Discovering pools for ${symbol}...`);
    console.log("-".repeat(60));

    // Resolve token address
    const tokenAddress = await resolveTokenAddress(
      provider,
      symbol,
      aaveDataProvider
    );
    if (!tokenAddress) {
      console.log(`❌ Failed to resolve address for ${symbol}`);
      continue;
    }
    console.log(`Token Address: ${tokenAddress}`);

    const poolsForAsset = [];

    // Check all quote tokens and fee tiers
    for (const quoteSymbol of quoteTokens) {
      const quoteAddress = BASE_TOKENS[quoteSymbol];
      if (!quoteAddress) {
        console.warn(
          `Warning: Quote token ${quoteSymbol} address not found, skipping`
        );
        continue;
      }

      // Skip self-pairs
      if (
        tokenAddress.toLowerCase() === quoteAddress.toLowerCase()
      ) {
        continue;
      }

      console.log(`  Checking ${symbol}/${quoteSymbol} pools...`);

      for (const fee of feeTiers) {
        const poolAddress = await discoverPool(
          factory,
          tokenAddress,
          quoteAddress,
          fee
        );
        if (!poolAddress) {
          console.log(`    Fee ${fee}: No pool found`);
          continue;
        }

        const metrics = await getPoolMetrics(provider, poolAddress);
        if (!metrics) {
          console.log(`    Fee ${fee}: Failed to fetch metrics`);
          continue;
        }

        // Filter by minimum liquidity
        if (BigInt(metrics.liquidity) < minLiquidity) {
          console.log(
            `    Fee ${fee}: Below min liquidity (${metrics.liquidity})`
          );
          continue;
        }

        poolsForAsset.push({ ...metrics, quoteSymbol });
        console.log(
          `    ✅ Fee ${fee}: Found pool ${poolAddress.slice(0, 10)}... (liquidity: ${metrics.liquidity})`
        );
      }
    }

    if (poolsForAsset.length === 0) {
      console.log(`❌ No pools found for ${symbol}`);
      continue;
    }

    // Rank pools by liquidity
    const rankedPools = rankPools(poolsForAsset);
    const bestPool = rankedPools[0];

    console.log(`\n  🏆 Best pool for ${symbol}:`);
    console.log(`     Address: ${bestPool.address}`);
    console.log(`     Quote: ${bestPool.quoteSymbol}`);
    console.log(`     Fee: ${bestPool.fee}`);
    console.log(`     Liquidity: ${bestPool.liquidity}`);
    console.log(
      `     Observation Cardinality: ${bestPool.observationCardinality}`
    );

    results.push(formatPoolConfig(symbol, bestPool, bestPool.quoteSymbol));
  }

  // Output final TWAP_POOLS configuration
  console.log("\n\n✨ TWAP Pool Discovery Summary");
  console.log("=========================================\n");

  if (results.length === 0) {
    console.log("No pools discovered. Verify targets and RPC connectivity.");
  } else {
    console.log("Discovered pools:\n");
    for (const result of results) {
      console.log(`  ${result.symbol}:`);
      console.log(`    Address: ${result.pool}`);
      console.log(`    Quote: ${result.quote}`);
      console.log(`    Fee: ${result.fee}`);
      console.log("");
    }
    
    console.log("\n✅ Ready-to-paste TWAP_POOLS configuration:\n");
    const twapPoolsString = safeStringify(results);
    console.log(`TWAP_POOLS='${JSON.stringify(results)}'`);
  }

  console.log("\n✅ Discovery complete\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
