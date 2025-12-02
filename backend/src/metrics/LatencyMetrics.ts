/**
 * LatencyMetrics: Prometheus metrics for latency tracking
 */

import { Counter, Histogram, Gauge } from 'prom-client';

import { metricsRegistry } from './registry.js';

// Predictive candidates metrics
export const predictiveCandidatesTotal = new Counter({
  name: 'predictive_candidates_total',
  help: 'Total predictive candidates generated',
  labelNames: ['scenario'],
  registers: [metricsRegistry]
});

export const predictiveCrossingsConfirmed = new Counter({
  name: 'predictive_crossings_confirmed',
  help: 'Predictive crossings that were confirmed',
  labelNames: ['scenario'],
  registers: [metricsRegistry]
});

export const predictiveFalsePositive = new Counter({
  name: 'predictive_false_positive',
  help: 'Predictive candidates that did not materialize',
  labelNames: ['scenario'],
  registers: [metricsRegistry]
});

// HF calculation metrics
export const hfCalcBatchMs = new Histogram({
  name: 'hf_calc_batch_ms',
  help: 'Health factor calculation batch duration in milliseconds',
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [metricsRegistry]
});

export const hfCalcUsersPerSec = new Gauge({
  name: 'hf_calc_users_per_sec',
  help: 'Health factor calculations per second',
  registers: [metricsRegistry]
});

// Redis metrics
export const redisHitRatio = new Gauge({
  name: 'redis_hit_ratio',
  help: 'Redis cache hit ratio',
  registers: [metricsRegistry]
});

export const redisPipelineOps = new Counter({
  name: 'redis_pipeline_ops',
  help: 'Total Redis pipeline operations',
  registers: [metricsRegistry]
});

// Opportunity latency metrics
export const opportunityLatencyMs = new Histogram({
  name: 'opportunity_latency_ms',
  help: 'Latency from block detection to liquidation decision in milliseconds',
  buckets: [50, 100, 200, 500, 1000, 2000, 5000],
  registers: [metricsRegistry]
});

export const executionFastpathLatencyMs = new Histogram({
  name: 'execution_fastpath_latency_ms',
  help: 'Latency from decision to transaction sent in milliseconds',
  buckets: [10, 25, 50, 100, 250, 500, 1000],
  registers: [metricsRegistry]
});

// Liquidation miss rate
export const liquidationMissRate = new Gauge({
  name: 'liquidation_miss_rate',
  help: 'Ratio of missed liquidations vs competitors',
  registers: [metricsRegistry]
});

/**
 * Record a predictive candidate
 */
export function recordPredictiveCandidate(scenario: string): void {
  predictiveCandidatesTotal.inc({ scenario });
}

/**
 * Record a confirmed predictive crossing
 */
export function recordPredictiveCrossing(scenario: string, confirmed: boolean): void {
  if (confirmed) {
    predictiveCrossingsConfirmed.inc({ scenario });
  } else {
    predictiveFalsePositive.inc({ scenario });
  }
}

/**
 * Record HF calculation batch timing
 */
export function recordHFCalcBatch(durationMs: number, userCount: number): void {
  hfCalcBatchMs.observe(durationMs);
  if (durationMs > 0) {
    hfCalcUsersPerSec.set((userCount / durationMs) * 1000);
  }
}

/**
 * Update Redis metrics
 */
export function updateRedisMetrics(hits: number, misses: number, pipelineOps: number): void {
  const total = hits + misses;
  if (total > 0) {
    redisHitRatio.set(hits / total);
  }
  redisPipelineOps.inc(pipelineOps);
}

/**
 * Record opportunity latency
 */
export function recordOpportunityLatency(latencyMs: number): void {
  opportunityLatencyMs.observe(latencyMs);
}

/**
 * Record fast-path execution latency
 */
export function recordFastpathLatency(latencyMs: number): void {
  executionFastpathLatencyMs.observe(latencyMs);
}

/**
 * Update liquidation miss rate
 */
export function updateLiquidationMissRate(rate: number): void {
  liquidationMissRate.set(rate);
}
