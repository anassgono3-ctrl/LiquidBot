/**
 * Pre-Submit Liquidation Pipeline Metrics
 * 
 * Prometheus counters and histograms for monitoring pre-submit liquidation flow:
 * - Pyth price updates and staleness
 * - TWAP sanity checks
 * - Pre-submit attempts and outcomes
 * - ETA accuracy and time-to-mine
 */

import { Counter, Histogram, register } from 'prom-client';

// ==== PYTH NETWORK METRICS ====

export const pythPriceUpdatesTotal = new Counter({
  name: 'pyth_price_updates_total',
  help: 'Total number of Pyth price updates received',
  labelNames: ['symbol'],
  registers: [register]
});

export const pythStalePricesTotal = new Counter({
  name: 'pyth_stale_prices_total',
  help: 'Total number of stale Pyth prices detected',
  labelNames: ['symbol'],
  registers: [register]
});

export const pythConnectionErrorsTotal = new Counter({
  name: 'pyth_connection_errors_total',
  help: 'Total number of Pyth connection errors',
  registers: [register]
});

export const pythReconnectsTotal = new Counter({
  name: 'pyth_reconnects_total',
  help: 'Total number of Pyth reconnection attempts',
  registers: [register]
});

export const pythPriceAgeSec = new Histogram({
  name: 'pyth_price_age_sec',
  help: 'Age of Pyth price updates in seconds',
  labelNames: ['symbol'],
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60],
  registers: [register]
});

// ==== TWAP SANITY CHECK METRICS ====

export const twapSanityChecksTotal = new Counter({
  name: 'twap_sanity_checks_total',
  help: 'Total number of TWAP sanity checks performed',
  labelNames: ['symbol', 'result'], // result: pass | fail
  registers: [register]
});

export const twapDeltaPct = new Histogram({
  name: 'twap_delta_pct',
  help: 'TWAP price delta percentage from reference price',
  labelNames: ['symbol'],
  buckets: [0.001, 0.005, 0.01, 0.02, 0.05, 0.1],
  registers: [register]
});

export const twapComputationDurationMs = new Histogram({
  name: 'twap_computation_duration_ms',
  help: 'Duration of TWAP computation in milliseconds',
  labelNames: ['symbol'],
  buckets: [10, 50, 100, 250, 500, 1000],
  registers: [register]
});

// ==== PRE-SUBMIT METRICS ====

export const preSubmitAttemptsTotal = new Counter({
  name: 'pre_submit_attempts_total',
  help: 'Total number of pre-submit attempts',
  labelNames: ['result'], // result: submitted | gate_failed | error
  registers: [register]
});

export const preSubmitGateFailuresTotal = new Counter({
  name: 'pre_submit_gate_failures_total',
  help: 'Total number of pre-submit gate failures',
  labelNames: ['gate'], // gate: eta | hf | size | twap | feature_disabled
  registers: [register]
});

export const preSubmitGasEstimated = new Histogram({
  name: 'pre_submit_gas_estimated',
  help: 'Estimated gas for pre-submit transactions',
  buckets: [100000, 200000, 300000, 400000, 500000, 750000, 1000000],
  registers: [register]
});

export const preSubmitGasPriceGwei = new Histogram({
  name: 'pre_submit_gas_price_gwei',
  help: 'Gas price used for pre-submit transactions in Gwei',
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
  registers: [register]
});

export const preSubmitDebtUsd = new Histogram({
  name: 'pre_submit_debt_usd',
  help: 'Debt amount in USD for pre-submit candidates',
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000],
  registers: [register]
});

export const preSubmitHfProjected = new Histogram({
  name: 'pre_submit_hf_projected',
  help: 'Projected health factor for pre-submit candidates',
  buckets: [0.85, 0.90, 0.95, 0.98, 1.0, 1.02, 1.05],
  registers: [register]
});

// ==== OUTCOME METRICS ====

export const preSubmitOutcomesTotal = new Counter({
  name: 'pre_submit_outcomes_total',
  help: 'Total number of pre-submit outcomes',
  labelNames: ['outcome'], // outcome: success | reverted | expired | pending
  registers: [register]
});

export const preSubmitRevertReasonsTotal = new Counter({
  name: 'pre_submit_revert_reasons_total',
  help: 'Total number of pre-submit reverts by reason code',
  labelNames: ['reason'],
  registers: [register]
});

export const preSubmitTimeToMineSec = new Histogram({
  name: 'pre_submit_time_to_mine_sec',
  help: 'Time from submission to mining in seconds',
  buckets: [1, 3, 6, 12, 24, 48, 96, 192],
  registers: [register]
});

export const preSubmitEtaAccuracySec = new Histogram({
  name: 'pre_submit_eta_accuracy_sec',
  help: 'Delta between predicted ETA and actual time (negative means early)',
  buckets: [-60, -30, -15, -5, 0, 5, 15, 30, 60],
  registers: [register]
});

export const preSubmitPendingCount = new Histogram({
  name: 'pre_submit_pending_count',
  help: 'Number of pending pre-submit transactions',
  buckets: [0, 1, 2, 5, 10, 20, 50],
  registers: [register]
});

// ==== HELPER FUNCTIONS ====

/**
 * Record a Pyth price update
 */
export function recordPythPriceUpdate(symbol: string, ageSec: number, isStale: boolean): void {
  pythPriceUpdatesTotal.inc({ symbol });
  pythPriceAgeSec.observe({ symbol }, ageSec);
  if (isStale) {
    pythStalePricesTotal.inc({ symbol });
  }
}

/**
 * Record a TWAP sanity check
 */
export function recordTwapSanityCheck(
  symbol: string,
  deltaPct: number,
  passed: boolean,
  durationMs: number
): void {
  twapSanityChecksTotal.inc({ symbol, result: passed ? 'pass' : 'fail' });
  twapDeltaPct.observe({ symbol }, deltaPct);
  twapComputationDurationMs.observe({ symbol }, durationMs);
}

/**
 * Record a pre-submit attempt
 */
export function recordPreSubmitAttempt(
  result: 'submitted' | 'gate_failed' | 'error',
  gasEstimated?: number,
  gasPriceGwei?: number,
  debtUsd?: number,
  hfProjected?: number
): void {
  preSubmitAttemptsTotal.inc({ result });
  if (result === 'submitted') {
    if (gasEstimated !== undefined) {
      preSubmitGasEstimated.observe(gasEstimated);
    }
    if (gasPriceGwei !== undefined) {
      preSubmitGasPriceGwei.observe(gasPriceGwei);
    }
    if (debtUsd !== undefined) {
      preSubmitDebtUsd.observe(debtUsd);
    }
    if (hfProjected !== undefined) {
      preSubmitHfProjected.observe(hfProjected);
    }
  }
}

/**
 * Record a gate failure
 */
export function recordGateFailure(gate: 'eta' | 'hf' | 'size' | 'twap' | 'feature_disabled'): void {
  preSubmitGateFailuresTotal.inc({ gate });
}

/**
 * Record a pre-submit outcome
 */
export function recordPreSubmitOutcome(
  outcome: 'success' | 'reverted' | 'expired' | 'pending',
  timeToMineSec?: number,
  etaAccuracySec?: number,
  revertReason?: string
): void {
  preSubmitOutcomesTotal.inc({ outcome });
  
  if (outcome === 'success' || outcome === 'reverted') {
    if (timeToMineSec !== undefined) {
      preSubmitTimeToMineSec.observe(timeToMineSec);
    }
    if (etaAccuracySec !== undefined) {
      preSubmitEtaAccuracySec.observe(etaAccuracySec);
    }
  }
  
  if (outcome === 'reverted' && revertReason) {
    preSubmitRevertReasonsTotal.inc({ reason: revertReason });
  }
}

/**
 * Update pending count gauge
 */
export function recordPendingCount(count: number): void {
  preSubmitPendingCount.observe(count);
}
