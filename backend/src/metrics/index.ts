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
