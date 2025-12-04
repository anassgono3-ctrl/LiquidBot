#!/usr/bin/env node
/**
 * discover-twap-pools.mjs
 *
 * Discovers liquid Uniswap v3 pools on Base for TWAP oracle integration.
 * Queries pools against USDC and WETH across multiple fee tiers and ranks by liquidity.
 *
 * Usage:
 *   npm run discover:twap
 *   TWAP_TARGET_ASSETS=WETH,cbETH,USDC npm run discover:twap
 *
 * Environment variables:
 *   - RPC_URL: Base RPC endpoint (required)
 *   - TWAP_TARGET_ASSETS: Comma-separated asset symbols (defaults to PYTH_ASSETS or "WETH,USDC,cbETH")
 *   - PYTH_ASSETS: Fallback if TWAP_TARGET_ASSETS not set
 *
 * Outputs:
 *   - Console: Ready-to-paste TWAP_POOLS string for .env
 *   - File: scripts/output/twap_pools.json with detailed pool data
 */

import { ethers } from "ethers";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Uniswap V3 Factory address on Base
const UNISWAP_V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";

// Fee tiers to check (in basis points: 500 = 0.05%, 3000 = 0.30%, 10000 = 1.00%)
const FEE_TIERS = [500, 3000, 10000];

// Known token addresses on Base
const BASE_TOKENS = {
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  USDbC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
  DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
  cbETH: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
  wstETH: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
  AAVE: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", // Note: This is actually the Aave Pool address, not AAVE token
};

// Quote tokens to pair against (USDC and WETH are most liquid)
const QUOTE_TOKENS = ["USDC", "WETH"];

// ABIs
const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
];

const POOL_ABI = [
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
];

/**
 * Parse asset symbols from environment
 */
function parseAssets() {
  const assetsEnv =
    process.env.TWAP_TARGET_ASSETS || process.env.PYTH_ASSETS || "WETH,USDC,cbETH";
  return assetsEnv.split(",").map((s) => s.trim().toUpperCase());
}

/**
 * Resolve token symbol to address
 */
function resolveTokenAddress(symbol) {
  const addr = BASE_TOKENS[symbol];
  if (!addr) {
    console.warn(`Warning: Unknown token symbol "${symbol}", skipping`);
    return null;
  }
  return addr;
}

/**
 * Get pool address from factory
 */
async function getPoolAddress(provider, factory, token0, token1, fee) {
  try {
    const poolAddress = await factory.getPool(token0, token1, fee);
    if (poolAddress === ethers.ZeroAddress) {
      return null;
    }
    return poolAddress;
  } catch (err) {
    console.warn(`Warning: Failed to get pool for ${token0}/${token1} fee ${fee}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch pool liquidity and slot0 data
 */
async function getPoolData(provider, poolAddress) {
  try {
    const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);

    const [liquidity, slot0, token0, token1, fee] = await Promise.all([
      pool.liquidity(),
      pool.slot0(),
      pool.token0(),
      pool.token1(),
      pool.fee(),
    ]);

    return {
      address: poolAddress,
      liquidity: liquidity.toString(),
      sqrtPriceX96: slot0.sqrtPriceX96.toString(),
      tick: slot0.tick,
      observationCardinality: slot0.observationCardinality,
      token0,
      token1,
      fee: Number(fee),
    };
  } catch (err) {
    console.warn(`Warning: Failed to fetch pool data for ${poolAddress}: ${err.message}`);
    return null;
  }
}

/**
 * Main discovery logic
 */
async function main() {
  console.log("🔍 Discovering Uniswap V3 pools on Base for TWAP integration...\n");

  // 1. Check RPC URL
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    console.error("Error: RPC_URL not set in environment");
    process.exit(1);
  }

  // 2. Connect to provider
  let provider;
  try {
    provider = new ethers.JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    console.log(`✅ Connected to network: ${network.name} (chainId: ${network.chainId})\n`);
  } catch (err) {
    console.error(`Error: Failed to connect to RPC: ${err.message}`);
    process.exit(1);
  }

  // 3. Parse target assets
  const targetAssets = parseAssets();
  console.log(`Target assets: ${targetAssets.join(", ")}\n`);

  // 4. Initialize factory contract
  const factory = new ethers.Contract(UNISWAP_V3_FACTORY, FACTORY_ABI, provider);

  // 5. Discover pools
  const pools = [];

  for (const assetSymbol of targetAssets) {
    const assetAddress = resolveTokenAddress(assetSymbol);
    if (!assetAddress) continue;

    console.log(`📊 Checking pools for ${assetSymbol} (${assetAddress})...`);

    for (const quoteSymbol of QUOTE_TOKENS) {
      // Skip if asset is the same as quote
      if (assetSymbol === quoteSymbol) continue;

      const quoteAddress = resolveTokenAddress(quoteSymbol);
      if (!quoteAddress) continue;

      for (const fee of FEE_TIERS) {
        const poolAddress = await getPoolAddress(
          provider,
          factory,
          assetAddress,
          quoteAddress,
          fee
        );

        if (poolAddress) {
          console.log(
            `  ✓ Found pool: ${assetSymbol}/${quoteSymbol} (fee: ${fee / 10000}%) at ${poolAddress}`
          );

          const poolData = await getPoolData(provider, poolAddress);
          if (poolData) {
            pools.push({
              asset: assetSymbol,
              quote: quoteSymbol,
              feePercent: fee / 10000,
              ...poolData,
            });
          }
        }
      }
    }
    console.log("");
  }

  // 6. Rank pools by liquidity
  pools.sort((a, b) => {
    const liquidityA = BigInt(a.liquidity);
    const liquidityB = BigInt(b.liquidity);
    return liquidityB > liquidityA ? 1 : liquidityB < liquidityA ? -1 : 0;
  });

  // 7. Output results
  if (pools.length === 0) {
    console.log("⚠️  No pools found. Check your RPC connection and target assets.");
    process.exit(0);
  }

  console.log(`\n📈 Found ${pools.length} pool(s), ranked by liquidity:\n`);

  // Display top pools
  const topPools = pools.slice(0, 10);
  topPools.forEach((pool, idx) => {
    const liquidityETH = (BigInt(pool.liquidity) / BigInt(1e18)).toString();
    console.log(
      `${idx + 1}. ${pool.asset}/${pool.quote} (${pool.feePercent}%) - Liquidity: ${liquidityETH} (raw: ${pool.liquidity})`
    );
    console.log(`   Address: ${pool.address}`);
    console.log(`   Cardinality: ${pool.observationCardinality}`);
  });

  // 8. Generate .env TWAP_POOLS string
  console.log("\n📋 Suggested TWAP_POOLS configuration for .env:\n");
  const twapPoolsString = pools
    .map((pool) => `${pool.asset}:${pool.address}:${pool.fee}`)
    .join(",");
  console.log(`TWAP_POOLS=${twapPoolsString}\n`);

  // 9. Save detailed output to JSON
  const outputPath = `${__dirname}/output/twap_pools.json`;
  try {
    mkdirSync(`${__dirname}/output`, { recursive: true });
    const output = {
      discoveredAt: new Date().toISOString(),
      network: {
        chainId: (await provider.getNetwork()).chainId.toString(),
        rpcUrl: rpcUrl.replace(/\/\/.*@/, "//[REDACTED]@"), // Hide API keys
      },
      targetAssets,
      poolCount: pools.length,
      pools: pools.map((pool) => ({
        asset: pool.asset,
        quote: pool.quote,
        feePercent: pool.feePercent,
        address: pool.address,
        liquidity: pool.liquidity,
        token0: pool.token0,
        token1: pool.token1,
        tick: pool.tick,
        observationCardinality: pool.observationCardinality,
      })),
      envString: twapPoolsString,
    };

    writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`💾 Detailed pool data saved to: ${outputPath}\n`);
  } catch (err) {
    console.warn(`Warning: Failed to save output file: ${err.message}`);
  }

  console.log("✅ Discovery complete!");
}

// Run main
main().catch((err) => {
  console.error("Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
