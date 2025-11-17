/**
 * TxSubmitter: Multi-mode transaction submission
 * 
 * Supports four modes:
 * - public: send to one fastest public write RPC (default)
 * - private: send to private relay only
 * - race: concurrently send to all public + private, cancel others on first success
 * - bundle: timed/bundled inclusion (scaffold for future)
 * 
 * Integrates with existing GAS_LADDER, GAS_BURST, and GAS_BUMP_* settings.
 */

import { ethers } from 'ethers';

import type { ExecutionRpcPool, RpcEndpoint } from './ExecutionRpcPool.js';

export type TxSubmitMode = 'public' | 'private' | 'race' | 'bundle';

export interface TxSubmitConfig {
  mode: TxSubmitMode;
  raceTimeoutMs: number; // For race mode: delay before firing secondary endpoints
  maxGasBumps: number;
  gasBumpPct: number;
  gasBurstFirstMs: number;
  gasBurstSecondMs: number;
  gasBurstFirstPct: number;
  gasBurstSecondPct: number;
}

export interface TxSubmitResult {
  success: boolean;
  txHash?: string;
  error?: Error;
  submittedTo: string[]; // URLs where tx was submitted
  acceptedBy?: string; // URL that first accepted the tx
  latencyMs: number;
  gasBumps: number;
}

interface PendingSubmission {
  endpoint: RpcEndpoint;
  promise: Promise<ethers.TransactionResponse>;
  controller: AbortController;
}

/**
 * TxSubmitter handles multi-mode transaction submission
 */
export class TxSubmitter {
  private config: TxSubmitConfig;
  private rpcPool: ExecutionRpcPool;

  constructor(rpcPool: ExecutionRpcPool, config: TxSubmitConfig) {
    this.rpcPool = rpcPool;
    this.config = config;

    // eslint-disable-next-line no-console
    console.log(`[tx-submit] Initialized with mode=${config.mode}, raceTimeout=${config.raceTimeoutMs}ms`);
  }

  /**
   * Submit a signed transaction according to configured mode
   */
  async submitTransaction(signedTx: string): Promise<TxSubmitResult> {
    const startTime = Date.now();

    try {
      switch (this.config.mode) {
        case 'public':
          return await this.submitPublic(signedTx, startTime);
        case 'private':
          return await this.submitPrivate(signedTx, startTime);
        case 'race':
          return await this.submitRace(signedTx, startTime);
        case 'bundle':
          return await this.submitBundle(signedTx, startTime);
        default:
          throw new Error(`Unknown submit mode: ${this.config.mode}`);
      }
    } catch (error) {
      return {
        success: false,
        error: error as Error,
        submittedTo: [],
        latencyMs: Date.now() - startTime,
        gasBumps: 0
      };
    }
  }

  /**
   * Submit to one fastest public write RPC
   */
  private async submitPublic(signedTx: string, startTime: number): Promise<TxSubmitResult> {
    const provider = this.rpcPool.getFastestWriteProvider();
    if (!provider) {
      throw new Error('No healthy public write endpoints available');
    }

    const endpoints = this.rpcPool.getPublicWriteEndpoints();
    const targetUrl = endpoints[0]?.url || 'unknown';

    try {
      const tx = await provider.broadcastTransaction(signedTx);
      
      return {
        success: true,
        txHash: tx.hash,
        submittedTo: [targetUrl],
        acceptedBy: targetUrl,
        latencyMs: Date.now() - startTime,
        gasBumps: 0
      };
    } catch (error) {
      this.rpcPool.markUnhealthy(targetUrl, error as Error);
      throw error;
    }
  }

  /**
   * Submit to private relay only
   */
  private async submitPrivate(signedTx: string, startTime: number): Promise<TxSubmitResult> {
    const endpoint = this.rpcPool.getPrivateRelayEndpoint();
    if (!endpoint) {
      throw new Error('No private relay endpoint configured or healthy');
    }

    try {
      const tx = await endpoint.provider.broadcastTransaction(signedTx);
      
      return {
        success: true,
        txHash: tx.hash,
        submittedTo: [endpoint.url],
        acceptedBy: endpoint.url,
        latencyMs: Date.now() - startTime,
        gasBumps: 0
      };
    } catch (error) {
      this.rpcPool.markUnhealthy(endpoint.url, error as Error);
      throw error;
    }
  }

  /**
   * Submit concurrently to all public + private, cancel others on first success
   */
  private async submitRace(signedTx: string, startTime: number): Promise<TxSubmitResult> {
    const publicEndpoints = this.rpcPool.getPublicWriteEndpoints();
    const privateEndpoint = this.rpcPool.getPrivateRelayEndpoint();

    if (publicEndpoints.length === 0 && !privateEndpoint) {
      throw new Error('No healthy endpoints available for racing');
    }

    const allEndpoints = [
      ...publicEndpoints,
      ...(privateEndpoint ? [privateEndpoint] : [])
    ];

    // Create pending submissions with abort controllers
    const pending: PendingSubmission[] = allEndpoints.map(endpoint => {
      const controller = new AbortController();
      const promise = endpoint.provider.broadcastTransaction(signedTx);
      
      return {
        endpoint,
        promise,
        controller
      };
    });

    try {
      // Race all submissions
      const result = await Promise.race(
        pending.map(async (p, idx) => {
          try {
            const tx = await p.promise;
            return { success: true, tx, endpoint: p.endpoint, idx };
          } catch (error) {
            return { success: false, error: error as Error, endpoint: p.endpoint, idx };
          }
        })
      );

      // Cancel other pending requests (best effort)
      for (let i = 0; i < pending.length; i++) {
        if (i !== result.idx) {
          pending[i].controller.abort();
        }
      }

      if (result.success && result.tx) {
        return {
          success: true,
          txHash: result.tx.hash,
          submittedTo: allEndpoints.map(ep => ep.url),
          acceptedBy: result.endpoint.url,
          latencyMs: Date.now() - startTime,
          gasBumps: 0
        };
      } else {
        // First result was an error, mark endpoint unhealthy
        if (result.error) {
          this.rpcPool.markUnhealthy(result.endpoint.url, result.error);
        }
        throw result.error || new Error('Race failed with unknown error');
      }
    } catch (error) {
      // All endpoints failed
      return {
        success: false,
        error: error as Error,
        submittedTo: allEndpoints.map(ep => ep.url),
        latencyMs: Date.now() - startTime,
        gasBumps: 0
      };
    }
  }

  /**
   * Submit as a bundle (scaffold for future implementation)
   * Currently falls back to race mode
   */
  private async submitBundle(signedTx: string, startTime: number): Promise<TxSubmitResult> {
    // eslint-disable-next-line no-console
    console.warn('[tx-submit] Bundle mode not yet implemented, falling back to race mode');
    return this.submitRace(signedTx, startTime);
  }

  /**
   * Get current configuration
   */
  getConfig(): TxSubmitConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (e.g., change mode at runtime)
   */
  updateConfig(updates: Partial<TxSubmitConfig>): void {
    this.config = { ...this.config, ...updates };
    // eslint-disable-next-line no-console
    console.log(`[tx-submit] Configuration updated:`, updates);
  }
}

/**
 * Load TxSubmitter configuration from environment variables
 */
export function loadTxSubmitConfig(): TxSubmitConfig {
  const mode = (process.env.TX_SUBMIT_MODE || 'public') as TxSubmitMode;
  
  // Validate mode
  const validModes: TxSubmitMode[] = ['public', 'private', 'race', 'bundle'];
  if (!validModes.includes(mode)) {
    // eslint-disable-next-line no-console
    console.warn(`[tx-submit] Invalid TX_SUBMIT_MODE="${mode}", defaulting to "public"`);
    return loadTxSubmitConfig(); // Recursively load with default
  }

  return {
    mode,
    raceTimeoutMs: Number(process.env.WRITE_RACE_TIMEOUT_MS || 120),
    maxGasBumps: Number(process.env.GAS_BURST_MAX_BUMPS || 2),
    gasBumpPct: Number(process.env.GAS_BUMP_PCT || 25),
    gasBurstFirstMs: Number(process.env.GAS_BURST_FIRST_MS || 150),
    gasBurstSecondMs: Number(process.env.GAS_BURST_SECOND_MS || 300),
    gasBurstFirstPct: Number(process.env.GAS_BURST_FIRST_PCT || 25),
    gasBurstSecondPct: Number(process.env.GAS_BURST_SECOND_PCT || 25)
  };
}
