/**
 * ReversionBudget: Safety mechanism to track and limit optimistic execution reverts
 * 
 * Tracks daily revert count for optimistic path and enforces budget limit.
 * Resets at UTC midnight.
 */

import { optimisticConfig } from './config.js';
import { optimisticRevertBudgetRemaining } from '../../metrics/index.js';

export class ReversionBudget {
  private revertCount: number = 0;
  private lastResetDate: string;
  private maxReverts: number;

  constructor(maxReverts: number = optimisticConfig.maxReverts) {
    this.maxReverts = maxReverts;
    this.lastResetDate = this.getCurrentDateUTC();
    this.updateMetric();
  }

  /**
   * Get current UTC date string (YYYY-MM-DD)
   */
  private getCurrentDateUTC(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  /**
   * Check if budget needs reset (new day)
   */
  private checkAndResetIfNeeded(): void {
    const currentDate = this.getCurrentDateUTC();
    if (currentDate !== this.lastResetDate) {
      this.revertCount = 0;
      this.lastResetDate = currentDate;
      this.updateMetric();
    }
  }

  /**
   * Update Prometheus metric
   */
  private updateMetric(): void {
    optimisticRevertBudgetRemaining.set(Math.max(0, this.maxReverts - this.revertCount));
  }

  /**
   * Check if optimistic execution is allowed (budget not exceeded)
   */
  canExecuteOptimistic(): boolean {
    this.checkAndResetIfNeeded();
    return this.revertCount < this.maxReverts;
  }

  /**
   * Record a revert
   */
  recordRevert(): void {
    this.checkAndResetIfNeeded();
    this.revertCount++;
    this.updateMetric();
  }

  /**
   * Get current revert count
   */
  getRevertCount(): number {
    this.checkAndResetIfNeeded();
    return this.revertCount;
  }

  /**
   * Get remaining budget
   */
  getRemainingBudget(): number {
    this.checkAndResetIfNeeded();
    return Math.max(0, this.maxReverts - this.revertCount);
  }

  /**
   * Reset budget (for testing)
   */
  reset(): void {
    this.revertCount = 0;
    this.lastResetDate = this.getCurrentDateUTC();
    this.updateMetric();
  }
}

// Singleton instance
export const reversionBudget = new ReversionBudget();
