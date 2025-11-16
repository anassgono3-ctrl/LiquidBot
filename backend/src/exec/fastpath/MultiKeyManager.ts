/**
 * MultiKeyManager: Multiple executor keys for nonce sharding
 * 
 * Manages multiple private keys for parallel execution capability.
 * Supports round-robin or deterministic (user-based) selection.
 * 
 * SECURITY: Never logs raw private keys
 */

import { ethers } from 'ethers';

import { executorKeyUsageTotal } from '../../metrics/index.js';

import { loadExecutorKeys } from './config.js';

export type KeySelectionStrategy = 'round-robin' | 'deterministic';

export class MultiKeyManager {
  private keys: string[];
  private wallets: ethers.Wallet[] = [];
  private currentIndex = 0;
  private strategy: KeySelectionStrategy;

  constructor(
    keys: string[] = loadExecutorKeys(),
    strategy: KeySelectionStrategy = 'round-robin'
  ) {
    this.keys = keys;
    this.strategy = strategy;

    // Validate keys and create wallets
    for (let i = 0; i < keys.length; i++) {
      try {
        const wallet = new ethers.Wallet(keys[i]);
        this.wallets.push(wallet);
        // Log only the index and address, never the private key
        console.log(`[multi-key] Loaded executor key ${i}: ${wallet.address}`);
      } catch (error) {
        // Log error without exposing the key
        console.error(`[multi-key] Failed to load executor key at index ${i}: ${(error as Error).message}`);
      }
    }

    if (this.wallets.length === 0) {
      console.warn('[multi-key] No valid executor keys loaded. Multi-key manager is disabled.');
    }
  }

  /**
   * Select next key using configured strategy
   * 
   * @param user Optional user address for deterministic selection
   * @returns Wallet instance and its index
   */
  selectKey(user?: string): { wallet: ethers.Wallet; index: number } {
    if (this.wallets.length === 0) {
      throw new Error('No executor keys available');
    }

    let index: number;

    if (this.strategy === 'deterministic' && user) {
      // Hash user address to get consistent key assignment
      const hash = ethers.keccak256(ethers.toUtf8Bytes(user.toLowerCase()));
      const hashNum = BigInt(hash);
      index = Number(hashNum % BigInt(this.wallets.length));
    } else {
      // Round-robin
      index = this.currentIndex;
      this.currentIndex = (this.currentIndex + 1) % this.wallets.length;
    }

    const wallet = this.wallets[index];
    
    // Record usage metric
    executorKeyUsageTotal.inc({ keyIndex: index.toString() });

    return { wallet, index };
  }

  /**
   * Get wallet by index
   */
  getWalletByIndex(index: number): ethers.Wallet | undefined {
    return this.wallets[index];
  }

  /**
   * Get all wallet addresses (for monitoring)
   */
  getAddresses(): string[] {
    return this.wallets.map(w => w.address);
  }

  /**
   * Get number of available keys
   */
  getKeyCount(): number {
    return this.wallets.length;
  }

  /**
   * Check if multiple keys are configured
   */
  isMultiKeyEnabled(): boolean {
    return this.wallets.length > 1;
  }

  /**
   * Set key selection strategy
   */
  setStrategy(strategy: KeySelectionStrategy): void {
    this.strategy = strategy;
  }

  /**
   * Get current strategy
   */
  getStrategy(): KeySelectionStrategy {
    return this.strategy;
  }

  /**
   * Connect wallets to provider
   */
  connectToProvider(provider: ethers.Provider): void {
    this.wallets = this.wallets.map(wallet => wallet.connect(provider));
  }
}

// Singleton instance
export const multiKeyManager = new MultiKeyManager();
