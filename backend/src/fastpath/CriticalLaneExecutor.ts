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

export interface CriticalEvent {
  user: string;
  block: number;
  hfRay: string;
  ts: number;
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
    
    console.log('[critical-executor] Initialized with config:', {
      reverifyMode: config.criticalLaneReverifyMode,
      maxReserves: config.criticalLaneMaxReverifyReserves,
      minDebtUsd: config.criticalLaneMinDebtUsd,
      minProfitUsd: config.criticalLaneMinProfitUsd
    });
  }
  
  /**
   * Handle critical event from Redis pub/sub
   */
  async handleCriticalEvent(event: CriticalEvent): Promise<ExecutionOutcome> {
    const endLatencyTimer = recordAttempt();
    const startTime = Date.now();
    
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
        // 2. Fetch snapshot
        let snapshot = await this.fetchOrRefreshSnapshot(event.user);
        
        // 3. Check if still liquidatable
        const hf = Number(snapshot.healthFactor) / 1e18;
        if (hf >= 1.0) {
          recordSkip('hf_above_threshold');
          return {
            user: event.user,
            block: event.block,
            outcome: 'skipped',
            reason: 'hf_above_threshold',
            latencyMs: Date.now() - startTime
          };
        }
        
        // 4. Build liquidation plan
        const plan = await this.buildLiquidationPlan(snapshot);
        
        if (!plan) {
          recordSkip('no_viable_plan');
          return {
            user: event.user,
            block: event.block,
            outcome: 'skipped',
            reason: 'no_viable_plan',
            latencyMs: Date.now() - startTime
          };
        }
        
        // 5. Gate by min debt/profit
        if (plan.debtUsd < config.criticalLaneMinDebtUsd) {
          recordSkip('debt_below_threshold');
          return {
            user: event.user,
            block: event.block,
            outcome: 'skipped',
            reason: 'debt_below_threshold',
            latencyMs: Date.now() - startTime
          };
        }
        
        if (plan.profitUsd < config.criticalLaneMinProfitUsd) {
          recordSkip('profit_below_threshold');
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
          return {
            user: event.user,
            block: event.block,
            outcome: 'skipped',
            reason: 'latency_abort',
            latencyMs: elapsedMs
          };
        }
        
        // 7. Submit transaction (fast path)
        const txResult = await this.submitTransaction(plan);
        
        const finalLatency = Date.now() - startTime;
        endLatencyTimer();
        
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
  private async fetchOrRefreshSnapshot(user: string): Promise<UserSnapshot> {
    const userKey = `user:${user.toLowerCase()}:snapshot`;
    const snapshotData = await this.redis.hgetall(userKey);
    
    // Check if snapshot exists and is fresh
    if (snapshotData.updatedTs) {
      const age = Date.now() - Number(snapshotData.updatedTs);
      if (age < config.userSnapshotTtlMs) {
        // Use cached snapshot
        const reserves = JSON.parse(snapshotData.reservesJson || '[]');
        return {
          user,
          blockNumber: Number(snapshotData.lastBlock),
          totalCollateralBase: BigInt(snapshotData.totalCollateralBase),
          totalDebtBase: BigInt(snapshotData.totalDebtBase),
          healthFactor: BigInt(snapshotData.lastHFRay),
          timestamp: Number(snapshotData.updatedTs),
          reserves
        };
      }
    }
    
    // Snapshot stale or missing - refresh
    recordSnapshotStale();
    recordMiniMulticall();
    
    // Determine reserves to query (extract from snapshot or use common set)
    const reserves = snapshotData.reservesJson
      ? JSON.parse(snapshotData.reservesJson).map((r: { asset: string }) => r.asset)
      : this.getCommonReserves();
    
    const snapshot = await this.miniMulticall.fetchSnapshot(
      user,
      reserves,
      config.criticalLaneMaxReverifyReserves
    );
    
    // Update Redis snapshot
    await this.redis.hmset(userKey, {
      lastHFRay: snapshot.healthFactor.toString(),
      totalDebtBase: snapshot.totalDebtBase.toString(),
      totalCollateralBase: snapshot.totalCollateralBase.toString(),
      lastBlock: snapshot.blockNumber.toString(),
      updatedTs: snapshot.timestamp.toString(),
      reservesJson: JSON.stringify(snapshot.reserves)
    });
    
    await this.redis.expire(userKey, Math.floor(config.userSnapshotTtlMs / 1000) + 10);
    
    return snapshot;
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
   */
  private async submitTransaction(plan: {
    debtAsset: string;
    collateralAsset: string;
    debtToCover: bigint;
  }): Promise<{ success: boolean; raced?: boolean; txHash?: string }> {
    // Placeholder - integration with ExecutionService
    // In real implementation, this would call executionService.executeFastPath(...)
    console.log('[critical-executor] Would submit tx:', plan);
    
    // For now, return simulated result
    return { success: false, raced: false };
  }
  
  /**
   * Get price from Redis cache
   */
  private async getPrice(asset: string): Promise<bigint> {
    const priceKey = `price:${asset.toLowerCase()}`;
    const priceData = await this.redis.hget(priceKey, 'usd');
    
    if (priceData) {
      return BigInt(priceData);
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
