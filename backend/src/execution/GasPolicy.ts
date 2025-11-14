// GasPolicy.ts: EIP-1559 fee strategy and RBF (Replace-By-Fee) logic

import { ethers } from 'ethers';

export interface GasPolicyConfig {
  tipGweiFast: number;          // Base priority fee in Gwei (e.g., 3)
  bumpFactor: number;           // Multiplier for RBF (e.g., 1.25 = 25% increase)
  bumpIntervalMs: number;       // Time to wait before bumping (e.g., 500ms)
  bumpMax: number;              // Maximum number of RBF attempts (e.g., 3)
  maxFeeGwei?: number;          // Optional ceiling for maxFeePerGas
}

export interface FeeData {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/**
 * GasPolicy encapsulates EIP-1559 fee calculation and RBF logic
 */
export class GasPolicy {
  constructor(private config: GasPolicyConfig) {
    // eslint-disable-next-line no-console
    console.log('[gas-policy] Initialized:', {
      tipGweiFast: config.tipGweiFast,
      bumpFactor: config.bumpFactor,
      bumpIntervalMs: config.bumpIntervalMs,
      bumpMax: config.bumpMax,
      maxFeeGwei: config.maxFeeGwei || 'unlimited'
    });
  }

  /**
   * Calculate initial EIP-1559 fee for fast execution
   * Formula: maxFee = baseFee * 2 + tip (clamped if maxFeeGwei set)
   */
  async calculateInitialFee(provider: ethers.Provider): Promise<FeeData> {
    const feeData = await provider.getFeeData();
    
    if (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas) {
      throw new Error('[gas-policy] Provider does not support EIP-1559');
    }

    const baseFee = feeData.maxFeePerGas - feeData.maxPriorityFeePerGas;
    const tipWei = ethers.parseUnits(this.config.tipGweiFast.toString(), 'gwei');
    
    let maxFeePerGas = baseFee * 2n + tipWei;
    
    // Apply ceiling if configured
    if (this.config.maxFeeGwei) {
      const maxFeeWei = ethers.parseUnits(this.config.maxFeeGwei.toString(), 'gwei');
      if (maxFeePerGas > maxFeeWei) {
        maxFeePerGas = maxFeeWei;
        // eslint-disable-next-line no-console
        console.log(`[gas-policy] Clamped maxFee to ${this.config.maxFeeGwei} Gwei`);
      }
    }

    return {
      maxFeePerGas,
      maxPriorityFeePerGas: tipWei
    };
  }

  /**
   * Calculate bumped fee for RBF attempt
   * Increases priority fee by bumpFactor
   */
  async calculateBumpedFee(
    provider: ethers.Provider,
    previousFee: FeeData,
    attemptNumber: number
  ): Promise<FeeData> {
    const feeData = await provider.getFeeData();
    
    if (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas) {
      throw new Error('[gas-policy] Provider does not support EIP-1559');
    }

    const baseFee = feeData.maxFeePerGas - feeData.maxPriorityFeePerGas;
    
    // Bump priority fee by bumpFactor
    const bumpMultiplier = Math.pow(this.config.bumpFactor, attemptNumber);
    const bumpedTipWei = (previousFee.maxPriorityFeePerGas * BigInt(Math.floor(bumpMultiplier * 100))) / 100n;
    
    const maxFeePerGas = baseFee * 2n + bumpedTipWei;
    
    // Apply ceiling if configured
    if (this.config.maxFeeGwei) {
      const maxFeeWei = ethers.parseUnits(this.config.maxFeeGwei.toString(), 'gwei');
      if (maxFeePerGas > maxFeeWei) {
        // eslint-disable-next-line no-console
        console.log(`[gas-policy] Cannot bump further: already at maxFeeGwei=${this.config.maxFeeGwei}`);
        return previousFee;
      }
    }

    const bumpedTipGwei = Number(ethers.formatUnits(bumpedTipWei, 'gwei')).toFixed(2);
    // eslint-disable-next-line no-console
    console.log(`[rbf] attempt=${attemptNumber} tip=${bumpedTipGwei}gwei factor=${this.config.bumpFactor}`);

    return {
      maxFeePerGas,
      maxPriorityFeePerGas: bumpedTipWei
    };
  }

  /**
   * Get RBF configuration
   */
  getConfig(): GasPolicyConfig {
    return { ...this.config };
  }

  /**
   * Check if RBF is enabled
   */
  isRbfEnabled(): boolean {
    return this.config.bumpMax > 0;
  }

  /**
   * Get bump interval in milliseconds
   */
  getBumpIntervalMs(): number {
    return this.config.bumpIntervalMs;
  }

  /**
   * Get maximum RBF attempts
   */
  getMaxAttempts(): number {
    return this.config.bumpMax;
  }
}
