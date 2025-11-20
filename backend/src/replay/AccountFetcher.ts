/**
 * AccountFetcher - Fetches account data at historical blocks for replay
 * 
 * Uses Multicall3 to batch getUserAccountData calls with explicit blockTag
 * for deterministic historical state reconstruction.
 */

import { ethers } from 'ethers';

const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) external payable returns (tuple(bool success, bytes returnData)[] returnData)'
];

const AAVE_POOL_ABI = [
  'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
];

export interface AccountData {
  user: string;
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  availableBorrowsBase: bigint;
  currentLiquidationThreshold: bigint;
  ltv: bigint;
  healthFactor: bigint;
  hf: number;
  debtUSD: number;
  collateralUSD: number;
}

export class AccountFetcher {
  private multicall3: ethers.Contract;
  private aavePoolInterface: ethers.Interface;
  
  constructor(
    private readonly provider: ethers.JsonRpcProvider,
    private readonly multicall3Address: string,
    private readonly aavePoolAddress: string,
    private readonly batchSize: number = 100
  ) {
    this.multicall3 = new ethers.Contract(
      multicall3Address,
      MULTICALL3_ABI,
      provider
    );
    this.aavePoolInterface = new ethers.Interface(AAVE_POOL_ABI);
  }
  
  /**
   * Fetch account data for multiple users at a specific block
   */
  async fetchAccounts(
    users: string[],
    blockTag: number,
    ethUsdPrice: number = 2000 // fallback price
  ): Promise<Map<string, AccountData>> {
    const results = new Map<string, AccountData>();
    
    // Process in batches to avoid RPC limits
    for (let i = 0; i < users.length; i += this.batchSize) {
      const batch = users.slice(i, i + this.batchSize);
      const batchResults = await this.fetchBatch(batch, blockTag, ethUsdPrice);
      
      for (const [user, data] of batchResults) {
        results.set(user, data);
      }
    }
    
    return results;
  }
  
  /**
   * Fetch a batch of accounts using Multicall3
   */
  private async fetchBatch(
    users: string[],
    blockTag: number,
    ethUsdPrice: number
  ): Promise<Map<string, AccountData>> {
    const results = new Map<string, AccountData>();
    
    // Build multicall calls
    const calls = users.map(user => ({
      target: this.aavePoolAddress,
      allowFailure: true,
      callData: this.aavePoolInterface.encodeFunctionData('getUserAccountData', [user])
    }));
    
    try {
      // Execute multicall with explicit blockTag
      const response = await this.multicall3.aggregate3.staticCall(calls, { blockTag });
      
      // Decode results
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const result = response[i];
        
        if (!result.success) {
          // Failed call, skip user
          continue;
        }
        
        try {
          const decoded = this.aavePoolInterface.decodeFunctionResult(
            'getUserAccountData',
            result.returnData
          );
          
          const totalCollateralBase = decoded[0] as bigint;
          const totalDebtBase = decoded[1] as bigint;
          const availableBorrowsBase = decoded[2] as bigint;
          const currentLiquidationThreshold = decoded[3] as bigint;
          const ltv = decoded[4] as bigint;
          const healthFactor = decoded[5] as bigint;
          
          // Convert to human-readable values
          // Aave returns values in 8 decimals (base currency is USD with 8 decimals)
          const collateralUSD = Number(totalCollateralBase) / 1e8;
          const debtUSD = Number(totalDebtBase) / 1e8;
          
          // Health factor is returned as fixed point with 18 decimals
          const hf = Number(healthFactor) / 1e18;
          
          results.set(user, {
            user,
            totalCollateralBase,
            totalDebtBase,
            availableBorrowsBase,
            currentLiquidationThreshold,
            ltv,
            healthFactor,
            hf,
            debtUSD,
            collateralUSD
          });
        } catch (decodeErr) {
          console.warn(`[account-fetcher] Failed to decode result for user ${user}:`, decodeErr);
        }
      }
    } catch (err) {
      console.error(`[account-fetcher] Multicall failed at block ${blockTag}:`, err);
      throw err;
    }
    
    return results;
  }
  
  /**
   * Fetch single account data
   */
  async fetchAccount(
    user: string,
    blockTag: number,
    ethUsdPrice: number = 2000
  ): Promise<AccountData | null> {
    const results = await this.fetchAccounts([user], blockTag, ethUsdPrice);
    return results.get(user) || null;
  }
  
  /**
   * Filter accounts by health factor threshold
   */
  filterByHealthFactor(
    accounts: Map<string, AccountData>,
    maxHf: number
  ): Map<string, AccountData> {
    const filtered = new Map<string, AccountData>();
    
    for (const [user, data] of accounts) {
      if (data.hf < maxHf) {
        filtered.set(user, data);
      }
    }
    
    return filtered;
  }
  
  /**
   * Get liquidatable accounts (HF < 1.0)
   */
  getLiquidatable(accounts: Map<string, AccountData>): Map<string, AccountData> {
    return this.filterByHealthFactor(accounts, 1.0);
  }
}
