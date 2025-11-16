/**
 * LatencyTracker: End-to-end latency instrumentation for execution pipeline
 * 
 * Tracks timestamps at each stage of the execution pipeline and exposes
 * metrics for detailed latency analysis.
 */

import { latencyConfig } from './config.js';
import type { LatencyTimestamps } from './types.js';
import {
  execE2eLatencyMs,
  execLatencyBlockToDetection,
  execLatencyDetectionToPlan,
  execLatencyPlanToSign,
  execLatencySignToBroadcast,
  execLatencyBroadcastToCheck
} from '../../metrics/index.js';

export class LatencyTracker {
  private timestamps: Map<string, LatencyTimestamps> = new Map();

  constructor(private enabled: boolean = latencyConfig.enabled) {}

  /**
   * Start tracking latency for a given identifier (e.g., user address)
   */
  startTracking(id: string): void {
    if (!this.enabled) return;
    this.timestamps.set(id, {});
  }

  /**
   * Record block received timestamp
   */
  recordBlockReceived(id: string): void {
    if (!this.enabled) return;
    const ts = this.timestamps.get(id);
    if (ts) {
      ts.blockReceivedAt = Date.now();
    }
  }

  /**
   * Record candidate detected timestamp
   */
  recordCandidateDetected(id: string): void {
    if (!this.enabled) return;
    const ts = this.timestamps.get(id);
    if (ts) {
      ts.candidateDetectedAt = Date.now();
    }
  }

  /**
   * Record plan ready timestamp
   */
  recordPlanReady(id: string): void {
    if (!this.enabled) return;
    const ts = this.timestamps.get(id);
    if (ts) {
      ts.planReadyAt = Date.now();
    }
  }

  /**
   * Record transaction signed timestamp
   */
  recordTxSigned(id: string): void {
    if (!this.enabled) return;
    const ts = this.timestamps.get(id);
    if (ts) {
      ts.txSignedAt = Date.now();
    }
  }

  /**
   * Record transaction broadcast timestamp
   */
  recordTxBroadcast(id: string): void {
    if (!this.enabled) return;
    const ts = this.timestamps.get(id);
    if (ts) {
      ts.txBroadcastAt = Date.now();
    }
  }

  /**
   * Record first inclusion check timestamp
   */
  recordFirstInclusionCheck(id: string): void {
    if (!this.enabled) return;
    const ts = this.timestamps.get(id);
    if (ts) {
      ts.firstInclusionCheckAt = Date.now();
    }
  }

  /**
   * Get timestamps for a given identifier
   */
  getTimestamps(id: string): LatencyTimestamps | undefined {
    return this.timestamps.get(id);
  }

  /**
   * Finalize tracking and export metrics
   * Returns total latency in milliseconds
   */
  finalize(id: string): number | undefined {
    if (!this.enabled) return undefined;

    const ts = this.timestamps.get(id);
    if (!ts) return undefined;

    // Calculate breakdowns
    if (ts.blockReceivedAt && ts.candidateDetectedAt) {
      const blockToDetection = ts.candidateDetectedAt - ts.blockReceivedAt;
      execLatencyBlockToDetection.set(blockToDetection);
    }

    if (ts.candidateDetectedAt && ts.planReadyAt) {
      const detectionToPlan = ts.planReadyAt - ts.candidateDetectedAt;
      execLatencyDetectionToPlan.set(detectionToPlan);
    }

    if (ts.planReadyAt && ts.txSignedAt) {
      const planToSign = ts.txSignedAt - ts.planReadyAt;
      execLatencyPlanToSign.set(planToSign);
    }

    if (ts.txSignedAt && ts.txBroadcastAt) {
      const signToBroadcast = ts.txBroadcastAt - ts.txSignedAt;
      execLatencySignToBroadcast.set(signToBroadcast);
    }

    if (ts.txBroadcastAt && ts.firstInclusionCheckAt) {
      const broadcastToCheck = ts.firstInclusionCheckAt - ts.txBroadcastAt;
      execLatencyBroadcastToCheck.set(broadcastToCheck);
    }

    // Calculate end-to-end latency
    let e2eLatency: number | undefined;
    if (ts.blockReceivedAt && ts.txBroadcastAt) {
      e2eLatency = ts.txBroadcastAt - ts.blockReceivedAt;
      execE2eLatencyMs.observe(e2eLatency);
    }

    // Clean up
    this.timestamps.delete(id);

    return e2eLatency;
  }

  /**
   * Clear all tracked timestamps
   */
  clear(): void {
    this.timestamps.clear();
  }

  /**
   * Get current tracking count
   */
  getTrackingCount(): number {
    return this.timestamps.size;
  }
}

// Singleton instance
export const latencyTracker = new LatencyTracker();
