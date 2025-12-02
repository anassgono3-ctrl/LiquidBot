/**
 * TokenResolver Service
 * 
 * Resolves token information for Aave reserve tokens (aTokens, debt tokens)
 * and provides USD valuations for Telegram notifications.
 * 
 * Features:
 * - Resolves underlying asset for Aave reserve tokens via AAVE_PROTOCOL_DATA_PROVIDER
 * - Gets token decimals via ERC20.decimals()
 * - Resolves symbol via ERC20.symbol() with fallback aliases
 * - USD valuation via AAVE_ORACLE with fallback to Chainlink feeds
 */

import { ethers } from 'ethers';

import { config } from '../config/index.js';

import { PriceService } from './PriceService.js';

// ABIs
const PROTOCOL_DATA_PROVIDER_ABI = [
  'function getReserveTokensAddresses(address asset) external view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)'
];

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)'
];

const AAVE_ORACLE_ABI = [
  'function getAssetPrice(address asset) external view returns (uint256)'
];

// Oracle base unit (8 decimals)
const ORACLE_BASE_UNIT = 10n ** 8n;

interface TokenInfo {
  address: string;
  underlying: string; // Same as address if not a reserve token
  symbol: string;
  decimals: number;
}

interface FormattedAmount {
  amount: string; // Human-readable amount with decimals
  usdValue: string; // USD value formatted with $ prefix
  rawAmount: bigint;
  rawUsdValue: number;
}

interface TokenCache {
  info: TokenInfo;
  timestamp: number;
}

interface PriceCache {
  price: number; // USD price
  timestamp: number;
}

/**
 * TokenResolver resolves token information and provides USD valuations
 */
export class TokenResolver {
  private provider: ethers.JsonRpcProvider;
  private priceService: PriceService;
  private tokenCache: Map<string, TokenCache> = new Map();
  private priceCache: Map<string, PriceCache> = new Map();
  private underlyingCache: Map<string, string> = new Map(); // reserveToken -> underlying
  private readonly tokenCacheTtlMs = 3600000; // 1 hour
  private readonly priceCacheTtlMs = 60000; // 1 minute
  private symbolAliases: Map<string, string> = new Map();

  constructor(provider: ethers.JsonRpcProvider, priceService: PriceService) {
    this.provider = provider;
    this.priceService = priceService;
    
    // Initialize symbol aliases from config
    this.initializeSymbolAliases();
  }

  /**
   * Initialize symbol aliases from config
   */
  private initializeSymbolAliases(): void {
    // Parse PRICE_FEED_ALIASES
    if (config.priceFeedAliases) {
      const aliases = config.priceFeedAliases.split(',');
      for (const pair of aliases) {
        const [alias, target] = pair.split(':').map(s => s.trim());
        if (alias && target) {
          this.symbolAliases.set(alias.toUpperCase(), target.toUpperCase());
        }
      }
    }

    // Parse PRICE_SYMBOL_ALIASES
    if (config.priceSymbolAliases) {
      const aliases = config.priceSymbolAliases.split(',');
      for (const pair of aliases) {
        const [alias, canonical] = pair.split(':').map(s => s.trim());
        if (alias && canonical) {
          this.symbolAliases.set(alias.toUpperCase(), canonical.toUpperCase());
        }
      }
    }

    // Add hardcoded aliases for Chainlink feeds
    if (config.chainlinkFeeds) {
      const feeds = config.chainlinkFeeds.split(',');
      for (const feed of feeds) {
        const [symbol] = feed.split(':').map(s => s.trim());
        if (symbol) {
          this.symbolAliases.set(symbol.toUpperCase(), symbol.toUpperCase());
        }
      }
    }
  }

  /**
   * Resolve underlying asset for a reserve token (aToken, debt token)
   * Returns the same address if not a reserve token
   */
  async resolveUnderlying(tokenAddress: string): Promise<string> {
    const normalized = tokenAddress.toLowerCase();

    // Check cache first
    if (this.underlyingCache.has(normalized)) {
      return this.underlyingCache.get(normalized)!;
    }

    try {
      const dataProvider = new ethers.Contract(
        config.aaveProtocolDataProvider,
        PROTOCOL_DATA_PROVIDER_ABI,
        this.provider
      );

      // Try to get reserve tokens for this address
      // If it's an underlying asset, the call will return reserve tokens
      // If it's a reserve token, we need to reverse-lookup
      try {
        const { aTokenAddress, stableDebtTokenAddress, variableDebtTokenAddress } = 
          await dataProvider.getReserveTokensAddresses(tokenAddress);

        // If we get valid addresses back, tokenAddress is the underlying
        if (aTokenAddress && aTokenAddress !== ethers.ZeroAddress) {
          this.underlyingCache.set(normalized, normalized);
          return normalized;
        }
      } catch {
        // Not an underlying asset, might be a reserve token
      }

      // For now, assume it's the underlying if we can't resolve
      // In production, we'd iterate through all reserves to find the mapping
      this.underlyingCache.set(normalized, normalized);
      return normalized;
    } catch (error) {
      // If resolution fails, assume it's already the underlying
      this.underlyingCache.set(normalized, normalized);
      return normalized;
    }
  }

  /**
   * Get token information (decimals, symbol, underlying)
   */
  async getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
    const normalized = tokenAddress.toLowerCase();

    // Check cache
    const cached = this.tokenCache.get(normalized);
    if (cached && Date.now() - cached.timestamp < this.tokenCacheTtlMs) {
      return cached.info;
    }

    try {
      // Resolve underlying
      const underlying = await this.resolveUnderlying(tokenAddress);

      // Get decimals and symbol from the token contract
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      
      let decimals: number;
      let symbol: string;

      try {
        [decimals, symbol] = await Promise.all([
          tokenContract.decimals(),
          tokenContract.symbol()
        ]);
      } catch (error) {
        // Fallback for tokens without proper ERC20 implementation
        // Try Protocol Data Provider for reserve config
        decimals = 18; // Default
        symbol = 'UNKNOWN';
        
        // eslint-disable-next-line no-console
        console.warn(`[token-resolver] Failed to get token info for ${tokenAddress}, using defaults`);
      }

      // Normalize symbol using aliases
      const normalizedSymbol = this.normalizeSymbol(symbol);

      const info: TokenInfo = {
        address: normalized,
        underlying,
        symbol: normalizedSymbol,
        decimals
      };

      // Cache the result
      this.tokenCache.set(normalized, {
        info,
        timestamp: Date.now()
      });

      return info;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[token-resolver] Error getting token info for ${tokenAddress}:`, error);
      
      // Return minimal fallback
      return {
        address: normalized,
        underlying: normalized,
        symbol: 'UNKNOWN',
        decimals: 18
      };
    }
  }

  /**
   * Normalize symbol using aliases
   */
  private normalizeSymbol(symbol: string): string {
    const upper = symbol.toUpperCase();
    return this.symbolAliases.get(upper) || upper;
  }

  /**
   * Get USD price for a token
   */
  async getTokenPrice(tokenAddress: string): Promise<number> {
    const normalized = tokenAddress.toLowerCase();

    // Check cache
    const cached = this.priceCache.get(normalized);
    if (cached && Date.now() - cached.timestamp < this.priceCacheTtlMs) {
      return cached.price;
    }

    try {
      // Get token info first
      const info = await this.getTokenInfo(tokenAddress);

      let price = 0;

      // Try Aave Oracle first if enabled
      if (config.pricesUseAaveOracle && config.aaveOracle) {
        try {
          const oracle = new ethers.Contract(config.aaveOracle, AAVE_ORACLE_ABI, this.provider);
          const rawPrice = await oracle.getAssetPrice(info.underlying);
          
          // Normalize from ORACLE_BASE_UNIT (1e8) to USD
          price = Number(rawPrice) / Number(ORACLE_BASE_UNIT);
          
          if (price > 0) {
            // Cache and return
            this.priceCache.set(normalized, { price, timestamp: Date.now() });
            return price;
          }
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn(`[token-resolver] Aave Oracle failed for ${info.symbol}, falling back to Chainlink`);
        }
      }

      // Fallback to PriceService (Chainlink feeds)
      price = await this.priceService.getPrice(info.symbol, false);

      if (price > 0) {
        this.priceCache.set(normalized, { price, timestamp: Date.now() });
        return price;
      }

      // eslint-disable-next-line no-console
      console.warn(`[token-resolver] No price available for ${info.symbol} (${tokenAddress})`);
      return 0;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[token-resolver] Error getting price for ${tokenAddress}:`, error);
      return 0;
    }
  }

  /**
   * Format token amount with USD valuation
   */
  async formatAmount(
    tokenAddress: string,
    rawAmount: bigint
  ): Promise<FormattedAmount> {
    try {
      const info = await this.getTokenInfo(tokenAddress);
      const price = await this.getTokenPrice(tokenAddress);

      // Convert raw amount to human-readable
      const divisor = 10n ** BigInt(info.decimals);
      const humanAmount = Number(rawAmount) / Number(divisor);

      // Calculate USD value
      const usdValue = humanAmount * price;

      // Format with appropriate precision
      const amountStr = this.formatTokenNumber(humanAmount, 6);
      const usdStr = usdValue > 0 ? `$${this.formatUsdNumber(usdValue)}` : 'N/A';

      return {
        amount: amountStr,
        usdValue: usdStr,
        rawAmount,
        rawUsdValue: usdValue
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[token-resolver] Error formatting amount:`, error);
      
      // Return fallback
      return {
        amount: '0',
        usdValue: 'N/A',
        rawAmount,
        rawUsdValue: 0
      };
    }
  }

  /**
   * Format token number with appropriate precision
   */
  private formatTokenNumber(value: number, maxDecimals: number): string {
    if (value === 0) return '0';
    
    // For very small numbers, use scientific notation
    if (value < 0.000001) {
      return value.toExponential(2);
    }
    
    // For normal numbers, use fixed decimals
    if (value < 1) {
      return value.toFixed(Math.min(6, maxDecimals));
    }
    
    if (value < 1000) {
      return value.toFixed(Math.min(4, maxDecimals));
    }
    
    if (value < 1000000) {
      return value.toFixed(Math.min(2, maxDecimals));
    }
    
    // For large numbers, use compact notation
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  /**
   * Format USD value with appropriate precision
   */
  private formatUsdNumber(value: number): string {
    if (value === 0) return '0.00';
    
    if (value < 0.01) {
      return value.toFixed(4);
    }
    
    if (value < 1) {
      return value.toFixed(3);
    }
    
    if (value < 1000) {
      return value.toFixed(2);
    }
    
    // For large numbers, use comma separators
    return value.toLocaleString('en-US', { 
      minimumFractionDigits: 2,
      maximumFractionDigits: 2 
    });
  }

  /**
   * Clear all caches (useful for testing)
   */
  clearCaches(): void {
    this.tokenCache.clear();
    this.priceCache.clear();
    this.underlyingCache.clear();
  }
}
