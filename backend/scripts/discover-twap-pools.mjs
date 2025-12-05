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
 *   TWAP_TARGETS=WETH,cbETH,WBTC node scripts/discover-twap-pools.mjs
 *   RPC_URL=https://mainnet.base.org node scripts/discover-twap-pools.mjs
 *
 * Environment variables:
 *   - RPC_URL: Base RPC endpoint (required)
 *   - TWAP_TARGETS: Comma-separated asset symbols to discover pools for
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
  AAVE: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", // Placeholder - update with actual
};

const FEE_TIERS = [500, 3000, 10000]; // 0.05%, 0.3%, 1%
const QUOTE_TOKENS = ["USDC", "WETH"]; // Common quote tokens for pairing

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
 * Format pool for output
 */
function formatPoolConfig(symbol, pool, quoteSymbol) {
  return {
    symbol,
    pool: pool.address,
    dex: "uniswap_v3",
    fee: pool.fee,
    quote: quoteSymbol,
    liquidity: pool.liquidity,
  };
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

  const targets = parseTargets(process.env.TWAP_TARGETS || "WETH,cbETH,WBTC");
  const aaveDataProvider =
    process.env.AAVE_PROTOCOL_DATA_PROVIDER ||
    "0xC4Fcf9893072d61Cc2899C0054877Cb752587981";
  const minLiquidity = BigInt(process.env.MIN_LIQUIDITY || "0");

  console.log("🔍 TWAP Pool Discovery for Base Network");
  console.log("=========================================\n");
  console.log(`RPC URL: ${rpcUrl}`);
  console.log(`Targets: ${targets.join(", ")}`);
  console.log(`Quote Tokens: ${QUOTE_TOKENS.join(", ")}`);
  console.log(`Fee Tiers: ${FEE_TIERS.join(", ")}\n`);

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
    for (const quoteSymbol of QUOTE_TOKENS) {
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

      for (const fee of FEE_TIERS) {
        const poolAddress = await discoverPool(
          factory,
          tokenAddress,
          quoteAddress,
          fee
        );
        if (!poolAddress) {
          continue;
        }

        const metrics = await getPoolMetrics(provider, poolAddress);
        if (!metrics) {
          continue;
        }

        // Filter by minimum liquidity
        if (BigInt(metrics.liquidity) < minLiquidity) {
          console.log(
            `  ⚠️  Pool ${poolAddress} (${quoteSymbol}, fee ${fee}) below min liquidity: ${metrics.liquidity}`
          );
          continue;
        }

        poolsForAsset.push({ ...metrics, quoteSymbol });
        console.log(
          `  ✅ Found pool: ${poolAddress} (${quoteSymbol}, fee ${fee}, liquidity: ${metrics.liquidity})`
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
  console.log("\n\n✨ TWAP_POOLS Configuration");
  console.log("=========================================\n");

  if (results.length === 0) {
    console.log("No pools discovered. Verify targets and RPC connectivity.");
  } else {
    const twapPoolsJson = JSON.stringify(results, null, 2);
    console.log(twapPoolsJson);
    console.log("\n\nReady to paste into .env:");
    console.log(`TWAP_POOLS='${JSON.stringify(results)}'`);
  }

  console.log("\n✅ Discovery complete\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
