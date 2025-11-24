/**
 * Sprinter Pre-Staging Engine
 * 
 * High-priority execution path that pre-stages liquidation data to minimize latency.
 * 
 * Flow:
 * 1. Each block, identify near-threshold accounts (HF < PRESTAGE_HF_BPS)
 * 2. Forecast next-block HF using interest accrual and cached prices
 * 3. For accounts with projected HF < threshold + epsilon, create PreStagedCandidate
 * 4. Maintain pre-staged candidates with stale eviction
 * 
 * On price/log event:
 * 1. Collect pre-staged candidates for affected users
 * 2. Run micro-multicall to verify fresh HF
 * 3. Execute if HF < threshold
 */

import { ethers } from 'ethers';

import type { TemplateCache, CalldataTemplate } from './TemplateCache.js';

export interface PreStagedCandidate {
  // User identity
  user: string;
  
  // Asset pair
  debtToken: string;
  collateralToken: string;
  
  // Amounts (wei)
  debtWei: bigint;
  collateralWei: bigint;
  
  // Health factor
  projectedHF: number;
  
  // Repay estimate
  repayWeiEstimate: bigint;
  
  // Calldata template reference
  templateBuffer: Buffer;
  templateRepayOffset: number;
  
  // Metadata
  preparedBlock: number;
  preparedTimestamp: number;
}

export interface SprinterEngineConfig {
  // Pre-staging HF threshold (BPS, e.g., 10200 = 1.02)
  prestageHfBps: number;
  
  // Execution HF threshold (BPS, e.g., 9800 = 0.98)
  executionHfThresholdBps: number;
  
  // Optimistic epsilon (BPS, e.g., 20 = 0.20%)
  optimisticEpsilonBps: number;
  
  // Maximum pre-staged candidates
  maxPrestaged: number;
  
  // Stale blocks threshold
  staleBlocks: number;
  
  // Micro-verification batch size
  verifyBatch: number;
  
  // Close factor mode
  closeFactorMode: string;
  
  // Minimum debt USD threshold
  minDebtUsd: number;
}

/**
 * SprinterEngine manages pre-staged liquidation candidates
 */
export class SprinterEngine {
  private candidates: Map<string, PreStagedCandidate> = new Map();
  private config: SprinterEngineConfig;
  private templateCache: TemplateCache;

  constructor(config: SprinterEngineConfig, templateCache: TemplateCache) {
    this.config = config;
    this.templateCache = templateCache;

    // eslint-disable-next-line no-console
    console.log(
      `[sprinter-engine] Initialized: prestageHF=${config.prestageHfBps / 100}bps, ` +
      `executionHF=${config.executionHfThresholdBps / 100}bps, ` +
      `maxPrestaged=${config.maxPrestaged}, staleBlocks=${config.staleBlocks}`
    );
  }

  /**
   * Pre-stage a candidate for fast execution
   */
  prestage(
    user: string,
    debtToken: string,
    collateralToken: string,
    debtWei: bigint,
    collateralWei: bigint,
    projectedHF: number,
    currentBlock: number,
    debtPriceUsd: number
  ): boolean {
    const normalized = user.toLowerCase();
    
    // Check if candidate qualifies for pre-staging
    const prestageThreshold = this.config.prestageHfBps / 10000;
    if (projectedHF > prestageThreshold) {
      return false;
    }

    // Check minimum debt USD threshold
    const debtUsd = Number(ethers.formatEther(debtWei)) * debtPriceUsd;
    if (debtUsd < this.config.minDebtUsd) {
      return false;
    }

    // Enforce max pre-staged limit
    if (this.candidates.size >= this.config.maxPrestaged && !this.candidates.has(normalized)) {
      this.evictLowestPriority();
    }

    // Get or create calldata template
    const template = this.templateCache.getTemplate(debtToken, collateralToken, currentBlock);

    // Estimate repay amount based on close factor
    const repayWeiEstimate = this.estimateRepayAmount(debtWei, projectedHF);

    // Create pre-staged candidate
    const candidate: PreStagedCandidate = {
      user: normalized,
      debtToken: debtToken.toLowerCase(),
      collateralToken: collateralToken.toLowerCase(),
      debtWei,
      collateralWei,
      projectedHF,
      repayWeiEstimate,
      templateBuffer: template.buffer,
      templateRepayOffset: template.repayOffset,
      preparedBlock: currentBlock,
      preparedTimestamp: Date.now()
    };

    this.candidates.set(normalized, candidate);
    return true;
  }

  /**
   * Get pre-staged candidate for a user
   */
  getCandidate(user: string): PreStagedCandidate | undefined {
    return this.candidates.get(user.toLowerCase());
  }

  /**
   * Get all pre-staged candidates
   */
  getAllCandidates(): PreStagedCandidate[] {
    return Array.from(this.candidates.values());
  }

  /**
   * Get candidates for a specific reserve (debt token)
   */
  getCandidatesForReserve(debtToken: string): PreStagedCandidate[] {
    const normalized = debtToken.toLowerCase();
    return Array.from(this.candidates.values()).filter(
      c => c.debtToken === normalized
    );
  }

  /**
   * Remove a candidate (after execution or invalidation)
   */
  remove(user: string): boolean {
    return this.candidates.delete(user.toLowerCase());
  }

  /**
   * Evict stale candidates
   */
  evictStale(currentBlock: number): number {
    let evicted = 0;
    const staleThreshold = currentBlock - this.config.staleBlocks;

    for (const [user, candidate] of this.candidates.entries()) {
      if (candidate.preparedBlock < staleThreshold) {
        this.candidates.delete(user);
        evicted++;
      }
    }

    return evicted;
  }

  /**
   * Get engine statistics
   */
  getStats(): {
    total: number;
    active: number;
    avgProjectedHF: number;
    minProjectedHF: number;
  } {
    const candidates = Array.from(this.candidates.values());
    
    if (candidates.length === 0) {
      return {
        total: 0,
        active: 0,
        avgProjectedHF: 0,
        minProjectedHF: 0
      };
    }

    const projectedHFs = candidates.map(c => c.projectedHF);
    const avgProjectedHF = projectedHFs.reduce((sum, hf) => sum + hf, 0) / projectedHFs.length;
    const minProjectedHF = Math.min(...projectedHFs);

    return {
      total: candidates.length,
      active: candidates.length,
      avgProjectedHF,
      minProjectedHF
    };
  }

  /**
   * Check if a candidate should be executed optimistically
   */
  shouldExecuteOptimistic(candidate: PreStagedCandidate, actualHF: number): boolean {
    const executionThreshold = this.config.executionHfThresholdBps / 10000;
    const epsilon = this.config.optimisticEpsilonBps / 10000;

    // If HF is below threshold, execute immediately
    if (actualHF < executionThreshold) {
      return true;
    }

    // If HF is within epsilon of threshold and projected HF was below, allow optimistic
    if (actualHF < executionThreshold + epsilon && candidate.projectedHF < executionThreshold) {
      return true;
    }

    return false;
  }

  /**
   * Pre-stage a candidate from predictive engine
   * Applies same filters and delegates to prestage()
   */
  prestageFromPredictive(
    user: string,
    debtToken: string,
    collateralToken: string,
    debtWei: bigint,
    collateralWei: bigint,
    projectedHF: number,
    currentBlock: number,
    debtPriceUsd: number
  ): boolean {
    // Check minimum debt USD threshold
    const debtUsd = Number(ethers.formatEther(debtWei)) * debtPriceUsd;
    if (debtUsd < this.config.minDebtUsd) {
      return false;
    }

    // Check projected HF threshold
    const prestageThreshold = this.config.prestageHfBps / 10000;
    if (projectedHF > prestageThreshold) {
      return false;
    }

    // Delegate to regular prestage method
    return this.prestage(
      user,
      debtToken,
      collateralToken,
      debtWei,
      collateralWei,
      projectedHF,
      currentBlock,
      debtPriceUsd
    );
  }

  /**
   * Estimate repay amount based on close factor mode
   */
  private estimateRepayAmount(debtWei: bigint, projectedHF: number): bigint {
    const mode = this.config.closeFactorMode;

    if (mode === 'full' || projectedHF <= 0.95) {
      // Full liquidation for severely underwater positions
      return debtWei;
    }

    // Default to 50% close factor
    return debtWei / 2n;
  }

  /**
   * Evict lowest priority candidate (highest HF)
   */
  private evictLowestPriority(): void {
    let highestHF = -1;
    let evictUser: string | null = null;

    for (const [user, candidate] of this.candidates.entries()) {
      if (candidate.projectedHF > highestHF) {
        highestHF = candidate.projectedHF;
        evictUser = user;
      }
    }

    if (evictUser) {
      this.candidates.delete(evictUser);
    }
  }
}
