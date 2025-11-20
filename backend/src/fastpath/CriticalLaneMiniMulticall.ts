/**
 * Critical Lane Mini-Multicall
 * 
 * Lightweight per-user verification aggregator.
 * Only queries reserves specific to a single user for fast reverification.
 */

import { Contract, JsonRpcProvider } from 'ethers';

import { config } from '../config/index.js';

const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) external payable returns (tuple(bool success, bytes returnData)[] returnData)'
];

const POOL_ABI = [
  'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function getUserConfiguration(address user) external view returns (uint256)'
];

const PROTOCOL_DATA_PROVIDER_ABI = [
  'function getUserReserveData(address asset, address user) external view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)'
];

export interface UserSnapshot {
  user: string;
  blockNumber: number;
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  healthFactor: bigint;
  timestamp: number;
  reserves: ReserveData[];
}

export interface ReserveData {
  asset: string;
  currentATokenBalance: bigint;
  currentVariableDebt: bigint;
  currentStableDebt: bigint;
  scaledVariableDebt: bigint;
  usageAsCollateralEnabled: boolean;
}

/**
 * Mini-multicall for fast single-user reverification
 */
export class CriticalLaneMiniMulticall {
  private provider: JsonRpcProvider;
  private multicall3Address: string;
  private poolAddress: string;
  private dataProviderAddress: string;
  
  constructor(provider: JsonRpcProvider, multicall3Address?: string) {
    this.provider = provider;
    // Multicall3 address: configurable for different networks, defaults to Base mainnet
    this.multicall3Address = multicall3Address || '0xcA11bde05977b3631167028862bE2a173976CA11';
    this.poolAddress = config.aavePoolAddress;
    this.dataProviderAddress = config.aaveProtocolDataProvider;
  }
  
  /**
   * Fetch user snapshot with specified reserves
   * 
   * @param user - User address
   * @param reserves - List of reserve assets to query
   * @param maxReserves - Maximum number of reserves to include (default: 6)
   * @returns User snapshot with health factor and reserve data
   */
  async fetchSnapshot(
    user: string,
    reserves: string[],
    maxReserves: number = 6
  ): Promise<UserSnapshot> {
    const limitedReserves = reserves.slice(0, maxReserves);
    const multicall = new Contract(this.multicall3Address, MULTICALL3_ABI, this.provider);
    const poolIface = new Contract(this.poolAddress, POOL_ABI, this.provider).interface;
    const dataProviderIface = new Contract(
      this.dataProviderAddress,
      PROTOCOL_DATA_PROVIDER_ABI,
      this.provider
    ).interface;
    
    // Build call array
    const calls: Array<{ target: string; allowFailure: boolean; callData: string }> = [];
    
    // 1. getUserAccountData
    calls.push({
      target: this.poolAddress,
      allowFailure: false,
      callData: poolIface.encodeFunctionData('getUserAccountData', [user])
    });
    
    // 2. getUserReserveData for each reserve
    for (const reserve of limitedReserves) {
      calls.push({
        target: this.dataProviderAddress,
        allowFailure: false,
        callData: dataProviderIface.encodeFunctionData('getUserReserveData', [reserve, user])
      });
    }
    
    // Execute multicall
    const results = await multicall.aggregate3.staticCall(calls);
    
    // Decode results
    const accountData = poolIface.decodeFunctionResult('getUserAccountData', results[0].returnData);
    const reserveDataList: ReserveData[] = [];
    
    for (let i = 0; i < limitedReserves.length; i++) {
      const reserveResult = dataProviderIface.decodeFunctionResult(
        'getUserReserveData',
        results[i + 1].returnData
      );
      
      reserveDataList.push({
        asset: limitedReserves[i],
        currentATokenBalance: reserveResult.currentATokenBalance,
        currentVariableDebt: reserveResult.currentVariableDebt,
        currentStableDebt: reserveResult.currentStableDebt,
        scaledVariableDebt: reserveResult.scaledVariableDebt,
        usageAsCollateralEnabled: reserveResult.usageAsCollateralEnabled
      });
    }
    
    const blockNumber = await this.provider.getBlockNumber();
    
    return {
      user,
      blockNumber,
      totalCollateralBase: accountData.totalCollateralBase,
      totalDebtBase: accountData.totalDebtBase,
      healthFactor: accountData.healthFactor,
      timestamp: Date.now(),
      reserves: reserveDataList
    };
  }
  
  /**
   * Check if snapshot is stale
   * 
   * @param snapshot - User snapshot
   * @param staleTtlMs - Staleness threshold in milliseconds (default: 4000)
   * @returns true if snapshot is stale
   */
  isSnapshotStale(snapshot: UserSnapshot, staleTtlMs: number = 4000): boolean {
    const age = Date.now() - snapshot.timestamp;
    return age > staleTtlMs;
  }
  
  /**
   * Extract reserve list from user snapshot
   * 
   * @param snapshot - User snapshot
   * @returns Array of reserve addresses
   */
  extractReserves(snapshot: UserSnapshot): string[] {
    return snapshot.reserves.map(r => r.asset);
  }
}
