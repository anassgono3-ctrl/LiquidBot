// SameBlockVerifier: Multicall-based health factor verification at a single blockTag
// Ensures atomicity and eliminates race conditions

import { JsonRpcProvider, Contract, Interface } from 'ethers';

import { config } from '../config/index.js';

const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) external payable returns (tuple(bool success, bytes returnData)[] returnData)'
];

const AAVE_POOL_ABI = [
  'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
];

export interface VerifyResult {
  success: boolean;
  healthFactor?: bigint;
  totalCollateralBase?: bigint;
  totalDebtBase?: bigint;
  currentLiquidationThreshold?: bigint;
  ltv?: bigint;
  reason?: string;
  blockNumber?: number;
}

/**
 * SameBlockVerifier performs atomic health factor checks using Multicall3.
 * All data is fetched at a single blockTag to ensure consistency.
 */
export class SameBlockVerifier {
  private provider: JsonRpcProvider;
  private multicall3: Contract;
  private aavePoolAddress: string;
  private poolInterface: Interface;
  
  constructor(provider: JsonRpcProvider, multicall3Address?: string, aavePoolAddress?: string) {
    this.provider = provider;
    this.aavePoolAddress = aavePoolAddress ?? config.aavePool;
    
    const multicallAddr = multicall3Address ?? config.multicall3Address;
    this.multicall3 = new Contract(multicallAddr, MULTICALL3_ABI, provider);
    this.poolInterface = new Interface(AAVE_POOL_ABI);
  }
  
  /**
   * Verify a user's liquidation status at a specific block
   * @param userAddress User to check
   * @param blockTag Block number to check at (defaults to 'latest')
   * @returns Verification result with health factor and account data
   */
  async verify(userAddress: string, blockTag?: number | 'latest'): Promise<VerifyResult> {
    try {
      // Prepare multicall for getUserAccountData
      const callData = this.poolInterface.encodeFunctionData('getUserAccountData', [userAddress]);
      
      const calls = [{
        target: this.aavePoolAddress,
        allowFailure: false,
        callData
      }];
      
      // Execute multicall at specific block
      const blockOptions = blockTag !== undefined && blockTag !== 'latest' 
        ? { blockTag } 
        : {};
      
      const results = await this.multicall3.aggregate3.staticCall(calls, blockOptions);
      
      if (!results || results.length === 0 || !results[0].success) {
        return {
          success: false,
          reason: 'multicall_failed'
        };
      }
      
      // Decode result
      const decoded = this.poolInterface.decodeFunctionResult('getUserAccountData', results[0].returnData);
      
      const totalCollateralBase = decoded.totalCollateralBase;
      const totalDebtBase = decoded.totalDebtBase;
      const availableBorrowsBase = decoded.availableBorrowsBase;
      const currentLiquidationThreshold = decoded.currentLiquidationThreshold;
      const ltv = decoded.ltv;
      const healthFactor = decoded.healthFactor;
      
      // Check for zero debt
      if (totalDebtBase === 0n) {
        return {
          success: false,
          healthFactor,
          totalCollateralBase,
          totalDebtBase,
          currentLiquidationThreshold,
          ltv,
          reason: 'zero_debt',
          blockNumber: typeof blockTag === 'number' ? blockTag : undefined
        };
      }
      
      return {
        success: true,
        healthFactor,
        totalCollateralBase,
        totalDebtBase,
        currentLiquidationThreshold,
        ltv,
        blockNumber: typeof blockTag === 'number' ? blockTag : undefined
      };
      
    } catch (error) {
      return {
        success: false,
        reason: `error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  /**
   * Batch verify multiple users at the same block
   * @param userAddresses Array of user addresses
   * @param blockTag Block number to check at
   * @returns Array of verification results
   */
  async batchVerify(userAddresses: string[], blockTag?: number | 'latest'): Promise<VerifyResult[]> {
    if (userAddresses.length === 0) {
      return [];
    }
    
    try {
      // Prepare multicall for all users
      const calls = userAddresses.map(userAddress => ({
        target: this.aavePoolAddress,
        allowFailure: true, // Allow individual failures in batch
        callData: this.poolInterface.encodeFunctionData('getUserAccountData', [userAddress])
      }));
      
      // Execute multicall at specific block
      const blockOptions = blockTag !== undefined && blockTag !== 'latest' 
        ? { blockTag } 
        : {};
      
      const results = await this.multicall3.aggregate3.staticCall(calls, blockOptions);
      
      // Decode each result
      return results.map((result: { success: boolean; returnData: string }, index: number) => {
        if (!result.success) {
          return {
            success: false,
            reason: 'call_failed'
          };
        }
        
        try {
          const decoded = this.poolInterface.decodeFunctionResult('getUserAccountData', result.returnData);
          
          const totalCollateralBase = decoded.totalCollateralBase;
          const totalDebtBase = decoded.totalDebtBase;
          const healthFactor = decoded.healthFactor;
          const currentLiquidationThreshold = decoded.currentLiquidationThreshold;
          const ltv = decoded.ltv;
          
          // Check for zero debt
          if (totalDebtBase === 0n) {
            return {
              success: false,
              healthFactor,
              totalCollateralBase,
              totalDebtBase,
              currentLiquidationThreshold,
              ltv,
              reason: 'zero_debt',
              blockNumber: typeof blockTag === 'number' ? blockTag : undefined
            };
          }
          
          return {
            success: true,
            healthFactor,
            totalCollateralBase,
            totalDebtBase,
            currentLiquidationThreshold,
            ltv,
            blockNumber: typeof blockTag === 'number' ? blockTag : undefined
          };
        } catch (error) {
          return {
            success: false,
            reason: `decode_error: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      });
      
    } catch (error) {
      // Return error for all users
      return userAddresses.map(() => ({
        success: false,
        reason: `batch_error: ${error instanceof Error ? error.message : String(error)}`
      }));
    }
  }
}
