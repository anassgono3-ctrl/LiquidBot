import { Counter, Histogram, register } from 'prom-client';

/**
 * Optional price trigger metrics
 * 
 * Note: These metrics provide alternative naming conventions for price trigger monitoring.
 * The RealTimeHFService already uses similar metrics from src/metrics/index.ts:
 * - realtimePriceEmergencyScansTotal (functionally equivalent to priceTriggerScansTotal)
 * - emergencyScanLatency (functionally equivalent to priceTriggerLatencyMs)
 * 
 * Use these metrics if you prefer the explicit "price_trigger" naming, or stick with
 * the existing realtime metrics for consistency with other realtime service metrics.
 */

export const priceTriggerScansTotal = new Counter({
  name: 'liquidbot_price_trigger_scans_total',
  help: 'Total number of emergency scans initiated by price trigger',
  labelNames: ['asset'],
  registers: [register]
});

export const priceTriggerLatencyMs = new Histogram({
  name: 'liquidbot_price_trigger_scan_latency_ms',
  help: 'Latency of price-trigger emergency scan execution',
  buckets: [10, 50, 100, 250, 500, 1000, 2000, 5000],
  registers: [register]
});
