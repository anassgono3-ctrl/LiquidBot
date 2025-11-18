// PerformanceMetricsCollector: Core latency & throughput instrumentation
// Tracks block→critical slice, price transmit→projection, batch processing latencies
// Implements Prometheus-style counters with periodic log emit for debugging

import {
  blockToCriticalSliceMs,
  priceTransmitToProjectionMs,
  batchProcessingLatencyMs,
  throughputAccountsPerSecond
} from '../metrics/index.js';

export interface PerformanceCheckpoint {
  name: string;
  timestamp: number;
}

export interface LatencyMeasurement {
  operation: string;
  startTime: number;
  endTime: number;
  latencyMs: number;
  metadata?: Record<string, string | number>;
}

export interface ThroughputWindow {
  startTime: number;
  accountsProcessed: number;
  blocksProcessed: number;
}

/**
 * PerformanceMetricsCollector provides core latency & throughput instrumentation
 * for performance-critical operations.
 * 
 * Features:
 * - Prometheus-style histogram metrics for latency tracking
 * - Rolling window throughput calculation
 * - Periodic log emission for debugging
 * - Lightweight in-memory storage with automatic cleanup
 */
export class PerformanceMetricsCollector {
  private readonly logIntervalMs: number;
  private readonly windowSizeMs: number;
  private logTimer: NodeJS.Timeout | null = null;
  
  // Recent measurements for periodic logging
  private recentMeasurements: LatencyMeasurement[] = [];
  private readonly maxRecentMeasurements = 1000;
  
  // Throughput tracking
  private throughputWindow: ThroughputWindow = {
    startTime: Date.now(),
    accountsProcessed: 0,
    blocksProcessed: 0
  };
  
  // Active operation tracking (for incomplete operations)
  private activeOperations: Map<string, number> = new Map(); // operationId -> startTime

  constructor(options?: {
    logIntervalMs?: number;
    windowSizeMs?: number;
  }) {
    this.logIntervalMs = options?.logIntervalMs ?? 30000; // 30 seconds default
    this.windowSizeMs = options?.windowSizeMs ?? 60000; // 60 seconds rolling window

    // Start periodic logging
    this.startPeriodicLogging();

    // eslint-disable-next-line no-console
    console.log(
      `[perf-metrics] Initialized with logInterval=${this.logIntervalMs}ms, ` +
      `window=${this.windowSizeMs}ms`
    );
  }

  /**
   * Record block-to-critical-slice latency
   * Measures time from block received to critical accounts identified
   */
  recordBlockToCriticalSlice(latencyMs: number, blockNumber?: number): void {
    blockToCriticalSliceMs.observe(latencyMs);
    
    this.recordMeasurement({
      operation: 'block_to_critical_slice',
      startTime: Date.now() - latencyMs,
      endTime: Date.now(),
      latencyMs,
      metadata: blockNumber ? { blockNumber } : undefined
    });
  }

  /**
   * Record price-transmit-to-projection latency
   * Measures time from mempool transmit detection to HF projection completion
   */
  recordPriceTransmitToProjection(latencyMs: number, symbol?: string): void {
    priceTransmitToProjectionMs.observe(latencyMs);
    
    this.recordMeasurement({
      operation: 'price_transmit_to_projection',
      startTime: Date.now() - latencyMs,
      endTime: Date.now(),
      latencyMs,
      metadata: symbol ? { symbol } : undefined
    });
  }

  /**
   * Record batch processing latency
   * Measures time to process a batch of accounts
   */
  recordBatchProcessing(
    operation: 'head_check' | 'event_batch' | 'price_trigger',
    latencyMs: number,
    accountCount?: number
  ): void {
    batchProcessingLatencyMs.observe({ operation }, latencyMs);
    
    this.recordMeasurement({
      operation: `batch_${operation}`,
      startTime: Date.now() - latencyMs,
      endTime: Date.now(),
      latencyMs,
      metadata: accountCount ? { accountCount } : undefined
    });
  }

  /**
   * Start tracking an operation
   * Returns an operation ID for later completion
   */
  startOperation(operationType: string): string {
    const operationId = `${operationType}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.activeOperations.set(operationId, Date.now());
    return operationId;
  }

  /**
   * Complete a tracked operation
   */
  completeOperation(
    operationId: string,
    metadata?: Record<string, string | number>
  ): number | null {
    const startTime = this.activeOperations.get(operationId);
    if (!startTime) {
      return null;
    }

    this.activeOperations.delete(operationId);
    
    const endTime = Date.now();
    const latencyMs = endTime - startTime;

    // Extract operation type from ID
    const operationType = operationId.split('_')[0];

    this.recordMeasurement({
      operation: operationType,
      startTime,
      endTime,
      latencyMs,
      metadata
    });

    return latencyMs;
  }

  /**
   * Update throughput metrics
   */
  updateThroughput(accountsProcessed: number, blocksProcessed: number = 1): void {
    this.throughputWindow.accountsProcessed += accountsProcessed;
    this.throughputWindow.blocksProcessed += blocksProcessed;

    // Reset window if needed
    const now = Date.now();
    const windowElapsed = now - this.throughputWindow.startTime;
    
    if (windowElapsed >= this.windowSizeMs) {
      // Calculate rate
      const accountsPerSecond = (this.throughputWindow.accountsProcessed / windowElapsed) * 1000;
      throughputAccountsPerSecond.set(accountsPerSecond);

      // Reset window
      this.throughputWindow = {
        startTime: now,
        accountsProcessed: 0,
        blocksProcessed: 0
      };
    }
  }

  /**
   * Record a latency measurement
   */
  private recordMeasurement(measurement: LatencyMeasurement): void {
    this.recentMeasurements.push(measurement);

    // Trim if too large
    if (this.recentMeasurements.length > this.maxRecentMeasurements) {
      this.recentMeasurements.shift();
    }
  }

  /**
   * Start periodic logging of metrics
   */
  private startPeriodicLogging(): void {
    this.logTimer = setInterval(() => {
      this.emitPeriodicLog();
    }, this.logIntervalMs);
  }

  /**
   * Emit periodic log with aggregated metrics
   */
  private emitPeriodicLog(): void {
    if (this.recentMeasurements.length === 0) {
      return;
    }

    // Aggregate by operation type
    const aggregates = new Map<string, {
      count: number;
      totalLatency: number;
      minLatency: number;
      maxLatency: number;
    }>();

    for (const measurement of this.recentMeasurements) {
      if (!aggregates.has(measurement.operation)) {
        aggregates.set(measurement.operation, {
          count: 0,
          totalLatency: 0,
          minLatency: Infinity,
          maxLatency: 0
        });
      }

      const agg = aggregates.get(measurement.operation)!;
      agg.count++;
      agg.totalLatency += measurement.latencyMs;
      agg.minLatency = Math.min(agg.minLatency, measurement.latencyMs);
      agg.maxLatency = Math.max(agg.maxLatency, measurement.latencyMs);
    }

    // Calculate throughput
    const windowElapsed = Date.now() - this.throughputWindow.startTime;
    const accountsPerSecond = (this.throughputWindow.accountsProcessed / windowElapsed) * 1000;

    // Emit log
    // eslint-disable-next-line no-console
    console.log('[perf-metrics] Performance summary:');
    
    for (const [operation, agg] of aggregates.entries()) {
      const avgLatency = agg.totalLatency / agg.count;
      // eslint-disable-next-line no-console
      console.log(
        `  ${operation}: count=${agg.count}, ` +
        `avg=${avgLatency.toFixed(2)}ms, ` +
        `min=${agg.minLatency.toFixed(2)}ms, ` +
        `max=${agg.maxLatency.toFixed(2)}ms`
      );
    }

    // eslint-disable-next-line no-console
    console.log(
      `  Throughput: ${accountsPerSecond.toFixed(2)} accounts/sec, ` +
      `${this.throughputWindow.blocksProcessed} blocks in window`
    );

    // Clear recent measurements
    this.recentMeasurements = [];
  }

  /**
   * Get current statistics
   */
  getStats(): {
    recentMeasurements: number;
    activeOperations: number;
    throughputAccountsPerSecond: number;
  } {
    const windowElapsed = Date.now() - this.throughputWindow.startTime;
    const accountsPerSecond = windowElapsed > 0 
      ? (this.throughputWindow.accountsProcessed / windowElapsed) * 1000
      : 0;

    return {
      recentMeasurements: this.recentMeasurements.length,
      activeOperations: this.activeOperations.size,
      throughputAccountsPerSecond: accountsPerSecond
    };
  }

  /**
   * Stop collector and cleanup
   */
  stop(): void {
    if (this.logTimer) {
      clearInterval(this.logTimer);
      this.logTimer = null;
    }

    // Emit final log
    this.emitPeriodicLog();

    // eslint-disable-next-line no-console
    console.log('[perf-metrics] Stopped');
  }
}
