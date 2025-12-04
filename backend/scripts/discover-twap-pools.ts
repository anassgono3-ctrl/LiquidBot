#!/usr/bin/env node
/**
 * discover-twap-pools.ts
 *
 * Discovers and recommends TWAP pools for specified Base assets.
 * Queries Uniswap V3 factory, filters by liquidity, and outputs ready-to-paste TWAP_POOLS config.
 *
 * Usage:
 *   npm run discover:twap
 *   npm run discover:twap -- --symbols WETH,cbETH,cbBTC,weETH
 *   npm run discover:twap -- --quotes USDC,WETH --fees 500,3000,10000 --min-liquidity 100000
 *
 * Exit codes:
 *   0 - Success (pools found or suggestions provided)
 *   1 - Fatal error (connectivity, config issues)
 */

import 'dotenv/config';
import { ethers } from 'ethers';

// Uniswap V3 Factory on Base
const UNISWAP_V3_FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

// Well-known token addresses on Base
const TOKEN_ADDRESSES: Record<string, string> = {
  'WETH': '0x4200000000000000000000000000000000000006',
  'USDC': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'cbETH': '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
  'cbBTC': '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
  'weETH': '0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A',
  'AAVE': '0x4e033A7fF228d2dd8424C9Ab3Aa2F869B69a8a26',
  'WBTC': '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c',
};

const UNISWAP_V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'
];

const UNISWAP_V3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function liquidity() external view returns (uint128)',
  'function fee() external view returns (uint24)'
];

interface DiscoveryOptions {
  symbols?: string[];
  quotes?: string[];
  fees?: number[];
  minLiquidity?: number;
  verbose?: boolean;
}

interface PoolInfo {
  symbol: string;
  pool: string;
  quote: string;
  fee: number;
  liquidity: string;
  tvlUsd: number | null;
  token0IsAsset: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): DiscoveryOptions {
  const args = process.argv.slice(2);
  const options: DiscoveryOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--symbols':
        options.symbols = args[++i].split(',').map(s => s.trim().toUpperCase());
        break;
      case '--quotes':
        options.quotes = args[++i].split(',').map(s => s.trim().toUpperCase());
        break;
      case '--fees':
        options.fees = args[++i].split(',').map(s => Number(s.trim()));
        break;
      case '--min-liquidity':
        options.minLiquidity = Number(args[++i]);
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
 * Discover pools for a given token pair and fee tier
 */
async function discoverPool(
  provider: ethers.JsonRpcProvider,
  factory: ethers.Contract,
  tokenSymbol: string,
  quoteSymbol: string,
  fee: number,
  verbose: boolean
): Promise<PoolInfo | null> {
  const tokenAddress = TOKEN_ADDRESSES[tokenSymbol];
  const quoteAddress = TOKEN_ADDRESSES[quoteSymbol];

  if (!tokenAddress || !quoteAddress) {
    if (verbose) {
      console.log(`⊘ ${tokenSymbol}/${quoteSymbol}: Token address not found`);
    }
    return null;
  }

  try {
    // Get pool address from factory
    const poolAddress = await factory.getPool(tokenAddress, quoteAddress, fee);

    if (poolAddress === ethers.ZeroAddress) {
      if (verbose) {
        console.log(`⊘ ${tokenSymbol}/${quoteSymbol} (fee=${fee}): Pool does not exist`);
      }
      return null;
    }

    // Query pool details
    const pool = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, provider);
    const [liquidity, token0Address] = await Promise.all([
      pool.liquidity(),
      pool.token0()
    ]);

    const liquidityStr = liquidity.toString();

    // Determine if token0 is the asset (vs quote)
    const token0IsAsset = token0Address.toLowerCase() === tokenAddress.toLowerCase();

    // Estimate TVL (simplified - just use liquidity as proxy)
    // For accurate TVL, we'd need to compute reserves and multiply by prices
    const tvlUsd: number | null = null;

    if (verbose) {
      console.log(
        `✓ ${tokenSymbol}/${quoteSymbol} (fee=${fee}): ` +
        `Pool=${poolAddress.slice(0, 10)}... Liquidity=${liquidityStr}`
      );
    }

    return {
      symbol: tokenSymbol,
      pool: poolAddress,
      quote: quoteSymbol,
      fee,
      liquidity: liquidityStr,
      tvlUsd,
      token0IsAsset
    };
  } catch (error) {
    if (verbose) {
      console.log(
        `⊘ ${tokenSymbol}/${quoteSymbol} (fee=${fee}): ` +
        `${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
    return null;
  }
}

/**
 * Rank pools by liquidity
 */
function rankPools(pools: PoolInfo[]): PoolInfo[] {
  return pools.sort((a, b) => {
    // Sort by liquidity (descending)
    const liquidityA = BigInt(a.liquidity);
    const liquidityB = BigInt(b.liquidity);
    
    if (liquidityA > liquidityB) return -1;
    if (liquidityA < liquidityB) return 1;
    
    // If liquidity is equal, prefer USDC over WETH
    if (a.quote === 'USDC' && b.quote !== 'USDC') return -1;
    if (a.quote !== 'USDC' && b.quote === 'USDC') return 1;
    
    return 0;
  });
}

/**
 * Format pool config for TWAP_POOLS
 */
function formatTwapPools(pools: PoolInfo[]): string {
  const configs = pools.map(pool => {
    return `{"symbol":"${pool.symbol}","pool":"${pool.pool}","dex":"uniswap_v3","token0IsAsset":${pool.token0IsAsset}}`;
  });
  
  return `[${configs.join(',')}]`;
}

/**
 * Format ready-to-paste output
 */
function formatOutput(pools: PoolInfo[]): void {
  console.log(`\n━━━ TWAP Pool Recommendations ━━━\n`);

  if (pools.length === 0) {
    console.log('⊘ No pools found with sufficient liquidity\n');
    console.log('Suggestions:');
    console.log('  - Use Chainlink direct USD feeds for these assets');
    console.log('  - Lower --min-liquidity threshold');
    console.log('  - Try different quote currencies or fee tiers\n');
    return;
  }

  // Group by symbol
  const bySymbol = new Map<string, PoolInfo[]>();
  for (const pool of pools) {
    if (!bySymbol.has(pool.symbol)) {
      bySymbol.set(pool.symbol, []);
    }
    bySymbol.get(pool.symbol)!.push(pool);
  }

  // Print best pool per symbol
  console.log('Best pools per asset:\n');
  const bestPools: PoolInfo[] = [];

  for (const [symbol, symbolPools] of bySymbol) {
    const ranked = rankPools(symbolPools);
    const best = ranked[0];
    bestPools.push(best);

    console.log(`${symbol}:`);
    console.log(`  Pool: ${best.pool}`);
    console.log(`  Quote: ${best.quote}`);
    console.log(`  Fee tier: ${best.fee / 10000}%`);
    console.log(`  Liquidity: ${best.liquidity}`);
    console.log(`  Token0 is asset: ${best.token0IsAsset}`);
    
    if (ranked.length > 1) {
      console.log(`  Alternatives: ${ranked.length - 1} other pool(s) found`);
    }
    console.log();
  }

  // Generate TWAP_POOLS config
  console.log('━━━ Ready-to-Paste Configuration ━━━\n');
  const twapPoolsJson = formatTwapPools(bestPools);
  console.log(`TWAP_POOLS='${twapPoolsJson}'\n`);

  console.log('Add this to your .env file to enable TWAP validation.\n');
}

/**
 * Main function
 */
async function main() {
  console.log('🔍 TWAP Pool Discovery Tool\n');

  const options = parseArgs();

  // Determine symbols to discover
  const symbols = options.symbols || 
    (process.env.PYTH_ASSETS || process.env.PRICE_TRIGGER_ASSETS || 'WETH,cbETH,cbBTC,weETH')
      .split(',').map(s => s.trim().toUpperCase());

  // Quote currencies to try
  const quotes = options.quotes || ['USDC', 'WETH'];

  // Fee tiers to try (in hundredths of a bip)
  const fees = options.fees || [500, 3000, 10000]; // 0.05%, 0.30%, 1.00%

  // Minimum liquidity threshold
  const minLiquidity = options.minLiquidity || 0; // No minimum by default

  const verbose = options.verbose || false;

  console.log(`Assets: ${symbols.join(', ')}`);
  console.log(`Quote currencies: ${quotes.join(', ')}`);
  console.log(`Fee tiers: ${fees.map(f => `${f / 10000}%`).join(', ')}`);
  if (minLiquidity > 0) {
    console.log(`Min liquidity: ${minLiquidity}`);
  }
  console.log();

  // Initialize provider
  const rpcUrl = process.env.RPC_URL || process.env.CHAINLINK_RPC_URL;
  if (!rpcUrl) {
    console.error('❌ Error: RPC_URL must be set');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  try {
    const blockNumber = await provider.getBlockNumber();
    console.log(`✅ RPC connected: Block ${blockNumber}\n`);
  } catch (error) {
    console.error(`❌ RPC connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }

  const factory = new ethers.Contract(UNISWAP_V3_FACTORY, UNISWAP_V3_FACTORY_ABI, provider);

  console.log('Discovering pools...\n');

  // Discover all pools
  const allPools: PoolInfo[] = [];

  for (const symbol of symbols) {
    for (const quote of quotes) {
      // Skip if symbol is same as quote
      if (symbol === quote) continue;

      for (const fee of fees) {
        const pool = await discoverPool(provider, factory, symbol, quote, fee, verbose);
        if (pool) {
          // Filter by min liquidity
          const liquidityNum = Number(pool.liquidity);
          if (liquidityNum >= minLiquidity) {
            allPools.push(pool);
          } else if (verbose) {
            console.log(`  ⊘ Pool filtered: liquidity ${liquidityNum} < ${minLiquidity}`);
          }
        }
      }
    }
  }

  // Generate output
  formatOutput(allPools);

  // Check for missing symbols
  const foundSymbols = new Set(allPools.map(p => p.symbol));
  const missingSymbols = symbols.filter(s => !foundSymbols.has(s));

  if (missingSymbols.length > 0) {
    console.log('━━━ Missing Assets ━━━\n');
    console.log('No suitable pools found for:');
    for (const symbol of missingSymbols) {
      console.log(`  • ${symbol}: Consider using Chainlink direct USD feed`);
    }
    console.log();
  }

  process.exit(0);
}

main().catch(err => {
  console.error(`\n❌ Fatal error: ${err instanceof Error ? err.message : 'Unknown error'}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
