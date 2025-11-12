/**
 * DecisionTraceStore: In-memory ring buffer for liquidation decision traces
 * 
 * Captures decision metadata at detection time to support post-hoc classification
 * of missed liquidations.
 */

export type DecisionAction = 'attempt' | 'skip';

export type SkipReason =
  | 'min_debt'
  | 'min_profit'
  | 'slippage'
  | 'prefund'
  | 'price_stale'
  | 'callstatic_fail'
  | 'unknown';

export interface DecisionTrace {
  // Identification
  user: string;
  debtAsset: string;
  collateralAsset: string;
  
  // Timing
  ts: number; // Timestamp when decision was made (ms)
  blockNumber: number;
  
  // Health Factor
  hfAtDecision: number;
  hfPrevBlock?: number; // HF at previous block, if available
  
  // Financial estimates
  estDebtUsd: number | null;
  estProfitUsd: number | null;
  
  // Thresholds and gates
  thresholds: {
    minDebtUsd: number;
    minProfitUsd: number;
    maxSlippagePct: number;
  };
  gates: {
    passedMinDebt: boolean;
    passedMinProfit: boolean;
    passedSlippage: boolean;
    passedPrefund: boolean;
    passedPriceFresh: boolean;
    passedCallStatic: boolean;
  };
  
  // Decision outcome
  action: DecisionAction;
  skipReason?: SkipReason;
  
  // Context
  priceSource: string; // e.g., "aave_oracle", "chainlink", "cached"
  headLagBlocks: number; // How many blocks behind current head
  
  // Attempt metadata (if action = 'attempt')
  attemptMeta?: {
    txHash?: string;
    tsSend?: number;
    gasPriceGwei?: number;
    submittedPrivate?: boolean;
  };
}

/**
 * DecisionTraceStore maintains recent decision traces in a ring buffer
 */
export class DecisionTraceStore {
  private traces: DecisionTrace[] = [];
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(maxSize = 10000, ttlMs = 300000) { // 5 minutes TTL
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    
    // Start periodic cleanup
    this.cleanupTimer = setInterval(() => this.cleanup(), 60000); // Every minute
  }

  /**
   * Record a decision trace
   */
  record(trace: DecisionTrace): void {
    // Add to ring buffer
    this.traces.push(trace);
    
    // Enforce max size (FIFO eviction)
    if (this.traces.length > this.maxSize) {
      this.traces.shift();
    }
  }

  /**
   * Find the most recent decision trace for a user before a given timestamp
   * @param user User address
   * @param beforeTs Timestamp to search before (e.g., event seen timestamp)
   * @param maxLookbackMs Maximum lookback time (default 60s)
   * @returns Decision trace or null
   */
  findDecision(
    user: string,
    beforeTs: number,
    maxLookbackMs = 60000
  ): DecisionTrace | null {
    const normalized = user.toLowerCase();
    const minTs = beforeTs - maxLookbackMs;
    
    // Search backwards (most recent first)
    for (let i = this.traces.length - 1; i >= 0; i--) {
      const trace = this.traces[i];
      
      // Check if this trace is for the target user
      if (trace.user.toLowerCase() !== normalized) {
        continue;
      }
      
      // Check if timestamp is in valid range
      if (trace.ts > beforeTs) {
        // Future trace, skip
        continue;
      }
      
      if (trace.ts < minTs) {
        // Too old, stop searching
        break;
      }
      
      // Found a match
      return trace;
    }
    
    return null;
  }

  /**
   * Clean up expired traces
   */
  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.ttlMs;
    
    // Remove traces older than TTL
    this.traces = this.traces.filter(trace => trace.ts >= cutoff);
  }

  /**
   * Get current size
   */
  size(): number {
    return this.traces.length;
  }

  /**
   * Clear all traces
   */
  clear(): void {
    this.traces = [];
  }

  /**
   * Stop cleanup timer
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}
