/**
 * Configuration loader for fast path execution features
 */

import type {
  OptimisticConfig,
  WriteRacingConfig,
  GasBurstConfig,
  CalldataTemplateConfig,
  SecondOrderConfig,
  LatencyConfig,
  EmergencyScanConfig
} from './types.js';

/**
 * Parse boolean from environment variable
 */
function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

/**
 * Parse number from environment variable
 */
function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse comma-separated list from environment variable
 */
function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Load optimistic execution configuration
 */
export function loadOptimisticConfig(): OptimisticConfig {
  return {
    enabled: parseBool(process.env.OPTIMISTIC_ENABLED, false),
    epsilonBps: parseNumber(process.env.OPTIMISTIC_EPSILON_BPS, 5),
    maxReverts: parseNumber(process.env.OPTIMISTIC_MAX_REVERTS, 50)
  };
}

/**
 * Load write racing configuration
 */
export function loadWriteRacingConfig(): WriteRacingConfig {
  return {
    writeRpcs: parseList(process.env.WRITE_RPCS),
    raceTimeoutMs: parseNumber(process.env.WRITE_RACE_TIMEOUT_MS, 120)
  };
}

/**
 * Load gas burst configuration
 */
export function loadGasBurstConfig(): GasBurstConfig {
  return {
    enabled: parseBool(process.env.GAS_BURST_ENABLED, false),
    firstMs: parseNumber(process.env.GAS_BURST_FIRST_MS, 150),
    secondMs: parseNumber(process.env.GAS_BURST_SECOND_MS, 300),
    firstPct: parseNumber(process.env.GAS_BURST_FIRST_PCT, 25),
    secondPct: parseNumber(process.env.GAS_BURST_SECOND_PCT, 25),
    maxBumps: parseNumber(process.env.GAS_BURST_MAX_BUMPS, 2)
  };
}

/**
 * Load calldata template configuration
 */
export function loadCalldataTemplateConfig(): CalldataTemplateConfig {
  return {
    enabled: parseBool(process.env.CALLDATA_TEMPLATE_ENABLED, false),
    refreshIndexBps: parseNumber(process.env.TEMPLATE_REFRESH_INDEX_BPS, 10)
  };
}

/**
 * Load second-order chaining configuration
 */
export function loadSecondOrderConfig(): SecondOrderConfig {
  return {
    enabled: parseBool(process.env.SECOND_ORDER_CHAIN_ENABLED, false)
  };
}

/**
 * Load latency instrumentation configuration
 */
export function loadLatencyConfig(): LatencyConfig {
  return {
    enabled: parseBool(process.env.LATENCY_METRICS_ENABLED, false)
  };
}

/**
 * Load emergency scan configuration
 */
export function loadEmergencyScanConfig(): EmergencyScanConfig {
  return {
    maxUsers: parseNumber(process.env.EMERGENCY_SCAN_MAX_USERS, 250),
    assetHfBandBps: parseNumber(process.env.EMERGENCY_SCAN_ASSET_HF_BAND_BPS, 300)
  };
}

/**
 * Load multiple executor private keys
 * WARNING: Never log the raw keys!
 */
export function loadExecutorKeys(): string[] {
  const keysEnv = process.env.EXECUTION_PRIVATE_KEYS;
  if (!keysEnv) {
    // Fallback to single key if available
    const singleKey = process.env.EXECUTION_PRIVATE_KEY;
    return singleKey ? [singleKey] : [];
  }
  
  // Parse comma-separated keys and ensure 0x prefix
  return parseList(keysEnv).map(key => {
    const trimmed = key.trim();
    return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  });
}

/**
 * Singleton instances for loaded configurations
 */
export const optimisticConfig = loadOptimisticConfig();
export const writeRacingConfig = loadWriteRacingConfig();
export const gasBurstConfig = loadGasBurstConfig();
export const calldataTemplateConfig = loadCalldataTemplateConfig();
export const secondOrderConfig = loadSecondOrderConfig();
export const latencyConfig = loadLatencyConfig();
export const emergencyScanConfig = loadEmergencyScanConfig();
