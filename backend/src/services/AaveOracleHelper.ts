/**
 * AaveOracleHelper: Price and metadata lookup via Aave on-chain oracle
 * 
 * Provides USD pricing for assets using Aave's oracle (BASE_CURRENCY_UNIT=1e8)
 * and caches token metadata (decimals, symbols) with TTL.
 */

import { ethers } from 'ethers';

import { config } from '../config/index.js';
import { computeUsd } from '../utils/CanonicalUsdMath.js';

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
  private tokenRegistry: import('./TokenMetadataRegistry.js').TokenMetadataRegistry | null = null;

  constructor(provider: ethers.JsonRpcProvider) {
    this.provider = provider;
  }

  /**
   * Set TokenMetadataRegistry instance for symbol/decimals resolution
   */
  setTokenRegistry(tokenRegistry: import('./TokenMetadataRegistry.js').TokenMetadataRegistry): void {
    this.tokenRegistry = tokenRegistry;
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
   * Get the resolved oracle address
   */
  getOracleAddress(): string | null {
    return this.oracleAddress;
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
      let decimals: number;
      let symbol: string;
      
      // Try TokenMetadataRegistry first
      if (this.tokenRegistry) {
        try {
          const metadata = await this.tokenRegistry.get(normalized);
          decimals = metadata.decimals;
          symbol = metadata.symbol;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[aave-oracle] TokenMetadataRegistry failed for ${normalized}, falling back to ERC20:`, err);
          
          // Fallback to direct ERC20 call
          const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
          decimals = Number(await token.decimals());
          symbol = cached?.symbol || await this.fetchSymbol(tokenAddress);
        }
      } else {
        // No registry, use direct ERC20 call
        const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
        decimals = Number(await token.decimals());
        symbol = cached?.symbol || await this.fetchSymbol(tokenAddress);
      }
      
      // Update cache
      this.metadataCache.set(normalized, {
        decimals,
        symbol,
        timestamp: Date.now()
      });
      
      return decimals;
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

    // Try TokenMetadataRegistry first
    if (this.tokenRegistry) {
      try {
        const metadata = await this.tokenRegistry.get(normalized);
        
        // Update cache
        this.metadataCache.set(normalized, {
          decimals: metadata.decimals,
          symbol: metadata.symbol,
          timestamp: Date.now()
        });
        
        return metadata.symbol;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[aave-oracle] TokenMetadataRegistry failed for ${normalized}, falling back to ERC20:`, err);
      }
    }

    // Fallback to direct ERC20 call
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

    // Use canonical USD computation (ensures consistency across the system)
    try {
      return computeUsd(rawAmount, decimals, price, 8);
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
