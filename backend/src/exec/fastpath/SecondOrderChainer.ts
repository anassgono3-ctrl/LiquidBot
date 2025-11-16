/**
 * SecondOrderChainer: Second-order liquidation chaining
 * 
 * On detection of competitor liquidation event, re-evaluates affected user
 * plus collateral borrowers whose HF moved into liquidatable range.
 */

import { secondOrderConfig } from './config.js';
import { secondOrderChainTotal } from '../../metrics/index.js';

export interface ChainedCandidate {
  user: string;
  reason: 'affected_user' | 'collateral_borrower';
  healthFactor?: number;
  queuedAt: number;
}

export class SecondOrderChainer {
  private enabled: boolean;
  private chainQueue: ChainedCandidate[] = [];
  private processedUsers: Set<string> = new Set();
  private hfThreshold = 1.03; // HF threshold for second-order candidates

  constructor(enabled: boolean = secondOrderConfig.enabled) {
    this.enabled = enabled;
  }

  /**
   * Handle competitor liquidation event
   * 
   * @param liquidatedUser Address of user who was liquidated
   * @param collateralAsset Address of collateral asset seized
   * @param debtAsset Address of debt asset repaid
   * @param collateralBorrowers Set of users who have borrowed collateral asset
   */
  onCompetitorLiquidation(
    liquidatedUser: string,
    collateralAsset: string,
    debtAsset: string,
    collateralBorrowers: Set<string> = new Set()
  ): ChainedCandidate[] {
    if (!this.enabled) {
      secondOrderChainTotal.inc({ result: 'skipped' });
      return [];
    }

    const candidates: ChainedCandidate[] = [];

    // Always re-evaluate the liquidated user
    if (!this.processedUsers.has(liquidatedUser.toLowerCase())) {
      candidates.push({
        user: liquidatedUser,
        reason: 'affected_user',
        queuedAt: Date.now()
      });
      this.processedUsers.add(liquidatedUser.toLowerCase());
    }

    // Queue collateral borrowers for evaluation
    for (const borrower of collateralBorrowers) {
      const borrowerLower = borrower.toLowerCase();
      if (borrowerLower !== liquidatedUser.toLowerCase() && !this.processedUsers.has(borrowerLower)) {
        candidates.push({
          user: borrower,
          reason: 'collateral_borrower',
          queuedAt: Date.now()
        });
        this.processedUsers.add(borrowerLower);
      }
    }

    // Add to internal queue
    this.chainQueue.push(...candidates);

    if (candidates.length > 0) {
      secondOrderChainTotal.inc({ result: 'queued', count: candidates.length } as any);
    }

    return candidates;
  }

  /**
   * Filter candidates by health factor threshold
   * Only keep candidates with HF < threshold
   */
  filterByHealthFactor(
    candidates: ChainedCandidate[],
    healthFactors: Map<string, number>
  ): ChainedCandidate[] {
    const filtered = candidates.filter(candidate => {
      const hf = healthFactors.get(candidate.user.toLowerCase());
      if (hf !== undefined) {
        candidate.healthFactor = hf;
        return hf < this.hfThreshold;
      }
      return false;
    });

    return filtered;
  }

  /**
   * Dequeue next candidate for execution
   */
  dequeue(): ChainedCandidate | undefined {
    return this.chainQueue.shift();
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.chainQueue.size;
  }

  /**
   * Get all queued candidates
   */
  getQueue(): ChainedCandidate[] {
    return [...this.chainQueue];
  }

  /**
   * Mark candidate as executed
   */
  markExecuted(user: string): void {
    secondOrderChainTotal.inc({ result: 'executed' });
  }

  /**
   * Clear processed users set (for new liquidation cycle)
   */
  clearProcessed(): void {
    this.processedUsers.clear();
  }

  /**
   * Clear queue
   */
  clearQueue(): void {
    this.chainQueue = [];
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.chainQueue = [];
    this.processedUsers.clear();
  }

  /**
   * Check if chaining is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Set HF threshold for second-order candidates
   */
  setHfThreshold(threshold: number): void {
    this.hfThreshold = threshold;
  }
}

// Singleton instance
export const secondOrderChainer = new SecondOrderChainer();
