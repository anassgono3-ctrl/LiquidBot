/**
 * LiquidationSimulator - Simulates liquidation calldata using callStatic
 * 
 * Performs read-only simulation of liquidation transactions at specific blocks
 * without broadcasting to the network. Used for first-detection and liquidation-block
 * simulations in replay mode.
 */

import { ethers } from 'ethers';

const AAVE_POOL_ABI = [
  'function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken) external returns ()'
];

export interface SimulationParams {
  user: string;
  collateralAsset: string;
  debtAsset: string;
  debtToCover: bigint;
  receiveAToken: boolean;
}

export interface SimulationResult {
  success: boolean;
  revertReason: string;
  gasUsed?: bigint;
}

export class LiquidationSimulator {
  private poolContract: ethers.Contract;
  
  constructor(
    private readonly provider: ethers.JsonRpcProvider,
    private readonly aavePoolAddress: string
  ) {
    this.poolContract = new ethers.Contract(
      aavePoolAddress,
      AAVE_POOL_ABI,
      provider
    );
  }
  
  /**
   * Simulate liquidation at a specific block using callStatic
   */
  async simulate(
    params: SimulationParams,
    blockTag: number
  ): Promise<SimulationResult> {
    try {
      // Use callStatic with blockTag to simulate at historical block
      const tx = await this.poolContract.liquidationCall.staticCallResult(
        params.collateralAsset,
        params.debtAsset,
        params.user,
        params.debtToCover,
        params.receiveAToken,
        { blockTag }
      );
      
      // Success if no revert
      return {
        success: true,
        revertReason: '',
        gasUsed: undefined // callStatic doesn't return gas used
      };
    } catch (error: any) {
      // Parse revert reason
      let revertReason = 'Unknown error';
      
      if (error.data) {
        try {
          // Try to decode custom error or revert message
          revertReason = error.data;
        } catch {
          revertReason = error.message || 'Simulation reverted';
        }
      } else if (error.message) {
        revertReason = error.message;
      }
      
      // Extract short reason if possible
      if (revertReason.includes('execution reverted:')) {
        const match = revertReason.match(/execution reverted: (.+)/);
        if (match) {
          revertReason = match[1];
        }
      }
      
      return {
        success: false,
        revertReason: revertReason.substring(0, 200), // Truncate long reasons
        gasUsed: undefined
      };
    }
  }
  
  /**
   * Simulate with default params (50% close factor)
   */
  async simulateDefault(
    user: string,
    collateralAsset: string,
    debtAsset: string,
    totalDebt: bigint,
    blockTag: number
  ): Promise<SimulationResult> {
    // Use 50% close factor as default
    const debtToCover = totalDebt / 2n;
    
    return this.simulate({
      user,
      collateralAsset,
      debtAsset,
      debtToCover,
      receiveAToken: false
    }, blockTag);
  }
  
  /**
   * Batch simulate multiple users at the same block
   */
  async batchSimulate(
    simulations: Array<{ params: SimulationParams; user: string }>,
    blockTag: number
  ): Promise<Map<string, SimulationResult>> {
    const results = new Map<string, SimulationResult>();
    
    // Execute simulations sequentially to avoid rate limiting
    for (const { params, user } of simulations) {
      try {
        const result = await this.simulate(params, blockTag);
        results.set(user, result);
      } catch (error) {
        console.warn(`[simulator] Batch simulation failed for user ${user}:`, error);
        results.set(user, {
          success: false,
          revertReason: 'Batch simulation error',
          gasUsed: undefined
        });
      }
    }
    
    return results;
  }
  
  /**
   * Estimate profit from simulation (simple calculation)
   */
  estimateProfit(
    debtCovered: bigint,
    collateralSeized: bigint,
    debtPrice: number,
    collateralPrice: number,
    gasCostUSD: number
  ): number {
    const debtCoveredUSD = Number(debtCovered) / 1e18 * debtPrice;
    const collateralSeizedUSD = Number(collateralSeized) / 1e18 * collateralPrice;
    
    return collateralSeizedUSD - debtCoveredUSD - gasCostUSD;
  }
}
