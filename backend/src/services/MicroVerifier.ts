// MicroVerifier: Immediate single-user HF checks for micro-verification fast path
// Performs individual AavePool.getUserAccountData calls for candidates that:
// - Have projHF < 1.0
// - Are in near-threshold band and worsening
// Enforces per-block caps and interval throttling

import { Contract } from 'ethers';

import { config } from '../config/index.js';
import {
  microVerifyTotal,
  microVerifyLatency
} from '../metrics/index.js';

export interface MicroVerifyCandidate {
  user: string;
  trigger: 'projection_cross' | 'near_threshold' | 'reserve_fast' | 'head_critical' | 'sprinter';
  projectedHf?: number;
  currentHf?: number;
}

export interface MicroVerifyResult {
  user: string;
  hf: number;
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  availableBorrowsBase: bigint;
  currentLiquidationThreshold: bigint;
  ltv: bigint;
  success: boolean;
  trigger: string;
  latencyMs: number;
}

/**
 * MicroVerifier performs immediate single-user HF checks for critical candidates.
 * Integrates with RealTimeHFService to reduce time-to-first sub-1.0 HF read.
 */
export class MicroVerifier {
  private aavePool: Contract;
  private enabled: boolean;
  private maxPerBlock: number;
  private intervalMs: number;
  
  // Per-block tracking
  private currentBlockNumber: number | null = null;
  private verificationsThisBlock = 0;
  private lastVerifyTime = 0;
  
  // De-duplication within block
  private verifiedUsersThisBlock = new Set<string>();

  constructor(aavePool: Contract) {
    this.aavePool = aavePool;
    this.enabled = config.microVerifyEnabled;
    this.maxPerBlock = config.microVerifyMaxPerBlock;
    this.intervalMs = config.microVerifyIntervalMs;
  }

  /**
   * Called when a new block is received to reset per-block counters
   */
  onNewBlock(blockNumber: number): void {
    if (blockNumber !== this.currentBlockNumber) {
      this.currentBlockNumber = blockNumber;
      this.verificationsThisBlock = 0;
      this.verifiedUsersThisBlock.clear();
    }
  }

  /**
   * Check if micro-verification is available for a new candidate
   */
  canVerify(user: string): boolean {
    if (!this.enabled) return false;
    
    // Check per-block cap
    if (this.verificationsThisBlock >= this.maxPerBlock) {
      return false;
    }
    
    // Check interval throttling
    const now = Date.now();
    if (now - this.lastVerifyTime < this.intervalMs) {
      return false;
    }
    
    // Check de-duplication
    if (this.verifiedUsersThisBlock.has(user)) {
      return false;
    }
    
    return true;
  }

  /**
   * Perform immediate single-user HF verification
   */
  async verify(candidate: MicroVerifyCandidate): Promise<MicroVerifyResult | null> {
    const { user, trigger } = candidate;
    
    // Check if verification is allowed
    if (!this.canVerify(user)) {
      // Increment cap metric
      if (this.verificationsThisBlock >= this.maxPerBlock) {
        microVerifyTotal.labels({ result: 'cap', trigger }).inc();
      }
      return null;
    }
    
    const startTime = Date.now();
    
    try {
      // Single getUserAccountData call
      const result = await this.aavePool.getUserAccountData(user);
      
      const latencyMs = Date.now() - startTime;
      
      // Parse result
      const [
        totalCollateralBase,
        totalDebtBase,
        availableBorrowsBase,
        currentLiquidationThreshold,
        ltv,
        healthFactor
      ] = result;
      
      // Convert healthFactor from wei (1e18) to float
      const hf = Number(healthFactor) / 1e18;
      
      // Update tracking
      this.verificationsThisBlock++;
      this.verifiedUsersThisBlock.add(user);
      this.lastVerifyTime = Date.now();
      
      // Record metrics
      const resultLabel = hf < 1.0 ? 'hit' : 'miss';
      microVerifyTotal.labels({ result: resultLabel, trigger }).inc();
      microVerifyLatency.observe(latencyMs);
      
      return {
        user,
        hf,
        totalCollateralBase,
        totalDebtBase,
        availableBorrowsBase,
        currentLiquidationThreshold,
        ltv,
        success: true,
        trigger,
        latencyMs
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      
      // Record error metric
      microVerifyTotal.labels({ result: 'error', trigger }).inc();
      
      // eslint-disable-next-line no-console
      console.error(
        `[realtime-hf] micro-verify error user=${user} trigger=${trigger}`,
        error instanceof Error ? error.message : String(error)
      );
      
      return {
        user,
        hf: Number.MAX_VALUE, // Safe default on error
        totalCollateralBase: 0n,
        totalDebtBase: 0n,
        availableBorrowsBase: 0n,
        currentLiquidationThreshold: 0n,
        ltv: 0n,
        success: false,
        trigger,
        latencyMs
      };
    }
  }

  /**
   * Batch micro-verify multiple candidates (sequential to respect interval)
   */
  async verifyBatch(candidates: MicroVerifyCandidate[]): Promise<MicroVerifyResult[]> {
    const results: MicroVerifyResult[] = [];
    
    for (const candidate of candidates) {
      const result = await this.verify(candidate);
      if (result) {
        results.push(result);
      }
    }
    
    return results;
  }

  /**
   * Get current verification stats for logging
   */
  getStats() {
    return {
      enabled: this.enabled,
      verificationsThisBlock: this.verificationsThisBlock,
      maxPerBlock: this.maxPerBlock,
      intervalMs: this.intervalMs,
      currentBlock: this.currentBlockNumber
    };
  }
}
