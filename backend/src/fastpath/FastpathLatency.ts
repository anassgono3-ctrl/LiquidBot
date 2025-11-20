/**
 * FastpathLatency: Timing capture utilities for fast-path instrumentation
 * 
 * Provides helpers for measuring and recording latency breakdowns across
 * detection, multicall, planning, and execution phases.
 */

import { config } from '../config/index.js';

export interface LatencyPhases {
  eventToPublishMs?: number;
  publishToReceiveMs?: number;
  miniMulticallMs?: number;
  planBuildMs?: number;
  priceGasMs?: number;
  submitMs?: number;
  totalMs: number;
}

export interface ChunkLatency {
  batchId: string;
  type: 'head' | 'reserve' | 'event';
  calls: number;
  enqueueMs: number;
  rpcRttMs: number;
  hedgeDelayMs: number;
  postProcessMs: number;
  totalMs: number;
  provider: 'primary' | 'secondary';
  hedged: boolean;
}

/**
 * Timer for tracking elapsed time
 */
export class Timer {
  private startTime: number;
  
  constructor() {
    this.startTime = Date.now();
  }
  
  /**
   * Get elapsed time in milliseconds
   */
  elapsed(): number {
    return Date.now() - this.startTime;
  }
  
  /**
   * Reset the timer
   */
  reset(): void {
    this.startTime = Date.now();
  }
}

/**
 * Phase timer for tracking multiple phases
 */
export class PhaseTimer {
  private phases: Map<string, number> = new Map();
  private currentPhase: string | null = null;
  private phaseStart: number | null = null;
  
  /**
   * Start tracking a new phase
   */
  startPhase(name: string): void {
    if (this.currentPhase !== null && this.phaseStart !== null) {
      // Complete previous phase
      const elapsed = Date.now() - this.phaseStart;
      this.phases.set(this.currentPhase, elapsed);
    }
    
    this.currentPhase = name;
    this.phaseStart = Date.now();
  }
  
  /**
   * End current phase
   */
  endPhase(): void {
    if (this.currentPhase !== null && this.phaseStart !== null) {
      const elapsed = Date.now() - this.phaseStart;
      this.phases.set(this.currentPhase, elapsed);
      this.currentPhase = null;
      this.phaseStart = null;
    }
  }
  
  /**
   * Get duration for a specific phase
   */
  getPhase(name: string): number | undefined {
    return this.phases.get(name);
  }
  
  /**
   * Get all phases
   */
  getAllPhases(): Record<string, number> {
    return Object.fromEntries(this.phases);
  }
}

/**
 * Log fastpath latency breakdown
 */
export function logFastpathLatency(
  user: string,
  snapshotStale: boolean,
  phases: LatencyPhases
): void {
  if (!config.fastpathLatencyEnabled || !config.fastpathLogDetail) {
    return;
  }
  
  const parts = [
    `[fastpath-latency]`,
    `user=${user}`,
    `snapshotStale=${snapshotStale}`
  ];
  
  if (phases.miniMulticallMs !== undefined) {
    parts.push(`miniMulticallMs=${phases.miniMulticallMs}`);
  }
  if (phases.planBuildMs !== undefined) {
    parts.push(`planBuildMs=${phases.planBuildMs}`);
  }
  if (phases.priceGasMs !== undefined) {
    parts.push(`priceGasMs=${phases.priceGasMs}`);
  }
  if (phases.submitMs !== undefined) {
    parts.push(`submitMs=${phases.submitMs}`);
  }
  parts.push(`totalMs=${phases.totalMs}`);
  
  console.log(parts.join(' '));
}

/**
 * Log chunk latency breakdown for multicall batches
 */
export function logChunkLatency(chunk: ChunkLatency): void {
  if (!config.fastpathLatencyEnabled) {
    return;
  }
  
  const parts = [
    `[latency-breakdown]`,
    `type=${chunk.type}`,
    `batchId=${chunk.batchId}`,
    `calls=${chunk.calls}`,
    `enqueueMs=${chunk.enqueueMs}`,
    `rpcRttMs=${chunk.rpcRttMs}`,
    `hedgeDelayMs=${chunk.hedgeDelayMs}`,
    `postMs=${chunk.postProcessMs}`,
    `totalMs=${chunk.totalMs}`,
    `provider=${chunk.provider}`,
    `hedged=${chunk.hedged}`
  ];
  
  console.log(parts.join(' '));
}

/**
 * Check if latency instrumentation is enabled
 */
export function isLatencyEnabled(): boolean {
  return config.fastpathLatencyEnabled;
}

/**
 * Check if hedge should be suppressed for small chunks
 */
export function shouldSuppressHedge(callCount: number): boolean {
  return config.fastpathHedgeSmallDisable && callCount <= 5;
}
