// Priority Sweep Metrics
// Prometheus metrics for priority sweep subsystem

import { Counter, Gauge, Histogram } from 'prom-client';

import { registry } from './index.js';

// Counter for total sweep runs
export const prioritySweepRunsTotal = new Counter({
  name: 'liquidbot_priority_sweep_runs_total',
  help: 'Total number of priority sweep runs completed',
  labelNames: ['status'],
  registers: [registry]
});

// Gauge for last sweep duration
export const prioritySweepLastDurationMs = new Gauge({
  name: 'liquidbot_priority_sweep_last_duration_ms',
  help: 'Duration of the last priority sweep run in milliseconds',
  registers: [registry]
});

// Gauge for users seen in last sweep
export const prioritySweepSeen = new Gauge({
  name: 'liquidbot_priority_sweep_seen',
  help: 'Number of users seen in the last priority sweep',
  registers: [registry]
});

// Gauge for users filtered in last sweep
export const prioritySweepFiltered = new Gauge({
  name: 'liquidbot_priority_sweep_filtered',
  help: 'Number of users that passed filters in the last priority sweep',
  registers: [registry]
});

// Gauge for users selected in last sweep
export const prioritySweepSelected = new Gauge({
  name: 'liquidbot_priority_sweep_selected',
  help: 'Number of users selected in the last priority sweep (top-N)',
  registers: [registry]
});

// Gauge for top score in last sweep
export const prioritySweepTopScore = new Gauge({
  name: 'liquidbot_priority_sweep_top_score',
  help: 'Highest priority score in the last priority sweep',
  registers: [registry]
});

// Gauge for median health factor in last sweep
export const prioritySweepMedianHf = new Gauge({
  name: 'liquidbot_priority_sweep_median_hf',
  help: 'Median health factor of selected users in the last priority sweep',
  registers: [registry]
});

// Counter for sweep errors
export const prioritySweepErrorsTotal = new Counter({
  name: 'liquidbot_priority_sweep_errors_total',
  help: 'Total number of errors during priority sweep runs',
  labelNames: ['error_type'],
  registers: [registry]
});

// Gauge for last error flag (0 = no error, 1 = error)
export const prioritySweepLastErrorFlag = new Gauge({
  name: 'liquidbot_priority_sweep_last_error_flag',
  help: 'Flag indicating if the last priority sweep had an error (0=success, 1=error)',
  registers: [registry]
});

// Histogram for sweep duration distribution
export const prioritySweepDurationHistogram = new Histogram({
  name: 'liquidbot_priority_sweep_duration_seconds',
  help: 'Distribution of priority sweep durations in seconds',
  buckets: [5, 10, 30, 60, 120, 180, 240],
  registers: [registry]
});

// Gauge for heap peak memory usage (optional tracking)
export const prioritySweepHeapPeakMb = new Gauge({
  name: 'liquidbot_priority_sweep_heap_peak_mb',
  help: 'Peak heap memory usage during last priority sweep in MB',
  registers: [registry]
});
