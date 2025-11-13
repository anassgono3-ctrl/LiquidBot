// FeedDiscoveryService: Auto-discover Chainlink price feeds and debt tokens for Aave reserves
// Queries Aave contracts to resolve reserve → Chainlink aggregator and variableDebtToken mappings

import { JsonRpcProvider, Contract } from 'ethers';

import { config } from '../config/index.js';
import type { AaveDataService } from './AaveDataService.js';

// Aave Oracle ABI for getting price feed sources
const AAVE_ORACLE_ABI = [
  'function getSourceOfAsset(address asset) external view returns (address)'
];

export interface DiscoveredReserve {
  asset: string;           // Underlying asset address
  symbol: string;          // Asset symbol (e.g., "WETH", "USDC")
  chainlinkAggregator: string | null;  // Chainlink price feed address
  variableDebtToken: string;  // Variable debt token address
}

export interface FeedDiscoveryOptions {
  skipInactive?: boolean;  // Skip reserves that are not active
  onlyBorrowEnabled?: boolean;  // Only include reserves with borrowing enabled
}

/**
 * FeedDiscoveryService auto-discovers Chainlink feeds and debt tokens
 * for all active Aave reserves.
 */
export class FeedDiscoveryService {
  private provider: JsonRpcProvider;
  private aaveDataService: AaveDataService;
  private aaveOracle: Contract | null = null;

  constructor(provider: JsonRpcProvider, aaveDataService: AaveDataService) {
    this.provider = provider;
    this.aaveDataService = aaveDataService;
    
    // Initialize Aave Oracle contract for feed discovery
    try {
      this.aaveOracle = new Contract(config.aaveOracle, AAVE_ORACLE_ABI, provider);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[feed-discovery] Failed to initialize Aave Oracle:', err);
    }
  }

  /**
   * Discover all reserves with their Chainlink feeds and debt tokens
   */
  async discoverReserves(options: FeedDiscoveryOptions = {}): Promise<DiscoveredReserve[]> {
    const { skipInactive = true, onlyBorrowEnabled = false } = options;

    // eslint-disable-next-line no-console
    console.log('[feed-discovery] Starting reserve discovery...');

    try {
      // Get all reserves from Aave
      const reserves = await this.aaveDataService.getReservesList();
      
      // eslint-disable-next-line no-console
      console.log(`[feed-discovery] Found ${reserves.length} reserves, fetching details...`);

      const discovered: DiscoveredReserve[] = [];

      for (const asset of reserves) {
        try {
          // Get reserve configuration
          const configData = await this.aaveDataService.getReserveConfigurationData(asset);
          
          // Filter based on options
          if (skipInactive && !configData.isActive) {
            continue;
          }
          
          if (onlyBorrowEnabled && !configData.borrowingEnabled) {
            continue;
          }

          // Get token addresses (including variableDebtToken)
          const tokenAddresses = await this.aaveDataService.getReserveTokenAddresses(asset);

          // Try to get symbol from metadata cache or fallback
          let symbol = await this.resolveSymbol(asset);

          // Get Chainlink aggregator address
          let chainlinkAggregator: string | null = null;
          if (this.aaveOracle) {
            try {
              chainlinkAggregator = await this.aaveOracle.getSourceOfAsset(asset);
              
              // Validate it's not zero address
              if (chainlinkAggregator === '0x0000000000000000000000000000000000000000') {
                chainlinkAggregator = null;
              }
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn(`[feed-discovery] Failed to get Chainlink feed for ${symbol}:`, err);
              chainlinkAggregator = null;
            }
          }

          discovered.push({
            asset: asset.toLowerCase(),
            symbol,
            chainlinkAggregator: chainlinkAggregator?.toLowerCase() || null,
            variableDebtToken: tokenAddresses.variableDebtTokenAddress.toLowerCase()
          });

          // eslint-disable-next-line no-console
          console.log(
            `[feed-discovery] ${symbol}: ` +
            `feed=${chainlinkAggregator ? chainlinkAggregator.slice(0, 10) + '...' : 'none'}, ` +
            `debtToken=${tokenAddresses.variableDebtTokenAddress.slice(0, 10)}...`
          );
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[feed-discovery] Failed to process reserve ${asset}:`, err);
          continue;
        }
      }

      // eslint-disable-next-line no-console
      console.log(`[feed-discovery] Discovered ${discovered.length} reserves with valid configuration`);

      return discovered;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[feed-discovery] Failed to discover reserves:', err);
      throw err;
    }
  }

  /**
   * Resolve asset symbol from address
   * Uses AaveDataService metadata cache or ERC20 contract call
   */
  private async resolveSymbol(asset: string): Promise<string> {
    try {
      // Try to use metadata cache if available
      if ((this.aaveDataService as any).metadataCache) {
        const metadata = await (this.aaveDataService as any).metadataCache.getMetadata(asset);
        if (metadata?.symbol) {
          return metadata.symbol;
        }
      }

      // Fallback: Query ERC20 contract directly
      const erc20Abi = ['function symbol() external view returns (string)'];
      const token = new Contract(asset, erc20Abi, this.provider);
      const symbol = await token.symbol();
      return symbol;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[feed-discovery] Failed to resolve symbol for ${asset}, using address`);
      // Return shortened address as fallback
      return asset.slice(0, 10);
    }
  }

  /**
   * Build Chainlink feeds map from discovered reserves (for config compatibility)
   * Returns map of symbol → aggregator address
   */
  static buildFeedsMap(reserves: DiscoveredReserve[]): Record<string, string> {
    const feeds: Record<string, string> = {};
    
    for (const reserve of reserves) {
      if (reserve.chainlinkAggregator) {
        feeds[reserve.symbol] = reserve.chainlinkAggregator;
      }
    }
    
    return feeds;
  }

  /**
   * Merge discovered feeds with manual config
   * Manual config takes precedence over discovered feeds
   */
  static mergeFeedsWithConfig(
    discoveredFeeds: Record<string, string>,
    manualFeeds?: string
  ): Record<string, string> {
    const result = { ...discoveredFeeds };
    
    if (!manualFeeds) {
      return result;
    }

    // Parse manual feeds from config format (e.g., "WETH:0x123,USDC:0x456")
    const entries = manualFeeds.split(',').map(e => e.trim()).filter(e => e.length > 0);
    
    for (const entry of entries) {
      const [symbol, address] = entry.split(':').map(s => s.trim());
      if (symbol && address) {
        // Manual config overrides discovered
        result[symbol] = address.toLowerCase();
      }
    }
    
    return result;
  }
}
