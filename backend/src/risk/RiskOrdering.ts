/**
 * RiskOrdering: Enhanced risk-based ordering for near-threshold candidates
 * 
 * Implements a simple scoring function for prioritizing liquidation candidates:
 * score = w1*(1.0015 - hf) + w2*(hf - projHF) + w3*log10(debtUSD)
 * 
 * Higher scores indicate higher priority (more urgent liquidation candidates).
 * 
 * This implements Tier 1 Risk Ordering Enhancement per the performance upgrade spec.
 */

import { config } from '../config/index.js';

export interface RiskCandidate {
  address: string;
  hf: number;
  projectedHf?: number;
  totalDebtUsd: number;
}

export interface ScoredCandidate extends RiskCandidate {
  score: number;
}

/**
 * Default scoring weights (can be overridden)
 */
export const DEFAULT_WEIGHTS = {
  w1: 100.0,  // Weight for HF proximity to liquidation threshold
  w2: 50.0,   // Weight for HF deterioration (current vs projected)
  w3: 5.0     // Weight for debt size (log scale)
};

/**
 * RiskOrdering provides risk-based scoring and ordering for liquidation candidates
 */
export class RiskOrdering {
  private weights = { ...DEFAULT_WEIGHTS };
  private enabled: boolean;

  constructor(weights?: Partial<typeof DEFAULT_WEIGHTS>) {
    this.enabled = config.riskOrderingSimple;
    
    if (weights) {
      this.weights = { ...DEFAULT_WEIGHTS, ...weights };
    }
  }

  /**
   * Calculate risk score for a candidate
   * 
   * @param candidate - Candidate with HF, projected HF, and debt
   * @returns Risk score (higher = more urgent)
   */
  calculateScore(candidate: RiskCandidate): number {
    if (!this.enabled) {
      // If disabled, return simple HF-based score
      return 1.0015 - candidate.hf;
    }

    const { hf, projectedHf, totalDebtUsd } = candidate;
    const { w1, w2, w3 } = this.weights;

    // Component 1: HF proximity to liquidation threshold (1.0015)
    // Higher score when HF is closer to liquidation
    const hfProximity = Math.max(0, 1.0015 - hf);

    // Component 2: HF deterioration (current vs projected)
    // Higher score when HF is worsening
    const hfDelta = projectedHf !== undefined 
      ? Math.max(0, hf - projectedHf)
      : 0;

    // Component 3: Debt size (log scale to avoid dominating)
    // Higher score for larger liquidations (more profitable)
    const debtComponent = totalDebtUsd > 0 
      ? Math.log10(Math.max(1, totalDebtUsd))
      : 0;

    // Combined score
    const score = (w1 * hfProximity) + (w2 * hfDelta) + (w3 * debtComponent);

    return score;
  }

  /**
   * Score and sort a list of candidates by risk priority
   * 
   * @param candidates - List of candidates to score
   * @returns Sorted list of scored candidates (highest score first)
   */
  scoreAndSort(candidates: RiskCandidate[]): ScoredCandidate[] {
    const scored = candidates.map(candidate => ({
      ...candidate,
      score: this.calculateScore(candidate)
    }));

    // Sort by score descending (highest risk first)
    scored.sort((a, b) => b.score - a.score);

    return scored;
  }

  /**
   * Log scoring details for a candidate
   * 
   * @param candidate - Candidate to log
   * @param blockNumber - Optional block number for context
   */
  logScore(candidate: ScoredCandidate, blockNumber?: number): void {
    const blockStr = blockNumber !== undefined ? ` block=${blockNumber}` : '';
    
    // eslint-disable-next-line no-console
    console.log(
      `[risk-order] user=${candidate.address} score=${candidate.score.toFixed(4)} ` +
      `hf=${candidate.hf.toFixed(6)} projHf=${candidate.projectedHf?.toFixed(6) || 'N/A'} ` +
      `debtUsd=${candidate.totalDebtUsd.toFixed(2)}${blockStr}`
    );
  }

  /**
   * Enable or disable risk ordering
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if risk ordering is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Update scoring weights
   */
  setWeights(weights: Partial<typeof DEFAULT_WEIGHTS>): void {
    this.weights = { ...this.weights, ...weights };
  }

  /**
   * Get current weights
   */
  getWeights(): typeof DEFAULT_WEIGHTS {
    return { ...this.weights };
  }
}
