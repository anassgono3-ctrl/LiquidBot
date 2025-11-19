// Types for historical replay mode

export interface ReplayBlockMetrics {
  block: number;
  candidateCount: number;
  liquidatableCount: number;
  minHF: number;
  newLiquidatables: string[];
  durationMs: number;
}

export interface ReplaySummary {
  startBlock: number;
  endBlock: number;
  totalBlocks: number;
  totalLiquidatables: number;
  earliestLiquidationBlock: number | null;
  totalUniqueLiquidatableUsers: number;
  averageDurationMs: number;
  totalDurationMs: number;
}

export interface ParsedReplayRange {
  start: number;
  end: number;
}
