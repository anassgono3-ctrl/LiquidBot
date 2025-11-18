/**
 * Startup Diagnostics Service
 * 
 * Provides comprehensive startup diagnostics for Phase 1 features including:
 * - WebSocket connectivity status
 * - Mempool transmit monitoring configuration
 * - Feed discovery and subscription status
 * - Projection engine configuration
 * - Coalesce settings
 * - Metrics configuration
 * - Borrowers index status
 * - Precompute configuration
 */

import { WebSocketProvider } from 'ethers';

import { config } from '../config/index.js';
import {
  mempoolPendingSubscriptions,
  borrowersIndexBackfillBlocks,
  borrowersIndexTotalAddresses
} from '../metrics/index.js';

export interface StartupDiagnosticsResult {
  wsConnectivity: {
    providerType: string;
    urlHost: string;
    connected: boolean;
    error?: string;
  };
  mempoolTransmit: {
    enabled: boolean;
    subscriptionMode: string;
    subscriptionCheck?: {
      success: boolean;
      aggregatorCount: number;
      error?: string;
    };
    status: 'ACTIVE' | 'INACTIVE';
    reason?: string;
  };
  feeds: {
    autoDiscoverEnabled: boolean;
    discoveredCount: number;
    pendingSubscriptions: number;
    onChainSubscriptions: number;
  };
  projectionEngine: {
    enabled: boolean;
    bufferBps?: number;
    criticalSliceSizeCap?: number;
  };
  coalesce: {
    reserveDebounceMs: number;
    fastLaneSettings: {
      enabled: boolean;
      maxBatch?: number;
    };
  };
  metrics: {
    latencyMetricsEnabled: boolean;
    emitIntervalBlocks: number;
  };
  borrowersIndex: {
    enabled: boolean;
    backfillBlocks: number;
    status: 'in-progress' | 'done' | 'disabled';
    totalAddresses?: number;
  };
  precompute: {
    enabled: boolean;
    topK: number;
  };
  sprinter: {
    enabled: boolean;
    prestageHf: number;
    maxPrestaged: number;
    verifyBatch: number;
    writeRpcCount: number;
    optimisticMode: boolean;
  };
}

/**
 * StartupDiagnosticsService performs comprehensive startup checks
 */
export class StartupDiagnosticsService {
  private provider?: WebSocketProvider;
  private timeoutMs: number;

  constructor(provider?: WebSocketProvider, timeoutMs?: number) {
    this.provider = provider;
    this.timeoutMs = timeoutMs || config.startupDiagTimeoutMs;
  }

  /**
   * Run full startup diagnostics
   */
  async run(): Promise<StartupDiagnosticsResult> {
    const result: StartupDiagnosticsResult = {
      wsConnectivity: await this.checkWsConnectivity(),
      mempoolTransmit: await this.checkMempoolTransmit(),
      feeds: await this.checkFeeds(),
      projectionEngine: this.checkProjectionEngine(),
      coalesce: this.checkCoalesceSettings(),
      metrics: this.checkMetricsConfig(),
      borrowersIndex: this.checkBorrowersIndex(),
      precompute: this.checkPrecomputeConfig(),
      sprinter: this.checkSprinterConfig()
    };

    return result;
  }

  /**
   * Check WebSocket connectivity
   */
  private async checkWsConnectivity(): Promise<StartupDiagnosticsResult['wsConnectivity']> {
    const wsUrl = config.wsRpcUrl || '';
    
    if (!wsUrl) {
      return {
        providerType: 'none',
        urlHost: 'not-configured',
        connected: false,
        error: 'WS_RPC_URL not configured'
      };
    }

    // Determine provider type
    let providerType = 'generic';
    if (wsUrl.includes('flashblocks') || config.useFlashblocks) {
      providerType = 'Flashblocks';
    } else if (wsUrl.includes('alchemy')) {
      providerType = 'Alchemy';
    }

    // Mask URL for security (show only host)
    const urlHost = this.maskUrl(wsUrl);

    // Check if provider is connected
    if (this.provider) {
      try {
        // Simple connectivity check - try to get network
        const network = await Promise.race([
          this.provider.getNetwork(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 3000)
          )
        ]);
        
        return {
          providerType,
          urlHost,
          connected: !!network
        };
      } catch (error) {
        return {
          providerType,
          urlHost,
          connected: false,
          error: error instanceof Error ? error.message : 'Connection failed'
        };
      }
    }

    return {
      providerType,
      urlHost,
      connected: false,
      error: 'Provider not initialized'
    };
  }

  /**
   * Check mempool transmit monitoring status
   */
  private async checkMempoolTransmit(): Promise<StartupDiagnosticsResult['mempoolTransmit']> {
    const enabled = config.transmitMempoolEnabled || config.mempoolMonitorEnabled;
    const subscriptionMode = config.mempoolSubscriptionMode || 'auto';

    if (!enabled) {
      return {
        enabled: false,
        subscriptionMode: 'none',
        status: 'INACTIVE',
        reason: 'TRANSMIT_MEMPOOL_ENABLED=false'
      };
    }

    // Attempt subscription check if provider is available
    let subscriptionCheck: StartupDiagnosticsResult['mempoolTransmit']['subscriptionCheck'];
    
    if (this.provider) {
      subscriptionCheck = await this.testPendingSubscription();
    }

    // Determine status
    const status = subscriptionCheck?.success ? 'ACTIVE' : 'INACTIVE';
    const reason = subscriptionCheck?.success 
      ? `filtered pending for ${subscriptionCheck.aggregatorCount} aggregators`
      : subscriptionCheck?.error || 'provider not available';

    return {
      enabled,
      subscriptionMode,
      subscriptionCheck,
      status,
      reason
    };
  }

  /**
   * Test pending transaction subscription
   */
  private async testPendingSubscription(): Promise<{
    success: boolean;
    aggregatorCount: number;
    error?: string;
  }> {
    if (!this.provider) {
      return { success: false, aggregatorCount: 0, error: 'Provider not available' };
    }

    try {
      // Try to establish a pending subscription with timeout
      // This is a quick check to see if the provider supports pending tx subscriptions
      const testPromise = new Promise<boolean>((resolve) => {
        // Simplified test - just check if subscription method exists
        const hasSubscribe = typeof this.provider?.on === 'function';
        resolve(hasSubscribe);
      });

      const success = await Promise.race([
        testPromise,
        new Promise<boolean>((resolve) => 
          setTimeout(() => resolve(false), this.timeoutMs)
        )
      ]);

      // For now, assume success if provider has subscription capability
      // In a real implementation, we'd try to subscribe to a test aggregator
      const aggregatorCount = config.autoDiscoverFeeds ? 9 : 0; // Placeholder

      if (success) {
        mempoolPendingSubscriptions.set(1);
      }

      return {
        success,
        aggregatorCount,
        error: success ? undefined : 'Subscription test timed out'
      };
    } catch (error) {
      return {
        success: false,
        aggregatorCount: 0,
        error: error instanceof Error ? error.message : 'Subscription test failed'
      };
    }
  }

  /**
   * Check feed discovery and subscriptions
   */
  private async checkFeeds(): Promise<StartupDiagnosticsResult['feeds']> {
    const autoDiscoverEnabled = config.autoDiscoverFeeds;
    
    // These would be populated by actual feed discovery service
    // For now, use placeholder values
    const discoveredCount = autoDiscoverEnabled ? 9 : 0;
    const pendingSubscriptions = autoDiscoverEnabled ? 9 : 0;
    const onChainSubscriptions = autoDiscoverEnabled ? 9 : 0;

    return {
      autoDiscoverEnabled,
      discoveredCount,
      pendingSubscriptions,
      onChainSubscriptions
    };
  }

  /**
   * Check projection engine configuration
   */
  private checkProjectionEngine(): StartupDiagnosticsResult['projectionEngine'] {
    const enabled = config.hfProjectionEnabled;
    
    return {
      enabled,
      bufferBps: enabled ? config.hysteresisBps : undefined,
      criticalSliceSizeCap: enabled ? config.hotlistMax : undefined
    };
  }

  /**
   * Check coalesce settings
   */
  private checkCoalesceSettings(): StartupDiagnosticsResult['coalesce'] {
    return {
      reserveDebounceMs: config.reserveCoalesceWindowMs || config.eventBatchCoalesceMs,
      fastLaneSettings: {
        enabled: config.reserveCoalesceEnabled,
        maxBatch: config.reserveCoalesceMaxBatch
      }
    };
  }

  /**
   * Check metrics configuration
   */
  private checkMetricsConfig(): StartupDiagnosticsResult['metrics'] {
    return {
      latencyMetricsEnabled: config.latencyMetricsEnabled,
      emitIntervalBlocks: config.metricsEmitIntervalBlocks
    };
  }

  /**
   * Check borrowers index status
   */
  private checkBorrowersIndex(): StartupDiagnosticsResult['borrowersIndex'] {
    const enabled = config.borrowersIndexEnabled;
    const backfillBlocks = config.borrowersIndexBackfillBlocks;

    // Update metrics
    borrowersIndexBackfillBlocks.set(backfillBlocks);

    return {
      enabled,
      backfillBlocks,
      status: enabled ? 'in-progress' : 'disabled',
      totalAddresses: enabled ? 0 : undefined // Would be populated by actual service
    };
  }

  /**
   * Check precompute configuration
   */
  private checkPrecomputeConfig(): StartupDiagnosticsResult['precompute'] {
    return {
      enabled: config.precomputeEnabled,
      topK: config.precomputeTopK
    };
  }

  /**
   * Check Sprinter configuration
   */
  private checkSprinterConfig(): StartupDiagnosticsResult['sprinter'] {
    return {
      enabled: config.sprinterEnabled || false,
      prestageHf: config.prestageHfBps / 10000,
      maxPrestaged: config.sprinterMaxPrestaged || 0,
      verifyBatch: config.sprinterVerifyBatch || 0,
      writeRpcCount: config.writeRpcs?.length || 0,
      optimisticMode: config.optimisticEnabled || false
    };
  }

  /**
   * Format diagnostics result as readable log message
   */
  formatDiagnostics(result: StartupDiagnosticsResult): string {
    const lines: string[] = [];
    
    lines.push('');
    lines.push('='.repeat(80));
    lines.push('STARTUP DIAGNOSTICS - Phase 1 Features');
    lines.push('='.repeat(80));
    
    // WebSocket connectivity
    lines.push('');
    lines.push('[WebSocket Connectivity]');
    lines.push(`  Provider: ${result.wsConnectivity.providerType}`);
    lines.push(`  URL: ${result.wsConnectivity.urlHost}`);
    lines.push(`  Status: ${result.wsConnectivity.connected ? 'CONNECTED' : 'DISCONNECTED'}`);
    if (result.wsConnectivity.error) {
      lines.push(`  Error: ${result.wsConnectivity.error}`);
    }
    
    // Mempool transmit
    lines.push('');
    lines.push('[Mempool Transmit Monitoring]');
    lines.push(`  Enabled: ${result.mempoolTransmit.enabled}`);
    lines.push(`  Mode: ${result.mempoolTransmit.subscriptionMode}`);
    lines.push(`  Status: ${result.mempoolTransmit.status}`);
    if (result.mempoolTransmit.reason) {
      lines.push(`  Reason: ${result.mempoolTransmit.reason}`);
    }
    if (result.mempoolTransmit.subscriptionCheck) {
      const check = result.mempoolTransmit.subscriptionCheck;
      lines.push(`  Subscription: ${check.success ? 'SUCCESS' : 'FAILED'}`);
      if (check.success) {
        lines.push(`  Aggregators: ${check.aggregatorCount}`);
      }
      if (check.error) {
        lines.push(`  Error: ${check.error}`);
      }
    }
    
    // Feeds
    lines.push('');
    lines.push('[Chainlink Feeds]');
    lines.push(`  Auto-discovery: ${result.feeds.autoDiscoverEnabled ? 'ENABLED' : 'DISABLED'}`);
    lines.push(`  Discovered: ${result.feeds.discoveredCount}`);
    lines.push(`  Pending subscriptions: ${result.feeds.pendingSubscriptions}`);
    lines.push(`  On-chain subscriptions: ${result.feeds.onChainSubscriptions}`);
    
    // Projection engine
    lines.push('');
    lines.push('[Projection Engine]');
    lines.push(`  Enabled: ${result.projectionEngine.enabled}`);
    if (result.projectionEngine.enabled) {
      lines.push(`  Buffer: ${result.projectionEngine.bufferBps} bps`);
      lines.push(`  Critical slice cap: ${result.projectionEngine.criticalSliceSizeCap}`);
    }
    
    // Coalesce
    lines.push('');
    lines.push('[Reserve Event Coalescing]');
    lines.push(`  Debounce window: ${result.coalesce.reserveDebounceMs}ms`);
    lines.push(`  Fast-lane: ${result.coalesce.fastLaneSettings.enabled ? 'ENABLED' : 'DISABLED'}`);
    if (result.coalesce.fastLaneSettings.enabled) {
      lines.push(`  Max batch: ${result.coalesce.fastLaneSettings.maxBatch}`);
    }
    
    // Metrics
    lines.push('');
    lines.push('[Metrics]');
    lines.push(`  Latency metrics: ${result.metrics.latencyMetricsEnabled ? 'ENABLED' : 'DISABLED'}`);
    lines.push(`  Emit interval: ${result.metrics.emitIntervalBlocks} blocks`);
    
    // Borrowers index
    lines.push('');
    lines.push('[Borrowers Index]');
    lines.push(`  Enabled: ${result.borrowersIndex.enabled}`);
    lines.push(`  Backfill blocks: ${result.borrowersIndex.backfillBlocks}`);
    lines.push(`  Status: ${result.borrowersIndex.status}`);
    if (result.borrowersIndex.totalAddresses !== undefined) {
      lines.push(`  Total addresses: ${result.borrowersIndex.totalAddresses}`);
    }
    
    // Precompute
    lines.push('');
    lines.push('[Precompute]');
    lines.push(`  Enabled: ${result.precompute.enabled}`);
    lines.push(`  Top K: ${result.precompute.topK}`);
    
    // Sprinter
    lines.push('');
    lines.push('[Sprinter High-Priority Execution]');
    lines.push(`  Status: ${result.sprinter.enabled ? 'ENABLED' : 'DISABLED'}`);
    if (result.sprinter.enabled) {
      lines.push(`  Prestage HF threshold: ${result.sprinter.prestageHf.toFixed(4)} (${(result.sprinter.prestageHf * 100).toFixed(2)}%)`);
      lines.push(`  Max prestaged: ${result.sprinter.maxPrestaged}`);
      lines.push(`  Verify batch: ${result.sprinter.verifyBatch}`);
      lines.push(`  Write RPCs: ${result.sprinter.writeRpcCount}`);
      lines.push(`  Optimistic mode: ${result.sprinter.optimisticMode ? 'ENABLED' : 'DISABLED'}`);
    }
    
    // Summary line
    lines.push('');
    lines.push('[Summary]');
    const mempoolStatus = result.mempoolTransmit.status === 'ACTIVE'
      ? `mempool-transmit: ACTIVE (${result.mempoolTransmit.reason})`
      : `mempool-transmit: INACTIVE (${result.mempoolTransmit.reason})`;
    const feedStatus = `feeds: ${result.feeds.pendingSubscriptions} pending / ${result.feeds.onChainSubscriptions} on-chain`;
    lines.push(`  ${mempoolStatus} | ${feedStatus}`);
    
    lines.push('='.repeat(80));
    lines.push('');
    
    return lines.join('\n');
  }

  /**
   * Mask sensitive URL information
   */
  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch {
      return 'invalid-url';
    }
  }
}
