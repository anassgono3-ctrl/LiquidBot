/**
 * MissRowLogger: Structured logging for missed liquidations
 * 
 * Writes structured JSON logs for each observed liquidation with detailed
 * metadata for post-hoc analysis.
 */

import type { ClassifiedReason } from './DecisionClassifier.js';
import type { DecisionTrace } from './DecisionTraceStore.js';

export interface MissRow {
  // Event identification
  blockNumber: number;
  blockTimestamp: number;
  transactionHash: string;
  
  // User and assets
  user: string;
  debtAsset: string;
  collateralAsset: string;
  
  // Classification
  reasonCode: ClassifiedReason;
  decisionAction?: 'attempt' | 'skip';
  skipReason?: string;
  
  // Health factor
  hfAtDecision?: number;
  hfPrevBlock?: number;
  
  // Financial
  estDebtUsd?: number;
  estProfitUsd?: number;
  eventDebtUsd?: number; // Actual debt from event
  eventCollateralUsd?: number; // Actual collateral from event
  
  // Timing and latency
  eventSeenAtMs: number;
  headLagBlocks?: number;
  detectionLatencyMs?: number; // Time from block to detection
  sendLatencyMs?: number; // Time from detection to send (if attempted)
  
  // Context
  priceSource?: string;
  
  // Competitor info
  competitorTx?: {
    hash: string;
    liquidator: string;
    gasPrice?: string;
  };
  
  // Thresholds (if filtered)
  thresholds?: {
    minDebtUsd: number;
    minProfitUsd: number;
    maxSlippagePct: number;
  };
}

/**
 * MissRowLogger handles structured logging of missed liquidations
 */
export class MissRowLogger {
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  /**
   * Log a miss row
   */
  log(row: MissRow): void {
    if (!this.enabled) {
      return;
    }

    // Write structured JSON log
    // In production, this could write to a file, database, or log aggregation service
    // For now, we'll use console.log with a special prefix for filtering
    const json = JSON.stringify(row);
    
    // eslint-disable-next-line no-console
    console.log(`[miss-row] ${json}`);
  }

  /**
   * Create a miss row from event and classification
   */
  static fromClassification(
    blockNumber: number,
    blockTimestamp: number,
    transactionHash: string,
    user: string,
    debtAsset: string,
    collateralAsset: string,
    liquidator: string,
    reasonCode: ClassifiedReason,
    eventSeenAtMs: number,
    eventDebtUsd: number | null,
    eventCollateralUsd: number | null,
    trace?: DecisionTrace
  ): MissRow {
    const row: MissRow = {
      blockNumber,
      blockTimestamp,
      transactionHash,
      user,
      debtAsset,
      collateralAsset,
      reasonCode,
      eventSeenAtMs,
      eventDebtUsd: eventDebtUsd || undefined,
      eventCollateralUsd: eventCollateralUsd || undefined,
      competitorTx: {
        hash: transactionHash,
        liquidator
      }
    };

    // Add trace information if available
    if (trace) {
      row.decisionAction = trace.action;
      row.skipReason = trace.skipReason;
      row.hfAtDecision = trace.hfAtDecision;
      row.hfPrevBlock = trace.hfPrevBlock;
      row.estDebtUsd = trace.estDebtUsd || undefined;
      row.estProfitUsd = trace.estProfitUsd || undefined;
      row.headLagBlocks = trace.headLagBlocks;
      row.priceSource = trace.priceSource;
      row.thresholds = trace.thresholds;

      // Calculate latencies
      row.detectionLatencyMs = trace.ts - blockTimestamp * 1000;
      
      if (trace.attemptMeta?.tsSend) {
        row.sendLatencyMs = trace.attemptMeta.tsSend - trace.ts;
      }
    }

    return row;
  }

  /**
   * Enable or disable logging
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}
