/**
 * Types for historical replay harness
 */

export interface ReplayBlockRange {
  start: number;
  end: number;
}

export interface LiquidationEvent {
  user: string;
  txHash: string;
  txBlock: number;
  collateralAsset: string;
  debtAsset: string;
  debtToCover: bigint;
  liquidatedCollateralAmount: bigint;
  liquidator: string;
  receiveAToken: boolean;
  timestamp: number;
}

export interface LiquidationEventWithPrices extends LiquidationEvent {
  debtUSD: number;
  seizedUSD: number;
}

export interface UserReplayState {
  user: string;
  firstLiquidatableBlock: number | null;
  earliestWouldExecuteBlock: number | null;
  everInCandidateSet: boolean;
}

export type MissReason = 
  | 'below_min_debt' 
  | 'watch_set_gap' 
  | 'profit_filter' 
  | 'unknown'
  | 'success';

export interface LiquidationAnalysis {
  user: string;
  txHash: string;
  txBlock: number;
  seizedUSD: number;
  debtUSD: number;
  firstLiquidatableBlock: number | null;
  earliestWouldExecuteBlock: number | null;
  detectionLag: number | null;
  executionLag: number | null;
  missReason: MissReason;
}

export interface ReplaySummary {
  totalLiquidations: number;
  detectionCoveragePct: number;
  executionCoveragePct: number;
  medianDetectionLagBlocks: number | null;
  medianExecutionLagBlocks: number | null;
  missedByReason: Record<MissReason, number>;
  totalPotentialProfitMissedUSD: number;
}
