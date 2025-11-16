/**
 * GasBurstManager: Timed gas bump / RBF burst strategy
 * 
 * Manages automatic gas price bumping for pending transactions using
 * a timed replacement strategy with configurable stages.
 */

import { ethers } from 'ethers';

import {
  gasBumpTotal,
  gasBumpSkippedTotal
} from '../../metrics/index.js';

import { gasBurstConfig } from './config.js';
import type { GasBumpAttempt } from './types.js';

interface PendingTransaction {
  txHash: string;
  signedTx: string;
  nonce: number;
  gasPrice: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  sentAt: number;
  bumpCount: number;
  provider: ethers.JsonRpcProvider;
  wallet: ethers.Wallet;
}

export class GasBurstManager {
  private enabled: boolean;
  private firstMs: number;
  private secondMs: number;
  private firstPct: number;
  private secondPct: number;
  private maxBumps: number;
  private pendingTxs: Map<string, PendingTransaction> = new Map();
  private bumpAttempts: Map<string, GasBumpAttempt[]> = new Map();

  constructor(
    enabled: boolean = gasBurstConfig.enabled,
    firstMs: number = gasBurstConfig.firstMs,
    secondMs: number = gasBurstConfig.secondMs,
    firstPct: number = gasBurstConfig.firstPct,
    secondPct: number = gasBurstConfig.secondPct,
    maxBumps: number = gasBurstConfig.maxBumps
  ) {
    this.enabled = enabled;
    this.firstMs = firstMs;
    this.secondMs = secondMs;
    this.firstPct = firstPct;
    this.secondPct = secondPct;
    this.maxBumps = maxBumps;
  }

  /**
   * Track a pending transaction for potential gas bumping
   */
  trackTransaction(
    txHash: string,
    signedTx: string,
    nonce: number,
    gasPrice: bigint,
    provider: ethers.JsonRpcProvider,
    wallet: ethers.Wallet,
    maxFeePerGas?: bigint,
    maxPriorityFeePerGas?: bigint
  ): void {
    if (!this.enabled) return;

    this.pendingTxs.set(txHash, {
      txHash,
      signedTx,
      nonce,
      gasPrice,
      maxFeePerGas,
      maxPriorityFeePerGas,
      sentAt: Date.now(),
      bumpCount: 0,
      provider,
      wallet
    });

    this.bumpAttempts.set(txHash, []);

    // Schedule bump checks
    this.scheduleBumpCheck(txHash);
  }

  /**
   * Schedule gas bump checks for a transaction
   */
  private scheduleBumpCheck(txHash: string): void {
    // First bump check
    setTimeout(() => {
      this.checkAndBump(txHash, 'first').catch(() => {
        // Silently handle errors
      });
    }, this.firstMs);

    // Second bump check
    setTimeout(() => {
      this.checkAndBump(txHash, 'second').catch(() => {
        // Silently handle errors
      });
    }, this.secondMs);
  }

  /**
   * Check if transaction is still pending and bump if needed
   */
  private async checkAndBump(
    txHash: string,
    stage: 'first' | 'second'
  ): Promise<void> {
    const pending = this.pendingTxs.get(txHash);
    if (!pending) {
      gasBumpSkippedTotal.inc({ reason: 'not_tracked' });
      return;
    }

    // Check if already bumped max times
    if (pending.bumpCount >= this.maxBumps) {
      gasBumpSkippedTotal.inc({ reason: 'max_bumps' });
      return;
    }

    // Check if transaction is still pending
    try {
      const receipt = await pending.provider.getTransactionReceipt(txHash);
      if (receipt) {
        // Transaction already mined
        gasBumpSkippedTotal.inc({ reason: 'already_mined' });
        this.pendingTxs.delete(txHash);
        return;
      }
    } catch (error) {
      // Continue with bump if receipt check fails
    }

    // Calculate new gas price
    const bumpPct = stage === 'first' ? this.firstPct : this.secondPct;
    const bumpMultiplier = 1 + (bumpPct / 100);

    let newGasPrice: bigint;
    let newMaxFeePerGas: bigint | undefined;
    let newMaxPriorityFeePerGas: bigint | undefined;

    if (pending.maxFeePerGas && pending.maxPriorityFeePerGas) {
      // EIP-1559 transaction
      newMaxFeePerGas = BigInt(Math.floor(Number(pending.maxFeePerGas) * bumpMultiplier));
      newMaxPriorityFeePerGas = BigInt(Math.floor(Number(pending.maxPriorityFeePerGas) * bumpMultiplier));
      newGasPrice = newMaxFeePerGas;
    } else {
      // Legacy transaction
      newGasPrice = BigInt(Math.floor(Number(pending.gasPrice) * bumpMultiplier));
    }

    // Create replacement transaction
    try {
      // Parse original transaction
      const tx = ethers.Transaction.from(pending.signedTx);
      
      // Update gas parameters
      if (newMaxFeePerGas && newMaxPriorityFeePerGas) {
        tx.maxFeePerGas = newMaxFeePerGas;
        tx.maxPriorityFeePerGas = newMaxPriorityFeePerGas;
      } else {
        tx.gasPrice = newGasPrice;
      }

      // Re-sign transaction
      const signedTx = await pending.wallet.signTransaction(tx);
      
      // Broadcast replacement
      const response = await pending.provider.broadcastTransaction(signedTx);
      
      // Record bump attempt
      this.bumpAttempts.get(txHash)?.push({
        originalTxHash: txHash,
        bumpStage: stage,
        newGasPrice,
        timestamp: Date.now()
      });

      // Update tracking
      pending.bumpCount++;
      pending.txHash = response.hash;
      pending.gasPrice = newGasPrice;
      pending.maxFeePerGas = newMaxFeePerGas;
      pending.maxPriorityFeePerGas = newMaxPriorityFeePerGas;

      gasBumpTotal.inc({ stage });
    } catch (error) {
      gasBumpSkippedTotal.inc({ reason: 'broadcast_failed' });
    }
  }

  /**
   * Mark transaction as confirmed (stop tracking)
   */
  confirmTransaction(txHash: string): void {
    this.pendingTxs.delete(txHash);
  }

  /**
   * Get bump attempts for a transaction
   */
  getBumpAttempts(txHash: string): GasBumpAttempt[] {
    return this.bumpAttempts.get(txHash) || [];
  }

  /**
   * Get all pending transactions
   */
  getPendingTransactions(): PendingTransaction[] {
    return Array.from(this.pendingTxs.values());
  }

  /**
   * Clear all tracking (for testing)
   */
  clear(): void {
    this.pendingTxs.clear();
    this.bumpAttempts.clear();
  }

  /**
   * Check if gas burst is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
export const gasBurstManager = new GasBurstManager();
