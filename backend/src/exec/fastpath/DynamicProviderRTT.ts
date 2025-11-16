/**
 * DynamicProviderRTT: Dynamic provider RTT measurement
 * 
 * Periodically pings write RPCs with eth_blockNumber to measure RTT.
 * Maintains exponential moving average and provides ordering by RTT.
 */

import { ethers } from 'ethers';

export interface ProviderRTTMetrics {
  url: string;
  avgRttMs: number;
  lastPingMs: number;
  lastPingAt: number;
  pingCount: number;
  errorCount: number;
}

export class DynamicProviderRTT {
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();
  private metrics: Map<string, ProviderRTTMetrics> = new Map();
  private pingIntervalMs: number;
  private pingTimer?: NodeJS.Timeout;
  private emaAlpha = 0.3; // Exponential moving average smoothing

  constructor(
    rpcUrls: string[],
    pingIntervalMs: number = 60000 // Default: 60 seconds
  ) {
    this.pingIntervalMs = pingIntervalMs;

    // Initialize providers
    for (const url of rpcUrls) {
      this.providers.set(url, new ethers.JsonRpcProvider(url));
      this.metrics.set(url, {
        url,
        avgRttMs: 0,
        lastPingMs: 0,
        lastPingAt: 0,
        pingCount: 0,
        errorCount: 0
      });
    }
  }

  /**
   * Start periodic RTT measurement
   */
  start(): void {
    if (this.pingTimer) return;

    // Initial ping
    this.pingAll().catch(() => {
      // Silently handle errors
    });

    // Set up periodic pings
    this.pingTimer = setInterval(() => {
      this.pingAll().catch(() => {
        // Silently handle errors
      });
    }, this.pingIntervalMs);
  }

  /**
   * Stop periodic RTT measurement
   */
  stop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  /**
   * Ping all providers
   */
  async pingAll(): Promise<void> {
    const pingPromises = Array.from(this.providers.entries()).map(
      async ([url, provider]) => {
        await this.pingProvider(url, provider);
      }
    );

    await Promise.allSettled(pingPromises);
  }

  /**
   * Ping a single provider
   */
  private async pingProvider(url: string, provider: ethers.JsonRpcProvider): Promise<void> {
    const metrics = this.metrics.get(url);
    if (!metrics) return;

    const startTime = Date.now();
    try {
      await provider.getBlockNumber();
      const rtt = Date.now() - startTime;

      // Update exponential moving average
      if (metrics.avgRttMs === 0) {
        metrics.avgRttMs = rtt;
      } else {
        metrics.avgRttMs = this.emaAlpha * rtt + (1 - this.emaAlpha) * metrics.avgRttMs;
      }

      metrics.lastPingMs = rtt;
      metrics.lastPingAt = Date.now();
      metrics.pingCount++;
    } catch (error) {
      metrics.errorCount++;
    }
  }

  /**
   * Get providers ordered by RTT (ascending)
   */
  getOrderedProviders(): string[] {
    return Array.from(this.metrics.entries())
      .sort((a, b) => {
        // Sort by average RTT (lower is better)
        // If RTT is 0 (no successful pings), put at end
        const rttA = a[1].avgRttMs || Infinity;
        const rttB = b[1].avgRttMs || Infinity;
        return rttA - rttB;
      })
      .map(([url]) => url);
  }

  /**
   * Get metrics for a specific provider
   */
  getMetrics(url: string): ProviderRTTMetrics | undefined {
    return this.metrics.get(url);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): ProviderRTTMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Get provider with lowest RTT
   */
  getFastestProvider(): string | undefined {
    const ordered = this.getOrderedProviders();
    return ordered[0];
  }

  /**
   * Manual ping (for immediate measurement)
   */
  async ping(url: string): Promise<number | null> {
    const provider = this.providers.get(url);
    if (!provider) return null;

    const startTime = Date.now();
    try {
      await provider.getBlockNumber();
      return Date.now() - startTime;
    } catch (error) {
      return null;
    }
  }

  /**
   * Clear all metrics (for testing)
   */
  clear(): void {
    for (const metrics of this.metrics.values()) {
      metrics.avgRttMs = 0;
      metrics.lastPingMs = 0;
      metrics.lastPingAt = 0;
      metrics.pingCount = 0;
      metrics.errorCount = 0;
    }
  }
}
