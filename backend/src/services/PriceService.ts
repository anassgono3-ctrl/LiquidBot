// PriceService: USD price lookup (stub for future Coingecko integration)
import { config } from '../config/index.js';

/**
 * PriceService provides USD price lookups for tokens.
 * Current implementation uses hardcoded prices.
 * Ready for future integration with Coingecko or on-chain oracles.
 */
export class PriceService {
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly cacheTtlMs = 60000; // 1 minute cache

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
    if (config.priceOracleMode !== 'coingecko') {
      // eslint-disable-next-line no-console
      console.log(`[price] Using stub mode (PRICE_ORACLE_MODE=${config.priceOracleMode})`);
    }
  }

  /**
   * Get USD price for a token symbol.
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

    // Get price from default mapping
    const price = this.defaultPrices[upperSymbol] ?? this.defaultPrices.UNKNOWN;

    // Cache the result
    this.priceCache.set(upperSymbol, { price, timestamp: Date.now() });

    return price;
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
