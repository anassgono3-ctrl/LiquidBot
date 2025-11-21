/**
 * Critical Lane Executor
 * 
 * Handles building actionable liquidation intent for HF < 1 users.
 * Bypasses batch verification and pre-sim queues for minimum latency.
 */

import { JsonRpcProvider } from 'ethers';
import type { Redis as IORedis } from 'ioredis';

import { config } from '../config/index.js';
import { computeUsd, expandVariableDebt } from '../utils/CanonicalUsdMath.js';
import { TokenMetadataResolver } from '../services/TokenMetadataResolver.js';
import type { ExecutionService } from '../services/ExecutionService.js';
import type { DecisionTraceStore } from '../services/DecisionTraceStore.js';
import { CriticalLaneMiniMulticall, type UserSnapshot } from './CriticalLaneMiniMulticall.js';
import {
  recordAttempt,
  recordSuccess,
  recordRaced,
  recordSkip,
  recordSnapshotStale,
  recordMiniMulticall
} from './CriticalLaneMetrics.js';
import { FastpathCache } from './FastpathPriceGasCache.js';
import { Timer, logFastpathLatency, type LatencyPhases } from './FastpathLatency.js';

export interface CriticalEvent {
  user: string;
  block: number;
  hfRay: string;
  ts: number;
  triggerType?: string; // 'watched_fastpath', 'event', 'head', etc.
}

export interface ExecutionOutcome {
  user: string;
  block: number;
  outcome: 'success' | 'raced' | 'skipped';
  reason?: string;
  latencyMs: number;
  txHash?: string;
  profitUsd?: number;
}

/**
 * Critical Lane Executor orchestrates fast-path liquidation execution
 */
export class CriticalLaneExecutor {
  private redis: IORedis;
  private provider: JsonRpcProvider;
  private miniMulticall: CriticalLaneMiniMulticall;
  private tokenResolver: TokenMetadataResolver;
  private executionService?: ExecutionService;
  private decisionTrace?: DecisionTraceStore;
  private cache: FastpathCache;
  
  constructor(options: {
    redis: IORedis;
    provider: JsonRpcProvider;
    executionService?: ExecutionService;
    decisionTrace?: DecisionTraceStore;
  }) {
    this.redis = options.redis;
    this.provider = options.provider;
    this.executionService = options.executionService;
    this.decisionTrace = options.decisionTrace;
    
    this.miniMulticall = new CriticalLaneMiniMulticall(this.provider);
    this.tokenResolver = new TokenMetadataResolver({ provider: this.provider });
    this.cache = new FastpathCache();
    
    console.log('[critical-executor] Initialized with config:', {
      reverifyMode: config.criticalLaneReverifyMode,
      maxReserves: config.criticalLaneMaxReverifyReserves,
      minDebtUsd: config.criticalLaneMinDebtUsd,
      minProfitUsd: config.criticalLaneMinProfitUsd,
      priceCacheTtl: config.fastpathPriceCacheTtlMs,
      gasCacheTtl: config.fastpathGasCacheTtlMs
    });
  }
  
  /**
   * Handle critical event from Redis pub/sub
   */
  async handleCriticalEvent(event: CriticalEvent): Promise<ExecutionOutcome> {
    const endLatencyTimer = recordAttempt();
    const startTime = Date.now();
    const timer = new Timer();
    const latencyPhases: LatencyPhases = { totalMs: 0 };
    
    try {
      // 1. Acquire lock
      const lockKey = `attempt_lock:${event.user.toLowerCase()}`;
      const locked = await this.redis.set(lockKey, '1', 'PX', 6000, 'NX');
      
      if (!locked) {
        recordSkip('lock_contention');
        return {
          user: event.user,
          block: event.block,
          outcome: 'skipped',
          reason: 'lock_contention',
          latencyMs: Date.now() - startTime
        };
      }
      
      try {
        // 2. Fetch snapshot (mini-multicall if stale)
        const snapshotTimer = new Timer();
        const snapshotResult = await this.fetchOrRefreshSnapshot(event.user);
        const snapshot = snapshotResult.snapshot;
        const snapshotStale = snapshotResult.refreshed;
        
        if (snapshotStale) {
          latencyPhases.miniMulticallMs = snapshotTimer.elapsed();
          recordSnapshotStale();
          recordMiniMulticall();
        }
        
        // 3. Check if still liquidatable (use BigInt for precision)
        const thresholdRay = BigInt(Math.floor(config.criticalLaneMinExecuteHf * 1e18));
        if (snapshot.healthFactor >= thresholdRay) {
          recordSkip('hf_above_threshold');
          latencyPhases.totalMs = timer.elapsed();
          logFastpathLatency(event.user, snapshotStale, latencyPhases);
          return {
            user: event.user,
            block: event.block,
            outcome: 'skipped',
            reason: 'hf_above_threshold',
            latencyMs: Date.now() - startTime
          };
        }
        
        // 4. Call ExecutionService fast-path method if available
        if (this.executionService) {
          const planTimer = new Timer();
          
          let actionable;
          // Watched fast-path: use prepareActionableOpportunityFastpath (bypasses pre-sim/micro-verify)
          if (event.triggerType === 'watched_fastpath') {
            const result = await (this.executionService as any).prepareActionableOpportunityFastpath(event.user, 'watched_fastpath');
            if (result.success) {
              actionable = {
                plan: {
                  debtAsset: result.plan.debtAsset,
                  collateralAsset: result.plan.collateralAsset,
                  debtToCover: result.plan.debtToCover,
                  debtUsd: result.plan.debtToCoverUsd,
                  profitUsd: result.plan.liquidationBonusPct * result.plan.debtToCoverUsd / 100 - result.plan.debtToCoverUsd
                }
              };
            } else {
              actionable = { skipReason: result.skipReason };
            }
          } else {
            // Normal fast-path: use existing method
            actionable = await this.callFastpathExecution(event.user, snapshot);
          }
          
          latencyPhases.planBuildMs = planTimer.elapsed();
          
          if (!actionable || !actionable.plan) {
            recordSkip(actionable?.skipReason || 'no_viable_plan');
            latencyPhases.totalMs = timer.elapsed();
            logFastpathLatency(event.user, snapshotStale, latencyPhases);
            return {
              user: event.user,
              block: event.block,
              outcome: 'skipped',
              reason: actionable?.skipReason || 'no_viable_plan',
              latencyMs: Date.now() - startTime
            };
          }
          
          const plan = actionable.plan;
          
          // 5. Gate by min debt/profit (skip for watched fast-path, already gated in ExecutionService)
          const isWatchedFastpath = event.triggerType === 'watched_fastpath';
          
          if (!isWatchedFastpath && plan.debtUsd < config.criticalLaneMinDebtUsd) {
            recordSkip('debt_below_threshold');
            latencyPhases.totalMs = timer.elapsed();
            logFastpathLatency(event.user, snapshotStale, latencyPhases);
            return {
              user: event.user,
              block: event.block,
              outcome: 'skipped',
              reason: 'debt_below_threshold',
              latencyMs: Date.now() - startTime
            };
          }
          
          if (!isWatchedFastpath && plan.profitUsd < config.criticalLaneMinProfitUsd) {
            recordSkip('profit_below_threshold');
            latencyPhases.totalMs = timer.elapsed();
            logFastpathLatency(event.user, snapshotStale, latencyPhases);
            return {
              user: event.user,
              block: event.block,
              outcome: 'skipped',
              reason: 'profit_below_threshold',
              latencyMs: Date.now() - startTime
            };
          }
          
          // 6. Check latency budget
          const elapsedMs = Date.now() - startTime;
          if (elapsedMs > config.criticalLaneLatencyAbortMs) {
            recordSkip('latency_abort');
            latencyPhases.totalMs = timer.elapsed();
            logFastpathLatency(event.user, snapshotStale, latencyPhases);
            return {
              user: event.user,
              block: event.block,
              outcome: 'skipped',
              reason: 'latency_abort',
              latencyMs: elapsedMs
            };
          }
          
          // 7. Submit transaction (fast path)
          const submitTimer = new Timer();
          const txResult = await this.submitTransaction(plan);
          latencyPhases.submitMs = submitTimer.elapsed();
          
          const finalLatency = Date.now() - startTime;
          latencyPhases.totalMs = finalLatency;
          endLatencyTimer();
          
          logFastpathLatency(event.user, snapshotStale, latencyPhases);
          
          if (txResult.success) {
            recordSuccess();
            
            // Record to stream
            await this.recordOutcome({
              user: event.user,
              block: event.block,
              outcome: 'success',
              latencyMs: finalLatency,
              txHash: txResult.txHash,
              profitUsd: plan.profitUsd
            });
            
            return {
              user: event.user,
              block: event.block,
              outcome: 'success',
              latencyMs: finalLatency,
              txHash: txResult.txHash,
              profitUsd: plan.profitUsd
            };
          } else if (txResult.raced) {
            recordRaced();
            return {
              user: event.user,
              block: event.block,
              outcome: 'raced',
              reason: 'competitor_tx',
              latencyMs: finalLatency
            };
          } else {
            recordSkip('tx_failed');
            return {
              user: event.user,
              block: event.block,
              outcome: 'skipped',
              reason: 'tx_failed',
              latencyMs: finalLatency
            };
          }
        } else {
          // Fallback: no ExecutionService available
          recordSkip('no_execution_service');
          latencyPhases.totalMs = timer.elapsed();
          return {
            user: event.user,
            block: event.block,
            outcome: 'skipped',
            reason: 'no_execution_service',
            latencyMs: Date.now() - startTime
          };
        }
      } finally {
        // Release lock
        await this.redis.del(lockKey);
      }
    } catch (err) {
      console.error('[critical-executor] Error handling event:', err);
      recordSkip('error');
      return {
        user: event.user,
        block: event.block,
        outcome: 'skipped',
        reason: 'error',
        latencyMs: Date.now() - startTime
      };
    }
  }
  
  /**
   * Fetch snapshot from Redis or refresh via mini-multicall
   */
  private async fetchOrRefreshSnapshot(user: string): Promise<{ snapshot: UserSnapshot; refreshed: boolean }> {
    const userKey = `user:${user.toLowerCase()}:snapshot`;
    const snapshotData = await this.redis.hgetall(userKey);
    
    // Check if snapshot exists and is fresh
    if (snapshotData.updatedTs) {
      const age = Date.now() - Number(snapshotData.updatedTs);
      if (age < config.userSnapshotTtlMs) {
        // Use cached snapshot
        const reserves = JSON.parse(snapshotData.reservesJson || '[]');
        return {
          snapshot: {
            user,
            blockNumber: Number(snapshotData.lastBlock),
            totalCollateralBase: BigInt(snapshotData.totalCollateralBase),
            totalDebtBase: BigInt(snapshotData.totalDebtBase),
            healthFactor: BigInt(snapshotData.lastHFRay),
            timestamp: Number(snapshotData.updatedTs),
            reserves
          },
          refreshed: false
        };
      }
    }
    
    // Snapshot stale or missing - refresh
    
    // Determine reserves to query (extract from snapshot or use common set)
    const reserves = snapshotData.reservesJson
      ? JSON.parse(snapshotData.reservesJson).map((r: { asset: string }) => r.asset)
      : this.getCommonReserves();
    
    const snapshot = await this.miniMulticall.fetchSnapshot(
      user,
      reserves,
      config.criticalLaneMaxReverifyReserves
    );
    
    // Update Redis snapshot (using hset for Redis 4.0+ compatibility)
    await this.redis.hset(userKey,
      'lastHFRay', snapshot.healthFactor.toString(),
      'totalDebtBase', snapshot.totalDebtBase.toString(),
      'totalCollateralBase', snapshot.totalCollateralBase.toString(),
      'lastBlock', snapshot.blockNumber.toString(),
      'updatedTs', snapshot.timestamp.toString(),
      'reservesJson', JSON.stringify(snapshot.reserves)
    );
    
    await this.redis.expire(userKey, Math.floor(config.userSnapshotTtlMs / 1000) + 10);
    
    return { snapshot, refreshed: true };
  }
  
  /**
   * Build liquidation plan from snapshot
   */
  private async buildLiquidationPlan(snapshot: UserSnapshot): Promise<{
    debtAsset: string;
    collateralAsset: string;
    debtToCover: bigint;
    debtUsd: number;
    profitUsd: number;
  } | null> {
    // Find largest debt and collateral reserves
    let maxDebt: { asset: string; amount: bigint; usd: number } | null = null;
    let maxCollateral: { asset: string; amount: bigint; usd: number } | null = null;
    
    for (const reserve of snapshot.reserves) {
      const totalDebt = reserve.currentVariableDebt + reserve.currentStableDebt;
      
      if (totalDebt > 0n) {
        const metadata = await this.tokenResolver.getMetadata(reserve.asset);
        const price = await this.getPrice(reserve.asset);
        const debtUsd = computeUsd(totalDebt, metadata.decimals, price, 8);
        
        if (!maxDebt || debtUsd > maxDebt.usd) {
          maxDebt = { asset: reserve.asset, amount: totalDebt, usd: debtUsd };
        }
      }
      
      if (reserve.currentATokenBalance > 0n && reserve.usageAsCollateralEnabled) {
        const metadata = await this.tokenResolver.getMetadata(reserve.asset);
        const price = await this.getPrice(reserve.asset);
        const collateralUsd = computeUsd(reserve.currentATokenBalance, metadata.decimals, price, 8);
        
        if (!maxCollateral || collateralUsd > maxCollateral.usd) {
          maxCollateral = { asset: reserve.asset, amount: reserve.currentATokenBalance, usd: collateralUsd };
        }
      }
    }
    
    if (!maxDebt || !maxCollateral) {
      return null;
    }
    
    // Calculate close factor (100% for HF < 0.95, 50% otherwise)
    const hf = Number(snapshot.healthFactor) / 1e18;
    const closeFactor = hf < 0.95 ? 1.0 : 0.5;
    const debtToCover = BigInt(Math.floor(Number(maxDebt.amount) * closeFactor));
    
    // Estimate profit (simplified - 5% liquidation bonus)
    const profitUsd = maxDebt.usd * closeFactor * 0.05;
    
    return {
      debtAsset: maxDebt.asset,
      collateralAsset: maxCollateral.asset,
      debtToCover,
      debtUsd: maxDebt.usd * closeFactor,
      profitUsd
    };
  }
  
  /**
   * Submit transaction via ExecutionService fast path
   * 
   * TODO: Integration with ExecutionService required
   * This is a placeholder that should be replaced with actual execution logic:
   * - Build liquidation calldata
   * - Estimate gas
   * - Submit to private RPC or public provider
   * - Handle revert scenarios
   */
  private async submitTransaction(plan: {
    debtAsset: string;
    collateralAsset: string;
    debtToCover: bigint;
  }): Promise<{ success: boolean; raced?: boolean; txHash?: string }> {
    // LIMITATION: Transaction submission not yet integrated with ExecutionService
    // The critical lane will detect opportunities but not execute them
    // This requires integration with the existing execution pipeline
    console.log('[critical-executor] Transaction submission not implemented:', plan);
    console.log('[critical-executor] Integration with ExecutionService required for actual execution');
    
    // Return simulated result - in production, this would attempt actual transaction
    return { success: false, raced: false };
  }
  
  /**
   * Get price from cache or Redis
   */
  private async getPrice(asset: string): Promise<bigint> {
    // Try FastpathCache first
    const cached = this.cache.prices.get(asset);
    if (cached !== null) {
      return cached;
    }
    
    // Fallback to Redis
    const priceKey = `price:${asset.toLowerCase()}`;
    const priceData = await this.redis.hget(priceKey, 'usd');
    
    if (priceData) {
      const price = BigInt(priceData);
      // Cache for future use
      this.cache.prices.set(asset, price);
      return price;
    }
    
    // Fallback to default (should not happen in production)
    console.warn('[critical-executor] Price not found for', asset, '- using 1e8');
    return BigInt(1e8);
  }
  
  /**
   * Record outcome to Redis stream
   */
  private async recordOutcome(outcome: ExecutionOutcome): Promise<void> {
    try {
      await this.redis.xadd(
        'exec_outcomes',
        '*',
        'user', outcome.user,
        'block', outcome.block.toString(),
        'outcome', outcome.outcome,
        'latencyMs', outcome.latencyMs.toString(),
        'txHash', outcome.txHash || '',
        'profitUsd', (outcome.profitUsd || 0).toString()
      );
    } catch (err) {
      console.error('[critical-executor] Failed to record outcome:', err);
    }
  }
  
  /**
   * Call fast-path execution (currently uses buildLiquidationPlan)
   * 
   * TODO: Integrate with ExecutionService.prepareActionableOpportunityFastpath()
   * when that method is implemented for full pre-sim bypass
   */
  private async callFastpathExecution(user: string, snapshot: UserSnapshot): Promise<{
    plan?: {
      debtAsset: string;
      collateralAsset: string;
      debtToCover: bigint;
      debtUsd: number;
      profitUsd: number;
    };
    skipReason?: string;
  }> {
    // Use buildLiquidationPlan for now - already bypasses heavy operations
    const plan = await this.buildLiquidationPlan(snapshot);
    if (!plan) {
      return { skipReason: 'no_viable_plan' };
    }
    return { plan };
  }
  
  /**
   * Get common reserve addresses for Base
   */
  private getCommonReserves(): string[] {
    return [
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
      '0x4200000000000000000000000000000000000006', // WETH
      '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // USDbC
      '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', // cbBTC
      '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // DAI
      '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22'  // cbETH
    ];
  }
}
