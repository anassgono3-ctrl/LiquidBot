import { Counter, Gauge, Histogram } from 'prom-client';
import { metricsRegistry } from './registry.js';
import { createExecutionMetrics, type ExecutionMetrics } from './execution.js';

// Singleton execution metrics instance
let _executionMetrics: ExecutionMetrics | null = null;

/**
 * Initialize metrics exactly once
 * Safe to call multiple times - will return existing instance after first call
 */
export function initMetricsOnce(): ExecutionMetrics {
  if (_executionMetrics) return _executionMetrics;
  _executionMetrics = createExecutionMetrics(metricsRegistry);
  return _executionMetrics;
}

/**
 * Get execution metrics (must be initialized first)
 * @throws Error if metrics not initialized
 */
export function getExecutionMetrics(): ExecutionMetrics {
  if (!_executionMetrics) {
    throw new Error('Metrics not initialized — call initMetricsOnce() at startup');
  }
  return _executionMetrics;
}

// Re-export the central registry
export { metricsRegistry as registry };

export const subgraphRequestsTotal = new Counter({
  name: 'liquidbot_subgraph_requests_total',
  help: 'Total subgraph request attempts',
  labelNames: ['status'],
  registers: [metricsRegistry]
});

export const subgraphRequestDuration = new Histogram({
  name: 'liquidbot_subgraph_request_duration_seconds',
  help: 'Subgraph request duration (seconds)',
  labelNames: ['operation'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry]
});

export const subgraphConsecutiveFailures = new Gauge({
  name: 'liquidbot_subgraph_consecutive_failures',
  help: 'Current consecutive failure count',
  registers: [metricsRegistry]
});

export const subgraphLastSuccessTs = new Gauge({
  name: 'liquidbot_subgraph_last_success_timestamp',
  help: 'Unix timestamp of last successful subgraph request',
  registers: [metricsRegistry]
});

export const subgraphFallbackActivations = new Counter({
  name: 'liquidbot_subgraph_fallback_activated_total',
  help: 'Number of times fallback (mock mode) was activated automatically',
  registers: [metricsRegistry]
});

export const subgraphRateLimitDropped = new Counter({
  name: 'liquidbot_rate_limit_subgraph_dropped_total',
  help: 'Subgraph requests dropped by local rate limiter',
  registers: [metricsRegistry]
});

export const wsClients = new Gauge({
  name: 'liquidbot_ws_clients',
  help: 'Active WebSocket clients',
  registers: [metricsRegistry]
});

export const liquidationNewEventsTotal = new Counter({
  name: 'liquidbot_liquidation_new_events_total',
  help: 'Total number of new liquidation events detected',
  registers: [metricsRegistry]
});

export const liquidationSnapshotSize = new Gauge({
  name: 'liquidbot_liquidation_snapshot_size',
  help: 'Size of the most recent liquidation snapshot',
  registers: [metricsRegistry]
});

export const liquidationSeenTotal = new Gauge({
  name: 'liquidbot_liquidation_seen_total',
  help: 'Total number of unique liquidation IDs tracked',
  registers: [metricsRegistry]
});

export const opportunitiesGeneratedTotal = new Counter({
  name: 'liquidbot_opportunities_generated_total',
  help: 'Total number of liquidation opportunities generated',
  registers: [metricsRegistry]
});

export const opportunityProfitEstimate = new Histogram({
  name: 'liquidbot_opportunity_profit_estimate',
  help: 'Estimated profit in USD for liquidation opportunities',
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [metricsRegistry]
});

export const healthBreachEventsTotal = new Counter({
  name: 'liquidbot_health_breach_events_total',
  help: 'Total number of health factor breach events detected',
  registers: [metricsRegistry]
});

export const userHealthQueriesTotal = new Counter({
  name: 'liquidbot_user_health_queries_total',
  help: 'Total user health factor queries',
  labelNames: ['mode', 'result'],
  registers: [metricsRegistry]
});

export const userHealthCacheHitsTotal = new Counter({
  name: 'liquidbot_user_health_cache_hits_total',
  help: 'Total user health factor cache hits',
  registers: [metricsRegistry]
});

export const userHealthCacheMissesTotal = new Counter({
  name: 'liquidbot_user_health_cache_misses_total',
  help: 'Total user health factor cache misses',
  registers: [metricsRegistry]
});

export const atRiskScanUsersTotal = new Counter({
  name: 'liquidbot_at_risk_scan_users_total',
  help: 'Total number of users scanned for at-risk detection',
  registers: [metricsRegistry]
});

export const atRiskScanCriticalTotal = new Counter({
  name: 'liquidbot_at_risk_scan_critical_total',
  help: 'Total number of users detected below liquidation threshold',
  registers: [metricsRegistry]
});

export const atRiskScanWarnTotal = new Counter({
  name: 'liquidbot_at_risk_scan_warn_total',
  help: 'Total number of users detected between warn and liquidation thresholds',
  registers: [metricsRegistry]
});

// Real-time HF detection metrics
export const realtimeBlocksReceived = new Counter({
  name: 'liquidbot_realtime_blocks_received_total',
  help: 'Total number of newHeads blocks received',
  registers: [metricsRegistry]
});

export const realtimeAaveLogsReceived = new Counter({
  name: 'liquidbot_realtime_aave_logs_received_total',
  help: 'Total number of Aave Pool log events received',
  registers: [metricsRegistry]
});

export const realtimePriceUpdatesReceived = new Counter({
  name: 'liquidbot_realtime_price_updates_received_total',
  help: 'Total number of Chainlink price update events received',
  registers: [metricsRegistry]
});

export const realtimeHealthChecksPerformed = new Counter({
  name: 'liquidbot_realtime_health_checks_performed_total',
  help: 'Total number of health factor checks performed via Multicall3',
  registers: [metricsRegistry]
});

export const realtimeTriggersProcessed = new Counter({
  name: 'liquidbot_realtime_triggers_processed_total',
  help: 'Total number of liquidatable events emitted',
  labelNames: ['trigger_type'],
  registers: [metricsRegistry]
});

export const realtimeReconnects = new Counter({
  name: 'liquidbot_realtime_reconnects_total',
  help: 'Total number of WebSocket reconnection attempts',
  registers: [metricsRegistry]
});

export const realtimeCandidateCount = new Gauge({
  name: 'liquidbot_realtime_candidate_count',
  help: 'Current number of candidates in memory',
  registers: [metricsRegistry]
});

export const realtimeMinHealthFactor = new Gauge({
  name: 'liquidbot_realtime_min_health_factor',
  help: 'Lowest health factor observed across all candidates',
  registers: [metricsRegistry]
});

// Real-time execution metrics
export const realtimeLiquidationBonusBps = new Gauge({
  name: 'liquidbot_realtime_liquidation_bonus_bps',
  help: 'Last used liquidation bonus in basis points for real-time execution',
  registers: [metricsRegistry]
});

export const realtimeDebtToCover = new Histogram({
  name: 'liquidbot_realtime_debt_to_cover',
  help: 'Distribution of debt to cover amounts (USD equivalent)',
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [metricsRegistry]
});

export const realtimeCloseFactorMode = new Gauge({
  name: 'liquidbot_realtime_close_factor_mode',
  help: 'Current close factor mode (0=fixed50, 1=full)',
  registers: [metricsRegistry]
});

// Edge-triggered notification metrics
export const actionableOpportunitiesTotal = new Counter({
  name: 'liquidbot_actionable_opportunities_total',
  help: 'Total number of actionable opportunities notified',
  registers: [metricsRegistry]
});

export const skippedUnresolvedPlanTotal = new Counter({
  name: 'liquidbot_skipped_unresolved_plan_total',
  help: 'Total number of opportunities skipped due to unresolved liquidation plan',
  registers: [metricsRegistry]
});

export const liquidatableEdgeTriggersTotal = new Counter({
  name: 'liquidbot_liquidatable_edge_triggers_total',
  help: 'Total number of liquidatable edge-trigger events (state transitions)',
  labelNames: ['reason'],
  registers: [metricsRegistry]
});

// Price-triggered emergency scan metrics
export const realtimePriceEmergencyScansTotal = new Counter({
  name: 'liquidbot_realtime_price_emergency_scans_total',
  help: 'Total number of emergency scans triggered by price drops',
  labelNames: ['asset'],
  registers: [metricsRegistry]
});

export const emergencyScanLatency = new Histogram({
  name: 'liquidbot_emergency_scan_latency_ms',
  help: 'Latency of emergency scans in milliseconds',
  buckets: [50, 100, 250, 500, 1000, 2000, 5000],
  registers: [metricsRegistry]
});

// New detection speed metrics
export const realtimePriceTriggersTotal = new Counter({
  name: 'liquidbot_realtime_price_triggers_total',
  help: 'Total number of price trigger events per asset',
  labelNames: ['asset'],
  registers: [metricsRegistry]
});

export const reserveRechecksTotal = new Counter({
  name: 'liquidbot_reserve_rechecks_total',
  help: 'Total number of reserve-targeted rechecks',
  labelNames: ['asset', 'source'],
  registers: [metricsRegistry]
});

export const pendingVerifyErrorsTotal = new Counter({
  name: 'liquidbot_pending_verify_errors_total',
  help: 'Total number of pending-state verification errors',
  registers: [metricsRegistry]
});

// Timeout and recovery metrics
export const chunkTimeoutsTotal = new Counter({
  name: 'liquidbot_chunk_timeouts_total',
  help: 'Total number of chunk timeouts during multicall operations',
  registers: [metricsRegistry]
});

export const runAbortsTotal = new Counter({
  name: 'liquidbot_run_aborts_total',
  help: 'Total number of runs aborted due to stall detection',
  registers: [metricsRegistry]
});

export const wsReconnectsTotal = new Counter({
  name: 'liquidbot_ws_reconnects_total',
  help: 'Total number of WebSocket reconnections due to heartbeat failures',
  registers: [metricsRegistry]
});

export const chunkLatency = new Histogram({
  name: 'liquidbot_chunk_latency_seconds',
  help: 'Latency of multicall chunk execution in seconds',
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry]
});

// Price oracle metrics
export const priceOracleChainlinkRequestsTotal = new Counter({
  name: 'liquidbot_price_oracle_chainlink_requests_total',
  help: 'Total Chainlink price oracle requests',
  labelNames: ['status', 'symbol'],
  registers: [metricsRegistry]
});

export const priceOracleChainlinkStaleTotal = new Counter({
  name: 'liquidbot_price_oracle_chainlink_stale_total',
  help: 'Total number of stale Chainlink price data detected',
  labelNames: ['symbol'],
  registers: [metricsRegistry]
});

export const priceOracleStubFallbackTotal = new Counter({
  name: 'liquidbot_price_oracle_stub_fallback_total',
  help: 'Total number of times price oracle fell back to stub prices',
  labelNames: ['symbol', 'reason'],
  registers: [metricsRegistry]
});

export const priceRatioComposedTotal = new Counter({
  name: 'liquidbot_price_ratio_composed_total',
  help: 'Total number of prices composed from ratio feeds',
  labelNames: ['symbol', 'source'],
  registers: [metricsRegistry]
});

export const priceFallbackOracleTotal = new Counter({
  name: 'liquidbot_price_fallback_oracle_total',
  help: 'Total number of times price fell back to Aave oracle',
  labelNames: ['symbol'],
  registers: [metricsRegistry]
});

export const priceMissingTotal = new Counter({
  name: 'liquidbot_price_missing_total',
  help: 'Total number of times price was missing during critical operations',
  labelNames: ['symbol', 'stage'],
  registers: [metricsRegistry]
});

// Price initialization and deferred valuation metrics
export const pendingPriceQueueLength = new Gauge({
  name: 'liquidbot_pending_price_queue_length',
  help: 'Current number of opportunities queued for price revaluation',
  registers: [metricsRegistry]
});

export const revalueSuccessTotal = new Counter({
  name: 'liquidbot_revalue_success_total',
  help: 'Total number of successful price revaluations after feed initialization',
  labelNames: ['symbol'],
  registers: [metricsRegistry]
});

export const revalueFailTotal = new Counter({
  name: 'liquidbot_revalue_fail_total',
  help: 'Total number of failed price revaluations (still zero after init)',
  labelNames: ['symbol'],
  registers: [metricsRegistry]
});

// Low HF Tracker metrics
export const lowHfSnapshotTotal = new Counter({
  name: 'liquidbot_lowhf_snapshot_total',
  help: 'Total number of low HF snapshots captured',
  labelNames: ['mode'],
  registers: [metricsRegistry]
});

export const lowHfExtendedSnapshotTotal = new Counter({
  name: 'liquidbot_lowhf_extended_snapshot_total',
  help: 'Total number of low HF extended snapshots (with reserves) captured',
  registers: [metricsRegistry]
});

export const lowHfMinHealthFactor = new Histogram({
  name: 'liquidbot_lowhf_min_hf',
  help: 'Distribution of minimum health factors tracked',
  buckets: [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.5],
  registers: [metricsRegistry]
});

export const lowHfMismatchTotal = new Counter({
  name: 'liquidbot_lowhf_mismatch_total',
  help: 'Total number of HF verification mismatches detected',
  registers: [metricsRegistry]
});

// DirtySet metrics
export const dirtySetSize = new Gauge({
  name: 'liquidbot_dirty_set_size',
  help: 'Current size of DirtySet',
  registers: [metricsRegistry]
});

export const dirtyMarkedTotal = new Counter({
  name: 'liquidbot_dirty_marked_total',
  help: 'Total number of users marked dirty',
  labelNames: ['reason'],
  registers: [metricsRegistry]
});

export const dirtyConsumedTotal = new Counter({
  name: 'liquidbot_dirty_consumed_total',
  help: 'Total number of dirty users processed and removed',
  labelNames: ['source'],
  registers: [metricsRegistry]
});

export const dirtyExpiredTotal = new Counter({
  name: 'liquidbot_dirty_expired_total',
  help: 'Total number of dirty entries expired before being consumed',
  registers: [metricsRegistry]
});

// Hotlist metrics
export const hotlistSize = new Gauge({
  name: 'liquidbot_hotlist_size',
  help: 'Current size of hotlist',
  registers: [metricsRegistry]
});

export const hotlistPromotedTotal = new Counter({
  name: 'liquidbot_hotlist_promoted_total',
  help: 'Total number of users promoted to hotlist',
  labelNames: ['reason'],
  registers: [metricsRegistry]
});

export const hotlistRevisitTotal = new Counter({
  name: 'liquidbot_hotlist_revisit_total',
  help: 'Total number of hotlist revisit cycles',
  labelNames: ['outcome'],
  registers: [metricsRegistry]
});

// Candidate pruning metrics
export const candidatesPrunedZeroDebt = new Counter({
  name: 'liquidbot_candidates_pruned_zero_debt_total',
  help: 'Total number of candidates pruned due to zero debt',
  registers: [metricsRegistry]
});

export const candidatesPrunedTinyDebt = new Counter({
  name: 'liquidbot_candidates_pruned_tiny_debt_total',
  help: 'Total number of candidates pruned due to tiny debt',
  registers: [metricsRegistry]
});

export const candidatesTotal = new Counter({
  name: 'liquidbot_candidates_total',
  help: 'Total number of candidates evaluated',
  registers: [metricsRegistry]
});

// Event batch metrics
export const eventBatchesSkipped = new Counter({
  name: 'liquidbot_event_batches_skipped_total',
  help: 'Total number of event batches skipped due to concurrency limit',
  registers: [metricsRegistry]
});

export const eventBatchesExecuted = new Counter({
  name: 'liquidbot_event_batches_executed_total',
  help: 'Total number of event batches executed',
  registers: [metricsRegistry]
});

export const eventConcurrencyLevel = new Gauge({
  name: 'liquidbot_event_concurrency_level',
  help: 'Current event concurrency level (MAX_PARALLEL_EVENT_BATCHES)',
  registers: [metricsRegistry]
});

export const eventConcurrencyLevelHistogram = new Histogram({
  name: 'liquidbot_event_concurrency_level_histogram',
  help: 'Distribution of event concurrency levels over time',
  buckets: [1, 2, 3, 4, 5, 6, 7, 8],
  registers: [metricsRegistry]
});

// Liquidation audit metrics
export const liquidationAuditTotal = new Counter({
  name: 'liquidbot_liquidation_audit_total',
  help: 'Total number of liquidations audited',
  registers: [metricsRegistry]
});

export const liquidationAuditReasonNotInWatchSet = new Counter({
  name: 'liquidbot_liquidation_audit_reason_not_in_watch_set',
  help: 'Count of liquidations with reason: not_in_watch_set',
  registers: [metricsRegistry]
});

export const liquidationAuditReasonRaced = new Counter({
  name: 'liquidbot_liquidation_audit_reason_raced',
  help: 'Count of liquidations with reason: raced',
  registers: [metricsRegistry]
});

export const liquidationAuditErrors = new Counter({
  name: 'liquidbot_liquidation_audit_errors',
  help: 'Count of errors during liquidation audit',
  registers: [metricsRegistry]
});

// Liquidation miss classifier metrics
export const liquidationMissTotal = new Counter({
  name: 'liquidbot_liquidation_miss_total',
  help: 'Total number of missed liquidations classified',
  labelNames: ['reason'],
  registers: [metricsRegistry]
});

export const liquidationLatencyBlocks = new Histogram({
  name: 'liquidbot_liquidation_latency_blocks',
  help: 'Blocks between first detection and liquidation event',
  buckets: [0, 1, 2, 3, 5, 10, 20, 50, 100],
  registers: [metricsRegistry]
});

export const liquidationProfitGapUsd = new Histogram({
  name: 'liquidbot_liquidation_profit_gap_usd',
  help: 'Estimated profit that was missed (USD)',
  buckets: [0, 5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [metricsRegistry]
});

export const liquidationClassifierErrorsTotal = new Counter({
  name: 'liquidbot_liquidation_classifier_errors_total',
  help: 'Total number of errors during miss classification',
  registers: [metricsRegistry]
});

export const liquidationHfTransienceTotal = new Counter({
  name: 'liquidbot_liquidation_hf_transience_total',
  help: 'Total number of transient HF violations detected',
  registers: [metricsRegistry]
});

// Execution Path Acceleration metrics
export const preSimCacheHit = new Counter({
  name: 'liquidbot_pre_sim_cache_hit_total',
  help: 'Total number of pre-simulation cache hits',
  registers: [metricsRegistry]
});

export const preSimCacheMiss = new Counter({
  name: 'liquidbot_pre_sim_cache_miss_total',
  help: 'Total number of pre-simulation cache misses',
  registers: [metricsRegistry]
});

export const preSimLatencyMs = new Histogram({
  name: 'liquidbot_pre_sim_latency_ms',
  help: 'Pre-simulation computation latency in milliseconds',
  buckets: [10, 25, 50, 100, 200, 500, 1000],
  registers: [metricsRegistry]
});

export const pricePerBlockCoalescedTotal = new Counter({
  name: 'liquidbot_price_per_block_coalesced_total',
  help: 'Total number of times per-block price coalescing was used',
  labelNames: ['symbol'],
  registers: [metricsRegistry]
});

export const hedgeFiredTotal = new Counter({
  name: 'liquidbot_hedge_fired_total',
  help: 'Total number of times read hedge was fired',
  labelNames: ['operation'],
  registers: [metricsRegistry]
});

export const hedgeWinnerSecondary = new Counter({
  name: 'liquidbot_hedge_winner_secondary_total',
  help: 'Total number of times secondary RPC won the hedge race',
  labelNames: ['operation'],
  registers: [metricsRegistry]
});

// ==== HIGH-IMPACT SPEED FEATURES METRICS ====

// Optimistic Execution Metrics (Feature #1)
export const optimisticExecTotal = new Counter({
  name: 'liquidbot_optimistic_exec_total',
  help: 'Total optimistic execution attempts',
  labelNames: ['result'], // result: sent|reverted|skipped
  registers: [metricsRegistry]
});

export const optimisticLatencyMs = new Histogram({
  name: 'liquidbot_optimistic_latency_ms',
  help: 'Optimistic execution latency in milliseconds',
  buckets: [10, 25, 50, 75, 100, 150, 200, 300, 500],
  registers: [metricsRegistry]
});

export const optimisticRevertBudgetRemaining = new Gauge({
  name: 'liquidbot_optimistic_revert_budget_remaining',
  help: 'Remaining optimistic execution revert budget for today',
  registers: [metricsRegistry]
});

// Multi-RPC Write Racing Metrics (Feature #2)
export const writeRpcRttMs = new Gauge({
  name: 'liquidbot_write_rpc_rtt_ms',
  help: 'Round-trip time for write RPC endpoints in milliseconds',
  labelNames: ['rpc'],
  registers: [metricsRegistry]
});

export const writeRpcSuccessTotal = new Counter({
  name: 'liquidbot_write_rpc_success_total',
  help: 'Total successful write RPC calls',
  labelNames: ['rpc'],
  registers: [metricsRegistry]
});

export const writeRpcErrorTotal = new Counter({
  name: 'liquidbot_write_rpc_error_total',
  help: 'Total failed write RPC calls',
  labelNames: ['rpc'],
  registers: [metricsRegistry]
});

// Multiple Executor Keys Metrics (Feature #3)
export const executorKeyUsageTotal = new Counter({
  name: 'liquidbot_executor_key_usage_total',
  help: 'Total executions per executor key',
  labelNames: ['keyIndex'],
  registers: [metricsRegistry]
});

// Gas Burst/RBF Metrics (Feature #4)
export const gasBumpTotal = new Counter({
  name: 'liquidbot_gas_bump_total',
  help: 'Total gas bump attempts',
  labelNames: ['stage'], // stage: first|second
  registers: [metricsRegistry]
});

export const gasBumpSkippedTotal = new Counter({
  name: 'liquidbot_gas_bump_skipped_total',
  help: 'Total gas bumps skipped',
  labelNames: ['reason'], // reason: already_mined|max_bumps|not_enabled
  registers: [metricsRegistry]
});

// Calldata Template Metrics (Feature #5)
export const calldataTemplateHitsTotal = new Counter({
  name: 'liquidbot_calldata_template_hits_total',
  help: 'Total calldata template cache hits',
  registers: [metricsRegistry]
});

export const calldataTemplateMissesTotal = new Counter({
  name: 'liquidbot_calldata_template_misses_total',
  help: 'Total calldata template cache misses',
  registers: [metricsRegistry]
});

// Second-Order Liquidation Chaining Metrics (Feature #6)
export const secondOrderChainTotal = new Counter({
  name: 'liquidbot_second_order_chain_total',
  help: 'Total second-order chaining events',
  labelNames: ['result'], // result: queued|executed|skipped
  registers: [metricsRegistry]
});

// End-to-End Latency Instrumentation Metrics (Feature #7)
export const execE2eLatencyMs = new Histogram({
  name: 'liquidbot_exec_e2e_latency_ms',
  help: 'End-to-end execution latency in milliseconds',
  buckets: [25, 50, 75, 100, 150, 200, 300, 500, 1000, 2000],
  registers: [metricsRegistry]
});

export const execLatencyBlockToDetection = new Gauge({
  name: 'liquidbot_exec_latency_block_to_detection_ms',
  help: 'Latency from block received to candidate detected (ms)',
  registers: [metricsRegistry]
});

export const execLatencyDetectionToPlan = new Gauge({
  name: 'liquidbot_exec_latency_detection_to_plan_ms',
  help: 'Latency from candidate detected to plan ready (ms)',
  registers: [metricsRegistry]
});

export const execLatencyPlanToSign = new Gauge({
  name: 'liquidbot_exec_latency_plan_to_sign_ms',
  help: 'Latency from plan ready to tx signed (ms)',
  registers: [metricsRegistry]
});

export const execLatencySignToBroadcast = new Gauge({
  name: 'liquidbot_exec_latency_sign_to_broadcast_ms',
  help: 'Latency from tx signed to broadcast (ms)',
  registers: [metricsRegistry]
});

export const execLatencyBroadcastToCheck = new Gauge({
  name: 'liquidbot_exec_latency_broadcast_to_check_ms',
  help: 'Latency from broadcast to first inclusion check (ms)',
  registers: [metricsRegistry]
});

// Emergency Asset Scan Metrics (Feature #8)
export const emergencyAssetScanTotal = new Counter({
  name: 'liquidbot_emergency_asset_scan_total',
  help: 'Total emergency asset scans performed',
  labelNames: ['asset', 'result'], // result: partial|full
  registers: [metricsRegistry]
});

// Proxy objects for execution metrics to maintain backward compatibility
// These provide access to the initialized metrics through lazy getters
function createMetricProxy<T extends { inc?: (...args: any[]) => any; observe?: (...args: any[]) => any; set?: (...args: any[]) => any; labels?: (...args: any[]) => any }>(name: keyof ExecutionMetrics): T {
  return new Proxy({} as T, {
    get(_target, prop: string) {
      const metrics = getExecutionMetrics();
      const metric = metrics[name] as any;
      if (typeof metric[prop] === 'function') {
        return metric[prop].bind(metric);
      }
      return metric[prop];
    }
  });
}

export const intentBuildLatencyMs = createMetricProxy<any>('intentBuildLatencyMs');
export const intentCacheHits = createMetricProxy<any>('intentCacheHits');
export const intentCacheMisses = createMetricProxy<any>('intentCacheMisses');
export const intentRevalidations = createMetricProxy<any>('intentRevalidations');
export const intentAgeMs = createMetricProxy<any>('intentAgeMs');
export const pricePrewarmAgeMs = createMetricProxy<any>('pricePrewarmAgeMs');
export const priceHotCacheSize = createMetricProxy<any>('priceHotCacheSize');
export const priceHotCacheStalePrices = createMetricProxy<any>('priceHotCacheStalePrices');
export const priceHotCacheRefreshLatency = createMetricProxy<any>('priceHotCacheRefreshLatency');
export const executionLatencyMs = createMetricProxy<any>('executionLatencyMs');
export const txSubmitAttempts = createMetricProxy<any>('txSubmitAttempts');
export const txSubmitMode = createMetricProxy<any>('txSubmitMode');
export const relayAcceptMs = createMetricProxy<any>('relayAcceptMs');
export const raceWinner = createMetricProxy<any>('raceWinner');
export const blockBoundaryDispatches = createMetricProxy<any>('blockBoundaryDispatches');
export const blockBoundaryLatency = createMetricProxy<any>('blockBoundaryLatency');
export const hotQueueSize = createMetricProxy<any>('hotQueueSize');
export const warmQueueSize = createMetricProxy<any>('warmQueueSize');
export const hotQueueMinHF = createMetricProxy<any>('hotQueueMinHF');
export const hotQueueAvgDebtUsd = createMetricProxy<any>('hotQueueAvgDebtUsd');
export const queueEntryReason = createMetricProxy<any>('queueEntryReason');
export const missedLiquidationReason = createMetricProxy<any>('missedLiquidationReason');
export const rpcPoolHealthy = createMetricProxy<any>('rpcPoolHealthy');
export const rpcPoolTotal = createMetricProxy<any>('rpcPoolTotal');
