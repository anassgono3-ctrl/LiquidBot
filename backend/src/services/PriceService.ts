// PriceService: USD price lookup with optional Chainlink integration
import { ethers } from 'ethers';

import { config } from '../config/index.js';

// Chainlink Aggregator V3 Interface ABI (minimal)
const AGGREGATOR_V3_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
];

/**
 * PriceService provides USD price lookups for tokens.
 * Supports Chainlink price feeds with fallback to stub prices.
 */
export class PriceService {
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly cacheTtlMs = 60000; // 1 minute cache
  private chainlinkFeeds: Map<string, string> = new Map(); // symbol -> feed address
  private provider: ethers.JsonRpcProvider | null = null;

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
        
        // Parse CHAINLINK_FEEDS: "ETH:0xabc...,USDC:0xdef..."
        const feedPairs = config.chainlinkFeeds.split(',');
        for (const pair of feedPairs) {
          const [symbol, address] = pair.split(':').map(s => s.trim());
          if (symbol && address) {
            this.chainlinkFeeds.set(symbol.toUpperCase(), address);
          }
        }
        
        // eslint-disable-next-line no-console
        console.log(`[price] Chainlink feeds enabled for ${this.chainlinkFeeds.size} symbols`);
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
   * Get USD price for a token symbol.
   * Tries Chainlink feed first, falls back to stub prices.
   * @param symbol Token symbol (e.g., 'USDC', 'WETH')
   * @returns USD price per token
   */
  async getPrice(symbol: string): Promise<number> {
    if (!symbol) {
      return this.defaultPrices.UNKNOWN;
    }

    const upperSymbol = symbol.toUpperCase();

    // Check cache first
    const cached = this.priceCache.get(upperSymbol);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.price;
    }

    let price: number | null = null;

    // Try Chainlink feed if available
    if (this.provider && this.chainlinkFeeds.has(upperSymbol)) {
      price = await this.getChainlinkPrice(upperSymbol);
    }

    // Fall back to default prices
    if (price === null) {
      price = this.defaultPrices[upperSymbol] ?? this.defaultPrices.UNKNOWN;
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
      
      // Extract answer (price) from tuple
      const answer = roundData[1]; // int256 answer
      
      // Chainlink feeds typically have 8 decimals
      const price = Number(answer) / 1e8;
      
      // Validate price is reasonable
      if (!isFinite(price) || price <= 0) {
        return null;
      }

      return price;
    } catch (err) {
      // Silent fallback to stub prices
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
   * Clear the price cache (useful for testing)
   */
  clearCache(): void {
    this.priceCache.clear();
  }
}
