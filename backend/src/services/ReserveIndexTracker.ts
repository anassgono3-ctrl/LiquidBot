/**
 * ReserveIndexTracker: Track reserve indices (liquidityIndex, variableBorrowIndex) 
 * and calculate basis point deltas for reserve recheck optimization
 * 
 * Purpose: Skip wide reserve rechecks when index changes are below RESERVE_MIN_INDEX_DELTA_BPS
 * Reduces RPC volume from ~$1/15min by avoiding redundant sweeps on tiny parameter updates
 */

import { config } from '../config/index.js';
import { reserveRecheckSkippedSmallDeltaTotal } from '../metrics/index.js';

export interface ReserveIndices {
  liquidityIndex: bigint;
  variableBorrowIndex: bigint;
  timestamp: number;
  blockNumber: number;
}

export interface IndexDelta {
  liquidityIndexDeltaBps: number;
  variableBorrowIndexDeltaBps: number;
  maxDeltaBps: number;
  shouldRecheck: boolean;
  reason?: string;
}

/**
 * ReserveIndexTracker maintains historical reserve indices and computes deltas
 */
export class ReserveIndexTracker {
  private readonly minIndexDeltaBps: number;
  private readonly reserveIndices: Map<string, ReserveIndices> = new Map();
  
  constructor(minIndexDeltaBps?: number) {
    this.minIndexDeltaBps = minIndexDeltaBps ?? config.reserveMinIndexDeltaBps ?? 2; // 0.02%
    
    console.log(
      `[reserve-index-tracker] Initialized with minIndexDeltaBps=${this.minIndexDeltaBps}`
    );
  }

  /**
   * Update reserve indices from ReserveDataUpdated event
   */
  public updateIndices(
    reserve: string,
    liquidityIndex: bigint,
    variableBorrowIndex: bigint,
    blockNumber: number
  ): void {
    const reserveLower = reserve.toLowerCase();
    
    this.reserveIndices.set(reserveLower, {
      liquidityIndex,
      variableBorrowIndex,
      timestamp: Date.now(),
      blockNumber
    });
  }

  /**
   * Calculate index delta in basis points and determine if recheck is needed
   * 
   * Returns true if:
   * - No previous indices (first update for this reserve)
   * - Either liquidityIndex or variableBorrowIndex delta >= minIndexDeltaBps
   * 
   * Returns false (skip recheck) if:
   * - Both deltas < minIndexDeltaBps
   */
  public calculateDelta(
    reserve: string,
    newLiquidityIndex: bigint,
    newVariableBorrowIndex: bigint,
    asset: string = 'unknown'
  ): IndexDelta {
    const reserveLower = reserve.toLowerCase();
    const prevIndices = this.reserveIndices.get(reserveLower);
    
    // No previous data - always recheck on first update
    if (!prevIndices) {
      return {
        liquidityIndexDeltaBps: 0,
        variableBorrowIndexDeltaBps: 0,
        maxDeltaBps: 0,
        shouldRecheck: true,
        reason: 'first_update'
      };
    }
    
    // Calculate basis point deltas
    const liquidityIndexDeltaBps = this.calculateBpsDelta(
      prevIndices.liquidityIndex,
      newLiquidityIndex
    );
    
    const variableBorrowIndexDeltaBps = this.calculateBpsDelta(
      prevIndices.variableBorrowIndex,
      newVariableBorrowIndex
    );
    
    const maxDeltaBps = Math.max(liquidityIndexDeltaBps, variableBorrowIndexDeltaBps);
    
    // Determine if recheck is needed based on threshold
    const shouldRecheck = maxDeltaBps >= this.minIndexDeltaBps;
    
    // Log and emit metric if skipping
    if (!shouldRecheck) {
      console.log(
        `[reserve-index-skip] reserve=${reserve.slice(0, 10)} asset=${asset} ` +
        `liquidityDelta=${liquidityIndexDeltaBps.toFixed(2)}bps ` +
        `variableBorrowDelta=${variableBorrowIndexDeltaBps.toFixed(2)}bps ` +
        `maxDelta=${maxDeltaBps.toFixed(2)}bps < threshold=${this.minIndexDeltaBps}bps`
      );
      
      // Emit metric for skipped rechecks
      if (liquidityIndexDeltaBps > 0) {
        reserveRecheckSkippedSmallDeltaTotal.inc({
          asset,
          indexType: 'liquidity'
        });
      }
      if (variableBorrowIndexDeltaBps > 0) {
        reserveRecheckSkippedSmallDeltaTotal.inc({
          asset,
          indexType: 'variableBorrow'
        });
      }
    }
    
    return {
      liquidityIndexDeltaBps,
      variableBorrowIndexDeltaBps,
      maxDeltaBps,
      shouldRecheck,
      reason: shouldRecheck ? 'delta_above_threshold' : 'delta_below_threshold'
    };
  }

  /**
   * Calculate basis point delta between two index values
   * Formula: ((newIndex - oldIndex) / oldIndex) * 10000
   * 
   * Uses BigInt arithmetic for precision, converts only final result to number
   * Max safe BigInt for Number conversion: 2^53-1 (~9e15)
   * Aave indices are typically ~1e27, so delta bps will be well within safe range
   */
  private calculateBpsDelta(oldIndex: bigint, newIndex: bigint): number {
    if (oldIndex === 0n) return 0;
    
    // Calculate delta in basis points using BigInt arithmetic for precision
    // deltaBps = ((newIndex - oldIndex) * 10000) / oldIndex
    const deltaBigInt = ((newIndex - oldIndex) * 10000n) / oldIndex;
    
    // Sanity check: bps deltas should be small (< 10000 = 100%)
    // If delta exceeds this, likely indicates data corruption or extreme market event
    const MAX_SAFE_DELTA_BPS = 100000n; // 1000% - extreme upper bound
    if (deltaBigInt > MAX_SAFE_DELTA_BPS || deltaBigInt < -MAX_SAFE_DELTA_BPS) {
      console.warn(
        `[reserve-index] Extreme delta detected: ${deltaBigInt}bps. Capping to max safe value.`
      );
      return deltaBigInt > 0n ? Number(MAX_SAFE_DELTA_BPS) : -Number(MAX_SAFE_DELTA_BPS);
    }
    
    // Convert to number only for the final result (bps is typically small)
    // This preserves precision since bps deltas are usually < 1000 (10%)
    return Math.abs(Number(deltaBigInt));
  }

  /**
   * Get current indices for a reserve
   */
  public getIndices(reserve: string): ReserveIndices | undefined {
    return this.reserveIndices.get(reserve.toLowerCase());
  }

  /**
   * Clear all tracked indices (for testing)
   */
  public clear(): void {
    this.reserveIndices.clear();
  }

  /**
   * Get stats about tracked reserves
   */
  public getStats() {
    return {
      trackedReserves: this.reserveIndices.size,
      minIndexDeltaBps: this.minIndexDeltaBps
    };
  }
}
