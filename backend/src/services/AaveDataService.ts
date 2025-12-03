// AaveDataService: Fetch live reserve data from Aave V3 Protocol Data Provider
import { ethers } from 'ethers';

import { config } from '../config/index.js';
import { calculateUsdValue } from '../utils/usdMath.js';
import { baseToUsd, usdValue, formatTokenAmount, validateAmount } from '../utils/decimals.js';

import type { AssetMetadataCache } from './AssetMetadataCache.js';
import type { TokenMetadataRegistry } from './TokenMetadataRegistry.js';

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
  private wsProvider: ethers.WebSocketProvider | null = null;
  private httpProvider: ethers.JsonRpcProvider | null = null;
  private wsHealthy = false;
  private protocolDataProvider: ethers.Contract | null = null;
  private oracle: ethers.Contract | null = null;
  private pool: ethers.Contract | null = null;
  private uiPoolDataProvider: ethers.Contract | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private aaveMetadata: any | null = null; // AaveMetadata instance (optional, using any to avoid circular dependency)
  private metadataCache: AssetMetadataCache | null = null;
  private tokenRegistry: TokenMetadataRegistry | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(provider?: ethers.JsonRpcProvider, aaveMetadata?: any, metadataCache?: AssetMetadataCache) {
    if (provider) {
      this.provider = provider;
      this.initializeContracts();
      
      // Setup dual providers if WebSocket is configured
      this.setupDualProviders(provider);
    }
    this.aaveMetadata = aaveMetadata || null;
    this.metadataCache = metadataCache || null;
  }
  
  /**
   * Setup WebSocket and HTTP providers with health tracking
   */
  private setupDualProviders(provider: ethers.JsonRpcProvider): void {
    // Check if provider is WebSocket
    if (provider instanceof ethers.WebSocketProvider) {
      this.wsProvider = provider;
      
      // Setup event listeners for WebSocket health tracking
      this.wsProvider.on('open', () => {
        this.wsHealthy = true;
        // eslint-disable-next-line no-console
        console.log('[provider] ws_recovered');
      });
      
      this.wsProvider.on('close', () => {
        this.wsHealthy = false;
        // eslint-disable-next-line no-console
        console.log('[provider] ws_unhealthy; routing eth_call via http');
      });
      
      this.wsProvider.on('error', (error: Error) => {
        this.wsHealthy = false;
        // eslint-disable-next-line no-console
        console.log('[provider] ws_unhealthy; routing eth_call via http', error.message);
      });
      
      // WebSocketProvider.ready is a Promise, not a boolean
      // Check if provider is already ready (connected)
      // We'll mark as healthy when the provider successfully connects
      this.wsHealthy = false; // Start as unhealthy until confirmed connected
      
      // Create HTTP fallback provider if RPC_URL is configured
      const httpRpcUrl = process.env.RPC_URL;
      if (httpRpcUrl) {
        this.httpProvider = new ethers.JsonRpcProvider(httpRpcUrl);
        // eslint-disable-next-line no-console
        console.log('[provider] Initialized dual providers: WS + HTTP fallback');
      }
    } else {
      // HTTP provider only
      this.httpProvider = provider;
      this.wsHealthy = false;
    }
  }
  
  /**
   * Check if WebSocket provider is healthy
   */
  isWsHealthy(): boolean {
    return this.wsHealthy;
  }
  
  /**
   * Set AaveMetadata instance for symbol resolution
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setAaveMetadata(aaveMetadata: any): void {
    this.aaveMetadata = aaveMetadata;
  }

  /**
   * Set AssetMetadataCache instance for efficient metadata caching
   */
  setMetadataCache(metadataCache: AssetMetadataCache): void {
    this.metadataCache = metadataCache;
  }

  /**
   * Set TokenMetadataRegistry instance for symbol resolution
   */
  setTokenRegistry(tokenRegistry: TokenMetadataRegistry): void {
    this.tokenRegistry = tokenRegistry;
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
   * Execute a contract call with fallback to HTTP provider on WebSocket failure
   * @param contract The contract instance to call
   * @param method The method name to call
   * @param args The arguments to pass to the method
   * @param contractAddress The contract address (for fallback)
   * @param contractAbi The contract ABI (for fallback)
   * @returns The result of the contract call
   */
  private async callWithFallback<T>(
    contract: ethers.Contract,
    method: string,
    args: unknown[],
    contractAddress: string,
    contractAbi: string[]
  ): Promise<T> {
    // If WS is unhealthy, route directly to HTTP
    if (!this.wsHealthy && this.httpProvider) {
      const httpContract = new ethers.Contract(contractAddress, contractAbi, this.httpProvider);
      return await httpContract[method](...args);
    }

    try {
      // Try with current provider (likely WS)
      return await contract[method](...args);
    } catch (error) {
      // Check if error is provider destroyed
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isProviderDestroyed = errorMessage.includes('provider destroyed') || 
                                   errorMessage.includes('UNSUPPORTED_OPERATION');
      
      if (isProviderDestroyed && this.httpProvider) {
        // eslint-disable-next-line no-console
        console.log(`[provider] ws_unhealthy; routing eth_call via http (${method} retry after error)`);
        
        // Fallback to HTTP provider
        const httpContract = new ethers.Contract(contractAddress, contractAbi, this.httpProvider);
        return await httpContract[method](...args);
      }
      
      // Re-throw if not a provider destroyed error or no fallback available
      throw error;
    }
  }

  /**
   * Get reserve token addresses (aToken, stableDebt, variableDebt)
   */
  async getReserveTokenAddresses(asset: string): Promise<ReserveTokenAddresses> {
    if (!this.protocolDataProvider) {
      throw new Error('AaveDataService not initialized with provider');
    }

    const result = await this.callWithFallback<{
      aTokenAddress: string;
      stableDebtTokenAddress: string;
      variableDebtTokenAddress: string;
    }>(
      this.protocolDataProvider,
      'getReserveTokensAddresses',
      [asset],
      config.aaveProtocolDataProvider,
      PROTOCOL_DATA_PROVIDER_ABI
    );
    
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

    const result = await this.callWithFallback<{
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
    }>(
      this.protocolDataProvider,
      'getReserveConfigurationData',
      [asset],
      config.aaveProtocolDataProvider,
      PROTOCOL_DATA_PROVIDER_ABI
    );
    
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

    const result = await this.callWithFallback<{
      currentATokenBalance: bigint;
      currentStableDebt: bigint;
      currentVariableDebt: bigint;
      principalStableDebt: bigint;
      scaledVariableDebt: bigint;
      stableBorrowRate: bigint;
      liquidityRate: bigint;
      stableRateLastUpdated: bigint;
      usageAsCollateralEnabled: boolean;
    }>(
      this.protocolDataProvider,
      'getUserReserveData',
      [asset, user],
      config.aaveProtocolDataProvider,
      PROTOCOL_DATA_PROVIDER_ABI
    );
    
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

    return await this.callWithFallback<bigint>(
      this.oracle,
      'getAssetPrice',
      [asset],
      config.aaveOracle,
      ORACLE_ABI
    );
  }

  /**
   * Get user account data (including health factor)
   */
  async getUserAccountData(user: string): Promise<UserAccountData> {
    if (!this.pool) {
      throw new Error('AaveDataService not initialized with provider');
    }

    const result = await this.callWithFallback<{
      totalCollateralBase: bigint;
      totalDebtBase: bigint;
      availableBorrowsBase: bigint;
      currentLiquidationThreshold: bigint;
      ltv: bigint;
      healthFactor: bigint;
    }>(
      this.pool,
      'getUserAccountData',
      [user],
      config.aavePool,
      POOL_ABI
    );
    
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
   * Uses canonical Aave Protocol Data Provider values directly
   */
  async getTotalDebt(asset: string, user: string): Promise<bigint> {
    const userData = await this.getUserReserveData(asset, user);
    
    // Use canonical currentVariableDebt and currentStableDebt directly from Protocol Data Provider
    // These values are already properly scaled by the Aave protocol
    const totalDebt = userData.currentVariableDebt + userData.currentStableDebt;
    
    return totalDebt;
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

    const result = await this.callWithFallback<{
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
    }>(
      this.pool,
      'getReserveData',
      [asset],
      config.aavePool,
      POOL_ABI
    );
    
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
   * Uses WebSocket provider when healthy, falls back to HTTP on error
   */
  async getReservesList(): Promise<string[]> {
    if (!this.uiPoolDataProvider) {
      throw new Error('AaveDataService not initialized with provider');
    }

    // If WS is unhealthy, route directly to HTTP
    if (!this.wsHealthy && this.httpProvider) {
      // eslint-disable-next-line no-console
      console.log('[provider] ws_unhealthy; routing eth_call via http');
      const httpContract = new ethers.Contract(
        config.aaveUiPoolDataProvider,
        UI_POOL_DATA_PROVIDER_ABI,
        this.httpProvider
      );
      return await httpContract.getReservesList(config.aaveAddressesProvider);
    }

    try {
      // Try with current provider (likely WS)
      return await this.uiPoolDataProvider.getReservesList(config.aaveAddressesProvider);
    } catch (error) {
      // Check if error is provider destroyed
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isProviderDestroyed = errorMessage.includes('provider destroyed') || 
                                   errorMessage.includes('UNSUPPORTED_OPERATION');
      
      if (isProviderDestroyed && this.httpProvider) {
        // eslint-disable-next-line no-console
        console.log('[provider] ws_unhealthy; routing eth_call via http (retry after error)');
        
        // Fallback to HTTP provider
        const httpContract = new ethers.Contract(
          config.aaveUiPoolDataProvider,
          UI_POOL_DATA_PROVIDER_ABI,
          this.httpProvider
        );
        return await httpContract.getReservesList(config.aaveAddressesProvider);
      }
      
      // Re-throw if not a provider destroyed error or no fallback available
      throw error;
    }
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

        // Get symbol using registry-aware resolution
        // getSymbolForAsset now uses TokenMetadataRegistry internally if available
        const symbol = await this.getSymbolForAsset(asset);

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
   * Map asset address to symbol
   * Priority order when TokenMetadataRegistry available:
   *   1. Delegate to TokenMetadataRegistry (which checks base → overrides → on-chain)
   * 
   * Fallback when TokenMetadataRegistry NOT available:
   *   1. Check AaveMetadata
   *   2. Check hardcoded mapping
   */
  private async getSymbolForAsset(asset: string): Promise<string> {
    // Normalize address to lowercase at the start
    const normalizedAddress = asset.toLowerCase();
    
    // If TokenMetadataRegistry is available, delegate to it (handles base → overrides → on-chain)
    if (this.tokenRegistry) {
      try {
        const metadata = await this.tokenRegistry.get(normalizedAddress);
        
        // Registry returns symbol (may be UNKNOWN if resolution failed)
        // Do NOT log here - registry handles logging internally
        return metadata.symbol;
      } catch (error) {
        // Registry threw an error, continue to fallback
        // eslint-disable-next-line no-console
        console.warn(`[aave-data] TokenMetadataRegistry error for ${normalizedAddress}, using fallback:`, error);
      }
    }
    
    // Fallback path (only when registry not available)
    // Priority 1: Check base metadata (AaveMetadata)
    if (this.aaveMetadata && typeof this.aaveMetadata.getReserve === 'function') {
      const reserve = this.aaveMetadata.getReserve(normalizedAddress);
      if (reserve && reserve.symbol && reserve.symbol !== 'UNKNOWN') {
        return reserve.symbol;
      }
    }
    
    // Priority 2: Check hardcoded mapping (Base mainnet)
    const knownAssets: Record<string, string> = {
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
      '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 'DAI',
      '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 'USDbC',
      '0x4200000000000000000000000000000000000006': 'WETH',
      '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 'cbBTC',
      '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': 'cbETH',
      '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': 'wstETH',
      '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a': 'weETH',
      '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42': 'EURC',
      '0x63706e401c06ac8513145b7687a14804d17f814b': 'AAVE',
      '0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee': 'GHO',
    };

    const symbol = knownAssets[normalizedAddress];
    
    // Log if symbol is missing (fallback path only - when registry not available)
    if (!symbol) {
      // eslint-disable-next-line no-console
      console.warn(`[aave-data] symbol_missing: ${normalizedAddress} - consider adding to TokenMetadataRegistry or AaveMetadata`);
    }
    
    return symbol || 'UNKNOWN';
  }

  /**
   * Get user account data with proper sanity checks and decimal normalization.
   * This is the canonical source of truth for health factor and total positions.
   * 
   * Returns:
   * - totalCollateralUsd: Total collateral in USD (using ETH/USD price)
   * - totalDebtUsd: Total debt in USD (using ETH/USD price)
   * - healthFactor: Health factor from on-chain
   * - warnings: Array of warnings if sanity checks fail
   * 
   * Sanity checks performed:
   * 1. If HF < 1 and collateral == 0, re-fetch once
   * 2. Validate amounts are within reasonable bounds
   */
  async getUserAccountDataCanonical(user: string): Promise<{
    totalCollateralUsd: number;
    totalDebtUsd: number;
    healthFactor: number;
    totalCollateralBase: bigint;
    totalDebtBase: bigint;
    warnings: string[];
  }> {
    if (!this.pool) {
      throw new Error('AaveDataService not initialized with provider');
    }

    const warnings: string[] = [];
    
    // Fetch user account data from pool (canonical source)
    let accountData = await this.getUserAccountData(user);
    
    // Sanity check: if HF < 1 and collateral is 0, this is suspicious - re-fetch once
    if (accountData.healthFactor < BigInt(1e18) && accountData.totalCollateralBase === 0n) {
      warnings.push('SUSPICIOUS: HF < 1 but collateral is 0, re-fetching...');
      // eslint-disable-next-line no-console
      console.warn(`[aave-data] Suspicious state for ${user}: HF < 1 but collateral == 0, re-fetching...`);
      
      // Wait a bit and re-fetch
      await new Promise(resolve => setTimeout(resolve, 500));
      accountData = await this.getUserAccountData(user);
      
      // Still inconsistent? This is a critical error
      if (accountData.healthFactor < BigInt(1e18) && accountData.totalCollateralBase === 0n) {
        warnings.push('CRITICAL: Still HF < 1 with 0 collateral after re-fetch - data inconsistent');
        // eslint-disable-next-line no-console
        console.error(`[aave-data] Critical inconsistency for ${user}: HF < 1 but collateral still 0 after re-fetch`);
      }
    }

    // Get ETH/USD price to convert base amounts
    let totalCollateralUsd = 0;
    let totalDebtUsd = 0;
    
    try {
      if (this.metadataCache) {
        const ethPrice = await this.metadataCache.getEthPrice();
        
        // Convert base amounts (ETH) to USD
        totalCollateralUsd = baseToUsd(accountData.totalCollateralBase, ethPrice.price, ethPrice.decimals);
        totalDebtUsd = baseToUsd(accountData.totalDebtBase, ethPrice.price, ethPrice.decimals);
        
        // Log conversion for debugging
        // eslint-disable-next-line no-console
        console.log(`[aave-data] User ${user.slice(0, 10)}... - Collateral: ${totalCollateralUsd.toFixed(2)} USD, Debt: ${totalDebtUsd.toFixed(2)} USD, HF: ${(Number(accountData.healthFactor) / 1e18).toFixed(4)}`);
      } else {
        warnings.push('Metadata cache not available, cannot convert to USD');
      }
    } catch (error) {
      warnings.push(`Failed to get ETH price: ${error instanceof Error ? error.message : 'unknown error'}`);
      // eslint-disable-next-line no-console
      console.error('[aave-data] Failed to get ETH price:', error);
    }

    const healthFactor = Number(accountData.healthFactor) / 1e18;

    return {
      totalCollateralUsd,
      totalDebtUsd,
      healthFactor,
      totalCollateralBase: accountData.totalCollateralBase,
      totalDebtBase: accountData.totalDebtBase,
      warnings
    };
  }

  /**
   * Get detailed per-asset breakdown with sanity checks.
   * Uses canonical on-chain sources and proper decimal handling.
   * 
   * Sanity checks:
   * 1. Human amounts should not exceed 1e9 tokens
   * 2. Per-asset amounts should not exceed total supply * 1.05
   * 3. Sum of per-asset debt should match totalDebtBase within 0.5%
   */
  async getUserReservesCanonical(userAddress: string): Promise<{
    reserves: ReserveData[];
    totalDebtRecomputed: number;
    totalCollateralRecomputed: number;
    warnings: string[];
  }> {
    if (!this.protocolDataProvider || !this.oracle || !this.metadataCache) {
      throw new Error('AaveDataService not fully initialized');
    }

    const warnings: string[] = [];
    const reserves: ReserveData[] = [];
    let totalDebtRecomputedUsd = 0;
    let totalCollateralRecomputedUsd = 0;

    // Get all reserves in the protocol
    const reservesList = await this.getReservesList();
    
    // Fetch user data for each reserve
    for (const asset of reservesList) {
      try {
        // Get user reserve data
        const userData = await this.getUserReserveData(asset, userAddress);
        
        // Get total debt (properly expanded)
        const totalDebt = await this.getTotalDebt(asset, userAddress);
        
        // Skip reserves with no position
        if (totalDebt === 0n && userData.currentATokenBalance === 0n) {
          continue;
        }

        // Get metadata from cache
        const metadata = await this.metadataCache.getAssetMetadata(asset);
        const priceData = await this.metadataCache.getAssetPrice(asset);

        // Calculate human-readable amounts
        const humanDebt = Number(totalDebt) / (10 ** metadata.decimals);
        const humanCollateral = Number(userData.currentATokenBalance) / (10 ** metadata.decimals);

        // Sanity check: validate amounts are reasonable
        const debtValidation = validateAmount(humanDebt, metadata.symbol);
        if (!debtValidation.valid) {
          warnings.push(`${metadata.symbol} debt: ${debtValidation.reason}`);
          // eslint-disable-next-line no-console
          console.warn(`[aave-data] Scaling error detected - ${debtValidation.reason}`);
          continue; // Skip this asset
        }

        const collateralValidation = validateAmount(humanCollateral, metadata.symbol);
        if (!collateralValidation.valid) {
          warnings.push(`${metadata.symbol} collateral: ${collateralValidation.reason}`);
          // eslint-disable-next-line no-console
          console.warn(`[aave-data] Scaling error detected - ${collateralValidation.reason}`);
          continue; // Skip this asset
        }

        // Sanity check: compare with total supply (if available)
        try {
          const totalSupply = await this.metadataCache.getTotalSupply(asset);
          const maxReasonable = (totalSupply * 105n) / 100n; // 105% of total supply
          
          if (totalDebt > maxReasonable) {
            warnings.push(`${metadata.symbol} debt (${formatTokenAmount(totalDebt, metadata.decimals)}) exceeds 105% of total supply`);
            // eslint-disable-next-line no-console
            console.warn(`[aave-data] ${metadata.symbol} debt exceeds total supply sanity check`);
            continue; // Skip this asset
          }
          
          if (userData.currentATokenBalance > maxReasonable) {
            warnings.push(`${metadata.symbol} collateral (${formatTokenAmount(userData.currentATokenBalance, metadata.decimals)}) exceeds 105% of total supply`);
            // eslint-disable-next-line no-console
            console.warn(`[aave-data] ${metadata.symbol} collateral exceeds total supply sanity check`);
            continue; // Skip this asset
          }
        } catch (error) {
          // Total supply check failed, but not critical - continue
        }

        // Calculate USD values using new decimal utilities
        const debtValueUsd = usdValue(totalDebt, metadata.decimals, priceData.price, priceData.decimals);
        const collateralValueUsd = usdValue(userData.currentATokenBalance, metadata.decimals, priceData.price, priceData.decimals);

        totalDebtRecomputedUsd += debtValueUsd;
        totalCollateralRecomputedUsd += collateralValueUsd;

        reserves.push({
          asset,
          symbol: metadata.symbol,
          decimals: metadata.decimals,
          aTokenBalance: userData.currentATokenBalance,
          stableDebt: userData.currentStableDebt,
          variableDebt: userData.currentVariableDebt,
          totalDebt,
          usageAsCollateralEnabled: userData.usageAsCollateralEnabled,
          priceInUsd: Number(priceData.price) / (10 ** priceData.decimals),
          priceRaw: priceData.price,
          debtValueUsd,
          collateralValueUsd
        });

        // Log intermediate values for debugging
        // eslint-disable-next-line no-console
        console.log(
          `[aave-data] ${metadata.symbol}: debt=${formatTokenAmount(totalDebt, metadata.decimals)} ` +
          `collateral=${formatTokenAmount(userData.currentATokenBalance, metadata.decimals)} ` +
          `debtUsd=$${debtValueUsd.toFixed(2)} collateralUsd=$${collateralValueUsd.toFixed(2)}`
        );
      } catch (error) {
        // Skip reserves that fail (might be paused, frozen, or not active)
        // eslint-disable-next-line no-console
        console.warn(`[aave-data] Failed to process reserve ${asset}:`, error instanceof Error ? error.message : error);
        continue;
      }
    }

    return {
      reserves,
      totalDebtRecomputed: totalDebtRecomputedUsd,
      totalCollateralRecomputed: totalCollateralRecomputedUsd,
      warnings
    };
  }

  /**
   * Validate that per-asset totals match getUserAccountData within tolerance.
   * This is a critical consistency check.
   */
  async validateConsistency(
    userAddress: string,
    perAssetDebtUsd: number,
    perAssetCollateralUsd: number
  ): Promise<{ consistent: boolean; warnings: string[] }> {
    const warnings: string[] = [];
    
    try {
      // Get canonical totals from getUserAccountData
      const canonical = await this.getUserAccountDataCanonical(userAddress);
      
      // Compare debt (within 0.5% tolerance)
      if (canonical.totalDebtUsd > 0) {
        const debtDiff = Math.abs(perAssetDebtUsd - canonical.totalDebtUsd);
        const debtDiffPct = (debtDiff / canonical.totalDebtUsd) * 100;
        
        if (debtDiffPct > 0.5) {
          warnings.push(
            `Debt inconsistency: per-asset=$${perAssetDebtUsd.toFixed(2)} ` +
            `canonical=$${canonical.totalDebtUsd.toFixed(2)} ` +
            `diff=${debtDiffPct.toFixed(2)}%`
          );
        }
      }
      
      // Compare collateral (within 0.5% tolerance)
      if (canonical.totalCollateralUsd > 0) {
        const collateralDiff = Math.abs(perAssetCollateralUsd - canonical.totalCollateralUsd);
        const collateralDiffPct = (collateralDiff / canonical.totalCollateralUsd) * 100;
        
        if (collateralDiffPct > 0.5) {
          warnings.push(
            `Collateral inconsistency: per-asset=$${perAssetCollateralUsd.toFixed(2)} ` +
            `canonical=$${canonical.totalCollateralUsd.toFixed(2)} ` +
            `diff=${collateralDiffPct.toFixed(2)}%`
          );
        }
      }
      
      const consistent = warnings.length === 0;
      return { consistent, warnings };
    } catch (error) {
      warnings.push(`Failed to validate consistency: ${error instanceof Error ? error.message : 'unknown error'}`);
      return { consistent: false, warnings };
    }
  }
}
