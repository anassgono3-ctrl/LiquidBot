import { Counter, Histogram, register } from 'prom-client';

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
