/**
 * OptimisticExecutor: Optimistic dispatch for liquidations
 * 
 * Implements immediate execution when cached HF is sufficiently below 1.0,
 * skipping synchronous pre-flight HF recheck. Performs async verification after sending.
 */

import { optimisticConfig } from './config.js';
import { reversionBudget } from './ReversionBudget.js';
import type { OptimisticResult } from './types.js';
import {
  optimisticExecTotal,
  optimisticLatencyMs
} from '../../metrics/index.js';

export class OptimisticExecutor {
  private enabled: boolean;
  private epsilonBps: number;

  constructor(
    enabled: boolean = optimisticConfig.enabled,
    epsilonBps: number = optimisticConfig.epsilonBps
  ) {
    this.enabled = enabled;
    this.epsilonBps = epsilonBps;
  }

  /**
   * Check if optimistic execution should be used for given health factor
   * 
   * @param healthFactor Current health factor as a number (e.g., 0.998)
   * @returns true if optimistic execution should proceed
   */
  shouldExecuteOptimistic(healthFactor: number): OptimisticResult {
    const startTime = Date.now();

    // Feature disabled
    if (!this.enabled) {
      return {
        executed: false,
        reason: 'borderline_hf'
      };
    }

    // Check reversion budget
    if (!reversionBudget.canExecuteOptimistic()) {
      optimisticExecTotal.inc({ result: 'skipped' });
      return {
        executed: false,
        reason: 'budget_exceeded',
        latencyMs: Date.now() - startTime
      };
    }

    // Calculate epsilon threshold: 1.0 - (epsilonBps / 10000)
    const epsilonThreshold = 1.0 - (this.epsilonBps / 10000);

    // Health factor must be below epsilon threshold for optimistic path
    if (healthFactor < epsilonThreshold) {
      const latency = Date.now() - startTime;
      optimisticLatencyMs.observe(latency);
      return {
        executed: true,
        reason: 'epsilon_threshold',
        latencyMs: latency
      };
    }

    // Borderline HF - use normal path with recheck
    return {
      executed: false,
      reason: 'borderline_hf',
      latencyMs: Date.now() - startTime
    };
  }

  /**
   * Record successful optimistic execution
   */
  recordSuccess(txHash: string): void {
    optimisticExecTotal.inc({ result: 'sent' });
  }

  /**
   * Record optimistic execution that reverted
   */
  recordRevert(): void {
    optimisticExecTotal.inc({ result: 'reverted' });
    reversionBudget.recordRevert();
  }

  /**
   * Async verification after optimistic send (for post-execution checks)
   * This can be called after the transaction is broadcast to verify it was correct
   */
  async verifyPostExecution(
    txHash: string,
    verifyFn: () => Promise<boolean>
  ): Promise<boolean> {
    try {
      const isValid = await verifyFn();
      if (!isValid) {
        this.recordRevert();
      }
      return isValid;
    } catch (error) {
      // Verification error doesn't count as revert
      return false;
    }
  }

  /**
   * Check if optimistic execution is currently enabled
   */
  isEnabled(): boolean {
    return this.enabled && reversionBudget.canExecuteOptimistic();
  }

  /**
   * Get current epsilon threshold
   */
  getEpsilonThreshold(): number {
    return 1.0 - (this.epsilonBps / 10000);
  }
}

// Singleton instance
export const optimisticExecutor = new OptimisticExecutor();
