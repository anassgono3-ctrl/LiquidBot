/**
 * AssetMetadataCache: Caches asset metadata including symbols, decimals, and price feed info.
 * Provides consistent decimal handling across the liquidation pipeline.
 */

import { ethers } from 'ethers';

import { config } from '../config/index.js';

// ERC20 ABI for symbol and decimals
const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
  'function totalSupply() external view returns (uint256)'
];

// Chainlink Aggregator ABI
const CHAINLINK_AGGREGATOR_ABI = [
  'function decimals() external view returns (uint8)',
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
];

// Aave Oracle ABI
const AAVE_ORACLE_ABI = [
  'function getAssetPrice(address asset) external view returns (uint256)',
  'function getSourceOfAsset(address asset) external view returns (address)'
];

export interface AssetMetadata {
  address: string;
  symbol: string;
  decimals: number;
  totalSupply?: bigint;
  priceFeedAddress?: string;
  priceFeedDecimals?: number;
  lastUpdate: number;
}

export interface PriceData {
  price: bigint;
  decimals: number;
  timestamp: number;
}

/**
 * Cache TTL (time-to-live) for different data types
 */
const METADATA_TTL_MS = 60 * 60 * 1000; // 1 hour (symbols/decimals rarely change)
const PRICE_TTL_MS = 30 * 1000; // 30 seconds (prices update frequently)
const TOTAL_SUPPLY_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * AssetMetadataCache provides efficient caching of asset metadata and prices.
 * Reduces RPC calls and ensures consistent decimal handling.
 */
export class AssetMetadataCache {
  private provider: ethers.JsonRpcProvider;
  private aaveOracle: ethers.Contract;
  private metadataCache = new Map<string, AssetMetadata>();
  private priceCache = new Map<string, PriceData>();
  private ethPriceCache: PriceData | null = null;
  private ethPriceFeed: string | null = null;
  private tokenRegistry: import('./TokenMetadataRegistry.js').TokenMetadataRegistry | null = null;

  constructor(provider: ethers.JsonRpcProvider) {
    this.provider = provider;
    this.aaveOracle = new ethers.Contract(
      config.aaveOracle,
      AAVE_ORACLE_ABI,
      provider
    );
  }

  /**
   * Set TokenMetadataRegistry instance for symbol resolution
   */
  setTokenRegistry(tokenRegistry: import('./TokenMetadataRegistry.js').TokenMetadataRegistry): void {
    this.tokenRegistry = tokenRegistry;
  }

  /**
   * Get or fetch asset metadata (symbol, decimals, price feed info)
   */
  async getAssetMetadata(assetAddress: string): Promise<AssetMetadata> {
    const normalizedAddress = assetAddress.toLowerCase();
    const cached = this.metadataCache.get(normalizedAddress);
    
    // Return cached if fresh
    if (cached && Date.now() - cached.lastUpdate < METADATA_TTL_MS) {
      return cached;
    }

    // Fetch fresh metadata
    const metadata = await this.fetchAssetMetadata(normalizedAddress);
    this.metadataCache.set(normalizedAddress, metadata);
    return metadata;
  }

  /**
   * Fetch asset metadata from on-chain
   */
  private async fetchAssetMetadata(assetAddress: string): Promise<AssetMetadata> {
    const token = new ethers.Contract(assetAddress, ERC20_ABI, this.provider);
    
    try {
      let symbol: string;
      let decimals: number;
      
      // Try to use TokenMetadataRegistry first for consistent resolution
      if (this.tokenRegistry) {
        try {
          const metadata = await this.tokenRegistry.get(assetAddress);
          symbol = metadata.symbol;
          decimals = metadata.decimals;
          
          // Log if resolved via registry (for debugging)
          if (metadata.source !== 'unknown') {
            // eslint-disable-next-line no-console
            console.log(`[metadata-cache] Resolved via TokenMetadataRegistry: ${assetAddress} -> ${symbol} (source: ${metadata.source})`);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[metadata-cache] TokenMetadataRegistry failed for ${assetAddress}, falling back to direct ERC20 call:`, err);
          
          // Fallback to direct ERC20 calls
          [symbol, decimals] = await Promise.all([
            token.symbol(),
            token.decimals().then(d => Number(d))
          ]);
        }
      } else {
        // No registry available, use direct ERC20 calls
        [symbol, decimals] = await Promise.all([
          token.symbol(),
          token.decimals().then(d => Number(d))
        ]);
      }

      // Try to get price feed address from Aave oracle
      let priceFeedAddress: string | undefined;
      let priceFeedDecimals: number | undefined;
      
      try {
        priceFeedAddress = await this.aaveOracle.getSourceOfAsset(assetAddress);
        
        // If we got a price feed, fetch its decimals
        if (priceFeedAddress && priceFeedAddress !== ethers.ZeroAddress) {
          const aggregator = new ethers.Contract(
            priceFeedAddress,
            CHAINLINK_AGGREGATOR_ABI,
            this.provider
          );
          priceFeedDecimals = Number(await aggregator.decimals());
        }
      } catch (error) {
        // Price feed lookup failed - not critical, we can still use Aave oracle
        // eslint-disable-next-line no-console
        console.warn(`[metadata-cache] Failed to get price feed for ${assetAddress}:`, error instanceof Error ? error.message : error);
      }

      return {
        address: assetAddress,
        symbol,
        decimals,
        priceFeedAddress,
        priceFeedDecimals: priceFeedDecimals || 8, // Default to 8 (Chainlink standard)
        lastUpdate: Date.now()
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[metadata-cache] Failed to fetch metadata for ${assetAddress}:`, error);
      
      // Return fallback metadata
      return {
        address: assetAddress,
        symbol: 'UNKNOWN',
        decimals: 18, // Safe default
        lastUpdate: Date.now()
      };
    }
  }

  /**
   * Get asset price from Aave oracle (cached)
   */
  async getAssetPrice(assetAddress: string): Promise<PriceData> {
    const normalizedAddress = assetAddress.toLowerCase();
    const cached = this.priceCache.get(normalizedAddress);
    
    // Return cached if fresh
    if (cached && Date.now() - cached.timestamp < PRICE_TTL_MS) {
      return cached;
    }

    // Fetch fresh price
    try {
      const price = await this.aaveOracle.getAssetPrice(assetAddress);
      const priceData: PriceData = {
        price,
        decimals: 8, // Aave oracle returns prices in 8 decimals (USD base)
        timestamp: Date.now()
      };
      
      this.priceCache.set(normalizedAddress, priceData);
      return priceData;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[metadata-cache] Failed to fetch price for ${assetAddress}:`, error);
      throw error;
    }
  }

  /**
   * Get ETH/USD price from Chainlink (cached)
   * This is used to convert Aave's ETH-denominated base amounts to USD
   */
  async getEthPrice(): Promise<PriceData> {
    // Return cached if fresh
    if (this.ethPriceCache && Date.now() - this.ethPriceCache.timestamp < PRICE_TTL_MS) {
      return this.ethPriceCache;
    }

    // Get ETH price feed address (first time only)
    if (!this.ethPriceFeed) {
      // Try to parse from config first (if it's a JSON string mapping)
      const chainlinkFeedsStr = config.chainlinkFeeds;
      if (chainlinkFeedsStr) {
        try {
          const feeds = JSON.parse(chainlinkFeedsStr);
          if (feeds.ETH) {
            this.ethPriceFeed = feeds.ETH;
          }
        } catch (error) {
          // Not JSON or invalid - ignore
        }
      }
      
      // Fallback: Base mainnet ETH/USD feed
      if (!this.ethPriceFeed) {
        this.ethPriceFeed = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
        // eslint-disable-next-line no-console
        console.warn('[metadata-cache] ETH price feed not in config, using Base mainnet default');
      }
    }

    // Fetch fresh ETH price
    try {
      const aggregator = new ethers.Contract(
        this.ethPriceFeed,
        CHAINLINK_AGGREGATOR_ABI,
        this.provider
      );
      
      const [, answer, , ,] = await aggregator.latestRoundData();
      const decimals = Number(await aggregator.decimals());
      
      this.ethPriceCache = {
        price: answer,
        decimals,
        timestamp: Date.now()
      };
      
      return this.ethPriceCache;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[metadata-cache] Failed to fetch ETH price:', error);
      throw error;
    }
  }

  /**
   * Get total supply for an asset (cached, used for sanity checks)
   */
  async getTotalSupply(assetAddress: string): Promise<bigint> {
    const metadata = await this.getAssetMetadata(assetAddress);
    
    // Return cached if fresh
    if (metadata.totalSupply !== undefined && 
        Date.now() - metadata.lastUpdate < TOTAL_SUPPLY_TTL_MS) {
      return metadata.totalSupply;
    }

    // Fetch fresh total supply
    try {
      const token = new ethers.Contract(assetAddress, ERC20_ABI, this.provider);
      const totalSupply = await token.totalSupply();
      
      // Update cache
      metadata.totalSupply = totalSupply;
      metadata.lastUpdate = Date.now();
      this.metadataCache.set(assetAddress.toLowerCase(), metadata);
      
      return totalSupply;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[metadata-cache] Failed to fetch total supply for ${assetAddress}:`, error);
      throw error;
    }
  }

  /**
   * Clear all caches (useful for testing or manual refresh)
   */
  clearCache(): void {
    this.metadataCache.clear();
    this.priceCache.clear();
    this.ethPriceCache = null;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    metadataCount: number;
    priceCount: number;
    hasEthPrice: boolean;
  } {
    return {
      metadataCount: this.metadataCache.size,
      priceCount: this.priceCache.size,
      hasEthPrice: this.ethPriceCache !== null
    };
  }
}
