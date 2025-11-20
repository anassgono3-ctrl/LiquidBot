/**
 * Type definitions for historical replay mode
 */

export interface ReplayConfig {
  enabled: boolean;
  blockRange: string; // Format: "START-END"
  rpcUrl: string;
  startBlock: number;
  endBlock: number;
}

export interface LiquidationDetection {
  userAddress: string;
  firstDetectBlock: number | null;
  liquidationBlock: number;
  detectionLagBlocks: number | null;
  missReason: 'watch_set_gap' | 'min_debt_filter' | 'profit_filter' | 'unknown' | null;
}

export interface BlockMetrics {
  block: number;
  timestamp: number;
  candidateCount: number;
  hotsetCount: number;
  nearThresholdCount: number;
  fastSubsetSize: number;
  predictorTriggers: number;
  newHFEntrants: string[];
  liquidationCalls: Array<{
    user: string;
    debtAsset: string;
    collateralAsset: string;
    debtToCover: string;
  }>;
  minHF: number | null;
  durationMs: number;
}

export interface ReplaySummary {
  range: {
    start: number;
    end: number;
  };
  totalBlocks: number;
  totalUsersEvaluated: number;
  totalUniqueLiquidatableUsers: number;
  totalLiquidationEvents: number;
  detectionCoveragePct: number;
  medianDetectionLag: number | null;
  missedCountByReason: {
    watch_set_gap: number;
    min_debt_filter: number;
    profit_filter: number;
    unknown: number;
  };
  earliestLiquidationBlock: number | null;
  configSnapshot: {
    hotlistMinHf: number;
    hotlistMaxHf: number;
    hotlistMinDebtUsd: number;
    minDebtUsd: number;
    profitMinUsd: number;
    fastSubsetEnabled: boolean;
    predictorEnabled: boolean;
    microVerifyEnabled: boolean;
  };
}

export interface HistoricalEvent {
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  address: string;
  name: string;
  args: {
    [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  timestamp: number;
}
