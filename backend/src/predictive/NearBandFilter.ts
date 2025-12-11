/**
 * NearBandFilter: Filter users by proximity to liquidation threshold
 * 
 * Purpose: Reduce breadth of checks by focusing on users near HF=1.0
 * Uses NEAR_BAND_BPS and MIN_DEBT_USD gates to skip far-from-liquidation users
 * 
 * Filter criteria:
 * - HF in [1.0, 1.0 + NEAR_BAND_BPS/10000] OR
 * - HF < 1.0 + buffer and projected within HF_PRED_CRITICAL
 * - debtUsd >= MIN_DEBT_USD
 */

import { config } from '../config/index.js';

export interface UserSnapshot {
  user: string;
  hf: number;
  debtUsd?: number;
  projectedHf?: number;
}

export interface NearBandFilterConfig {
  nearBandBps: number;
  minDebtUsd: number;
  hfPredCritical: number;
}

export interface NearBandFilterResult {
  kept: UserSnapshot[];
  skipped: number;
  hfRange: { min: number; max: number };
}

/**
 * NearBandFilter filters user snapshots to those near liquidation threshold
 */
export class NearBandFilter {
  private readonly config: NearBandFilterConfig;

  constructor(configOverride?: Partial<NearBandFilterConfig>) {
    this.config = {
      nearBandBps: configOverride?.nearBandBps ?? config.nearBandBps ?? 30,
      minDebtUsd: configOverride?.minDebtUsd ?? config.minDebtUsd ?? 1,
      hfPredCritical: configOverride?.hfPredCritical ?? config.hfPredCritical ?? 1.0008
    };

    console.log(
      `[near-band] Initialized: nearBandBps=${this.config.nearBandBps}, ` +
      `minDebtUsd=${this.config.minDebtUsd}, hfPredCritical=${this.config.hfPredCritical}`
    );
  }

  /**
   * Check if a user snapshot should be checked based on near-band criteria
   */
  public shouldCheck(snapshot: UserSnapshot): boolean {
    const { hf, debtUsd, projectedHf } = snapshot;

    // Debt gate: skip users below minimum debt threshold
    if (debtUsd !== undefined && debtUsd < this.config.minDebtUsd) {
      return false;
    }

    // Calculate near-band threshold
    const nearBandThreshold = 1.0 + this.config.nearBandBps / 10000;

    // Near-band check: HF in [1.0, nearBandThreshold]
    if (hf >= 1.0 && hf <= nearBandThreshold) {
      return true;
    }

    // Already liquidatable: always check
    if (hf < 1.0) {
      return true;
    }

    // Projected HF check: if projected HF crosses critical threshold
    if (projectedHf !== undefined && projectedHf <= this.config.hfPredCritical) {
      return true;
    }

    // Otherwise, skip (too far from liquidation)
    return false;
  }

  /**
   * Filter a batch of user snapshots
   * Returns kept snapshots, skipped count, and HF range
   */
  public filter(snapshots: UserSnapshot[]): NearBandFilterResult {
    const kept: UserSnapshot[] = [];
    let skipped = 0;
    let minHf = Number.MAX_VALUE;
    let maxHf = 0;

    for (const snapshot of snapshots) {
      if (this.shouldCheck(snapshot)) {
        kept.push(snapshot);
        minHf = Math.min(minHf, snapshot.hf);
        maxHf = Math.max(maxHf, snapshot.hf);
      } else {
        skipped++;
      }
    }

    // Log filter results
    if (kept.length > 0 || skipped > 0) {
      console.log(
        `[near-band] reserved-filter kept=${kept.length} skipped=${skipped} ` +
        `hf_range=[${minHf === Number.MAX_VALUE ? 'N/A' : minHf.toFixed(4)}, ${maxHf === 0 ? 'N/A' : maxHf.toFixed(4)}]`
      );
    }

    return {
      kept,
      skipped,
      hfRange: {
        min: minHf === Number.MAX_VALUE ? 0 : minHf,
        max: maxHf
      }
    };
  }

  /**
   * Get current configuration
   */
  public getConfig(): NearBandFilterConfig {
    return { ...this.config };
  }
}
