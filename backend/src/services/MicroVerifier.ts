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
import { MicroVerifyCache, type CachedHFResult } from './microVerify/MicroVerifyCache.js';

export interface MicroVerifyCandidate {
  user: string;
  trigger: 'projection_cross' | 'near_threshold' | 'reserve_fast' | 'head_critical' | 'sprinter' | 'index_jump' | 'price_shock' | 'liquidation_refresh' | 'proj_cross';
  projectedHf?: number;
  currentHf?: number;
  hedge?: boolean; // Optional: override default hedging behavior
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
  private cache?: MicroVerifyCache;
  
  // Per-block tracking
  private currentBlockNumber: number | null = null;
  private verificationsThisBlock = 0;
  private lastVerifyTime = 0;
  
  // De-duplication within block
  private verifiedUsersThisBlock = new Set<string>();

  constructor(aavePool: Contract, cache?: MicroVerifyCache) {
    this.aavePool = aavePool;
    this.enabled = config.microVerifyEnabled;
    this.maxPerBlock = config.microVerifyMaxPerBlock;
    this.intervalMs = config.microVerifyIntervalMs;
    this.cache = cache;
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
    const { user, trigger, hedge } = candidate;
    
    // Check cache first if available
    const blockTag = this.currentBlockNumber !== null ? this.currentBlockNumber : 'latest';
    if (this.cache) {
      const cached = this.cache.get(user, blockTag);
      if (cached) {
        // Cache hit - return cached result
        microVerifyTotal.labels({ result: 'cache_hit', trigger }).inc();
        return {
          user: cached.user,
          hf: cached.hf,
          totalCollateralBase: cached.totalCollateralBase,
          totalDebtBase: cached.totalDebtBase,
          availableBorrowsBase: cached.availableBorrowsBase,
          currentLiquidationThreshold: cached.currentLiquidationThreshold,
          ltv: cached.ltv,
          success: true,
          trigger,
          latencyMs: 0 // Instant from cache
        };
      }
    }
    
    // Check if verification is allowed
    if (!this.canVerify(user)) {
      // Increment cap metric
      if (this.verificationsThisBlock >= this.maxPerBlock) {
        microVerifyTotal.labels({ result: 'cap', trigger }).inc();
      }
      return null;
    }
    
    // Use cache for in-flight deduplication if available
    if (this.cache) {
      return this.cache.getOrCreateInflight(user, blockTag, async () => {
        const result = await this.performVerification(user, trigger, hedge);
        if (!result) return null;
        
        // Convert MicroVerifyResult to CachedHFResult format
        return {
          user: result.user,
          blockTag,
          hf: result.hf,
          totalCollateralBase: result.totalCollateralBase,
          totalDebtBase: result.totalDebtBase,
          availableBorrowsBase: result.availableBorrowsBase,
          currentLiquidationThreshold: result.currentLiquidationThreshold,
          ltv: result.ltv,
          timestamp: Date.now()
        };
      }).then(cached => {
        if (!cached) return null;
        
        // Convert back to MicroVerifyResult
        return {
          user: cached.user,
          hf: cached.hf,
          totalCollateralBase: cached.totalCollateralBase,
          totalDebtBase: cached.totalDebtBase,
          availableBorrowsBase: cached.availableBorrowsBase,
          currentLiquidationThreshold: cached.currentLiquidationThreshold,
          ltv: cached.ltv,
          success: true,
          trigger,
          latencyMs: 0  // From cache
        };
      });
    }
    
    // No cache - perform verification directly
    return this.performVerification(user, trigger, hedge);
  }

  /**
   * Internal method to perform actual verification
   */
  private async performVerification(
    user: string,
    trigger: string,
    hedge?: boolean
  ): Promise<MicroVerifyResult | null> {
    // Determine if hedging should be used
    // Hedging disabled for single micro-verifies unless explicitly requested
    const shouldHedge = hedge !== undefined 
      ? hedge 
      : config.microVerifyHedgeForSingle;
    
    // For fast-lane triggers (reserve_fast, index_jump, price_shock, liquidation_refresh),
    // default to no hedging for minimal latency
    const fastLaneTriggers = ['reserve_fast', 'index_jump', 'price_shock', 'liquidation_refresh', 'proj_cross'];
    const useFastPath = fastLaneTriggers.includes(trigger) && !shouldHedge;
    
    const startTime = Date.now();
    
    try {
      // Single getUserAccountData call
      // TODO: If shouldHedge is true and dedicated RPC is configured, could implement hedge logic here
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
