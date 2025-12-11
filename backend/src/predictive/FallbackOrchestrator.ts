/**
 * FallbackOrchestrator: Conditional predictive evaluation orchestrator
 * 
 * Purpose: Manage predictive engine evaluation with fallback conditions
 * - When healthy: predictive stays passive or checks only near-band users
 * - When unhealthy: evaluate broader user set (capped by MAX_TARGET_USERS_PER_TICK)
 * 
 * Fallback triggers:
 * - WS provider unhealthy
 * - Price shock > PRICE_SHOCK_DROP_BPS_STRICT
 * 
 * Features:
 * - PREDICTIVE_FALLBACK_ENABLED flag (default: true)
 * - PREDICTIVE_FALLBACK_NEAR_ONLY flag (default: true)
 * - Integration with NearBandFilter for targeted checks
 */

import { config } from '../config/index.js';
import { NearBandFilter, type UserSnapshot } from './NearBandFilter.js';

export interface FallbackOrchestratorConfig {
  enabled: boolean;
  nearOnly: boolean;
  maxTargetUsersPerTick: number;
  priceShockDropBps: number;
}

export interface ProviderHealthSignal {
  isHealthy: boolean;
  reason?: string;
}

export interface PriceShockSignal {
  asset: string;
  dropBps: number;
  timestamp: number;
}

export type FallbackReason = 'ws_unhealthy' | 'price_shock' | 'passive' | 'near_band_only';

export interface FallbackEvaluationResult {
  shouldEvaluate: boolean;
  reason: FallbackReason;
  userSnapshots: UserSnapshot[];
}

/**
 * FallbackOrchestrator manages conditional predictive evaluation
 */
export class FallbackOrchestrator {
  private readonly config: FallbackOrchestratorConfig;
  private readonly nearBandFilter: NearBandFilter;
  
  // Health tracking
  private providerHealthy = true;
  private lastPriceShock?: PriceShockSignal;

  constructor(
    configOverride?: Partial<FallbackOrchestratorConfig>,
    nearBandFilter?: NearBandFilter
  ) {
    this.config = {
      enabled: configOverride?.enabled ?? config.predictiveFallbackEnabled ?? true,
      nearOnly: configOverride?.nearOnly ?? config.predictiveFallbackNearOnly ?? true,
      maxTargetUsersPerTick: configOverride?.maxTargetUsersPerTick ?? config.maxTargetUsersPerTick ?? 100,
      priceShockDropBps: configOverride?.priceShockDropBps ?? config.priceTriggerDropBps ?? 30
    };

    this.nearBandFilter = nearBandFilter ?? new NearBandFilter();

    if (this.config.enabled) {
      console.log(
        `[predictive-fallback] Initialized: ` +
        `nearOnly=${this.config.nearOnly}, ` +
        `maxUsers=${this.config.maxTargetUsersPerTick}, ` +
        `priceShockBps=${this.config.priceShockDropBps}`
      );
    }
  }

  /**
   * Update provider health status
   */
  public setProviderHealth(signal: ProviderHealthSignal): void {
    const wasHealthy = this.providerHealthy;
    this.providerHealthy = signal.isHealthy;

    if (wasHealthy !== signal.isHealthy) {
      console.log(
        `[predictive-fallback] provider health changed: ${signal.isHealthy ? 'healthy' : 'unhealthy'}` +
        (signal.reason ? ` reason=${signal.reason}` : '')
      );
    }
  }

  /**
   * Record a price shock event
   */
  public recordPriceShock(signal: PriceShockSignal): void {
    this.lastPriceShock = signal;
    console.log(
      `[predictive-fallback] price shock recorded: asset=${signal.asset} dropBps=${signal.dropBps}`
    );
  }

  /**
   * Check if a recent price shock exceeds threshold
   */
  private hasRecentPriceShock(): boolean {
    if (!this.lastPriceShock) return false;

    // Consider shock recent if within last 60 seconds
    const RECENT_PRICE_SHOCK_THRESHOLD_MS = 60000;
    const shockAgeMs = Date.now() - this.lastPriceShock.timestamp;

    if (shockAgeMs > RECENT_PRICE_SHOCK_THRESHOLD_MS) {
      return false;
    }

    return this.lastPriceShock.dropBps >= this.config.priceShockDropBps;
  }

  /**
   * Determine if predictive evaluation should run and with what user set
   */
  public shouldEvaluate(availableUsers: UserSnapshot[]): FallbackEvaluationResult {
    if (!this.config.enabled) {
      return {
        shouldEvaluate: false,
        reason: 'passive',
        userSnapshots: []
      };
    }

    // Check fallback conditions
    const isUnhealthy = !this.providerHealthy;
    const hasPriceShock = this.hasRecentPriceShock();

    // Determine evaluation mode
    if (isUnhealthy || hasPriceShock) {
      // Fallback mode: evaluate broader set (but still capped)
      const reason: FallbackReason = isUnhealthy ? 'ws_unhealthy' : 'price_shock';
      
      let userSet = availableUsers;
      
      // Apply near-band filter if enabled
      if (this.config.nearOnly) {
        const filterResult = this.nearBandFilter.filter(availableUsers);
        userSet = filterResult.kept;
      }
      
      // Cap to max users per tick
      const cappedUsers = userSet.slice(0, this.config.maxTargetUsersPerTick);
      
      console.log(
        `[predictive-fallback] evaluating users=${cappedUsers.length} ` +
        `(near-only=${this.config.nearOnly}) reason=${reason}`
      );

      return {
        shouldEvaluate: true,
        reason,
        userSnapshots: cappedUsers
      };
    }

    // Healthy mode: passive or near-only
    if (this.config.nearOnly) {
      // Check only near-band users
      const filterResult = this.nearBandFilter.filter(availableUsers);
      const nearBandUsers = filterResult.kept.slice(0, this.config.maxTargetUsersPerTick);

      if (nearBandUsers.length > 0) {
        console.log(
          `[predictive-fallback] evaluating users=${nearBandUsers.length} (near-only)`
        );
      }

      return {
        shouldEvaluate: nearBandUsers.length > 0,
        reason: 'near_band_only',
        userSnapshots: nearBandUsers
      };
    }

    // Passive mode: no evaluation
    return {
      shouldEvaluate: false,
      reason: 'passive',
      userSnapshots: []
    };
  }

  /**
   * Get current configuration
   */
  public getConfig(): FallbackOrchestratorConfig {
    return { ...this.config };
  }

  /**
   * Get current health status
   */
  public getHealthStatus() {
    return {
      providerHealthy: this.providerHealthy,
      lastPriceShock: this.lastPriceShock,
      hasRecentPriceShock: this.hasRecentPriceShock()
    };
  }

  /**
   * Check if orchestrator is enabled
   */
  public isEnabled(): boolean {
    return this.config.enabled;
  }
}
