/**
 * Private Relay Metrics
 * 
 * Prometheus metrics for private transaction relay submission.
 */

import { Counter, Histogram, Registry } from 'prom-client';

// Counters
let attemptsCounter: Counter<string> | undefined;
let successCounter: Counter<string> | undefined;
let fallbackCounter: Counter<string> | undefined;

// Histogram
let latencyHistogram: Histogram<string> | undefined;

/**
 * Register private relay metrics with Prometheus registry
 */
export function registerPrivateRelayMetrics(register: Registry): void {
  // Private transaction attempts counter
  attemptsCounter = new Counter({
    name: 'liquidbot_private_tx_attempts_total',
    help: 'Total number of private transaction submission attempts',
    labelNames: ['mode'],
    registers: [register]
  });

  // Private transaction success counter
  successCounter = new Counter({
    name: 'liquidbot_private_tx_success_total',
    help: 'Total number of successful private transaction submissions',
    labelNames: ['mode'],
    registers: [register]
  });

  // Fallback counter
  fallbackCounter = new Counter({
    name: 'liquidbot_private_tx_fallback_total',
    help: 'Total number of fallback submissions after private relay failure',
    labelNames: ['reason'],
    registers: [register]
  });

  // Latency histogram
  latencyHistogram = new Histogram({
    name: 'liquidbot_private_tx_latency_ms',
    help: 'Private transaction submission latency in milliseconds',
    buckets: [10, 25, 50, 100, 250, 500, 1000, 2000, 5000],
    registers: [register]
  });
}

/**
 * Record a private transaction attempt
 */
export function recordAttempt(mode: string): void {
  attemptsCounter?.inc({ mode });
}

/**
 * Record a successful private transaction submission
 */
export function recordSuccess(mode: string): void {
  successCounter?.inc({ mode });
}

/**
 * Record a fallback submission
 */
export function recordFallback(reason: string): void {
  fallbackCounter?.inc({ reason });
}

/**
 * Record private transaction latency
 */
export function recordLatency(latencyMs: number): void {
  latencyHistogram?.observe(latencyMs);
}
