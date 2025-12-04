#!/usr/bin/env node
/**
 * check-oracles.ts
 *
 * Validates Pyth, Chainlink, and TWAP oracle wiring end-to-end.
 * Reads configuration from .env and provides actionable diagnostics.
 *
 * Usage:
 *   npm run check:oracles
 *   npm run check:oracles -- --assets WETH,cbETH --verbose
 *   npm run check:oracles -- --window 600 --delta 0.02
 *
 * Exit codes:
 *   0 - All sources healthy and settings coherent
 *   1 - One or more failures detected
 */

import 'dotenv/config';
import { ethers } from 'ethers';

import { normalizeChainlinkPrice } from '../src/utils/chainlinkMath.js';

// CLI flags
interface CheckOraclesOptions {
  assets?: string;
  window?: number;
  delta?: number;
  verbose?: boolean;
}

interface PythPriceData {
  symbol: string;
  price: number;
  publishTime: number;
  confidence?: number;
  age: number;
  isStale: boolean;
}

interface ChainlinkPriceData {
  symbol: string;
  price: number;
  updatedAt: number;
  age: number;
  isStale: boolean;
  roundId: string;
}

interface TwapResult {
  symbol: string;
  pool: string;
  twapPrice: number | null;
  refPrice: number;
  delta: number | null;
  passed: boolean;
  error?: string;
}

// Pyth feed IDs for Base network
const PYTH_PRICE_FEED_IDS: Record<string, string> = {
  'WETH': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // ETH/USD
  'WBTC': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // BTC/USD
  'cbETH': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // ETH/USD (proxy)
  'USDC': '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a', // USDC/USD
  'cbBTC': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // BTC/USD (proxy)
  'AAVE': '0x2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445', // AAVE/USD
  'weETH': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // ETH/USD (proxy)
};

const UNISWAP_V3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function liquidity() external view returns (uint128)',
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)'
];

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

/**
 * Parse command line arguments
 */
function parseArgs(): CheckOraclesOptions {
  const args = process.argv.slice(2);
  const options: CheckOraclesOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--assets':
        options.assets = args[++i];
        break;
      case '--window':
        options.window = Number(args[++i]);
        break;
      case '--delta':
        options.delta = Number(args[++i]);
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      default:
        if (arg.startsWith('--')) {
          console.warn(`Unknown flag: ${arg}`);
        }
    }
  }

  return options;
}

/**
 * Validate Pyth price feeds
 */
async function checkPyth(assets: string[], staleSecs: number, verbose: boolean): Promise<PythPriceData[]> {
  const pythEnabled = process.env.PYTH_ENABLED?.toLowerCase() === 'true';
  const pythHttpUrl = process.env.PYTH_HTTP_URL || 'https://hermes.pyth.network';

  if (!pythEnabled) {
    console.log('⊘ Pyth: DISABLED (PYTH_ENABLED=false)');
    return [];
  }

  console.log(`\n━━━ Pyth Network Validation ━━━`);
  console.log(`HTTP URL: ${pythHttpUrl}`);
  console.log(`Assets: ${assets.join(', ')}`);
  console.log(`Staleness threshold: ${staleSecs}s\n`);

  const results: PythPriceData[] = [];

  for (const symbol of assets) {
    const feedId = PYTH_PRICE_FEED_IDS[symbol.toUpperCase()];
    if (!feedId) {
      console.log(`⚠️  ${symbol}: No Pyth feed ID configured`);
      continue;
    }

    try {
      // Query latest price from Pyth HTTP API
      const url = `${pythHttpUrl}/v2/updates/price/latest?ids[]=${feedId}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as {
        parsed?: Array<{
          id: string;
          price: { price: string; conf: string; expo: number; publish_time: number };
        }>;
      };

      if (!data.parsed || data.parsed.length === 0) {
        throw new Error('No price data in response');
      }

      const priceData = data.parsed[0].price;
      const price = Number(priceData.price) * Math.pow(10, priceData.expo);
      const confidence = Number(priceData.conf) * Math.pow(10, priceData.expo);
      const publishTime = priceData.publish_time;

      const now = Math.floor(Date.now() / 1000);
      const age = now - publishTime;
      const isStale = age > staleSecs;

      results.push({
        symbol,
        price,
        publishTime,
        confidence,
        age,
        isStale
      });

      const status = isStale ? '⚠️ ' : '✅';
      console.log(
        `${status} ${symbol}: $${price.toFixed(2)} ` +
        `(age: ${age}s, conf: ±$${confidence.toFixed(2)})${isStale ? ' STALE' : ''}`
      );

      if (verbose) {
        console.log(`   Feed ID: ${feedId}`);
        console.log(`   Publish time: ${new Date(publishTime * 1000).toISOString()}`);
      }
    } catch (error) {
      console.log(`❌ ${symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      results.push({
        symbol,
        price: 0,
        publishTime: 0,
        age: Infinity,
        isStale: true
      });
    }
  }

  return results;
}

/**
 * Validate Chainlink price feeds
 */
async function checkChainlink(
  provider: ethers.JsonRpcProvider,
  verbose: boolean
): Promise<ChainlinkPriceData[]> {
  const feedsEnv = process.env.CHAINLINK_FEEDS;
  const staleSecs = Number(process.env.PRICE_STALENESS_SEC || 900);

  if (!feedsEnv) {
    console.log('⊘ Chainlink: No feeds configured (CHAINLINK_FEEDS not set)');
    return [];
  }

  console.log(`\n━━━ Chainlink Feed Validation ━━━`);
  console.log(`Staleness threshold: ${staleSecs}s\n`);

  const feeds = feedsEnv.split(',').map(pair => {
    const [symbol, address] = pair.split(':').map(s => s.trim());
    return { symbol: symbol.toUpperCase(), address };
  });

  const results: ChainlinkPriceData[] = [];
  const aggregatorAbi = [
    'function decimals() view returns (uint8)',
    'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
  ];

  for (const feed of feeds) {
    try {
      const contract = new ethers.Contract(feed.address, aggregatorAbi, provider);
      const decimals = await contract.decimals();
      const roundData = await contract.latestRoundData();

      const roundId = roundData.roundId.toString();
      const rawAnswer = roundData.answer;
      const updatedAt = Number(roundData.updatedAt);

      if (rawAnswer <= 0n) {
        throw new Error('Invalid non-positive answer');
      }

      const price = normalizeChainlinkPrice(rawAnswer, decimals);
      const now = Math.floor(Date.now() / 1000);
      const age = now - updatedAt;
      const isStale = age > staleSecs;

      results.push({
        symbol: feed.symbol,
        price,
        updatedAt,
        age,
        isStale,
        roundId
      });

      const status = isStale ? '⚠️ ' : '✅';
      console.log(
        `${status} ${feed.symbol}: $${price.toFixed(2)} ` +
        `(age: ${age}s)${isStale ? ' STALE' : ''}`
      );

      if (verbose) {
        console.log(`   Feed: ${feed.address}`);
        console.log(`   Round ID: ${roundId}`);
        console.log(`   Updated: ${new Date(updatedAt * 1000).toISOString()}`);
      }
    } catch (error) {
      console.log(`❌ ${feed.symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      results.push({
        symbol: feed.symbol,
        price: 0,
        updatedAt: 0,
        age: Infinity,
        isStale: true,
        roundId: '0'
      });
    }
  }

  return results;
}

/**
 * Validate TWAP pools
 */
async function checkTwap(
  provider: ethers.JsonRpcProvider,
  chainlinkResults: ChainlinkPriceData[],
  pythResults: PythPriceData[],
  windowSec: number,
  maxDeltaPct: number,
  verbose: boolean
): Promise<TwapResult[]> {
  const twapEnabled = process.env.TWAP_ENABLED?.toLowerCase() === 'true';
  const twapPoolsEnv = process.env.TWAP_POOLS;

  if (!twapEnabled) {
    console.log('⊘ TWAP: DISABLED (TWAP_ENABLED=false)');
    return [];
  }

  if (!twapPoolsEnv) {
    console.log('⊘ TWAP: No pools configured (TWAP_POOLS not set)');
    return [];
  }

  console.log(`\n━━━ TWAP Validation ━━━`);
  console.log(`Window: ${windowSec}s`);
  console.log(`Max delta: ${(maxDeltaPct * 100).toFixed(2)}%\n`);

  let pools: Array<{ symbol: string; pool: string; dex: string }>;
  try {
    pools = JSON.parse(twapPoolsEnv);
  } catch (error) {
    console.log('❌ TWAP: Failed to parse TWAP_POOLS JSON');
    return [];
  }

  const results: TwapResult[] = [];

  for (const poolConfig of pools) {
    const { symbol, pool } = poolConfig;

    try {
      // Get reference price (prefer Chainlink, fallback to Pyth)
      let refPrice = 0;
      const chainlinkPrice = chainlinkResults.find(r => r.symbol === symbol.toUpperCase());
      const pythPrice = pythResults.find(r => r.symbol === symbol.toUpperCase());

      if (chainlinkPrice && chainlinkPrice.price > 0) {
        refPrice = chainlinkPrice.price;
      } else if (pythPrice && pythPrice.price > 0) {
        refPrice = pythPrice.price;
      } else {
        throw new Error('No reference price available');
      }

      // Compute TWAP
      const twapPrice = await computeUniswapV3Twap(provider, pool, windowSec, verbose);

      if (twapPrice === null) {
        results.push({
          symbol,
          pool,
          twapPrice: null,
          refPrice,
          delta: null,
          passed: true, // Pass by default if no data
          error: 'Insufficient swap data'
        });
        console.log(`⊘ ${symbol}: Insufficient swap data in ${windowSec}s window`);
        continue;
      }

      const delta = Math.abs(twapPrice - refPrice) / refPrice;
      const passed = delta <= maxDeltaPct;

      results.push({
        symbol,
        pool,
        twapPrice,
        refPrice,
        delta,
        passed
      });

      const status = passed ? '✅' : '❌';
      console.log(
        `${status} ${symbol}: TWAP=$${twapPrice.toFixed(2)} vs Ref=$${refPrice.toFixed(2)} ` +
        `(delta: ${(delta * 100).toFixed(2)}%)`
      );

      if (verbose) {
        console.log(`   Pool: ${pool}`);
      }
    } catch (error) {
      console.log(`❌ ${symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      results.push({
        symbol,
        pool,
        twapPrice: null,
        refPrice: 0,
        delta: null,
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return results;
}

/**
 * Compute Uniswap V3 TWAP from swap events
 */
async function computeUniswapV3Twap(
  provider: ethers.JsonRpcProvider,
  poolAddress: string,
  windowSec: number,
  verbose: boolean
): Promise<number | null> {
  const pool = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, provider);
  const currentBlock = await provider.getBlockNumber();

  // Estimate blocks for time window (assuming ~2 second block time on Base)
  const blocksPerWindow = Math.ceil(windowSec / 2);
  const fromBlock = Math.max(1, currentBlock - blocksPerWindow);

  // Fetch token info for decimals
  const token0Address = await pool.token0();
  const token1Address = await pool.token1();
  const token0 = new ethers.Contract(token0Address, ERC20_ABI, provider);
  const token1 = new ethers.Contract(token1Address, ERC20_ABI, provider);
  const token0Decimals = await token0.decimals();
  const token1Decimals = await token1.decimals();

  // Fetch Swap events
  const filter = pool.filters.Swap();
  const events = await pool.queryFilter(filter, fromBlock, currentBlock);

  if (events.length === 0) {
    if (verbose) {
      console.log(`   No swap events in last ${windowSec}s`);
    }
    return null;
  }

  // Filter events within time window and compute TWAP
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSec;
  const blockTimestamps = new Map<number, number>();

  let totalWeightedPrice = 0;
  let totalWeight = 0;

  for (const event of events) {
    const blockNumber = event.blockNumber;

    // Fetch block timestamp if not cached
    if (!blockTimestamps.has(blockNumber)) {
      const block = await provider.getBlock(blockNumber);
      if (block) {
        blockTimestamps.set(blockNumber, block.timestamp);
      }
    }

    const timestamp = blockTimestamps.get(blockNumber);
    if (!timestamp || timestamp < windowStart) {
      continue;
    }

    // Parse swap amounts
    if (!('args' in event)) {
      continue;
    }

    const amount0 = event.args?.amount0;
    const amount1 = event.args?.amount1;

    if (!amount0 || !amount1) {
      continue;
    }

    // Compute price from swap
    const absAmount0 = Math.abs(Number(ethers.formatUnits(amount0, token0Decimals)));
    const absAmount1 = Math.abs(Number(ethers.formatUnits(amount1, token1Decimals)));

    if (absAmount0 === 0 || absAmount1 === 0) {
      continue;
    }

    // Price of token0 in terms of token1
    const swapPrice = absAmount1 / absAmount0;
    const volumeUsd = absAmount1; // Assume token1 is quote currency (e.g., USDC)

    totalWeightedPrice += swapPrice * volumeUsd;
    totalWeight += volumeUsd;
  }

  if (totalWeight === 0) {
    return null;
  }

  const twap = totalWeightedPrice / totalWeight;
  if (verbose) {
    console.log(`   Processed ${events.length} swap events, TWAP=$${twap.toFixed(2)}`);
  }
  return twap;
}

/**
 * Main function
 */
async function main() {
  console.log('🔍 Oracle Validation Tool\n');

  const options = parseArgs();

  // Determine assets to check
  const assetsStr = options.assets || process.env.PYTH_ASSETS || 'WETH,cbETH,cbBTC,weETH';
  const assets = assetsStr.split(',').map(s => s.trim().toUpperCase());

  // Get configuration
  const staleSecs = Number(process.env.PYTH_STALE_SECS || 10);
  const windowSec = options.window || Number(process.env.TWAP_WINDOW_SEC || 300);
  const maxDeltaPct = options.delta || Number(process.env.TWAP_DELTA_PCT || 0.012);
  const verbose = options.verbose || false;

  // Initialize provider
  const rpcUrl = process.env.RPC_URL || process.env.CHAINLINK_RPC_URL;
  if (!rpcUrl) {
    console.error('❌ Error: RPC_URL or CHAINLINK_RPC_URL must be set');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  try {
    // Check connectivity
    const blockNumber = await provider.getBlockNumber();
    console.log(`✅ RPC connected: Block ${blockNumber}\n`);
  } catch (error) {
    console.error(`❌ RPC connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }

  // Run validations
  const pythResults = await checkPyth(assets, staleSecs, verbose);
  const chainlinkResults = await checkChainlink(provider, verbose);
  const twapResults = await checkTwap(provider, chainlinkResults, pythResults, windowSec, maxDeltaPct, verbose);

  // Generate summary
  console.log(`\n━━━ Summary ━━━\n`);

  const pythFailed = pythResults.filter(r => r.isStale || r.price === 0).length;
  const chainlinkFailed = chainlinkResults.filter(r => r.isStale || r.price === 0).length;
  const twapFailed = twapResults.filter(r => !r.passed).length;

  console.log(`Pyth: ${pythResults.length} checked, ${pythFailed} failed/stale`);
  console.log(`Chainlink: ${chainlinkResults.length} checked, ${chainlinkFailed} failed/stale`);
  console.log(`TWAP: ${twapResults.length} checked, ${twapFailed} failed\n`);

  const overallPass = pythFailed === 0 && chainlinkFailed === 0 && twapFailed === 0;

  if (overallPass) {
    console.log('✅ All oracle sources PASSED');
    process.exit(0);
  } else {
    console.log('❌ One or more oracle sources FAILED');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`\n❌ Fatal error: ${err instanceof Error ? err.message : 'Unknown error'}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
