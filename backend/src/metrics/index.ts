import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export const registry = new Registry();

export const wsClients = new Gauge({
  name: 'liquidbot_ws_clients',
  help: 'Active WebSocket clients',
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
