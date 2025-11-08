import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export const registry = new Registry();

export const subgraphRequestsTotal = new Counter({
  name: 'liquidbot_subgraph_requests_total',
  help: 'Total subgraph request attempts',
  labelNames: ['status'],
  registers: [registry]
});

export const subgraphRequestDuration = new Histogram({
  name: 'liquidbot_subgraph_request_duration_seconds',
  help: 'Subgraph request duration (seconds)',
  labelNames: ['operation'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry]
});

export const subgraphConsecutiveFailures = new Gauge({
  name: 'liquidbot_subgraph_consecutive_failures',
  help: 'Current consecutive failure count',
  registers: [registry]
});

export const subgraphLastSuccessTs = new Gauge({
  name: 'liquidbot_subgraph_last_success_timestamp',
  help: 'Unix timestamp of last successful subgraph request',
  registers: [registry]
});

export const subgraphFallbackActivations = new Counter({
  name: 'liquidbot_subgraph_fallback_activated_total',
  help: 'Number of times fallback (mock mode) was activated automatically',
  registers: [registry]
});

export const subgraphRateLimitDropped = new Counter({
  name: 'liquidbot_rate_limit_subgraph_dropped_total',
  help: 'Subgraph requests dropped by local rate limiter',
  registers: [registry]
});

export const wsClients = new Gauge({
  name: 'liquidbot_ws_clients',
  help: 'Active WebSocket clients',
  registers: [registry]
});

export const liquidationNewEventsTotal = new Counter({
  name: 'liquidbot_liquidation_new_events_total',
  help: 'Total number of new liquidation events detected',
  registers: [registry]
});

export const liquidationSnapshotSize = new Gauge({
  name: 'liquidbot_liquidation_snapshot_size',
  help: 'Size of the most recent liquidation snapshot',
  registers: [registry]
});

export const liquidationSeenTotal = new Gauge({
  name: 'liquidbot_liquidation_seen_total',
  help: 'Total number of unique liquidation IDs tracked',
  registers: [registry]
});

export const opportunitiesGeneratedTotal = new Counter({
  name: 'liquidbot_opportunities_generated_total',
  help: 'Total number of liquidation opportunities generated',
  registers: [registry]
});

export const opportunityProfitEstimate = new Histogram({
  name: 'liquidbot_opportunity_profit_estimate',
  help: 'Estimated profit in USD for liquidation opportunities',
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [registry]
});

export const healthBreachEventsTotal = new Counter({
  name: 'liquidbot_health_breach_events_total',
  help: 'Total number of health factor breach events detected',
  registers: [registry]
});

export const userHealthQueriesTotal = new Counter({
  name: 'liquidbot_user_health_queries_total',
  help: 'Total user health factor queries',
  labelNames: ['mode', 'result'],
  registers: [registry]
});

export const userHealthCacheHitsTotal = new Counter({
  name: 'liquidbot_user_health_cache_hits_total',
  help: 'Total user health factor cache hits',
  registers: [registry]
});

export const userHealthCacheMissesTotal = new Counter({
  name: 'liquidbot_user_health_cache_misses_total',
  help: 'Total user health factor cache misses',
  registers: [registry]
});

export const atRiskScanUsersTotal = new Counter({
  name: 'liquidbot_at_risk_scan_users_total',
  help: 'Total number of users scanned for at-risk detection',
  registers: [registry]
});

export const atRiskScanCriticalTotal = new Counter({
  name: 'liquidbot_at_risk_scan_critical_total',
  help: 'Total number of users detected below liquidation threshold',
  registers: [registry]
});

export const atRiskScanWarnTotal = new Counter({
  name: 'liquidbot_at_risk_scan_warn_total',
  help: 'Total number of users detected between warn and liquidation thresholds',
  registers: [registry]
});

// Real-time HF detection metrics
export const realtimeBlocksReceived = new Counter({
  name: 'liquidbot_realtime_blocks_received_total',
  help: 'Total number of newHeads blocks received',
  registers: [registry]
});

export const realtimeAaveLogsReceived = new Counter({
  name: 'liquidbot_realtime_aave_logs_received_total',
  help: 'Total number of Aave Pool log events received',
  registers: [registry]
});

export const realtimePriceUpdatesReceived = new Counter({
  name: 'liquidbot_realtime_price_updates_received_total',
  help: 'Total number of Chainlink price update events received',
  registers: [registry]
});

export const realtimeHealthChecksPerformed = new Counter({
  name: 'liquidbot_realtime_health_checks_performed_total',
  help: 'Total number of health factor checks performed via Multicall3',
  registers: [registry]
});

export const realtimeTriggersProcessed = new Counter({
  name: 'liquidbot_realtime_triggers_processed_total',
  help: 'Total number of liquidatable events emitted',
  labelNames: ['trigger_type'],
  registers: [registry]
});

export const realtimeReconnects = new Counter({
  name: 'liquidbot_realtime_reconnects_total',
  help: 'Total number of WebSocket reconnection attempts',
  registers: [registry]
});

export const realtimeCandidateCount = new Gauge({
  name: 'liquidbot_realtime_candidate_count',
  help: 'Current number of candidates in memory',
  registers: [registry]
});

export const realtimeMinHealthFactor = new Gauge({
  name: 'liquidbot_realtime_min_health_factor',
  help: 'Lowest health factor observed across all candidates',
  registers: [registry]
});

// Real-time execution metrics
export const realtimeLiquidationBonusBps = new Gauge({
  name: 'liquidbot_realtime_liquidation_bonus_bps',
  help: 'Last used liquidation bonus in basis points for real-time execution',
  registers: [registry]
});

export const realtimeDebtToCover = new Histogram({
  name: 'liquidbot_realtime_debt_to_cover',
  help: 'Distribution of debt to cover amounts (USD equivalent)',
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [registry]
});

export const realtimeCloseFactorMode = new Gauge({
  name: 'liquidbot_realtime_close_factor_mode',
  help: 'Current close factor mode (0=fixed50, 1=full)',
  registers: [registry]
});

// Edge-triggered notification metrics
export const actionableOpportunitiesTotal = new Counter({
  name: 'liquidbot_actionable_opportunities_total',
  help: 'Total number of actionable opportunities notified',
  registers: [registry]
});

export const skippedUnresolvedPlanTotal = new Counter({
  name: 'liquidbot_skipped_unresolved_plan_total',
  help: 'Total number of opportunities skipped due to unresolved liquidation plan',
  registers: [registry]
});

export const liquidatableEdgeTriggersTotal = new Counter({
  name: 'liquidbot_liquidatable_edge_triggers_total',
  help: 'Total number of liquidatable edge-trigger events (state transitions)',
  labelNames: ['reason'],
  registers: [registry]
});

// Price-triggered emergency scan metrics
export const realtimePriceEmergencyScansTotal = new Counter({
  name: 'liquidbot_realtime_price_emergency_scans_total',
  help: 'Total number of emergency scans triggered by price drops',
  labelNames: ['asset'],
  registers: [registry]
});

export const emergencyScanLatency = new Histogram({
  name: 'liquidbot_emergency_scan_latency_ms',
  help: 'Latency of emergency scans in milliseconds',
  buckets: [50, 100, 250, 500, 1000, 2000, 5000],
  registers: [registry]
});

// Timeout and recovery metrics
export const chunkTimeoutsTotal = new Counter({
  name: 'liquidbot_chunk_timeouts_total',
  help: 'Total number of chunk timeouts during multicall operations',
  registers: [registry]
});

export const runAbortsTotal = new Counter({
  name: 'liquidbot_run_aborts_total',
  help: 'Total number of runs aborted due to stall detection',
  registers: [registry]
});

export const wsReconnectsTotal = new Counter({
  name: 'liquidbot_ws_reconnects_total',
  help: 'Total number of WebSocket reconnections due to heartbeat failures',
  registers: [registry]
});

export const chunkLatency = new Histogram({
  name: 'liquidbot_chunk_latency_seconds',
  help: 'Latency of multicall chunk execution in seconds',
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry]
});

// Price oracle metrics
export const priceOracleChainlinkRequestsTotal = new Counter({
  name: 'liquidbot_price_oracle_chainlink_requests_total',
  help: 'Total Chainlink price oracle requests',
  labelNames: ['status', 'symbol'],
  registers: [registry]
});

export const priceOracleChainlinkStaleTotal = new Counter({
  name: 'liquidbot_price_oracle_chainlink_stale_total',
  help: 'Total number of stale Chainlink price data detected',
  labelNames: ['symbol'],
  registers: [registry]
});

export const priceOracleStubFallbackTotal = new Counter({
  name: 'liquidbot_price_oracle_stub_fallback_total',
  help: 'Total number of times price oracle fell back to stub prices',
  labelNames: ['symbol', 'reason'],
  registers: [registry]
});

// Low HF Tracker metrics
export const lowHfSnapshotTotal = new Counter({
  name: 'liquidbot_lowhf_snapshot_total',
  help: 'Total number of low HF snapshots captured',
  labelNames: ['mode'],
  registers: [registry]
});

export const lowHfMinHealthFactor = new Histogram({
  name: 'liquidbot_lowhf_min_hf',
  help: 'Distribution of minimum health factors tracked',
  buckets: [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.5],
  registers: [registry]
});

export const lowHfMismatchTotal = new Counter({
  name: 'liquidbot_lowhf_mismatch_total',
  help: 'Total number of HF verification mismatches detected',
  registers: [registry]
});
