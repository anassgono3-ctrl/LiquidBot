// PriceService: USD price lookup with optional Chainlink integration
import { ethers } from 'ethers';

import { config } from '../config/index.js';
import { 
  priceOracleChainlinkRequestsTotal,
  priceOracleChainlinkStaleTotal,
  priceOracleStubFallbackTotal,
  priceRatioComposedTotal,
  priceFallbackOracleTotal,
  priceMissingTotal,
  revalueSuccessTotal,
  revalueFailTotal,
  pendingPriceQueueLength
} from '../metrics/index.js';
import { normalizeChainlinkPrice } from '../utils/chainlinkMath.js';

// Chainlink Aggregator V3 Interface ABI (minimal)
const AGGREGATOR_V3_ABI = [
  'function decimals() external view returns (uint8)',
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
];

// Aave Oracle ABI (for fallback)
const AAVE_ORACLE_ABI = [
  'function getAssetPrice(address asset) external view returns (uint256)',
  'function BASE_CURRENCY() external view returns (address)',
  'function BASE_CURRENCY_UNIT() external view returns (uint256)'
];

// Default decimals for Chainlink feeds (most feeds use 8 decimals)
const CHAINLINK_DEFAULT_DECIMALS = 8;

// Base currency unit for Aave oracle prices (8 decimals)
const BASE_CURRENCY_UNIT = 10n ** 8n;

/**
 * Token registry for Base network assets - minimal symbol→address→decimals mapping
 * Used for Aave oracle fallback when Chainlink feeds are unavailable
 */
interface TokenInfo {
  address: string;
  decimals: number;
}

const BASE_TOKEN_REGISTRY: Record<string, TokenInfo> = {
  'USDC': {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: 6
  },
  'WETH': {
    address: '0x4200000000000000000000000000000000000006',
    decimals: 18
  },
  'cbETH': {
    address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
    decimals: 18
  },
  'cbBTC': {
    address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    decimals: 8
  },
  'tBTC': {
    address: '0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b',
    decimals: 18
  },
  'WSTETH': {
    address: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452',
    decimals: 18
  }
};

/**
 * PriceService provides USD price lookups for tokens.
 * Supports Chainlink price feeds with fallback to stub prices.
 */
// Interface for pending price resolution items
interface PendingPriceResolution {
  opportunityId?: string;
  symbol: string;
  rawCollateralAmount?: bigint;
  timestamp: number;
}

export class PriceService {
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly cacheTtlMs = 60000; // 1 minute cache
  private chainlinkFeeds: Map<string, string> = new Map(); // symbol -> feed address
  private ratioFeeds: Map<string, string> = new Map(); // underlying symbol -> ratio feed key (e.g. WSTETH -> WSTETH_ETH)
  private feedDecimals: Map<string, number> = new Map(); // symbol -> decimals
  private decimalsInitialized: boolean = false; // Track initialization status
  private provider: ethers.JsonRpcProvider | null = null;
  private aaveOracle: ethers.Contract | null = null;
  
  // Alias and derived asset support
  private aliases: Map<string, string> = new Map(); // alias -> target (e.g., USDbC -> USDC)
  private derivedAssets: Map<string, string> = new Map(); // asset -> ratio feed key (e.g., wstETH -> WSTETH_ETH)
  
  // Per-feed error tracking for poll disabling
  private feedErrorCounts: Map<string, number> = new Map(); // feed address -> consecutive error count
  private disabledFeeds: Set<string> = new Set(); // set of feed addresses with polling disabled
  
  // Price readiness and deferred valuation
  private feedsReady: boolean = false; // True after all feed discovery/initialization complete
  private pendingPriceResolutions: PendingPriceResolution[] = []; // Queue for opportunities needing revaluation
  private readonly maxPendingQueueLength = 500; // Safety limit for queue size
  private symbolAliases: Map<string, string> = new Map(); // Symbol normalization map (e.g., cbBTC -> CBBTC)
  private addressRegistry: Map<string, string> = new Map(); // Normalized address -> symbol mapping
  
  // Per-block price coalescing: guarantee one price resolution per symbol per blockTag
  private perBlockPriceCache: Map<string, { price: number; timestamp: number }> = new Map(); // key: symbol-blockTag

  /**
   * Default price mappings for common tokens (USD per token)
   */
  private readonly defaultPrices: Record<string, number> = {
    // Stablecoins
    'USDC': 1.0,
    'USDT': 1.0,
    'DAI': 1.0,
    'USDbC': 1.0,
    
    // Major tokens (approximate - should be replaced with real oracle)
    'WETH': 3000.0,
    'ETH': 3000.0,
    'WBTC': 60000.0,
    'cbETH': 3100.0,
    
    // Base ecosystem
    'AERO': 1.5,
    
    // Fallback for unknown tokens
    'UNKNOWN': 1.0
  };

  constructor() {
    // Parse symbol aliases (e.g., "cbBTC:CBBTC,tBTC:TBTC") for normalization
    if (config.priceSymbolAliases) {
      const entries = config.priceSymbolAliases.split(',').map(e => e.trim()).filter(e => e.length > 0);
      for (const entry of entries) {
        const [alias, canonical] = entry.split(':').map(s => s.trim());
        if (alias && canonical) {
          const aliasUpper = alias.toUpperCase();
          const canonicalUpper = canonical.toUpperCase();
          this.symbolAliases.set(aliasUpper, canonicalUpper);
          // Also map canonical to itself for consistency
          this.symbolAliases.set(canonicalUpper, canonicalUpper);
          // eslint-disable-next-line no-console
          console.log(`[price] Symbol alias: ${aliasUpper} -> ${canonicalUpper}`);
        }
      }
    }
    
    // Parse aliases (e.g., "USDbC:USDC")
    if (config.priceFeedAliases) {
      const entries = config.priceFeedAliases.split(',').map(e => e.trim()).filter(e => e.length > 0);
      for (const entry of entries) {
        const [alias, target] = entry.split(':').map(s => s.trim());
        if (alias && target) {
          this.aliases.set(alias.toUpperCase(), target.toUpperCase());
          // eslint-disable-next-line no-console
          console.log(`[price] Alias configured: ${alias.toUpperCase()} -> ${target.toUpperCase()}`);
        }
      }
    }
    
    // Parse derived ratio feeds (e.g., "wstETH:WSTETH_ETH,weETH:WEETH_ETH")
    if (config.derivedRatioFeeds) {
      const entries = config.derivedRatioFeeds.split(',').map(e => e.trim()).filter(e => e.length > 0);
      for (const entry of entries) {
        const [asset, ratioFeed] = entry.split(':').map(s => s.trim());
        if (asset && ratioFeed) {
          this.derivedAssets.set(asset.toUpperCase(), ratioFeed.toUpperCase());
          // eslint-disable-next-line no-console
          console.log(`[price] Derived asset configured: ${asset.toUpperCase()} via ${ratioFeed.toUpperCase()}`);
        }
      }
    }
    
    // Initialize Chainlink feeds if configured
    if (config.chainlinkRpcUrl && config.chainlinkFeeds) {
      try {
        this.provider = new ethers.JsonRpcProvider(config.chainlinkRpcUrl);
        
        // Initialize Aave oracle if configured
        if (config.aaveOracle) {
          this.aaveOracle = new ethers.Contract(
            config.aaveOracle,
            AAVE_ORACLE_ABI,
            this.provider
          );
        }
        
        // Parse CHAINLINK_FEEDS: "ETH:0xabc...,USDC:0xdef...,WSTETH_ETH:0xghi..."
        const feedPairs = config.chainlinkFeeds.split(',');
        for (const pair of feedPairs) {
          const [symbol, address] = pair.split(':').map(s => s.trim());
          if (symbol && address) {
            const upperSymbol = symbol.toUpperCase();
            this.chainlinkFeeds.set(upperSymbol, address);
            
            // Detect ratio feeds (ending with _ETH) - backwards compatibility
            if (config.ratioPriceEnabled && upperSymbol.endsWith('_ETH') && !this.derivedAssets.has(upperSymbol.replace(/_ETH$/, ''))) {
              // Extract underlying symbol (e.g., WSTETH_ETH -> WSTETH)
              const underlyingSymbol = upperSymbol.replace(/_ETH$/, '');
              this.ratioFeeds.set(underlyingSymbol, upperSymbol);
              // eslint-disable-next-line no-console
              console.log(`[price] Ratio feed detected (legacy): ${underlyingSymbol} -> ${upperSymbol}`);
            }
          }
        }
        
        // Add derived assets to ratioFeeds map for backwards compatibility
        for (const [asset, ratioFeed] of this.derivedAssets.entries()) {
          this.ratioFeeds.set(asset, ratioFeed);
        }
        
        // eslint-disable-next-line no-console
        console.log(`[price] Chainlink feeds enabled for ${this.chainlinkFeeds.size} symbols (${this.ratioFeeds.size} ratio feeds, ${this.aliases.size} aliases)`);
        
        // Fetch decimals for each feed asynchronously
        // Note: This is fire-and-forget to avoid blocking construction
        // If fetching fails, fallback to CHAINLINK_DEFAULT_DECIMALS (8)
        this.initializeFeedDecimals().catch(err => {
          // eslint-disable-next-line no-console
          console.error('[price] Failed to initialize feed decimals:', err);
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[price] Chainlink initialization failed, falling back to stub prices:', err);
        this.provider = null;
      }
    } else {
      // eslint-disable-next-line no-console
      console.log(`[price] Using stub mode (PRICE_ORACLE_MODE=${config.priceOracleMode})`);
    }
  }

  /**
   * Initialize decimals for all configured feeds
   * Note: Called asynchronously during construction to avoid blocking
   */
  private async initializeFeedDecimals(): Promise<void> {
    if (!this.provider) return;

    for (const [symbol, address] of this.chainlinkFeeds.entries()) {
      try {
        const aggregator = new ethers.Contract(address, AGGREGATOR_V3_ABI, this.provider);
        const decimals = await aggregator.decimals();
        this.feedDecimals.set(symbol, Number(decimals));
        
        // Populate address registry with normalized addresses
        const normalizedAddress = address.toLowerCase();
        this.addressRegistry.set(normalizedAddress, symbol);
        
        // eslint-disable-next-line no-console
        console.log(`[price] Feed ${symbol} decimals=${decimals} address=${address}`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[price] Failed to fetch decimals for ${symbol}:`, err);
        // Fallback to default decimals if we can't fetch
        this.feedDecimals.set(symbol, CHAINLINK_DEFAULT_DECIMALS);
        // eslint-disable-next-line no-console
        console.warn(`[price] Using fallback decimals (${CHAINLINK_DEFAULT_DECIMALS}) for ${symbol}`);
      }
    }
    
    this.decimalsInitialized = true;
    
    // Mark feeds as ready after initialization (manual + auto discovery complete)
    this.feedsReady = true;
    // eslint-disable-next-line no-console
    console.log(`[price] Feed decimals initialization complete (${this.feedDecimals.size} feeds) - feedsReady=true`);
    
    // Flush pending price resolutions
    if (this.pendingPriceResolutions.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[price-init] Flushing ${this.pendingPriceResolutions.length} pending price resolutions`);
      await this.flushPending();
    }
  }

  /**
   * Check if price feeds are ready (initialization complete)
   * @returns true if all feed discovery and normalization is complete
   */
  isFeedsReady(): boolean {
    return this.feedsReady;
  }

  /**
   * Flush pending price resolutions after feeds become ready
   * Revalues queued opportunities that were encountered before initialization
   * @returns Number of items successfully revalued
   */
  async flushPending(): Promise<number> {
    if (!this.feedsReady) {
      // eslint-disable-next-line no-console
      console.warn('[price-init] flushPending called but feedsReady=false, skipping');
      return 0;
    }

    const toProcess = [...this.pendingPriceResolutions];
    this.pendingPriceResolutions = []; // Clear queue
    
    let successCount = 0;
    let failCount = 0;
    
    for (const item of toProcess) {
      try {
        const price = await this.getPrice(item.symbol, false);
        
        if (price > 0) {
          successCount++;
          revalueSuccessTotal.inc({ symbol: item.symbol });
          
          // Calculate USD value if raw amount provided
          let usdValue = 'N/A';
          if (item.rawCollateralAmount) {
            // This is a simplified calculation - actual implementation would need decimals
            usdValue = (Number(item.rawCollateralAmount) * price).toFixed(2);
          }
          
          // eslint-disable-next-line no-console
          console.log(`[price-init] revalue success symbol=${item.symbol} usd=${usdValue}`);
        } else {
          failCount++;
          revalueFailTotal.inc({ symbol: item.symbol });
          // eslint-disable-next-line no-console
          console.warn(`[price-init] revalue fail symbol=${item.symbol} still_zero`);
        }
      } catch (error) {
        failCount++;
        revalueFailTotal.inc({ symbol: item.symbol });
        // eslint-disable-next-line no-console
        console.error(`[price-init] revalue error symbol=${item.symbol}:`, error instanceof Error ? error.message : error);
      }
    }
    
    // Update metrics
    pendingPriceQueueLength.set(this.pendingPriceResolutions.length);
    
    // eslint-disable-next-line no-console
    console.log(`[price-init] Flush complete: ${successCount} success, ${failCount} fail`);
    
    return successCount;
  }

  /**
   * Queue a price resolution for later (when feeds not ready)
   */
  private queuePriceResolution(symbol: string, opportunityId?: string, rawCollateralAmount?: bigint): void {
    // Check queue length limit
    if (this.pendingPriceResolutions.length >= this.maxPendingQueueLength) {
      const dropped = this.pendingPriceResolutions.length - this.maxPendingQueueLength + 1;
      this.pendingPriceResolutions.shift(); // Drop oldest
      // eslint-disable-next-line no-console
      console.warn(`[price-init] queue_overflow dropped=${dropped}`);
    }
    
    this.pendingPriceResolutions.push({
      opportunityId,
      symbol,
      rawCollateralAmount,
      timestamp: Date.now()
    });
    
    // Update metrics
    pendingPriceQueueLength.set(this.pendingPriceResolutions.length);
    
    // eslint-disable-next-line no-console
    console.log(`[price-init] queued collateral valuation symbol=${symbol} amount=${rawCollateralAmount?.toString() || 'N/A'}`);
  }

  /**
   * Get USD price for a token symbol.
   * Tries Chainlink feed first (direct or ratio), then Aave oracle, then falls back to stub prices.
   * @param symbol Token symbol (e.g., 'USDC', 'WETH', 'WSTETH')
   * @returns USD price per token
   * @throws Error if price is critically missing (when throwOnMissing=true)
   */
  async getPrice(symbol: string, throwOnMissing: boolean = false): Promise<number> {
    if (!symbol) {
      if (throwOnMissing) {
        throw new Error('[price] Empty symbol provided');
      }
      return this.defaultPrices.UNKNOWN;
    }

    const upperSymbol = symbol.toUpperCase();
    
    // Apply symbol aliases for normalization (e.g., cbBTC -> CBBTC)
    const normalizedSymbol = this.symbolAliases.get(upperSymbol) || upperSymbol;
    
    // Resolve alias if this is an aliased asset (e.g., USDbC -> USDC)
    const resolvedSymbol = this.aliases.get(normalizedSymbol) || normalizedSymbol;
    if (resolvedSymbol !== upperSymbol) {
      // eslint-disable-next-line no-console
      console.log(`[price] Resolving alias: ${upperSymbol} -> ${resolvedSymbol}`);
    }

    // Check cache first (using resolved symbol)
    const cached = this.priceCache.get(resolvedSymbol);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.price;
    }

    let price: number | null = null;

    // Try Chainlink feed if available (direct USD feed)
    if (this.provider && this.chainlinkFeeds.has(resolvedSymbol)) {
      price = await this.getChainlinkPrice(resolvedSymbol);
    }
    
    // Try ratio feed composition if no direct feed and ratio feed exists
    if (price === null && this.provider && this.ratioFeeds.has(resolvedSymbol)) {
      price = await this.getRatioComposedPrice(resolvedSymbol);
    }
    
    // Try Aave oracle fallback
    if (price === null && this.aaveOracle && config.aaveOracle) {
      price = await this.getAaveOraclePrice(resolvedSymbol);
    }

    // Fall back to default prices
    if (price === null) {
      price = this.defaultPrices[resolvedSymbol] ?? this.defaultPrices.UNKNOWN;
      
      // Log fallback when Chainlink/oracle was expected but failed
      if (this.chainlinkFeeds.has(resolvedSymbol) || this.ratioFeeds.has(resolvedSymbol)) {
        // eslint-disable-next-line no-console
        console.warn(`[price] Using stub price for ${resolvedSymbol}: ${price} USD (all sources unavailable)`);
      }
      
      // If throwOnMissing is true and we're using stub prices for a token that should have real pricing
      if (throwOnMissing && (this.chainlinkFeeds.has(resolvedSymbol) || this.ratioFeeds.has(resolvedSymbol))) {
        priceMissingTotal.inc({ symbol: resolvedSymbol, stage: 'fetch' });
        throw new Error(`[price] Missing price for ${resolvedSymbol} (all sources failed)`);
      }
    }

    // Cache the result (using resolved symbol)
    this.priceCache.set(resolvedSymbol, { price, timestamp: Date.now() });

    return price;
  }

  /**
   * Get price from Chainlink feed
   * @param symbol Token symbol
   * @returns Price in USD or null if unavailable
   */
  private async getChainlinkPrice(symbol: string): Promise<number | null> {
    if (!this.provider) return null;

    const feedAddress = this.chainlinkFeeds.get(symbol);
    if (!feedAddress) return null;

    try {
      const aggregator = new ethers.Contract(feedAddress, AGGREGATOR_V3_ABI, this.provider);
      const roundData = await aggregator.latestRoundData();
      
      // Extract data from tuple
      const roundId = roundData[0];      // uint80 roundId
      const answer = roundData[1];       // int256 answer
      const updatedAt = roundData[3];    // uint256 updatedAt
      const answeredInRound = roundData[4]; // uint80 answeredInRound
      
      // Validate answer is positive
      if (answer <= 0n) {
        // eslint-disable-next-line no-console
        console.warn(`[price] Invalid Chainlink answer for ${symbol}: ${answer}`);
        priceOracleChainlinkRequestsTotal.inc({ status: 'error', symbol });
        priceOracleStubFallbackTotal.inc({ symbol, reason: 'invalid_answer' });
        this.recordFeedError(feedAddress, symbol);
        return null;
      }
      
      // Validate roundId consistency
      if (answeredInRound < roundId) {
        // eslint-disable-next-line no-console
        console.warn(`[price] Stale Chainlink data for ${symbol}: answeredInRound=${answeredInRound} < roundId=${roundId}`);
        priceOracleChainlinkStaleTotal.inc({ symbol });
        priceOracleStubFallbackTotal.inc({ symbol, reason: 'stale_data' });
        this.recordFeedError(feedAddress, symbol);
        return null;
      }
      
      // Get decimals for this feed (fallback to default if not initialized yet)
      const decimals = this.feedDecimals.get(symbol) ?? CHAINLINK_DEFAULT_DECIMALS;
      
      // High-precision normalization using chainlinkMath helper
      const price = normalizeChainlinkPrice(answer, decimals);
      
      // Validate price is positive and finite
      if (!isFinite(price) || price <= 0) {
        // eslint-disable-next-line no-console
        console.warn(`[price] Invalid normalized Chainlink price for ${symbol}: ${price}`);
        priceOracleChainlinkRequestsTotal.inc({ status: 'error', symbol });
        priceOracleStubFallbackTotal.inc({ symbol, reason: 'invalid_normalized_price' });
        this.recordFeedError(feedAddress, symbol);
        return null;
      }
      
      // Check freshness (warn if older than 1 hour, but still use it)
      const now = Math.floor(Date.now() / 1000);
      const age = now - Number(updatedAt);
      if (age > 3600) {
        // eslint-disable-next-line no-console
        console.warn(`[price] Chainlink price for ${symbol} is ${age}s old (threshold: 3600s)`);
      }

      // Log successful price fetch with details
      // eslint-disable-next-line no-console
      console.log(
        `[price] Chainlink success: ${symbol}=$${price.toFixed(8)} ` +
        `decimals=${decimals} age=${age}s roundId=${roundId.toString()}`
      );

      // Reset error count on success
      this.resetFeedError(feedAddress);
      
      priceOracleChainlinkRequestsTotal.inc({ status: 'success', symbol });
      return price;
    } catch (err) {
      // Log error and fallback to stub prices
      const message = err instanceof Error ? err.message : String(err);
      
      // Check if this is a CALL_EXCEPTION
      const isCallException = message.includes('CALL_EXCEPTION') || (err instanceof Error && err.message.includes('CALL_EXCEPTION'));
      
      // eslint-disable-next-line no-console
      console.warn(`[price] Chainlink fetch failed for ${symbol}: ${message}`);
      priceOracleChainlinkRequestsTotal.inc({ status: 'error', symbol });
      priceOracleStubFallbackTotal.inc({ symbol, reason: 'fetch_error' });
      
      // Record error for poll disabling
      this.recordFeedError(feedAddress, symbol, isCallException);
      
      return null;
    }
  }

  /**
   * Record feed error and check if polling should be disabled
   */
  private recordFeedError(feedAddress: string, symbol: string, isCallException: boolean = false): void {
    // Increment error count
    const currentCount = this.feedErrorCounts.get(feedAddress) || 0;
    const newCount = currentCount + 1;
    this.feedErrorCounts.set(feedAddress, newCount);
    
    // Check if we should disable polling
    const threshold = config.pricePollDisableAfterErrors;
    if (newCount >= threshold && !this.disabledFeeds.has(feedAddress)) {
      this.disabledFeeds.add(feedAddress);
      // eslint-disable-next-line no-console
      console.warn(
        `[price-poll] disabled feed=${symbol} address=${feedAddress} after ${newCount} consecutive ${isCallException ? 'CALL_EXCEPTION' : 'errors'}`
      );
    }
  }

  /**
   * Reset feed error count on successful fetch
   */
  private resetFeedError(feedAddress: string): void {
    if (this.feedErrorCounts.has(feedAddress)) {
      this.feedErrorCounts.delete(feedAddress);
    }
  }

  /**
   * Check if a feed has polling disabled
   */
  isFeedPollingDisabled(symbol: string): boolean {
    const feedAddress = this.chainlinkFeeds.get(symbol.toUpperCase());
    if (!feedAddress) return false;
    return this.disabledFeeds.has(feedAddress);
  }

  /**
   * Check if an asset is derived (priced via ratio feed)
   */
  isDerivedAsset(symbol: string): boolean {
    return this.derivedAssets.has(symbol.toUpperCase());
  }

  /**
   * Get price by composing ratio feed with ETH/USD feed
   * @param symbol Underlying token symbol (e.g., 'WSTETH')
   * @returns USD price or null if unavailable
   */
  private async getRatioComposedPrice(symbol: string): Promise<number | null> {
    if (!this.provider) return null;
    
    const ratioFeedKey = this.ratioFeeds.get(symbol);
    if (!ratioFeedKey) return null;
    
    const ratioFeedAddress = this.chainlinkFeeds.get(ratioFeedKey);
    if (!ratioFeedAddress) return null;
    
    try {
      // Get ratio (e.g., WSTETH/ETH)
      const ratioAggregator = new ethers.Contract(ratioFeedAddress, AGGREGATOR_V3_ABI, this.provider);
      const ratioRoundData = await ratioAggregator.latestRoundData();
      
      const ratioAnswer = ratioRoundData[1];       // int256 answer
      const ratioUpdatedAt = ratioRoundData[3];    // uint256 updatedAt
      const ratioAnsweredInRound = ratioRoundData[4]; // uint80 answeredInRound
      const ratioRoundId = ratioRoundData[0];      // uint80 roundId
      
      // Validate ratio answer is positive
      if (ratioAnswer <= 0n) {
        // eslint-disable-next-line no-console
        console.warn(`[price] ratio_resolution_failed symbol=${symbol} reason=invalid_ratio_answer answer=${ratioAnswer}`);
        return null;
      }
      
      // Check staleness of ratio feed
      const now = Math.floor(Date.now() / 1000);
      const ratioAge = now - Number(ratioUpdatedAt);
      const stalenessThreshold = config.priceStalenessSeconds;
      
      if (ratioAge > stalenessThreshold) {
        // eslint-disable-next-line no-console
        console.warn(`[price] stale_feed symbol=${symbol} type=ratio age=${ratioAge}s threshold=${stalenessThreshold}s`);
        priceOracleChainlinkStaleTotal.inc({ symbol: ratioFeedKey });
        return null;
      }
      
      // Validate round consistency
      if (ratioAnsweredInRound < ratioRoundId) {
        // eslint-disable-next-line no-console
        console.warn(`[price] stale_feed symbol=${symbol} type=ratio answeredInRound=${ratioAnsweredInRound} < roundId=${ratioRoundId}`);
        priceOracleChainlinkStaleTotal.inc({ symbol: ratioFeedKey });
        return null;
      }
      
      // Get ETH/USD price (use WETH or ETH feed)
      const ethSymbol = this.chainlinkFeeds.has('WETH') ? 'WETH' : 'ETH';
      const ethFeedAddress = this.chainlinkFeeds.get(ethSymbol);
      
      if (!ethFeedAddress) {
        // eslint-disable-next-line no-console
        console.warn(`[price] ratio_resolution_failed symbol=${symbol} reason=no_eth_feed`);
        return null;
      }
      
      const ethAggregator = new ethers.Contract(ethFeedAddress, AGGREGATOR_V3_ABI, this.provider);
      const ethRoundData = await ethAggregator.latestRoundData();
      
      const ethAnswer = ethRoundData[1];       // int256 answer
      const ethUpdatedAt = ethRoundData[3];    // uint256 updatedAt
      const ethAnsweredInRound = ethRoundData[4]; // uint80 answeredInRound
      const ethRoundId = ethRoundData[0];      // uint80 roundId
      
      // Validate ETH answer is positive
      if (ethAnswer <= 0n) {
        // eslint-disable-next-line no-console
        console.warn(`[price] ratio_resolution_failed symbol=${symbol} reason=invalid_eth_answer answer=${ethAnswer}`);
        return null;
      }
      
      // Check staleness of ETH feed
      const ethAge = now - Number(ethUpdatedAt);
      if (ethAge > stalenessThreshold) {
        // eslint-disable-next-line no-console
        console.warn(`[price] stale_feed symbol=${ethSymbol} type=eth_usd age=${ethAge}s threshold=${stalenessThreshold}s`);
        priceOracleChainlinkStaleTotal.inc({ symbol: ethSymbol });
        return null;
      }
      
      // Validate ETH round consistency
      if (ethAnsweredInRound < ethRoundId) {
        // eslint-disable-next-line no-console
        console.warn(`[price] stale_feed symbol=${ethSymbol} type=eth_usd answeredInRound=${ethAnsweredInRound} < roundId=${ethRoundId}`);
        priceOracleChainlinkStaleTotal.inc({ symbol: ethSymbol });
        return null;
      }
      
      // Get decimals for both feeds
      const ratioDecimals = this.feedDecimals.get(ratioFeedKey) ?? CHAINLINK_DEFAULT_DECIMALS;
      const ethDecimals = this.feedDecimals.get(ethSymbol) ?? CHAINLINK_DEFAULT_DECIMALS;
      
      // Compose price: tokenUSD = (ratio / 10^ratioDecimals) * (ethUSD / 10^ethDecimals)
      // Using BigInt arithmetic for precision
      const ratioDivisor = 10n ** BigInt(ratioDecimals);
      const ethDivisor = 10n ** BigInt(ethDecimals);
      
      // Calculate: (ratioAnswer * ethAnswer) / (ratioDivisor * ethDivisor)
      // To maintain precision, we scale up first then divide
      // Ensure we're working with BigInt values
      const ratioAnswerBigInt = BigInt(ratioAnswer.toString());
      const ethAnswerBigInt = BigInt(ethAnswer.toString());
      
      const numerator = ratioAnswerBigInt * ethAnswerBigInt;
      const denominator = ratioDivisor * ethDivisor;
      
      // Convert to number with precision (using BigInt division)
      const integerPart = numerator / denominator;
      const fractionalPart = numerator % denominator;
      const price = Number(integerPart) + Number(fractionalPart) / Number(denominator);
      
      // Validate price is positive and finite
      if (!isFinite(price) || price <= 0) {
        // eslint-disable-next-line no-console
        console.warn(`[price] ratio_resolution_failed symbol=${symbol} reason=invalid_composed_price price=${price}`);
        return null;
      }
      
      // Log successful composition
      // eslint-disable-next-line no-console
      console.log(
        `[price] Ratio composition success: ${symbol}=$${price.toFixed(8)} ` +
        `ratio=${(Number(ratioAnswer) / Number(ratioDivisor)).toFixed(6)} ` +
        `ethUsd=${(Number(ethAnswer) / Number(ethDivisor)).toFixed(2)} ` +
        `ratioAge=${ratioAge}s ethAge=${ethAge}s`
      );
      
      priceRatioComposedTotal.inc({ symbol, source: 'chainlink' });
      return price;
      
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[price] ratio_resolution_failed symbol=${symbol} error=${message}`);
      return null;
    }
  }
  
  /**
   * Get price from Aave oracle as fallback
   * @param symbolOrAddress Token symbol or hex address (0x...)
   * @returns USD price or null if unavailable
   */
  private async getAaveOraclePrice(symbolOrAddress: string): Promise<number | null> {
    if (!this.aaveOracle) return null;
    
    let address: string;
    let symbol: string;
    
    // Detect if input is a hex address (starts with 0x and has valid length)
    const isAddress = /^0x[a-fA-F0-9]{40}$/i.test(symbolOrAddress);
    
    if (isAddress) {
      // Normalize address to lowercase
      address = symbolOrAddress.toLowerCase();
      
      // Try to find symbol from address registry
      symbol = this.addressRegistry.get(address) || symbolOrAddress;
      
      // eslint-disable-next-line no-console
      console.log(`[price] aave_fallback_attempted address=${address} symbol=${symbol}`);
    } else {
      // Look up token address from registry
      symbol = symbolOrAddress;
      const tokenInfo = BASE_TOKEN_REGISTRY[symbol];
      
      if (!tokenInfo) {
        // eslint-disable-next-line no-console
        console.log(`[price] aave_fallback_attempted symbol=${symbol} result=no_address_mapping`);
        return null;
      }
      
      address = tokenInfo.address.toLowerCase();
    }
    
    try {
      // Query Aave oracle for asset price
      const priceRaw = await this.aaveOracle.getAssetPrice(address);
      
      // Aave oracle returns prices in 8 decimals (BASE_CURRENCY_UNIT)
      // Convert to USD using the same format as Chainlink (price / 10^8)
      const price = Number(priceRaw) / Number(BASE_CURRENCY_UNIT);
      
      // Validate price is positive and finite
      if (!isFinite(price) || price <= 0) {
        // eslint-disable-next-line no-console
        console.warn(`[price] Invalid Aave oracle price for ${symbol}: ${price}`);
        return null;
      }
      
      // eslint-disable-next-line no-console
      console.log(
        `[price] Aave oracle success: ${symbol}=$${price.toFixed(8)} ` +
        `address=${address}`
      );
      
      priceFallbackOracleTotal.inc({ symbol });
      return price;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[price] Aave oracle fetch failed for ${symbol}: ${message}`);
      return null;
    }
  }

  /**
   * Get prices for multiple symbols in a single call.
   * @param symbols Array of token symbols
   * @returns Map of symbol to USD price
   */
  async getPrices(symbols: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    
    for (const symbol of symbols) {
      const price = await this.getPrice(symbol);
      result.set(symbol, price);
    }

    return result;
  }

  /**
   * Get price at a specific block with per-block coalescing.
   * Guarantees one price resolution per symbol per blockTag.
   * @param symbol Token symbol
   * @param blockTag Block number for price snapshot
   * @returns USD price at the specified block
   */
  async getPriceAtBlock(symbol: string, blockTag: number): Promise<number> {
    const cacheKey = `${symbol.toUpperCase()}-${blockTag}`;
    const cached = this.perBlockPriceCache.get(cacheKey);
    
    if (cached) {
      // Return cached per-block price
      return cached.price;
    }
    
    // Resolve price (will use regular cache if available)
    const price = await this.getPrice(symbol);
    
    // Store in per-block cache
    this.perBlockPriceCache.set(cacheKey, { price, timestamp: Date.now() });
    
    // Increment metric
    const { pricePerBlockCoalescedTotal } = await import('../metrics/index.js');
    pricePerBlockCoalescedTotal.inc({ symbol: symbol.toUpperCase() });
    
    // Prune old per-block entries (keep last 10 blocks worth)
    if (this.perBlockPriceCache.size > 1000) {
      const cutoffBlock = blockTag - 10;
      for (const [key] of this.perBlockPriceCache) {
        const parts = key.split('-');
        const keyBlock = parseInt(parts[parts.length - 1], 10);
        if (keyBlock < cutoffBlock) {
          this.perBlockPriceCache.delete(key);
        }
      }
    }
    
    return price;
  }

  /**
   * Clear the price cache (useful for testing)
   */
  clearCache(): void {
    this.priceCache.clear();
    this.perBlockPriceCache.clear();
  }
}
