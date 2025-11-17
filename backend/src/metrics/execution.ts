/**
 * Execution Path Metrics
 * 
 * Metrics for the ultra-low-latency execution path:
 * - Intent building and caching
 * - Price hot cache performance
 * - Transaction submission modes and latency
 * - Block boundary dispatch
 * - Queue statistics
 */

import { Counter, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Interface for execution metrics
 */
export interface ExecutionMetrics {
  intentBuildLatencyMs: Histogram<string>;
  intentCacheHits: Counter<string>;
  intentCacheMisses: Counter<string>;
  intentRevalidations: Counter<string>;
  intentAgeMs: Histogram<string>;
  pricePrewarmAgeMs: Histogram<string>;
  priceHotCacheSize: Gauge<string>;
  priceHotCacheStalePrices: Gauge<string>;
  priceHotCacheRefreshLatency: Histogram<string>;
  executionLatencyMs: Histogram<string>;
  txSubmitAttempts: Counter<string>;
  txSubmitMode: Counter<string>;
  relayAcceptMs: Histogram<string>;
  raceWinner: Counter<string>;
  blockBoundaryDispatches: Counter<string>;
  blockBoundaryLatency: Histogram<string>;
  hotQueueSize: Gauge<string>;
  warmQueueSize: Gauge<string>;
  hotQueueMinHF: Gauge<string>;
  hotQueueAvgDebtUsd: Gauge<string>;
  queueEntryReason: Counter<string>;
  missedLiquidationReason: Counter<string>;
  rpcPoolHealthy: Gauge<string>;
  rpcPoolTotal: Gauge<string>;
}

/**
 * Factory function to create execution metrics
 * @param registry - The prom-client Registry to register metrics with
 * @returns ExecutionMetrics object containing all execution-related metrics
 */
export function createExecutionMetrics(registry: Registry): ExecutionMetrics {
  // Intent Builder Metrics
  const intentBuildLatencyMs = new Histogram({
    name: 'liquidbot_intent_build_latency_ms',
    help: 'Latency to build liquidation intent (milliseconds)',
    buckets: [1, 5, 10, 25, 50, 100, 250],
    registers: [registry]
  });

  const intentCacheHits = new Counter({
    name: 'liquidbot_intent_cache_hits_total',
    help: 'Intent cache hits',
    registers: [registry]
  });

  const intentCacheMisses = new Counter({
    name: 'liquidbot_intent_cache_misses_total',
    help: 'Intent cache misses',
    registers: [registry]
  });

  const intentRevalidations = new Counter({
    name: 'liquidbot_intent_revalidations_total',
    help: 'Intent revalidations due to price divergence',
    labelNames: ['result'],
    registers: [registry]
  });

  const intentAgeMs = new Histogram({
    name: 'liquidbot_intent_age_ms',
    help: 'Age of intent when used (milliseconds)',
    buckets: [100, 250, 500, 1000, 2000, 5000],
    registers: [registry]
  });

  // Price Hot Cache Metrics
  const pricePrewarmAgeMs = new Histogram({
    name: 'liquidbot_price_prewarm_age_ms',
    help: 'Age of prewarmed price when used (milliseconds)',
    buckets: [50, 100, 200, 400, 800, 1600],
    registers: [registry]
  });

  const priceHotCacheSize = new Gauge({
    name: 'liquidbot_price_hot_cache_size',
    help: 'Number of assets in hot price cache',
    registers: [registry]
  });

  const priceHotCacheStalePrices = new Gauge({
    name: 'liquidbot_price_hot_cache_stale_prices',
    help: 'Number of stale prices in hot cache',
    registers: [registry]
  });

  const priceHotCacheRefreshLatency = new Histogram({
    name: 'liquidbot_price_hot_cache_refresh_latency_ms',
    help: 'Latency to refresh hot price cache (milliseconds)',
    buckets: [10, 25, 50, 100, 200, 500],
    registers: [registry]
  });

  // Transaction Submission Metrics
  const executionLatencyMs = new Histogram({
    name: 'liquidbot_execution_latency_ms',
    help: 'End-to-end execution latency from intent to tx submission (milliseconds)',
    buckets: [10, 25, 50, 100, 150, 250, 500, 1000],
    registers: [registry]
  });

  const txSubmitAttempts = new Counter({
    name: 'liquidbot_tx_submit_attempts_total',
    help: 'Transaction submission attempts',
    labelNames: ['mode', 'result'],
    registers: [registry]
  });

  const txSubmitMode = new Counter({
    name: 'liquidbot_tx_submit_mode_total',
    help: 'Transactions by submit mode',
    labelNames: ['mode'],
    registers: [registry]
  });

  const relayAcceptMs = new Histogram({
    name: 'liquidbot_relay_accept_ms',
    help: 'Time for relay to accept transaction (milliseconds)',
    labelNames: ['relay_type'],
    buckets: [10, 25, 50, 100, 200, 500],
    registers: [registry]
  });

  const raceWinner = new Counter({
    name: 'liquidbot_race_winner_total',
    help: 'Race mode winner by endpoint',
    labelNames: ['endpoint_type'],
    registers: [registry]
  });

  // Block Boundary Controller Metrics
  const blockBoundaryDispatches = new Counter({
    name: 'liquidbot_block_boundary_dispatches_total',
    help: 'Block boundary dispatch attempts',
    labelNames: ['result'],
    registers: [registry]
  });

  const blockBoundaryLatency = new Histogram({
    name: 'liquidbot_block_boundary_latency_ms',
    help: 'Latency from block event to tx submission (milliseconds)',
    buckets: [10, 25, 50, 100, 150, 250, 500],
    registers: [registry]
  });

  // Priority Queue Metrics
  const hotQueueSize = new Gauge({
    name: 'liquidbot_hot_queue_size',
    help: 'Number of users in hot critical queue',
    registers: [registry]
  });

  const warmQueueSize = new Gauge({
    name: 'liquidbot_warm_queue_size',
    help: 'Number of users in warm projected queue',
    registers: [registry]
  });

  const hotQueueMinHF = new Gauge({
    name: 'liquidbot_hot_queue_min_hf',
    help: 'Minimum health factor in hot queue',
    registers: [registry]
  });

  const hotQueueAvgDebtUsd = new Gauge({
    name: 'liquidbot_hot_queue_avg_debt_usd',
    help: 'Average debt USD in hot queue',
    registers: [registry]
  });

  const queueEntryReason = new Counter({
    name: 'liquidbot_queue_entry_reason_total',
    help: 'Queue entry reasons',
    labelNames: ['queue', 'reason'],
    registers: [registry]
  });

  // Missed Liquidation Reasons (Enhanced)
  const missedLiquidationReason = new Counter({
    name: 'liquidbot_missed_liquidation_reason_total',
    help: 'Missed liquidation classification reasons',
    labelNames: ['reason'],
    registers: [registry]
  });

  // Execution RPC Pool Metrics
  const rpcPoolHealthy = new Gauge({
    name: 'liquidbot_rpc_pool_healthy_endpoints',
    help: 'Number of healthy endpoints by type',
    labelNames: ['pool_type'],
    registers: [registry]
  });

  const rpcPoolTotal = new Gauge({
    name: 'liquidbot_rpc_pool_total_endpoints',
    help: 'Total number of endpoints by type',
    labelNames: ['pool_type'],
    registers: [registry]
  });

  return {
    intentBuildLatencyMs,
    intentCacheHits,
    intentCacheMisses,
    intentRevalidations,
    intentAgeMs,
    pricePrewarmAgeMs,
    priceHotCacheSize,
    priceHotCacheStalePrices,
    priceHotCacheRefreshLatency,
    executionLatencyMs,
    txSubmitAttempts,
    txSubmitMode,
    relayAcceptMs,
    raceWinner,
    blockBoundaryDispatches,
    blockBoundaryLatency,
    hotQueueSize,
    warmQueueSize,
    hotQueueMinHF,
    hotQueueAvgDebtUsd,
    queueEntryReason,
    missedLiquidationReason,
    rpcPoolHealthy,
    rpcPoolTotal
  };
}
