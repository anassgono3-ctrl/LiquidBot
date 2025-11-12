/**
 * AaveOracleHelper: Price and metadata lookup via Aave on-chain oracle
 * 
 * Provides USD pricing for assets using Aave's oracle (BASE_CURRENCY_UNIT=1e8)
 * and caches token metadata (decimals, symbols) with TTL.
 */

import { ethers } from 'ethers';

import { config } from '../config/index.js';

// Aave AddressesProvider ABI (minimal)
const ADDRESSES_PROVIDER_ABI = [
  'function getPriceOracle() external view returns (address)'
];

// Aave Oracle ABI (minimal)
const AAVE_ORACLE_ABI = [
  'function getAssetPrice(address asset) external view returns (uint256)',
  'function BASE_CURRENCY() external view returns (address)',
  'function BASE_CURRENCY_UNIT() external view returns (uint256)'
];

// ERC20 ABI (minimal)
const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)'
];

// Base currency unit for Aave oracle prices (8 decimals = 1e8)
const BASE_CURRENCY_UNIT = 10n ** 8n;

interface TokenMetadata {
  decimals: number;
  symbol: string;
  timestamp: number;
}

interface PriceCache {
  price: bigint; // Raw price from oracle (in BASE_CURRENCY_UNIT)
  timestamp: number;
}

/**
 * AaveOracleHelper provides price and metadata lookups via Aave oracle
 */
export class AaveOracleHelper {
  private provider: ethers.JsonRpcProvider;
  private oracleAddress: string | null = null;
  private oracle: ethers.Contract | null = null;
  private metadataCache: Map<string, TokenMetadata> = new Map();
  private priceCache: Map<string, PriceCache> = new Map();
  private readonly metadataTtlMs = 600000; // 10 minutes
  private readonly priceTtlMs = 60000; // 1 minute (for block-tagged reads)
  private initialized = false;

  constructor(provider: ethers.JsonRpcProvider) {
    this.provider = provider;
  }

  /**
   * Initialize the oracle by reading from AddressesProvider
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Get oracle address from AddressesProvider
      const addressesProvider = new ethers.Contract(
        config.aaveAddressesProvider,
        ADDRESSES_PROVIDER_ABI,
        this.provider
      );

      this.oracleAddress = await addressesProvider.getPriceOracle();
      
      if (!this.oracleAddress) {
        throw new Error('Failed to get oracle address from AddressesProvider');
      }
      
      // Initialize oracle contract
      this.oracle = new ethers.Contract(
        this.oracleAddress,
        AAVE_ORACLE_ABI,
        this.provider
      );

      this.initialized = true;
      
      // eslint-disable-next-line no-console
      console.log(`[aave-oracle] Initialized with oracle address: ${this.oracleAddress}`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[aave-oracle] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Get token decimals from ERC20 contract (with caching)
   */
  async getDecimals(tokenAddress: string): Promise<number | null> {
    const normalized = tokenAddress.toLowerCase();
    
    // Check cache
    const cached = this.metadataCache.get(normalized);
    if (cached && Date.now() - cached.timestamp < this.metadataTtlMs) {
      return cached.decimals;
    }

    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const decimals = await token.decimals();
      
      // Update cache (fetch symbol at the same time if not cached)
      const existingSymbol = cached?.symbol;
      const symbol = existingSymbol || await this.fetchSymbol(tokenAddress);
      
      this.metadataCache.set(normalized, {
        decimals: Number(decimals),
        symbol,
        timestamp: Date.now()
      });
      
      return Number(decimals);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[aave-oracle] Failed to get decimals for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Get token symbol from ERC20 contract (with caching)
   */
  async getSymbol(tokenAddress: string): Promise<string | null> {
    const normalized = tokenAddress.toLowerCase();
    
    // Check cache
    const cached = this.metadataCache.get(normalized);
    if (cached && Date.now() - cached.timestamp < this.metadataTtlMs) {
      return cached.symbol;
    }

    return await this.fetchSymbol(tokenAddress);
  }

  /**
   * Fetch symbol from contract (helper)
   */
  private async fetchSymbol(tokenAddress: string): Promise<string> {
    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const symbol = await token.symbol();
      return symbol;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[aave-oracle] Failed to get symbol for ${tokenAddress}, using address`);
      return tokenAddress.substring(0, 10);
    }
  }

  /**
   * Get asset price from Aave oracle (in BASE_CURRENCY_UNIT = 1e8)
   * @param tokenAddress Token address
   * @param blockTag Optional block tag for historical price
   * @returns Price in BASE_CURRENCY_UNIT (1e8) or null if unavailable
   */
  async getAssetPrice(tokenAddress: string, blockTag?: number | string): Promise<bigint | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.oracle) {
      return null;
    }

    const normalized = tokenAddress.toLowerCase();
    
    // For current block, check cache
    if (!blockTag) {
      const cached = this.priceCache.get(normalized);
      if (cached && Date.now() - cached.timestamp < this.priceTtlMs) {
        return cached.price;
      }
    }

    try {
      const overrides = blockTag ? { blockTag } : {};
      const price = await this.oracle.getAssetPrice(tokenAddress, overrides);
      
      // Cache for current block only
      if (!blockTag) {
        this.priceCache.set(normalized, {
          price: BigInt(price),
          timestamp: Date.now()
        });
      }
      
      return BigInt(price);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[aave-oracle] Failed to get price for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Convert raw token amount to USD value
   * @param rawAmount Raw token amount (in token's native decimals)
   * @param tokenAddress Token address
   * @param blockTag Optional block tag for historical pricing
   * @returns USD value or null if price/decimals unavailable
   */
  async toUsd(
    rawAmount: bigint,
    tokenAddress: string,
    blockTag?: number | string
  ): Promise<number | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Get decimals
    const decimals = await this.getDecimals(tokenAddress);
    if (decimals === null) {
      return null;
    }

    // Get price
    const price = await this.getAssetPrice(tokenAddress, blockTag);
    if (price === null) {
      return null;
    }

    // Convert: (rawAmount / 10^decimals) * (price / 10^8)
    // Simplified: (rawAmount * price) / (10^decimals * 10^8)
    try {
      const tokenDivisor = 10n ** BigInt(decimals);
      const priceDivisor = BASE_CURRENCY_UNIT;
      
      // Use bigint arithmetic for precision
      const numerator = rawAmount * price;
      const denominator = tokenDivisor * priceDivisor;
      
      // Convert to float
      const usdValue = Number(numerator) / Number(denominator);
      
      return usdValue;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[aave-oracle] Failed to convert to USD for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Clear caches (useful for testing)
   */
  clearCaches(): void {
    this.metadataCache.clear();
    this.priceCache.clear();
  }

  /**
   * Check if oracle is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}
