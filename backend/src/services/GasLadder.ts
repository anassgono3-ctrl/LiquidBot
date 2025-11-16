// GasLadder: Pre-computed gas tip ladder for Base network
// Maintains fast/mid/safe tip levels updated each block
// Provides synchronous getGasPlan() for quick execution decisions

import { JsonRpcProvider } from 'ethers';

import { config } from '../config/index.js';

export interface GasPlan {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  plan: 'fast' | 'mid' | 'safe';
}

export interface GasLadderOptions {
  provider: JsonRpcProvider;
  fastTipGwei?: number;
  midTipGwei?: number;
  safeTipGwei?: number;
}

/**
 * GasLadder maintains pre-computed gas pricing for fast execution on Base.
 * Updates each block using eth_maxPriorityFeePerGas and baseFee.
 * Provides synchronous getGasPlan() returning fast/mid/safe options.
 */
export class GasLadder {
  private provider: JsonRpcProvider;
  private fastTipGwei: number;
  private midTipGwei: number;
  private safeTipGwei: number;
  private currentBaseFee: bigint = 0n;
  private lastBlockNumber: number = 0;

  constructor(options: GasLadderOptions) {
    this.provider = options.provider;
    this.fastTipGwei = options.fastTipGwei ?? config.gasLadderFastTipGwei;
    this.midTipGwei = options.midTipGwei ?? config.gasLadderMidTipGwei;
    this.safeTipGwei = options.safeTipGwei ?? config.gasLadderSafeTipGwei;
  }

  /**
   * Initialize gas ladder by fetching current block base fee
   */
  async initialize(): Promise<void> {
    try {
      const block = await this.provider.getBlock('latest');
      if (block && block.baseFeePerGas) {
        this.currentBaseFee = block.baseFeePerGas;
        this.lastBlockNumber = block.number;
      }
    } catch (err) {
      console.error('[gas-ladder] initialization failed:', err);
    }
  }

  /**
   * Update gas ladder with new block data
   * @param blockNumber Current block number
   */
  async updateForBlock(blockNumber: number): Promise<void> {
    if (blockNumber <= this.lastBlockNumber) {
      return; // Already up to date
    }

    try {
      const block = await this.provider.getBlock(blockNumber);
      if (block && block.baseFeePerGas) {
        this.currentBaseFee = block.baseFeePerGas;
        this.lastBlockNumber = blockNumber;
      }
    } catch (err) {
      console.error(`[gas-ladder] update failed for block ${blockNumber}:`, err);
    }
  }

  /**
   * Get a gas plan synchronously
   * @param targetInclusion Target inclusion speed ('fast', 'mid', or 'safe')
   * @returns Gas plan with maxFeePerGas and maxPriorityFeePerGas
   */
  getGasPlan(targetInclusion: 'fast' | 'mid' | 'safe' = 'fast'): GasPlan {
    let tipGwei: number;
    
    switch (targetInclusion) {
      case 'fast':
        tipGwei = this.fastTipGwei;
        break;
      case 'mid':
        tipGwei = this.midTipGwei;
        break;
      case 'safe':
        tipGwei = this.safeTipGwei;
        break;
      default:
        tipGwei = this.fastTipGwei;
    }

    const tipWei = BigInt(Math.floor(tipGwei * 1e9));
    const maxFeePerGas = this.currentBaseFee * 2n + tipWei; // 2x base + tip

    console.log(`[gas] plan=${targetInclusion} base=${Number(this.currentBaseFee) / 1e9} tip=${tipGwei}`);

    return {
      maxFeePerGas,
      maxPriorityFeePerGas: tipWei,
      plan: targetInclusion
    };
  }

  /**
   * Get current base fee in Gwei
   */
  getBaseFeeGwei(): number {
    return Number(this.currentBaseFee) / 1e9;
  }
}
