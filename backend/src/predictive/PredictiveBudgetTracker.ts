/**
 * PredictiveBudgetTracker: Enforces RPC budget limits for predictive operations
 * 
 * Tracks:
 * - Per-block user evaluation caps
 * - Per-minute tick rate limits
 * - Hourly RPC spend budget (heuristic estimation)
 * 
 * Prevents predictive from overwhelming RPC providers with excessive calls.
 */

import { config } from '../config/index.js';
import {
  predictiveTicksExecuted,
  predictiveTicksRateLimited,
  predictiveRpcUsdSpendEstimate,
  predictiveHfReadsTotal
} from '../metrics/index.js';

export interface BudgetConfig {
  maxUsersPerTick: number;
  maxTicksPerMin: number;
  rpcBudgetUsdPerHour: number;
  maxUsersPerSignalPerAsset: number;
  costPerHfReadUsd: number; // Estimated cost per health factor read
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  remaining?: {
    usersThisTick?: number;
    ticksThisMinute?: number;
    budgetThisHour?: number;
  };
}

/**
 * PredictiveBudgetTracker enforces budget constraints on predictive operations
 */
export class PredictiveBudgetTracker {
  private readonly config: BudgetConfig;
  
  // Per-tick tracking
  private currentTickUsersEvaluated = 0;
  private tickStartTime = 0;
  
  // Per-minute tracking
  private ticksThisMinute = 0;
  private minuteStartTime = 0;
  
  // Per-hour tracking
  private spendThisHourUsd = 0;
  private hourStartTime = 0;
  
  // Per-asset per-signal tracking
  private usersPerAssetThisSignal: Map<string, number> = new Map();
  
  constructor(configOverride?: Partial<BudgetConfig>) {
    this.config = {
      maxUsersPerTick: configOverride?.maxUsersPerTick ?? config.predictiveMaxUsersPerTick,
      maxTicksPerMin: configOverride?.maxTicksPerMin ?? config.predictiveMaxTicksPerMin,
      rpcBudgetUsdPerHour: configOverride?.rpcBudgetUsdPerHour ?? config.predictiveRpcBudgetUsdPerHour,
      maxUsersPerSignalPerAsset: configOverride?.maxUsersPerSignalPerAsset ?? config.predictiveMaxUsersPerSignalPerAsset,
      costPerHfReadUsd: configOverride?.costPerHfReadUsd ?? 0.000015 // ~$0.015 per 1000 calls for typical RPC
    };

    this.hourStartTime = Date.now();
    this.minuteStartTime = Date.now();
    
    console.log(
      `[predictive-budget-tracker] Initialized: ` +
      `maxUsersPerTick=${this.config.maxUsersPerTick}, ` +
      `maxTicksPerMin=${this.config.maxTicksPerMin}, ` +
      `rpcBudgetUsdPerHour=$${this.config.rpcBudgetUsdPerHour.toFixed(2)}, ` +
      `maxUsersPerSignalPerAsset=${this.config.maxUsersPerSignalPerAsset}`
    );
  }

  /**
   * Start a new evaluation tick
   * Resets per-tick counters and checks minute/hour boundaries
   */
  public startTick(asset?: string): void {
    const now = Date.now();
    
    // Reset tick counters
    this.currentTickUsersEvaluated = 0;
    this.tickStartTime = now;
    
    // Check minute boundary
    if (now - this.minuteStartTime >= 60000) {
      this.ticksThisMinute = 0;
      this.minuteStartTime = now;
    }
    
    // Check hour boundary
    if (now - this.hourStartTime >= 3600000) {
      this.spendThisHourUsd = 0;
      this.hourStartTime = now;
      
      // Update metrics
      predictiveRpcUsdSpendEstimate.set({ window: 'hour' }, 0);
    }
    
    // Increment tick counter
    this.ticksThisMinute++;
    predictiveTicksExecuted.inc();
  }

  /**
   * Check if we can evaluate N more users in this tick
   */
  public canEvaluateUsers(count: number, asset?: string): BudgetCheckResult {
    // Check per-tick cap
    if (this.currentTickUsersEvaluated + count > this.config.maxUsersPerTick) {
      predictiveTicksRateLimited.inc({ reason: 'per_tick_cap' });
      return {
        allowed: false,
        reason: 'per_tick_cap_exceeded',
        remaining: {
          usersThisTick: this.config.maxUsersPerTick - this.currentTickUsersEvaluated
        }
      };
    }

    // Check per-minute tick rate
    if (this.ticksThisMinute >= this.config.maxTicksPerMin) {
      predictiveTicksRateLimited.inc({ reason: 'per_minute_rate' });
      return {
        allowed: false,
        reason: 'per_minute_rate_exceeded',
        remaining: {
          ticksThisMinute: 0
        }
      };
    }

    // Check hourly budget
    const estimatedCost = count * this.config.costPerHfReadUsd;
    if (this.spendThisHourUsd + estimatedCost > this.config.rpcBudgetUsdPerHour) {
      predictiveTicksRateLimited.inc({ reason: 'hourly_budget' });
      return {
        allowed: false,
        reason: 'hourly_budget_exceeded',
        remaining: {
          budgetThisHour: this.config.rpcBudgetUsdPerHour - this.spendThisHourUsd
        }
      };
    }

    // Check per-asset per-signal cap (if asset specified)
    if (asset) {
      const currentAssetCount = this.usersPerAssetThisSignal.get(asset) ?? 0;
      if (currentAssetCount + count > this.config.maxUsersPerSignalPerAsset) {
        predictiveTicksRateLimited.inc({ reason: 'per_asset_cap' });
        return {
          allowed: false,
          reason: 'per_asset_cap_exceeded',
          remaining: {
            usersThisTick: this.config.maxUsersPerSignalPerAsset - currentAssetCount
          }
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Record that N users were evaluated
   * Updates counters and spend estimates
   */
  public recordUsersEvaluated(count: number, type: 'micro_verify' | 'bulk_scan' | 'prestage', asset?: string): void {
    this.currentTickUsersEvaluated += count;
    
    // Update per-asset counter
    if (asset) {
      const current = this.usersPerAssetThisSignal.get(asset) ?? 0;
      this.usersPerAssetThisSignal.set(asset, current + count);
    }
    
    // Estimate and record RPC cost
    const estimatedCost = count * this.config.costPerHfReadUsd;
    this.spendThisHourUsd += estimatedCost;
    
    // Update metrics
    predictiveHfReadsTotal.inc({ type }, count);
    predictiveRpcUsdSpendEstimate.set({ window: 'hour' }, this.spendThisHourUsd);
  }

  /**
   * Reset per-signal asset counters (called when signal window expires)
   */
  public resetSignalCounters(): void {
    this.usersPerAssetThisSignal.clear();
  }

  /**
   * Get current budget status
   */
  public getStatus(): {
    usersThisTick: number;
    ticksThisMinute: number;
    spendThisHourUsd: number;
    remainingTicksThisMinute: number;
    remainingBudgetThisHourUsd: number;
  } {
    return {
      usersThisTick: this.currentTickUsersEvaluated,
      ticksThisMinute: this.ticksThisMinute,
      spendThisHourUsd: this.spendThisHourUsd,
      remainingTicksThisMinute: Math.max(0, this.config.maxTicksPerMin - this.ticksThisMinute),
      remainingBudgetThisHourUsd: Math.max(0, this.config.rpcBudgetUsdPerHour - this.spendThisHourUsd)
    };
  }

  /**
   * Downsample users array to fit within budget
   * Returns subsampled array prioritized by risk score if available
   */
  public downsampleToFit<T extends { hf?: number; debtUsd?: number }>(
    users: T[],
    asset?: string
  ): T[] {
    const check = this.canEvaluateUsers(users.length, asset);
    
    if (check.allowed) {
      return users;
    }

    // Calculate max we can take
    let maxUsers = this.config.maxUsersPerTick - this.currentTickUsersEvaluated;
    
    if (asset) {
      const currentAssetCount = this.usersPerAssetThisSignal.get(asset) ?? 0;
      maxUsers = Math.min(maxUsers, this.config.maxUsersPerSignalPerAsset - currentAssetCount);
    }

    if (maxUsers <= 0) {
      return [];
    }

    // Sort by risk (lower HF = higher risk, higher debt = higher impact)
    const sorted = [...users].sort((a, b) => {
      const hfA = a.hf ?? 2.0;
      const hfB = b.hf ?? 2.0;
      const debtA = a.debtUsd ?? 0;
      const debtB = b.debtUsd ?? 0;
      
      // Primary: lower HF (higher risk)
      if (Math.abs(hfA - hfB) > 0.001) {
        return hfA - hfB;
      }
      
      // Secondary: higher debt (higher impact)
      return debtB - debtA;
    });

    console.warn(
      `[predictive-budget-tracker] Downsampling from ${users.length} to ${maxUsers} users ` +
      `(asset=${asset}, reason=${check.reason})`
    );

    return sorted.slice(0, maxUsers);
  }
}
