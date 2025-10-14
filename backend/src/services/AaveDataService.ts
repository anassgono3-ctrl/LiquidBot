// AaveDataService: Fetch live reserve data from Aave V3 Protocol Data Provider
import { ethers } from 'ethers';

import { config } from '../config/index.js';

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

// Aave Pool ABI (for getUserAccountData)
const POOL_ABI = [
  'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
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

/**
 * AaveDataService provides access to live Aave V3 protocol data.
 * Used for fetching reserve configurations, debt balances, and oracle prices.
 */
export class AaveDataService {
  private provider: ethers.JsonRpcProvider | null = null;
  private protocolDataProvider: ethers.Contract | null = null;
  private oracle: ethers.Contract | null = null;
  private pool: ethers.Contract | null = null;

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
   */
  async getTotalDebt(asset: string, user: string): Promise<bigint> {
    const userData = await this.getUserReserveData(asset, user);
    return userData.currentVariableDebt + userData.currentStableDebt;
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
}
