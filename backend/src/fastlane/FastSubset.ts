/**
 * FastSubset: Fast reserve subset micro-verification path
 * 
 * On ReserveDataUpdated events, compute intersection between near-threshold users
 * and borrowers of the affected reserve. Micro-verify the intersection immediately
 * BEFORE scheduling large borrower sweeps to reduce time-to-first-intersection.
 * 
 * This implements Tier 0 Fast Subset logic per the performance upgrade spec.
 */

import type { MicroVerifier, MicroVerifyCandidate } from '../services/MicroVerifier.js';
import { addressSetIntersection, assertIntersectionConsistency } from '../utils/Address.js';
import { config } from '../config/index.js';

export interface FastSubsetOptions {
  maxSubsetSize?: number; // Max users in subset (default from config)
  trigger: 'reserve_fast' | 'price_shock'; // Trigger type for logging
}

export interface FastSubsetResult {
  intersectionSize: number;
  verifiedCount: number;
  durationMs: number;
  skippedEmpty: boolean;
}

/**
 * FastSubset performs priority micro-verification of near-threshold users
 * affected by reserve or price events
 */
export class FastSubset {
  private microVerifier: MicroVerifier;

  constructor(microVerifier: MicroVerifier) {
    this.microVerifier = microVerifier;
  }

  /**
   * Execute fast subset micro-verification for a reserve event
   * 
   * @param reserveAddress - Address of the affected reserve
   * @param nearThresholdSet - Set of near-threshold user addresses
   * @param reserveBorrowers - Set of borrowers for the reserve
   * @param blockNumber - Current block number
   * @param options - Configuration options
   * @returns Result with intersection size and verification stats
   */
  async executeForReserve(
    reserveAddress: string,
    nearThresholdSet: Set<string>,
    reserveBorrowers: Set<string>,
    blockNumber: number,
    options: FastSubsetOptions
  ): Promise<FastSubsetResult> {
    const startTime = Date.now();
    const { trigger } = options;
    const maxSubsetSize = options.maxSubsetSize || config.reserveFastSubsetMax;

    // Compute intersection with normalization
    const intersection = addressSetIntersection(nearThresholdSet, reserveBorrowers);

    // Diagnostic assertion
    assertIntersectionConsistency(
      nearThresholdSet,
      reserveBorrowers,
      intersection,
      `reserve=${reserveAddress} trigger=${trigger}`
    );

    const intersectionSize = intersection.size;

    // Skip if empty intersection
    if (intersectionSize === 0) {
      const durationMs = Date.now() - startTime;
      // eslint-disable-next-line no-console
      console.log(
        `[fast-lane] ${trigger}-intersection reserve=${reserveAddress} size=0 ` +
        `nearThreshold=${nearThresholdSet.size} borrowers=${reserveBorrowers.size} ` +
        `durationMs=${durationMs} skipped=true`
      );
      
      return {
        intersectionSize: 0,
        verifiedCount: 0,
        durationMs,
        skippedEmpty: true
      };
    }

    // Limit to maxSubsetSize
    const usersToVerify = Array.from(intersection).slice(0, maxSubsetSize);

    // eslint-disable-next-line no-console
    console.log(
      `[fast-lane] ${trigger}-intersection reserve=${reserveAddress} size=${intersectionSize} ` +
      `nearThreshold=${nearThresholdSet.size} borrowers=${reserveBorrowers.size} ` +
      `verifying=${usersToVerify.length}`
    );

    // Micro-verify each user (single RPC, no hedge)
    let verifiedCount = 0;
    for (const user of usersToVerify) {
      const candidate: MicroVerifyCandidate = {
        user,
        trigger: trigger === 'reserve_fast' ? 'reserve_fast' : 'price_shock'
      };

      const result = await this.microVerifier.verify(candidate);
      if (result && result.success) {
        verifiedCount++;
        
        // Log micro-verify result
        // eslint-disable-next-line no-console
        console.log(
          `[micro-verify] user=${user} trigger=${trigger} latency=${result.latencyMs}ms ` +
          `hedged=false hf=${result.hf.toFixed(6)} block=${blockNumber}`
        );
      }
    }

    const durationMs = Date.now() - startTime;

    // eslint-disable-next-line no-console
    console.log(
      `[fast-lane] ${trigger}-intersection-complete reserve=${reserveAddress} ` +
      `size=${intersectionSize} verified=${verifiedCount} durationMs=${durationMs}`
    );

    return {
      intersectionSize,
      verifiedCount,
      durationMs,
      skippedEmpty: false
    };
  }

  /**
   * Delay execution to allow fast subset to complete
   * 
   * @param delayMs - Delay in milliseconds (default from config)
   * @returns Promise that resolves after delay
   */
  async delayLargeSweep(delayMs?: number): Promise<void> {
    const delay = delayMs || config.reserveFastSubsetSweepDelayMs;
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
