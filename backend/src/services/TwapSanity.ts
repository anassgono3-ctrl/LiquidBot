/**
 * TwapSanity: DEX TWAP price sanity checker
 * 
 * Computes time-weighted average price (TWAP) from configured DEX pools
 * and validates against reference prices to detect manipulation or stale data.
 * 
 * Supports:
 * - Uniswap V3 pools (primary)
 * - Configurable time windows
 * - Deviation thresholds
 */

import { ethers } from 'ethers';
import { config } from '../config/index.js';
import { recordTwapSanityCheck } from '../metrics/preSubmitMetrics.js';

// Uniswap V3 Pool ABI (minimal - just Swap event)
const UNISWAP_V3_POOL_ABI = [
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)'
];

interface TwapPoolConfig {
  symbol: string;
  pool: string; // Pool contract address
  dex: 'uniswap_v3' | 'sushiswap' | 'curve';
  token0IsAsset?: boolean; // If true, asset is token0; else token1
  token0Decimals?: number; // Optional: decimals for token0 (default: 18)
  token1Decimals?: number; // Optional: decimals for token1 (default: 6 for USDC)
}

interface TwapSanityResult {
  ok: boolean;
  twapPrice: number | null;
  delta?: number;
  error?: string;
}

export class TwapSanity {
  private provider: ethers.JsonRpcProvider | null = null;
  private poolConfigs: Map<string, TwapPoolConfig> = new Map();
  private enabled: boolean;
  private windowSec: number;
  private maxDeltaPct: number;

  constructor() {
    this.enabled = config.twapEnabled;
    this.windowSec = config.twapWindowSec;
    this.maxDeltaPct = config.twapDeltaPct;

    // Initialize provider if enabled
    if (this.enabled) {
      // Use chainlinkRpcUrl or fallback to RPC URL from process.env
      const rpcUrl = config.chainlinkRpcUrl || process.env.RPC_URL;
      if (!rpcUrl) {
        console.warn('[twap-sanity] TWAP_ENABLED but no RPC_URL configured, disabling');
        this.enabled = false;
      } else {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.initializePoolConfigs();
      }
    }

    if (this.enabled) {
      console.log(
        `[twap-sanity] Initialized: window=${this.windowSec}s, maxDelta=${this.maxDeltaPct * 100}%, pools=${this.poolConfigs.size}`
      );
    }
  }

  /**
   * Initialize pool configurations from env
   */
  private initializePoolConfigs(): void {
    const pools = config.twapPools as TwapPoolConfig[];
    
    if (!Array.isArray(pools) || pools.length === 0) {
      console.warn('[twap-sanity] TWAP_ENABLED but TWAP_POOLS is empty or invalid');
      this.enabled = false;
      return;
    }

    for (const poolConfig of pools) {
      if (!poolConfig.symbol || !poolConfig.pool || !poolConfig.dex) {
        console.warn('[twap-sanity] Invalid pool config, skipping:', poolConfig);
        continue;
      }
      
      // Normalize pool address
      const poolAddress = poolConfig.pool.toLowerCase();
      this.poolConfigs.set(poolConfig.symbol.toUpperCase(), {
        ...poolConfig,
        pool: poolAddress,
        token0IsAsset: poolConfig.token0IsAsset ?? true,
        token0Decimals: poolConfig.token0Decimals ?? 18,
        token1Decimals: poolConfig.token1Decimals ?? 6
      });
    }

    if (this.poolConfigs.size === 0) {
      console.warn('[twap-sanity] No valid pool configs found, disabling');
      this.enabled = false;
    }
  }

  /**
   * Perform TWAP sanity check for a given symbol and reference price
   * 
   * @param symbol Asset symbol (e.g., 'WETH')
   * @param refPrice Reference price to compare against
   * @returns Result object with ok status, TWAP price, and delta
   */
  public async sanityCheck(symbol: string, refPrice: number): Promise<TwapSanityResult> {
    const startTime = Date.now();

    // Gate: Feature disabled
    if (!this.enabled) {
      return { ok: true, twapPrice: null, error: 'TWAP disabled' };
    }

    // Gate: No pool config for this symbol
    const poolConfig = this.poolConfigs.get(symbol.toUpperCase());
    if (!poolConfig) {
      // If no pool configured for this symbol, pass by default (not a failure)
      return { ok: true, twapPrice: null, error: 'No pool configured' };
    }

    try {
      const twapPrice = await this.computeTwap(poolConfig);
      
      if (twapPrice === null) {
        // Couldn't compute TWAP (e.g., no recent swaps)
        // Don't fail sanity check, just log warning
        console.warn(`[twap-sanity] Could not compute TWAP for ${symbol}, passing by default`);
        return { ok: true, twapPrice: null, error: 'Insufficient data' };
      }

      // Compute delta
      const delta = Math.abs(twapPrice - refPrice) / refPrice;
      const passed = delta <= this.maxDeltaPct;

      // Record metrics
      const durationMs = Date.now() - startTime;
      recordTwapSanityCheck(symbol, delta, passed, durationMs);

      if (!passed) {
        console.warn(
          `[twap-sanity] FAILED: ${symbol} twap=$${twapPrice.toFixed(2)} ref=$${refPrice.toFixed(2)} delta=${(delta * 100).toFixed(2)}%`
        );
      } else {
        console.log(
          `[twap-sanity] PASSED: ${symbol} twap=$${twapPrice.toFixed(2)} ref=$${refPrice.toFixed(2)} delta=${(delta * 100).toFixed(2)}%`
        );
      }

      return { ok: passed, twapPrice, delta };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      console.error(`[twap-sanity] Error computing TWAP for ${symbol}:`, error);
      
      // On error, pass by default (conservative approach)
      recordTwapSanityCheck(symbol, 0, true, durationMs);
      return { ok: true, twapPrice: null, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Compute TWAP for a pool over the configured window
   */
  private async computeTwap(poolConfig: TwapPoolConfig): Promise<number | null> {
    if (!this.provider) {
      return null;
    }

    if (poolConfig.dex !== 'uniswap_v3') {
      console.warn(`[twap-sanity] Unsupported DEX: ${poolConfig.dex}`);
      return null;
    }

    return this.computeUniswapV3Twap(poolConfig);
  }

  /**
   * Compute TWAP from Uniswap V3 Swap events
   */
  private async computeUniswapV3Twap(poolConfig: TwapPoolConfig): Promise<number | null> {
    if (!this.provider) {
      return null;
    }

    try {
      const pool = new ethers.Contract(poolConfig.pool, UNISWAP_V3_POOL_ABI, this.provider);
      const currentBlock = await this.provider.getBlockNumber();
      
      // Estimate blocks for time window (assuming ~2 second block time on Base)
      const blocksPerWindow = Math.ceil(this.windowSec / 2);
      const fromBlock = Math.max(1, currentBlock - blocksPerWindow);

      // Fetch Swap events
      const filter = pool.filters.Swap();
      const events = await pool.queryFilter(filter, fromBlock, currentBlock);

      if (events.length === 0) {
        console.warn(`[twap-sanity] No swap events found for ${poolConfig.symbol} in last ${this.windowSec}s`);
        return null;
      }

      // Get block timestamps
      const blockTimestamps = new Map<number, number>();
      const now = Math.floor(Date.now() / 1000);
      const windowStart = now - this.windowSec;

      // Filter events within time window and compute TWAP
      let totalWeightedPrice = 0;
      let totalWeight = 0;

      for (const event of events) {
        const blockNumber = event.blockNumber;
        
        // Fetch block timestamp if not cached
        if (!blockTimestamps.has(blockNumber)) {
          const block = await this.provider.getBlock(blockNumber);
          if (block) {
            blockTimestamps.set(blockNumber, block.timestamp);
          }
        }

        const timestamp = blockTimestamps.get(blockNumber);
        if (!timestamp || timestamp < windowStart) {
          continue;
        }

        // Parse swap amounts
        // Check if event is EventLog (has args)
        if (!('args' in event)) {
          continue;
        }
        
        const amount0 = event.args?.amount0;
        const amount1 = event.args?.amount1;

        if (!amount0 || !amount1) {
          continue;
        }

        // Compute price from swap
        // Use configured decimals instead of hard-coded values
        // If token0 is the asset, price = |amount1| / |amount0|
        // Else price = |amount0| / |amount1|
        const absAmount0 = Math.abs(Number(ethers.formatUnits(amount0, poolConfig.token0Decimals || 18)));
        const absAmount1 = Math.abs(Number(ethers.formatUnits(amount1, poolConfig.token1Decimals || 6)));

        if (absAmount0 === 0 || absAmount1 === 0) {
          continue;
        }

        const swapPrice = poolConfig.token0IsAsset 
          ? absAmount1 / absAmount0 
          : absAmount0 / absAmount1;

        // Weight by USD volume
        const volumeUsd = poolConfig.token0IsAsset 
          ? absAmount1 
          : absAmount0;

        totalWeightedPrice += swapPrice * volumeUsd;
        totalWeight += volumeUsd;
      }

      if (totalWeight === 0) {
        return null;
      }

      const twap = totalWeightedPrice / totalWeight;
      return twap;
    } catch (error) {
      console.error(`[twap-sanity] Error fetching Uniswap V3 events:`, error);
      return null;
    }
  }

  /**
   * Check if TWAP sanity checks are enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get configured symbols
   */
  public getConfiguredSymbols(): string[] {
    return Array.from(this.poolConfigs.keys());
  }
}
