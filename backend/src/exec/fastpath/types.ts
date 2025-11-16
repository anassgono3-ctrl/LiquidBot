/**
 * Shared types and interfaces for fast path execution features
 */

export interface OptimisticConfig {
  enabled: boolean;
  epsilonBps: number; // epsilon margin in basis points
  maxReverts: number; // daily revert budget
}

export interface WriteRacingConfig {
  writeRpcs: string[]; // multiple write endpoints
  raceTimeoutMs: number; // hedge timeout
}

export interface GasBurstConfig {
  enabled: boolean;
  firstMs: number; // first bump delay
  secondMs: number; // second bump delay
  firstPct: number; // first bump percentage
  secondPct: number; // second bump percentage
  maxBumps: number; // maximum bumps
}

export interface CalldataTemplateConfig {
  enabled: boolean;
  refreshIndexBps: number; // index change threshold for refresh
}

export interface SecondOrderConfig {
  enabled: boolean;
}

export interface LatencyConfig {
  enabled: boolean;
}

export interface EmergencyScanConfig {
  maxUsers: number;
  assetHfBandBps: number; // HF band for asset scans
}

/**
 * Latency tracking timestamps for execution pipeline
 */
export interface LatencyTimestamps {
  blockReceivedAt?: number;
  candidateDetectedAt?: number;
  planReadyAt?: number;
  txSignedAt?: number;
  txBroadcastAt?: number;
  firstInclusionCheckAt?: number;
}

/**
 * RPC health metrics
 */
export interface RpcHealthMetrics {
  rpcUrl: string;
  successCount: number;
  errorCount: number;
  totalRtt: number; // cumulative RTT in ms
  avgRtt: number; // exponential moving average
  lastUpdated: number;
}

/**
 * Calldata template cache entry
 */
export interface CalldataTemplate {
  user: string;
  debtAsset: string;
  collateralAsset: string;
  mode: number;
  template: string; // encoded calldata without debtToCover
  debtIndex: bigint; // variable debt index at creation
  createdAt: number;
}

/**
 * Gas bump attempt record
 */
export interface GasBumpAttempt {
  originalTxHash: string;
  bumpStage: 'first' | 'second';
  newGasPrice: bigint;
  timestamp: number;
}

/**
 * Optimistic execution result
 */
export interface OptimisticResult {
  executed: boolean;
  reason?: 'epsilon_threshold' | 'budget_exceeded' | 'borderline_hf';
  txHash?: string;
  latencyMs?: number;
}
