/**
 * Private Relay Service
 * 
 * High-level service for private transaction submission with retry logic,
 * fallback handling, and metrics integration.
 */

import { ethers } from 'ethers';
import { getPrivateRelayConfig, logPrivateRelayConfig, type PrivateRelayConfig } from '../config/privateRelay.js';
import { FlashbotsProtectClient } from './FlashbotsProtectClient.js';
import { PrivateRelayErrorCode, type PrivateSendResult, type PrivateRelayContext } from './types.js';
import {
  recordAttempt,
  recordSuccess,
  recordFallback,
  recordLatency
} from '../metrics/PrivateRelayMetrics.js';

export interface PrivateRelayServiceOptions {
  provider?: ethers.Provider;
  wallet?: ethers.Wallet;
  writeRpcs?: string[]; // For race mode fallback
}

/**
 * Private Relay Service orchestrates private transaction submission
 */
export class PrivateRelayService {
  private config: PrivateRelayConfig;
  private client?: FlashbotsProtectClient;
  private provider?: ethers.Provider;
  private writeRpcs: string[];

  constructor(options: PrivateRelayServiceOptions = {}) {
    this.config = getPrivateRelayConfig();
    this.provider = options.provider;
    this.writeRpcs = options.writeRpcs || [];

    // Log configuration once on initialization
    logPrivateRelayConfig(this.config);

    // Initialize client if enabled
    if (this.config.enabled && this.config.rpcUrl && options.wallet) {
      this.client = new FlashbotsProtectClient({
        rpcUrl: this.config.rpcUrl,
        signerAddress: options.wallet.address,
        signatureRandom: this.config.signatureRandom
      });
    }
  }

  /**
   * Submit transaction with private relay or fallback
   */
  async submit(
    signedTx: string,
    context: PrivateRelayContext
  ): Promise<PrivateSendResult> {
    const startTime = Date.now();

    // Check if private relay is disabled
    if (!this.config.enabled) {
      return {
        success: false,
        sentPrivate: false,
        fallbackUsed: false,
        errorCode: PrivateRelayErrorCode.DISABLED,
        latencyMs: 0
      };
    }

    if (!this.config.rpcUrl) {
      return {
        success: false,
        sentPrivate: false,
        fallbackUsed: false,
        errorCode: PrivateRelayErrorCode.NO_RPC_URL,
        latencyMs: 0
      };
    }

    if (!this.client) {
      return {
        success: false,
        sentPrivate: false,
        fallbackUsed: false,
        errorCode: PrivateRelayErrorCode.NO_RPC_URL,
        latencyMs: 0
      };
    }

    // Log attempt
    console.log('[private-relay] submit', {
      user: context.user,
      mode: this.config.mode,
      triggerType: context.triggerType,
      size: signedTx.length
    });

    recordAttempt(this.config.mode);

    // Attempt private submission with retries
    let lastError: string | undefined;
    let lastErrorCode: PrivateRelayErrorCode | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const result = await this.client.sendPrivateTransaction(signedTx);

      if (result.success && result.txHash) {
        const latencyMs = Date.now() - startTime;
        
        console.log('[private-relay] result', {
          user: context.user,
          hash: result.txHash,
          latency: `${latencyMs}ms`,
          attempt: attempt + 1
        });

        recordSuccess(this.config.mode);
        recordLatency(latencyMs);

        return {
          success: true,
          txHash: result.txHash,
          sentPrivate: true,
          fallbackUsed: false,
          latencyMs
        };
      }

      // Store error for potential fallback
      lastError = result.error;
      lastErrorCode = result.errorCode;

      // Don't retry on certain errors
      if (result.errorCode === PrivateRelayErrorCode.INVALID_RESPONSE) {
        break;
      }

      // Wait before retry (exponential backoff)
      if (attempt < this.config.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)));
      }
    }

    const latencyMs = Date.now() - startTime;

    // Private submission failed after retries, attempt fallback
    console.log('[private-relay] fallback', {
      user: context.user,
      reason: lastErrorCode || 'UNKNOWN',
      mode: this.config.fallbackMode,
      error: lastError
    });

    recordFallback(lastErrorCode || PrivateRelayErrorCode.MAX_RETRIES_EXCEEDED);

    // Execute fallback strategy
    const fallbackResult = await this.executeFallback(signedTx, context);

    return {
      success: fallbackResult.success,
      txHash: fallbackResult.txHash,
      sentPrivate: false,
      fallbackUsed: true,
      errorCode: lastErrorCode,
      rpcError: lastError,
      latencyMs
    };
  }

  /**
   * Execute fallback strategy (race or direct)
   */
  private async executeFallback(
    signedTx: string,
    context: PrivateRelayContext
  ): Promise<{ success: boolean; txHash?: string }> {
    if (this.config.fallbackMode === 'race' && this.writeRpcs.length > 0) {
      // Race mode: broadcast to multiple RPCs
      return this.raceMode(signedTx, context);
    } else {
      // Direct mode: use primary provider
      return this.directMode(signedTx, context);
    }
  }

  /**
   * Race mode: broadcast to multiple RPC endpoints
   */
  private async raceMode(
    signedTx: string,
    context: PrivateRelayContext
  ): Promise<{ success: boolean; txHash?: string }> {
    console.log('[private-relay] race mode fallback', {
      user: context.user,
      endpoints: this.writeRpcs.length
    });

    // Broadcast to all RPCs in parallel
    const promises = this.writeRpcs.map(async (rpcUrl) => {
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const response = await provider.broadcastTransaction(signedTx);
        return { success: true, txHash: response.hash };
      } catch (error: any) {
        console.warn('[private-relay] race endpoint failed', {
          rpcUrl: new URL(rpcUrl).host,
          error: error.message
        });
        return { success: false };
      }
    });

    // Wait for first success or all failures
    const results = await Promise.all(promises);
    const successful = results.find(r => r.success);

    return successful || { success: false };
  }

  /**
   * Direct mode: use primary provider
   */
  private async directMode(
    signedTx: string,
    context: PrivateRelayContext
  ): Promise<{ success: boolean; txHash?: string }> {
    if (!this.provider) {
      console.warn('[private-relay] direct mode: no provider available');
      return { success: false };
    }

    try {
      console.log('[private-relay] direct mode fallback', {
        user: context.user
      });

      const response = await this.provider.broadcastTransaction(signedTx);
      return { success: true, txHash: response.hash };
    } catch (error: any) {
      console.error('[private-relay] direct mode failed', {
        user: context.user,
        error: error.message
      });
      return { success: false };
    }
  }

  /**
   * Check if private relay is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get current configuration
   */
  getConfig(): PrivateRelayConfig {
    return { ...this.config };
  }
}
