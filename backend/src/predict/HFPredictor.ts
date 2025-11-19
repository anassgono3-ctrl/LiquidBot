/**
 * HFPredictor: Index jump prediction for health factor changes
 * 
 * Tracks previous variableBorrowIndex and liquidityIndex per reserve.
 * On ReserveDataUpdated events, computes basis point delta and predicts
 * HF impact using new indices (math-only, no RPC).
 * 
 * This implements Tier 1 Index Jump Prediction logic per the performance upgrade spec.
 */

import { config } from '../config/index.js';

export interface ReserveIndices {
  variableBorrowIndex: bigint;
  liquidityIndex: bigint;
}

export interface IndexJumpResult {
  reserveAddress: string;
  userAddress: string;
  predictedHf: number;
  deltaBps: number;
  indexType: 'borrow' | 'liquidity' | 'both';
}

/**
 * HFPredictor tracks reserve indices and predicts HF changes from index jumps
 */
export class HFPredictor {
  // Track previous indices per reserve (lowercase normalized)
  private previousIndices = new Map<string, ReserveIndices>();

  /**
   * Update reserve indices and detect jumps
   * 
   * @param reserveAddress - Address of the reserve
   * @param newIndices - New index values
   * @returns Delta in basis points (null if first observation)
   */
  updateIndices(
    reserveAddress: string,
    newIndices: ReserveIndices
  ): { borrowDeltaBps: number; liquidityDeltaBps: number } | null {
    const normalized = reserveAddress.toLowerCase();
    const previous = this.previousIndices.get(normalized);

    if (!previous) {
      // First observation - store and return null
      this.previousIndices.set(normalized, { ...newIndices });
      return null;
    }

    // Calculate basis point deltas
    const borrowDeltaBps = this.calculateBpsDelta(
      previous.variableBorrowIndex,
      newIndices.variableBorrowIndex
    );

    const liquidityDeltaBps = this.calculateBpsDelta(
      previous.liquidityIndex,
      newIndices.liquidityIndex
    );

    // Update stored indices
    this.previousIndices.set(normalized, { ...newIndices });

    return { borrowDeltaBps, liquidityDeltaBps };
  }

  /**
   * Calculate basis point delta between two index values
   */
  private calculateBpsDelta(oldIndex: bigint, newIndex: bigint): number {
    if (oldIndex === 0n) return 0;
    
    // Convert to number for calculation (indices are typically in 1e27 range)
    const oldNum = Number(oldIndex);
    const newNum = Number(newIndex);
    
    const delta = ((newNum - oldNum) / oldNum) * 10000; // basis points
    return delta;
  }

  /**
   * Check if index jump exceeds threshold
   * 
   * @param deltaBps - Delta in basis points
   * @returns true if delta exceeds threshold
   */
  isJumpSignificant(deltaBps: number): boolean {
    return Math.abs(deltaBps) >= config.indexJumpBpsTrigger;
  }

  /**
   * Predict HF change for a user based on index jump
   * This is a simplified prediction - actual implementation would need
   * user's detailed position data (collateral, debt, LTV, etc.)
   * 
   * For now, we return a conservative estimate that flags users
   * who should be micro-verified.
   * 
   * @param userAddress - User address
   * @param currentHf - Current health factor
   * @param borrowDeltaBps - Borrow index delta in bps
   * @param liquidityDeltaBps - Liquidity index delta in bps
   * @returns Predicted health factor (null if prediction not applicable)
   */
  predictHfChange(
    userAddress: string,
    currentHf: number,
    borrowDeltaBps: number,
    liquidityDeltaBps: number
  ): number | null {
    // If user is already critical, return current HF
    if (currentHf < 1.0) return currentHf;

    // Simple model: borrow index increase worsens HF, liquidity index increase improves it
    // This is a rough approximation - real calculation requires full position data
    const netDeltaBps = borrowDeltaBps - liquidityDeltaBps;
    
    // Convert bps to HF impact (very rough estimate)
    // Assume 100 bps index change ≈ 0.001 HF change for near-threshold users
    const hfImpact = (netDeltaBps / 100) * 0.001;
    
    const predictedHf = currentHf - hfImpact;
    
    return predictedHf;
  }

  /**
   * Check if predicted HF is critical and warrants micro-verification
   * 
   * @param predictedHf - Predicted health factor
   * @returns true if HF is below critical threshold
   */
  isPredictedCritical(predictedHf: number | null): boolean {
    if (predictedHf === null) return false;
    return predictedHf < config.hfPredCritical;
  }

  /**
   * Get index jump details for a reserve
   * 
   * @param reserveAddress - Reserve address
   * @returns Previous indices or null if not tracked
   */
  getPreviousIndices(reserveAddress: string): ReserveIndices | null {
    const normalized = reserveAddress.toLowerCase();
    return this.previousIndices.get(normalized) || null;
  }

  /**
   * Clear stored indices (for testing or reset)
   */
  clear(): void {
    this.previousIndices.clear();
  }

  /**
   * Get number of tracked reserves
   */
  getTrackedReserveCount(): number {
    return this.previousIndices.size;
  }
}
