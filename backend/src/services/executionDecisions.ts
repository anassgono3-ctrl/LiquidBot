/**
 * Execution Decisions Ring Buffer
 * 
 * Records execution decisions (attempts, skips, reverts) for miss classification.
 * Provides a bounded in-memory store with TTL-based expiration.
 */

export type ExecutionDecisionType = 'attempt' | 'skip' | 'revert';

export interface ExecutionDecision {
  user: string;
  timestamp: number; // ms
  blockNumber: number;
  type: ExecutionDecisionType;
  reason?: string; // Skip reason or revert reason
  debtAsset?: string;
  collateralAsset?: string;
  debtUsd?: number;
  profitEstimateUsd?: number;
  gasPriceGwei?: number;
  txHash?: string; // For attempts and reverts
}

/**
 * ExecutionDecisionsStore maintains a ring buffer of recent execution decisions
 */
export class ExecutionDecisionsStore {
  private decisions: ExecutionDecision[] = [];
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(maxSize = 5000, ttlMs = 300000) { // Default: 5000 entries, 5 min TTL
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    
    // Start periodic cleanup
    this.cleanupTimer = setInterval(() => this.cleanup(), 60000); // Every minute
  }

  /**
   * Record an execution decision
   */
  record(decision: ExecutionDecision): void {
    this.decisions.push(decision);
    
    // Enforce max size (FIFO eviction)
    if (this.decisions.length > this.maxSize) {
      this.decisions.shift();
    }
  }

  /**
   * Find the most recent decision for a user within the TTL window
   * @param user User address
   * @param beforeTimestamp Look for decisions before this timestamp (ms)
   * @returns Most recent decision or null
   */
  findDecision(user: string, beforeTimestamp: number): ExecutionDecision | null {
    const userLower = user.toLowerCase();
    const cutoff = beforeTimestamp - this.ttlMs;
    
    // Search backwards (most recent first)
    for (let i = this.decisions.length - 1; i >= 0; i--) {
      const decision = this.decisions[i];
      
      // Skip if too old
      if (decision.timestamp < cutoff) {
        break; // All older entries will also be too old
      }
      
      // Match user and timestamp
      if (decision.user.toLowerCase() === userLower && decision.timestamp <= beforeTimestamp) {
        return decision;
      }
    }
    
    return null;
  }

  /**
   * Get all decisions for a user within the TTL window
   * @param user User address
   * @param beforeTimestamp Look for decisions before this timestamp (ms)
   * @returns Array of decisions (oldest first)
   */
  findAllDecisions(user: string, beforeTimestamp: number): ExecutionDecision[] {
    const userLower = user.toLowerCase();
    const cutoff = beforeTimestamp - this.ttlMs;
    const results: ExecutionDecision[] = [];
    
    for (const decision of this.decisions) {
      if (decision.timestamp < cutoff) {
        continue;
      }
      
      if (decision.user.toLowerCase() === userLower && decision.timestamp <= beforeTimestamp) {
        results.push(decision);
      }
    }
    
    return results;
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.ttlMs;
    
    // Remove all entries older than TTL
    // Since array is append-only, we can just remove from the start
    while (this.decisions.length > 0 && this.decisions[0].timestamp < cutoff) {
      this.decisions.shift();
    }
  }

  /**
   * Get current size of the store
   */
  size(): number {
    return this.decisions.length;
  }

  /**
   * Clear all decisions
   */
  clear(): void {
    this.decisions = [];
  }

  /**
   * Stop the cleanup timer
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}
