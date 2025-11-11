// AaveDataService: Fetch live reserve data from Aave V3 Protocol Data Provider
import { ethers } from 'ethers';

import { config } from '../config/index.js';
import { calculateUsdValue } from '../utils/usdMath.js';

// Aave Protocol Data Provider ABI (minimal interface)
const PROTOCOL_DATA_PROVIDER_ABI = [
  'function getReserveTokensAddresses(address asset) external view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)',
  'function getReserveConfigurationData(address asset) external view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)',
  'function getUserReserveData(address asset, address user) external view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)'
];

// Aave Oracle ABI
const ORACLE_ABI = [
  'function getAssetPrice(address asset) external view returns (uint256)'
];

// Aave Pool ABI (for getUserAccountData and getReserveData)
const POOL_ABI = [
  'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function getReserveData(address asset) external view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)'
];

// Aave UI Pool Data Provider ABI (for getting all reserves list)
const UI_POOL_DATA_PROVIDER_ABI = [
  'function getReservesList(address provider) external view returns (address[] memory)',
  'function getUserReservesData(address provider, address user) external view returns (tuple(address underlyingAsset, uint256 scaledATokenBalance, bool usageAsCollateralEnabledOnUser, uint256 stableBorrowRate, uint256 scaledVariableDebt, uint256 principalStableDebt, uint256 stableBorrowLastUpdateTimestamp)[] memory, uint8)'
];

export interface ReserveTokenAddresses {
  aTokenAddress: string;
  stableDebtTokenAddress: string;
  variableDebtTokenAddress: string;
}

export interface ReserveConfigurationData {
  decimals: bigint;
  ltv: bigint;
  liquidationThreshold: bigint;
  liquidationBonus: bigint;
  reserveFactor: bigint;
  usageAsCollateralEnabled: boolean;
  borrowingEnabled: boolean;
  stableBorrowRateEnabled: boolean;
  isActive: boolean;
  isFrozen: boolean;
}

export interface UserReserveData {
  currentATokenBalance: bigint;
  currentStableDebt: bigint;
  currentVariableDebt: bigint;
  principalStableDebt: bigint;
  scaledVariableDebt: bigint;
  stableBorrowRate: bigint;
  liquidityRate: bigint;
  stableRateLastUpdated: bigint;
  usageAsCollateralEnabled: boolean;
}

export interface UserAccountData {
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  availableBorrowsBase: bigint;
  currentLiquidationThreshold: bigint;
  ltv: bigint;
  healthFactor: bigint;
}

export interface ReserveData {
  asset: string;
  symbol: string;
  decimals: number;
  aTokenBalance: bigint;
  stableDebt: bigint;
  variableDebt: bigint;
  totalDebt: bigint;
  usageAsCollateralEnabled: boolean;
  priceInUsd: number;
  priceRaw: bigint;  // Raw oracle price in 1e8 format
  debtValueUsd: number;
  collateralValueUsd: number;
}

/**
 * AaveDataService provides access to live Aave V3 protocol data.
 * Used for fetching reserve configurations, debt balances, and oracle prices.
 */
export class AaveDataService {
  private provider: ethers.JsonRpcProvider | null = null;
  private protocolDataProvider: ethers.Contract | null = null;
  private oracle: ethers.Contract | null = null;
  private pool: ethers.Contract | null = null;
  private uiPoolDataProvider: ethers.Contract | null = null;

  constructor(provider?: ethers.JsonRpcProvider) {
    if (provider) {
      this.provider = provider;
      this.initializeContracts();
    }
  }

  /**
   * Initialize contract instances
   */
  private initializeContracts(): void {
    if (!this.provider) {
      return;
    }

    this.protocolDataProvider = new ethers.Contract(
      config.aaveProtocolDataProvider,
      PROTOCOL_DATA_PROVIDER_ABI,
      this.provider
    );

    this.oracle = new ethers.Contract(
      config.aaveOracle,
      ORACLE_ABI,
      this.provider
    );

    this.pool = new ethers.Contract(
      config.aavePool,
      POOL_ABI,
      this.provider
    );

    this.uiPoolDataProvider = new ethers.Contract(
      config.aaveUiPoolDataProvider,
      UI_POOL_DATA_PROVIDER_ABI,
      this.provider
    );
  }

  /**
   * Check if the service is initialized with a provider
   */
  isInitialized(): boolean {
    return this.provider !== null && this.protocolDataProvider !== null;
  }

  /**
   * Get reserve token addresses (aToken, stableDebt, variableDebt)
   */
  async getReserveTokenAddresses(asset: string): Promise<ReserveTokenAddresses> {
    if (!this.protocolDataProvider) {
      throw new Error('AaveDataService not initialized with provider');
    }

    const result = await this.protocolDataProvider.getReserveTokensAddresses(asset);
    return {
      aTokenAddress: result.aTokenAddress,
      stableDebtTokenAddress: result.stableDebtTokenAddress,
      variableDebtTokenAddress: result.variableDebtTokenAddress
    };
  }

  /**
   * Get reserve configuration data including liquidation bonus
   */
  async getReserveConfigurationData(asset: string): Promise<ReserveConfigurationData> {
    if (!this.protocolDataProvider) {
      throw new Error('AaveDataService not initialized with provider');
    }

    const result = await this.protocolDataProvider.getReserveConfigurationData(asset);
    return {
      decimals: result.decimals,
      ltv: result.ltv,
      liquidationThreshold: result.liquidationThreshold,
      liquidationBonus: result.liquidationBonus,
      reserveFactor: result.reserveFactor,
      usageAsCollateralEnabled: result.usageAsCollateralEnabled,
      borrowingEnabled: result.borrowingEnabled,
      stableBorrowRateEnabled: result.stableBorrowRateEnabled,
      isActive: result.isActive,
      isFrozen: result.isFrozen
    };
  }

  /**
   * Get user's debt balances for a specific reserve
   */
  async getUserReserveData(asset: string, user: string): Promise<UserReserveData> {
    if (!this.protocolDataProvider) {
      throw new Error('AaveDataService not initialized with provider');
    }

    const result = await this.protocolDataProvider.getUserReserveData(asset, user);
    return {
      currentATokenBalance: result.currentATokenBalance,
      currentStableDebt: result.currentStableDebt,
      currentVariableDebt: result.currentVariableDebt,
      principalStableDebt: result.principalStableDebt,
      scaledVariableDebt: result.scaledVariableDebt,
      stableBorrowRate: result.stableBorrowRate,
      liquidityRate: result.liquidityRate,
      stableRateLastUpdated: result.stableRateLastUpdated,
      usageAsCollateralEnabled: result.usageAsCollateralEnabled
    };
  }

  /**
   * Get asset price from Aave Oracle (in base currency, usually USD with 8 decimals)
   */
  async getAssetPrice(asset: string): Promise<bigint> {
    if (!this.oracle) {
      throw new Error('AaveDataService not initialized with provider');
    }

    return await this.oracle.getAssetPrice(asset);
  }

  /**
   * Get user account data (including health factor)
   */
  async getUserAccountData(user: string): Promise<UserAccountData> {
    if (!this.pool) {
      throw new Error('AaveDataService not initialized with provider');
    }

    const result = await this.pool.getUserAccountData(user);
    return {
      totalCollateralBase: result.totalCollateralBase,
      totalDebtBase: result.totalDebtBase,
      availableBorrowsBase: result.availableBorrowsBase,
      currentLiquidationThreshold: result.currentLiquidationThreshold,
      ltv: result.ltv,
      healthFactor: result.healthFactor
    };
  }

  /**
   * Calculate total debt for a user's reserve (variable + stable)
   * Properly expands scaled variable debt using the reserve's variable borrow index
   */
  async getTotalDebt(asset: string, user: string): Promise<bigint> {
    const userData = await this.getUserReserveData(asset, user);
    
    // Get the reserve's variable borrow index to expand scaled debt
    let principalVariableDebt: bigint;
    
    // Check if we have scaledVariableDebt that needs expansion
    if (userData.scaledVariableDebt > 0n) {
      try {
        // Fetch reserve data to get variableBorrowIndex
        const reserveData = await this.getReserveData(asset);
        const variableBorrowIndex = reserveData.variableBorrowIndex;
        
        // Expand scaled debt: principalVariableDebt = scaledVariableDebt * variableBorrowIndex / RAY
        const RAY = BigInt(10 ** 27);
        principalVariableDebt = (userData.scaledVariableDebt * variableBorrowIndex) / RAY;
        
        // If currentVariableDebt is also provided and differs significantly,
        // prefer the expanded value as it's more accurate
        if (userData.currentVariableDebt > 0n) {
          // Use the expanded value as it accounts for accrued interest
          principalVariableDebt = principalVariableDebt;
        }
      } catch (error) {
        // Fallback to currentVariableDebt if reserve data fetch fails
        principalVariableDebt = userData.currentVariableDebt;
      }
    } else {
      // No scaled debt, use current variable debt directly
      principalVariableDebt = userData.currentVariableDebt;
    }
    
    return principalVariableDebt + userData.currentStableDebt;
  }
  
  /**
   * Get reserve data including indices and rates
   */
  async getReserveData(asset: string): Promise<{
    unbacked: bigint;
    accruedToTreasuryScaled: bigint;
    totalAToken: bigint;
    totalStableDebt: bigint;
    totalVariableDebt: bigint;
    liquidityRate: bigint;
    variableBorrowRate: bigint;
    stableBorrowRate: bigint;
    averageStableBorrowRate: bigint;
    liquidityIndex: bigint;
    variableBorrowIndex: bigint;
    lastUpdateTimestamp: bigint;
  }> {
    if (!this.pool) {
      throw new Error('AaveDataService not initialized with provider');
    }

    const result = await this.pool.getReserveData(asset);
    return {
      unbacked: result.unbacked,
      accruedToTreasuryScaled: result.accruedToTreasuryScaled,
      totalAToken: result.totalAToken,
      totalStableDebt: result.totalStableDebt,
      totalVariableDebt: result.totalVariableDebt,
      liquidityRate: result.liquidityRate,
      variableBorrowRate: result.variableBorrowRate,
      stableBorrowRate: result.stableBorrowRate,
      averageStableBorrowRate: result.averageStableBorrowRate,
      liquidityIndex: result.liquidityIndex,
      variableBorrowIndex: result.variableBorrowIndex,
      lastUpdateTimestamp: result.lastUpdateTimestamp
    };
  }

  /**
   * Get liquidation bonus percentage for a reserve (as decimal, e.g., 0.05 for 5%)
   */
  async getLiquidationBonusPct(asset: string): Promise<number> {
    const config = await this.getReserveConfigurationData(asset);
    // liquidationBonus is in basis points with 10000 offset
    // e.g., 10500 means 5% bonus (105% of debt = 1.05)
    const bonusBps = Number(config.liquidationBonus) - 10000;
    return bonusBps / 10000;
  }

  /**
   * Get list of all reserves in the protocol
   */
  async getReservesList(): Promise<string[]> {
    if (!this.uiPoolDataProvider) {
      throw new Error('AaveDataService not initialized with provider');
    }

    return await this.uiPoolDataProvider.getReservesList(config.aaveAddressesProvider);
  }

  /**
   * Get all reserves data for a user (debts and collateral)
   * Returns enriched reserve data with symbols, decimals, prices, and USD values
   */
  async getAllUserReserves(userAddress: string): Promise<ReserveData[]> {
    if (!this.protocolDataProvider || !this.oracle) {
      throw new Error('AaveDataService not initialized with provider');
    }

    // Get all reserves in the protocol
    const reserves = await this.getReservesList();
    
    // Fetch user data for each reserve
    const results: ReserveData[] = [];
    
    for (const asset of reserves) {
      try {
        // Get user reserve data
        const userData = await this.getUserReserveData(asset, userAddress);
        // Use getTotalDebt which properly expands scaled variable debt
        const totalDebt = await this.getTotalDebt(asset, userAddress);
        
        // Skip reserves with no position (no debt and no collateral)
        if (totalDebt === 0n && userData.currentATokenBalance === 0n) {
          continue;
        }

        // Get reserve configuration for decimals
        const reserveConfig = await this.getReserveConfigurationData(asset);
        const decimals = Number(reserveConfig.decimals);

        // Get price from oracle (in USD with 8 decimals)
        const priceRaw = await this.getAssetPrice(asset);
        const priceInUsd = Number(priceRaw) / 1e8;

        // Calculate USD values using 1e18 normalization (same as plan resolver)
        const debtValueUsd = calculateUsdValue(totalDebt, decimals, priceRaw);
        const collateralValueUsd = calculateUsdValue(userData.currentATokenBalance, decimals, priceRaw);

        // Try to get symbol from a known mapping or use a placeholder
        const symbol = this.getSymbolForAsset(asset);

        results.push({
          asset,
          symbol,
          decimals,
          aTokenBalance: userData.currentATokenBalance,
          stableDebt: userData.currentStableDebt,
          variableDebt: userData.currentVariableDebt,
          totalDebt,
          usageAsCollateralEnabled: userData.usageAsCollateralEnabled,
          priceInUsd,
          priceRaw,
          debtValueUsd,
          collateralValueUsd
        });
      } catch (error) {
        // Skip reserves that fail (might be paused, frozen, or not active)
        continue;
      }
    }

    return results;
  }

  /**
   * Map asset address to symbol (Base mainnet)
   */
  private getSymbolForAsset(asset: string): string {
    const knownAssets: Record<string, string> = {
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
      '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 'DAI',
      '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 'USDbC',
      '0x4200000000000000000000000000000000000006': 'WETH',
      '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 'cbBTC',
      '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': 'cbETH',
    };

    return knownAssets[asset.toLowerCase()] || 'UNKNOWN';
  }
}
