/**
 * DecisionClassifier: Classify missed liquidations based on decision traces
 * 
 * Maps decision traces to reason codes for audit and reporting.
 */

import type { DecisionTrace, DecisionAction, SkipReason } from './DecisionTraceStore.js';
import type { DecisionTraceStore } from './DecisionTraceStore.js';

export type ClassifiedReason =
  | 'ours'
  | 'raced'
  | 'filtered.min_debt'
  | 'filtered.min_profit'
  | 'filtered.slippage'
  | 'filtered.prefund'
  | 'filtered.price_stale'
  | 'filtered.callstatic_fail'
  | 'latency.head_lag'
  | 'latency.pricing_delay'
  | 'unknown';

export interface ClassificationResult {
  reason: ClassifiedReason;
  notes: string[];
  trace?: DecisionTrace;
}

/**
 * DecisionClassifier maps decision traces to classified reasons
 */
export class DecisionClassifier {
  private traceStore: DecisionTraceStore;

  constructor(traceStore: DecisionTraceStore) {
    this.traceStore = traceStore;
  }

  /**
   * Classify a missed liquidation
   * @param user User address
   * @param liquidatorAddress Address that executed the liquidation
   * @param eventSeenAtMs Timestamp when we saw the event (ms)
   * @param eventDebtUsd USD value of debt covered in the liquidation
   * @param eventBlock Block number of the liquidation
   * @param ourAddress Our bot's address
   * @returns Classification result
   */
  classify(
    user: string,
    liquidatorAddress: string,
    eventSeenAtMs: number,
    eventDebtUsd: number | null,
    eventBlock: number,
    ourAddress?: string
  ): ClassificationResult {
    // Check if this was our liquidation
    if (ourAddress && liquidatorAddress.toLowerCase() === ourAddress.toLowerCase()) {
      return {
        reason: 'ours',
        notes: ['Liquidation executed by our bot']
      };
    }

    // Find decision trace
    const trace = this.traceStore.findDecision(user, eventSeenAtMs);

    if (!trace) {
      // No decision trace found - user was not in our watch set
      return {
        reason: 'raced',
        notes: ['No decision trace found - user not in watch set or trace expired']
      };
    }

    const notes: string[] = [];

    // Check decision action
    if (trace.action === 'attempt') {
      // We attempted but got raced
      if (trace.attemptMeta?.txHash) {
        notes.push(`We attempted liquidation (tx=${trace.attemptMeta.txHash.substring(0, 10)}...)`);
      } else {
        notes.push('We attempted liquidation but were raced');
      }
      
      return {
        reason: 'raced',
        notes,
        trace
      };
    }

    // Action was 'skip' - classify based on skip reason
    const skipReason = trace.skipReason;

    if (skipReason === 'min_debt') {
      notes.push(`Filtered: debt below threshold (est=${trace.estDebtUsd?.toFixed(2) || 'n/a'} < min=${trace.thresholds.minDebtUsd})`);
      if (eventDebtUsd !== null) {
        notes.push(`Actual event debt: $${eventDebtUsd.toFixed(2)}`);
      }
      return {
        reason: 'filtered.min_debt',
        notes,
        trace
      };
    }

    if (skipReason === 'min_profit') {
      notes.push(`Filtered: profit below threshold (est=${trace.estProfitUsd?.toFixed(2) || 'n/a'} < min=${trace.thresholds.minProfitUsd})`);
      return {
        reason: 'filtered.min_profit',
        notes,
        trace
      };
    }

    if (skipReason === 'slippage') {
      notes.push(`Filtered: slippage exceeded (max=${trace.thresholds.maxSlippagePct}%)`);
      return {
        reason: 'filtered.slippage',
        notes,
        trace
      };
    }

    if (skipReason === 'prefund') {
      notes.push('Filtered: insufficient prefund balance');
      return {
        reason: 'filtered.prefund',
        notes,
        trace
      };
    }

    if (skipReason === 'price_stale') {
      notes.push('Filtered: price data too stale');
      return {
        reason: 'filtered.price_stale',
        notes,
        trace
      };
    }

    if (skipReason === 'callstatic_fail') {
      notes.push('Filtered: callStatic simulation failed');
      return {
        reason: 'filtered.callstatic_fail',
        notes,
        trace
      };
    }

    // Check for latency issues
    if (trace.headLagBlocks > 2) {
      notes.push(`Latency: head lag (${trace.headLagBlocks} blocks behind)`);
      return {
        reason: 'latency.head_lag',
        notes,
        trace
      };
    }

    // Check for pricing delay (HF was > 1 at decision time but < 1 at previous block)
    if (trace.hfAtDecision >= 1.0 && trace.hfPrevBlock && trace.hfPrevBlock < 1.0) {
      notes.push(`Latency: pricing delay (HF @ decision=${trace.hfAtDecision.toFixed(4)}, HF @ prev=${trace.hfPrevBlock.toFixed(4)})`);
      return {
        reason: 'latency.pricing_delay',
        notes,
        trace
      };
    }

    // Unknown reason
    notes.push('Skipped for unknown reason');
    if (skipReason) {
      notes.push(`Skip reason: ${skipReason}`);
    }
    
    return {
      reason: 'unknown',
      notes,
      trace
    };
  }
}
