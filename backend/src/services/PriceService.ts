// PriceService: USD price lookup with optional Chainlink integration
import { ethers } from 'ethers';

import { config } from '../config/index.js';
import { 
  priceOracleChainlinkRequestsTotal,
  priceOracleChainlinkStaleTotal,
  priceOracleStubFallbackTotal,
  priceRatioComposedTotal,
  priceFallbackOracleTotal,
  priceMissingTotal
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
 * PriceService provides USD price lookups for tokens.
 * Supports Chainlink price feeds with fallback to stub prices.
 */
export class PriceService {
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly cacheTtlMs = 60000; // 1 minute cache
  private chainlinkFeeds: Map<string, string> = new Map(); // symbol -> feed address
  private ratioFeeds: Map<string, string> = new Map(); // underlying symbol -> ratio feed key (e.g. WSTETH -> WSTETH_ETH)
  private feedDecimals: Map<string, number> = new Map(); // symbol -> decimals
  private decimalsInitialized: boolean = false; // Track initialization status
  private provider: ethers.JsonRpcProvider | null = null;
  private aaveOracle: ethers.Contract | null = null;

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
            
            // Detect ratio feeds (ending with _ETH)
            if (config.ratioPriceEnabled && upperSymbol.endsWith('_ETH')) {
              // Extract underlying symbol (e.g., WSTETH_ETH -> WSTETH)
              const underlyingSymbol = upperSymbol.replace(/_ETH$/, '');
              this.ratioFeeds.set(underlyingSymbol, upperSymbol);
              // eslint-disable-next-line no-console
              console.log(`[price] Ratio feed detected: ${underlyingSymbol} -> ${upperSymbol}`);
            }
          }
        }
        
        // eslint-disable-next-line no-console
        console.log(`[price] Chainlink feeds enabled for ${this.chainlinkFeeds.size} symbols (${this.ratioFeeds.size} ratio feeds)`);
        
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
    // eslint-disable-next-line no-console
    console.log(`[price] Feed decimals initialization complete (${this.feedDecimals.size} feeds)`);
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

    // Check cache first
    const cached = this.priceCache.get(upperSymbol);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.price;
    }

    let price: number | null = null;

    // Try Chainlink feed if available (direct USD feed)
    if (this.provider && this.chainlinkFeeds.has(upperSymbol)) {
      price = await this.getChainlinkPrice(upperSymbol);
    }
    
    // Try ratio feed composition if no direct feed and ratio feed exists
    if (price === null && this.provider && this.ratioFeeds.has(upperSymbol)) {
      price = await this.getRatioComposedPrice(upperSymbol);
    }
    
    // Try Aave oracle fallback
    if (price === null && this.aaveOracle && config.aaveOracle) {
      price = await this.getAaveOraclePrice(upperSymbol);
    }

    // Fall back to default prices
    if (price === null) {
      price = this.defaultPrices[upperSymbol] ?? this.defaultPrices.UNKNOWN;
      
      // Log fallback when Chainlink/oracle was expected but failed
      if (this.chainlinkFeeds.has(upperSymbol) || this.ratioFeeds.has(upperSymbol)) {
        // eslint-disable-next-line no-console
        console.warn(`[price] Using stub price for ${upperSymbol}: ${price} USD (all sources unavailable)`);
      }
      
      // If throwOnMissing is true and we're using stub prices for a token that should have real pricing
      if (throwOnMissing && (this.chainlinkFeeds.has(upperSymbol) || this.ratioFeeds.has(upperSymbol))) {
        priceMissingTotal.inc({ symbol: upperSymbol, stage: 'fetch' });
        throw new Error(`[price] Missing price for ${upperSymbol} (all sources failed)`);
      }
    }

    // Cache the result
    this.priceCache.set(upperSymbol, { price, timestamp: Date.now() });

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
        return null;
      }
      
      // Validate roundId consistency
      if (answeredInRound < roundId) {
        // eslint-disable-next-line no-console
        console.warn(`[price] Stale Chainlink data for ${symbol}: answeredInRound=${answeredInRound} < roundId=${roundId}`);
        priceOracleChainlinkStaleTotal.inc({ symbol });
        priceOracleStubFallbackTotal.inc({ symbol, reason: 'stale_data' });
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

      priceOracleChainlinkRequestsTotal.inc({ status: 'success', symbol });
      return price;
    } catch (err) {
      // Log error and fallback to stub prices
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[price] Chainlink fetch failed for ${symbol}: ${message}`);
      priceOracleChainlinkRequestsTotal.inc({ status: 'error', symbol });
      priceOracleStubFallbackTotal.inc({ symbol, reason: 'fetch_error' });
      return null;
    }
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
   * @param symbol Token symbol
   * @returns USD price or null if unavailable
   */
  private async getAaveOraclePrice(symbol: string): Promise<number | null> {
    if (!this.aaveOracle) return null;
    
    // We need the token address to query Aave oracle
    // This is a limitation - we'd need a symbol->address mapping
    // For now, return null and let it fall back to stub
    // A full implementation would require a token address registry
    
    // eslint-disable-next-line no-console
    console.log(`[price] aave_fallback_attempted symbol=${symbol} result=no_address_mapping`);
    
    return null;
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
   * Clear the price cache (useful for testing)
   */
  clearCache(): void {
    this.priceCache.clear();
  }
}
