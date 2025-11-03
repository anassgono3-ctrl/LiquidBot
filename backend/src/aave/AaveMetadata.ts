// AaveMetadata: On-chain reserve enumeration, validation, and error decoding
import { ethers } from 'ethers';

import { config } from '../config/index.js';

// Aave UI Pool Data Provider ABI
const UI_POOL_DATA_PROVIDER_ABI = [
  'function getReservesList(address provider) external view returns (address[] memory)'
];

// Aave Protocol Data Provider ABI
const PROTOCOL_DATA_PROVIDER_ABI = [
  'function getReserveConfigurationData(address asset) external view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)',
  'function getReserveTokensAddresses(address asset) external view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)'
];

// ERC20 ABI for symbol lookup
const ERC20_ABI = [
  'function symbol() external view returns (string)'
];

export interface ReserveMetadata {
  underlyingAddress: string;
  symbol: string;
  decimals: number;
  liquidationThreshold: number;
  liquidationBonus: number;
  borrowingEnabled: boolean;
  usageAsCollateralEnabled: boolean;
  isActive: boolean;
  isFrozen: boolean;
}

// Aave Pool custom error mappings
export interface AaveErrorInfo {
  selector: string;
  name: string;
  explanation: string;
}

const AAVE_POOL_ERRORS: Record<string, AaveErrorInfo> = {
  '0x8622f8e4': {
    selector: '0x8622f8e4',
    name: 'COLLATERAL_CANNOT_BE_LIQUIDATED',
    explanation: 'The collateral asset is not a valid Aave reserve or cannot be liquidated'
  },
  '0x3f9a3604': {
    selector: '0x3f9a3604',
    name: 'HEALTH_FACTOR_NOT_BELOW_THRESHOLD',
    explanation: 'The user health factor is above liquidation threshold'
  },
  '0x0a4c7556': {
    selector: '0x0a4c7556',
    name: 'NO_ACTIVE_RESERVE',
    explanation: 'Reserve is not active or does not exist'
  },
  '0x4f4c1a74': {
    selector: '0x4f4c1a74',
    name: 'INVALID_AMOUNT',
    explanation: 'Invalid liquidation amount specified'
  },
  '0x59bed40b': {
    selector: '0x59bed40b',
    name: 'COLLATERAL_BALANCE_IS_ZERO',
    explanation: 'User has no collateral balance to liquidate'
  }
};

/**
 * AaveMetadata provides on-chain reserve enumeration and validation.
 * Caches reserve metadata and provides helpers for validation.
 */
export class AaveMetadata {
  private provider: ethers.JsonRpcProvider;
  private uiPoolDataProvider: ethers.Contract;
  private protocolDataProvider: ethers.Contract;
  private reserveCache = new Map<string, ReserveMetadata>();
  private lastRefreshTime = 0;
  private refreshIntervalMs = 5 * 60 * 1000; // 5 minutes
  private isInitialized = false;

  constructor(provider: ethers.JsonRpcProvider) {
    this.provider = provider;
    this.uiPoolDataProvider = new ethers.Contract(
      config.aaveUiPoolDataProvider,
      UI_POOL_DATA_PROVIDER_ABI,
      provider
    );
    this.protocolDataProvider = new ethers.Contract(
      config.aaveProtocolDataProvider,
      PROTOCOL_DATA_PROVIDER_ABI,
      provider
    );
  }

  /**
   * Initialize and enumerate reserves
   */
  async initialize(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[aave-metadata] Initializing reserve metadata...');
    
    try {
      await this.refreshReserves();
      this.isInitialized = true;
      
      // eslint-disable-next-line no-console
      console.log(`[aave-metadata] Initialized with ${this.reserveCache.size} reserves`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[aave-metadata] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Refresh reserve list from on-chain
   */
  async refreshReserves(blockTag?: number | string): Promise<void> {
    try {
      // Get list of all reserves
      const overrides = blockTag ? { blockTag } : {};
      const reservesList: string[] = await this.uiPoolDataProvider.getReservesList(
        config.aaveAddressesProvider,
        overrides
      );

      // eslint-disable-next-line no-console
      console.log(`[aave-metadata] Fetching metadata for ${reservesList.length} reserves${blockTag ? ` at block ${blockTag}` : ''}...`);

      // Fetch metadata for each reserve
      const metadataPromises = reservesList.map(async (underlyingAddress) => {
        try {
          // Get configuration data
          const configData = await this.protocolDataProvider.getReserveConfigurationData(
            underlyingAddress,
            overrides
          );

          // Get symbol from ERC20 contract
          let symbol = 'UNKNOWN';
          try {
            const token = new ethers.Contract(underlyingAddress, ERC20_ABI, this.provider);
            symbol = await token.symbol(overrides);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`[aave-metadata] Failed to fetch symbol for ${underlyingAddress}:`, err);
          }

          const metadata: ReserveMetadata = {
            underlyingAddress: underlyingAddress.toLowerCase(),
            symbol,
            decimals: Number(configData.decimals),
            liquidationThreshold: Number(configData.liquidationThreshold),
            liquidationBonus: Number(configData.liquidationBonus),
            borrowingEnabled: configData.borrowingEnabled,
            usageAsCollateralEnabled: configData.usageAsCollateralEnabled,
            isActive: configData.isActive,
            isFrozen: configData.isFrozen
          };

          return metadata;
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`[aave-metadata] Failed to fetch metadata for ${underlyingAddress}:`, error);
          return null;
        }
      });

      const metadataResults = await Promise.all(metadataPromises);

      // Update cache
      this.reserveCache.clear();
      for (const metadata of metadataResults) {
        if (metadata && metadata.isActive) {
          this.reserveCache.set(metadata.underlyingAddress, metadata);
        }
      }

      this.lastRefreshTime = Date.now();

      // eslint-disable-next-line no-console
      console.log(`[aave-metadata] Cached ${this.reserveCache.size} active reserves`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[aave-metadata] Failed to refresh reserves:', error);
      throw error;
    }
  }

  /**
   * Check if periodic refresh is needed and perform it
   */
  async maybeRefresh(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRefreshTime > this.refreshIntervalMs) {
      // eslint-disable-next-line no-console
      console.log('[aave-metadata] Periodic refresh triggered');
      await this.refreshReserves();
    }
  }

  /**
   * Check if an address is a valid Aave reserve
   */
  isReserve(address: string): boolean {
    return this.reserveCache.has(address.toLowerCase());
  }

  /**
   * Get reserve metadata
   */
  getReserve(address: string): ReserveMetadata | undefined {
    return this.reserveCache.get(address.toLowerCase());
  }

  /**
   * List all reserves
   */
  listReserves(): ReserveMetadata[] {
    return Array.from(this.reserveCache.values());
  }

  /**
   * Get reserve count
   */
  getReserveCount(): number {
    return this.reserveCache.size;
  }

  /**
   * Decode Aave Pool custom error
   */
  static decodeAaveError(errorData: string): AaveErrorInfo | null {
    if (!errorData || errorData.length < 10) {
      return null;
    }

    const selector = errorData.slice(0, 10);
    return AAVE_POOL_ERRORS[selector] || null;
  }

  /**
   * Format decoded error with context
   */
  static formatAaveError(
    errorData: string,
    context: {
      user?: string;
      debtAsset?: string;
      collateralAsset?: string;
      debtToCover?: string;
      healthFactor?: number;
    }
  ): string {
    const errorInfo = AaveMetadata.decodeAaveError(errorData);
    
    if (!errorInfo) {
      return `Unknown Aave error: ${errorData}`;
    }

    const parts = [
      `Aave Error: ${errorInfo.name}`,
      errorInfo.explanation
    ];

    if (context.user) {
      parts.push(`User: ${context.user}`);
    }
    if (context.debtAsset) {
      parts.push(`Debt Asset: ${context.debtAsset}`);
    }
    if (context.collateralAsset) {
      parts.push(`Collateral Asset: ${context.collateralAsset}`);
    }
    if (context.debtToCover) {
      parts.push(`Debt To Cover: ${context.debtToCover}`);
    }
    if (context.healthFactor !== undefined) {
      parts.push(`Health Factor: ${context.healthFactor.toFixed(4)}`);
    }

    return parts.join(' | ');
  }

  /**
   * Check if service is initialized
   */
  initialized(): boolean {
    return this.isInitialized;
  }
}
