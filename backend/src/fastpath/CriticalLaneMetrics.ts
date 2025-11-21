/**
 * Critical Lane Metrics
 * 
 * Prometheus metrics registration and local histograms for latency tracking.
 */

import { Counter, Histogram, Registry } from 'prom-client';

export interface CriticalLaneMetricsInterface {
  attemptTotal: Counter;
  successTotal: Counter;
  racedTotal: Counter;
  skippedTotal: Counter;
  snapshotStaleTotal: Counter;
  miniMulticallInvocationsTotal: Counter;
  latencyMsHistogram: Histogram;
  fastpathPhaseDurationMs: Histogram;
  fastpathAttemptTotal: Counter;
}

let metricsInstance: CriticalLaneMetricsInterface | null = null;

/**
 * Register Critical Lane metrics with Prometheus
 */
export function registerCriticalLaneMetrics(registry?: Registry): CriticalLaneMetricsInterface {
  if (metricsInstance) {
    return metricsInstance;
  }

  const attemptTotal = new Counter({
    name: 'critical_lane_attempt_total',
    help: 'Total number of critical lane execution attempts',
    registers: registry ? [registry] : undefined
  });

  const successTotal = new Counter({
    name: 'critical_lane_success_total',
    help: 'Total number of successful critical lane executions',
    registers: registry ? [registry] : undefined
  });

  const racedTotal = new Counter({
    name: 'critical_lane_raced_total',
    help: 'Total number of critical lane attempts lost to competitor',
    registers: registry ? [registry] : undefined
  });

  const skippedTotal = new Counter({
    name: 'critical_lane_skipped_total',
    help: 'Total number of critical lane attempts skipped',
    labelNames: ['reason'],
    registers: registry ? [registry] : undefined
  });

  const snapshotStaleTotal = new Counter({
    name: 'critical_lane_snapshot_stale_total',
    help: 'Total number of stale snapshot detections requiring refresh',
    registers: registry ? [registry] : undefined
  });

  const miniMulticallInvocationsTotal = new Counter({
    name: 'critical_lane_mini_multicall_invocations_total',
    help: 'Total number of mini-multicall reverification invocations',
    registers: registry ? [registry] : undefined
  });

  const latencyMsHistogram = new Histogram({
    name: 'critical_lane_latency_ms',
    help: 'End-to-end latency histogram for critical lane attempts (ms)',
    buckets: [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000],
    registers: registry ? [registry] : undefined
  });

  const fastpathPhaseDurationMs = new Histogram({
    name: 'fastpath_phase_duration_ms',
    help: 'Duration of each fast-path phase in milliseconds',
    labelNames: ['phase'],
    buckets: [10, 25, 50, 75, 100, 150, 200, 300, 500],
    registers: registry ? [registry] : undefined
  });

  const fastpathAttemptTotal = new Counter({
    name: 'fastpath_attempt_total',
    help: 'Total fast-path attempts by outcome',
    labelNames: ['outcome'],
    registers: registry ? [registry] : undefined
  });

  metricsInstance = {
    attemptTotal,
    successTotal,
    racedTotal,
    skippedTotal,
    snapshotStaleTotal,
    miniMulticallInvocationsTotal,
    latencyMsHistogram,
    fastpathPhaseDurationMs,
    fastpathAttemptTotal
  };

  return metricsInstance;
}

/**
 * Get existing metrics instance
 */
export function getCriticalLaneMetrics(): CriticalLaneMetricsInterface {
  if (!metricsInstance) {
    return registerCriticalLaneMetrics();
  }
  return metricsInstance;
}

/**
 * Record skip with reason
 */
export function recordSkip(reason: string): void {
  const metrics = getCriticalLaneMetrics();
  metrics.skippedTotal.inc({ reason });
}

/**
 * Record attempt and return timer function
 */
export function recordAttempt(): () => void {
  const metrics = getCriticalLaneMetrics();
  metrics.attemptTotal.inc();
  
  const start = Date.now();
  return () => {
    const latencyMs = Date.now() - start;
    metrics.latencyMsHistogram.observe(latencyMs);
  };
}

/**
 * Record success
 */
export function recordSuccess(): void {
  const metrics = getCriticalLaneMetrics();
  metrics.successTotal.inc();
}

/**
 * Record race loss
 */
export function recordRaced(): void {
  const metrics = getCriticalLaneMetrics();
  metrics.racedTotal.inc();
}

/**
 * Record stale snapshot
 */
export function recordSnapshotStale(): void {
  const metrics = getCriticalLaneMetrics();
  metrics.snapshotStaleTotal.inc();
}

/**
 * Record mini-multicall invocation
 */
export function recordMiniMulticall(): void {
  const metrics = getCriticalLaneMetrics();
  metrics.miniMulticallInvocationsTotal.inc();
}

/**
 * Record fast-path phase duration
 */
export function recordFastpathPhase(phase: string, durationMs: number): void {
  const metrics = getCriticalLaneMetrics();
  metrics.fastpathPhaseDurationMs.observe({ phase }, durationMs);
}

/**
 * Record fast-path attempt outcome
 */
export function recordFastpathAttempt(outcome: 'success' | 'raced' | 'skip'): void {
  const metrics = getCriticalLaneMetrics();
  metrics.fastpathAttemptTotal.inc({ outcome });
}
