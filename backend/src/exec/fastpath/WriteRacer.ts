/**
 * WriteRacer: Multi-RPC write racing with health scoring
 * 
 * Supports parallel broadcast to multiple write RPC endpoints with first-success
 * short-circuit. Tracks health metrics and RTT for endpoint selection.
 */

import { ethers } from 'ethers';

import {
  writeRpcRttMs,
  writeRpcSuccessTotal,
  writeRpcErrorTotal
} from '../../metrics/index.js';

import { writeRacingConfig } from './config.js';
import type { RpcHealthMetrics } from './types.js';

export class WriteRacer {
  private healthMetrics: Map<string, RpcHealthMetrics> = new Map();
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();
  private writeRpcs: string[];
  private raceTimeoutMs: number;
  private emaAlpha = 0.3; // Exponential moving average smoothing factor

  constructor(
    writeRpcs: string[] = writeRacingConfig.writeRpcs,
    raceTimeoutMs: number = writeRacingConfig.raceTimeoutMs
  ) {
    this.writeRpcs = writeRpcs;
    this.raceTimeoutMs = raceTimeoutMs;

    // Initialize providers and health metrics
    for (const rpcUrl of this.writeRpcs) {
      this.providers.set(rpcUrl, new ethers.JsonRpcProvider(rpcUrl));
      this.healthMetrics.set(rpcUrl, {
        rpcUrl,
        successCount: 0,
        errorCount: 0,
        totalRtt: 0,
        avgRtt: 0,
        lastUpdated: Date.now()
      });
    }
  }

  /**
   * Update health metrics for an RPC endpoint
   */
  private updateHealth(rpcUrl: string, success: boolean, rttMs: number): void {
    const metrics = this.healthMetrics.get(rpcUrl);
    if (!metrics) return;

    if (success) {
      metrics.successCount++;
      writeRpcSuccessTotal.inc({ rpc: rpcUrl });
    } else {
      metrics.errorCount++;
      writeRpcErrorTotal.inc({ rpc: rpcUrl });
    }

    // Update exponential moving average RTT
    if (success) {
      if (metrics.avgRtt === 0) {
        metrics.avgRtt = rttMs;
      } else {
        metrics.avgRtt = this.emaAlpha * rttMs + (1 - this.emaAlpha) * metrics.avgRtt;
      }
      metrics.totalRtt += rttMs;
      writeRpcRttMs.set({ rpc: rpcUrl }, metrics.avgRtt);
    }

    metrics.lastUpdated = Date.now();
  }

  /**
   * Get sorted RPC endpoints by health (ascending RTT)
   */
  private getSortedRpcs(): string[] {
    return Array.from(this.healthMetrics.entries())
      .sort((a, b) => {
        // Sort by average RTT (lower is better)
        // If RTT is 0, put at end
        const rttA = a[1].avgRtt || Infinity;
        const rttB = b[1].avgRtt || Infinity;
        return rttA - rttB;
      })
      .map(([url]) => url);
  }

  /**
   * Broadcast transaction to multiple RPCs with racing logic
   * 
   * @param signedTx Signed transaction hex string
   * @returns Transaction hash from first successful broadcast
   */
  async broadcastTransaction(signedTx: string): Promise<string> {
    // If no write RPCs configured, throw error
    if (this.writeRpcs.length === 0) {
      throw new Error('No write RPCs configured for racing');
    }

    const sortedRpcs = this.getSortedRpcs();
    const errors: Error[] = [];

    // Race all providers in parallel
    const broadcastPromises = sortedRpcs.map(async (rpcUrl) => {
      const provider = this.providers.get(rpcUrl);
      if (!provider) return null;

      const startTime = Date.now();
      try {
        const tx = await provider.broadcastTransaction(signedTx);
        const rtt = Date.now() - startTime;
        this.updateHealth(rpcUrl, true, rtt);
        return { txHash: tx.hash, rpcUrl, rtt };
      } catch (error) {
        const rtt = Date.now() - startTime;
        this.updateHealth(rpcUrl, false, rtt);
        errors.push(error as Error);
        return null;
      }
    });

    // Wait for first success
    const result = await Promise.race(broadcastPromises.map(async (p) => {
      const res = await p;
      if (res) return res;
      throw new Error('Broadcast failed');
    }).concat([
      // Timeout fallback
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('All broadcasts timed out')), this.raceTimeoutMs * 3)
      )
    ])).catch(() => null);

    if (result) {
      return result.txHash;
    }

    // All failed
    throw new Error(`All write RPCs failed: ${errors.map(e => e.message).join(', ')}`);
  }

  /**
   * Ping all RPCs to measure current RTT
   */
  async pingAll(): Promise<void> {
    const pingPromises = Array.from(this.providers.entries()).map(async ([rpcUrl, provider]) => {
      const startTime = Date.now();
      try {
        await provider.getBlockNumber();
        const rtt = Date.now() - startTime;
        this.updateHealth(rpcUrl, true, rtt);
      } catch (error) {
        const rtt = Date.now() - startTime;
        this.updateHealth(rpcUrl, false, rtt);
      }
    });

    await Promise.allSettled(pingPromises);
  }

  /**
   * Get health metrics for all RPCs
   */
  getHealthMetrics(): RpcHealthMetrics[] {
    return Array.from(this.healthMetrics.values());
  }

  /**
   * Get health metrics for specific RPC
   */
  getHealth(rpcUrl: string): RpcHealthMetrics | undefined {
    return this.healthMetrics.get(rpcUrl);
  }

  /**
   * Check if write racing is enabled (multiple RPCs configured)
   */
  isEnabled(): boolean {
    return this.writeRpcs.length > 0;
  }
}

// Singleton instance - only created if write RPCs are configured
export const writeRacer = writeRacingConfig.writeRpcs.length > 0
  ? new WriteRacer()
  : null;
