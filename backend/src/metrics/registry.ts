/**
 * Central Metrics Registry
 * 
 * Single source of truth for the prom-client Registry.
 * Initialized once at module load and configured with default metrics.
 * This module has no dependencies on other metrics modules to avoid circular imports.
 */

import { Registry, collectDefaultMetrics } from 'prom-client';

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });
