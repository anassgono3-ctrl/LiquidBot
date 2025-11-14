// PrivateTxSender.ts: Abstract private/public transaction submission

import { ethers } from 'ethers';

export type TxSubmitMode = 'public' | 'private';

export interface PrivateTxConfig {
  mode: TxSubmitMode;
  privateRpcUrl?: string;  // Required if mode='private'
}

export interface TxSubmitResult {
  txHash: string;
  mode: 'public' | 'private';
  fallbackUsed: boolean;
}

/**
 * PrivateTxSender handles both private and public transaction submission
 * with automatic fallback from private to public on failure
 */
export class PrivateTxSender {
  private privateProvider?: ethers.JsonRpcProvider;

  constructor(private config: PrivateTxConfig) {
    if (config.mode === 'private') {
      if (!config.privateRpcUrl) {
        throw new Error('[private-tx] PRIVATE_TX_RPC_URL required when TX_SUBMIT_MODE=private');
      }
      
      this.privateProvider = new ethers.JsonRpcProvider(config.privateRpcUrl);
      // eslint-disable-next-line no-console
      console.log('[private-tx] Initialized with private relay');
    } else {
      // eslint-disable-next-line no-console
      console.log('[private-tx] Using public mempool (default)');
    }
  }

  /**
   * Submit transaction through configured mode with fallback
   */
  async submitTransaction(
    wallet: ethers.Wallet,
    tx: ethers.TransactionRequest
  ): Promise<TxSubmitResult> {
    if (this.config.mode === 'private' && this.privateProvider) {
      try {
        // eslint-disable-next-line no-console
        console.log('[private-tx] submitted via private relay');
        
        // Connect wallet to private provider
        const privateWallet = wallet.connect(this.privateProvider);
        const response = await privateWallet.sendTransaction(tx);
        
        return {
          txHash: response.hash,
          mode: 'private',
          fallbackUsed: false
        };
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[private-tx] fallback-public - private submission failed:', error instanceof Error ? error.message : error);
        
        // Fallback to public immediately
        const response = await wallet.sendTransaction(tx);
        return {
          txHash: response.hash,
          mode: 'public',
          fallbackUsed: true
        };
      }
    } else {
      // Public mode
      const response = await wallet.sendTransaction(tx);
      return {
        txHash: response.hash,
        mode: 'public',
        fallbackUsed: false
      };
    }
  }

  /**
   * Check if private mode is enabled
   */
  isPrivateMode(): boolean {
    return this.config.mode === 'private';
  }

  /**
   * Get current configuration
   */
  getConfig(): PrivateTxConfig {
    return { ...this.config };
  }
}
