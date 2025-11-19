/**
 * PredictiveEngine: Short-horizon health factor projection engine
 * 
 * Projects HF for affected users when price/rate snapshots change
 * Creates predictive candidates for users likely to cross liquidation threshold
 */

import { config } from '../config/index.js';
import { HFCalculator, UserSnapshot } from './HFCalculator.js';
import { PriceWindow } from './PriceWindow.js';
import {
  PredictiveCandidate,
  PredictiveScenario,
  DEFAULT_SCENARIOS
} from './models/PredictiveCandidate.js';

export interface PredictiveEngineConfig {
  enabled: boolean;
  hfBufferBps: number;
  maxUsersPerTick: number;
  horizonSec: number;
  scenarios: PredictiveScenario[];
}

export class PredictiveEngine {
  private readonly config: PredictiveEngineConfig;
  private priceWindows: Map<string, PriceWindow> = new Map();
  private lastTickMs = 0;

  constructor(configOverride?: Partial<PredictiveEngineConfig>) {
    this.config = {
      enabled: configOverride?.enabled ?? config.predictiveEnabled,
      hfBufferBps: configOverride?.hfBufferBps ?? config.predictiveHfBufferBps,
      maxUsersPerTick: configOverride?.maxUsersPerTick ?? config.predictiveMaxUsersPerTick,
      horizonSec: configOverride?.horizonSec ?? config.predictiveHorizonSec,
      scenarios: configOverride?.scenarios ?? (config.predictiveScenarios as PredictiveScenario[])
    };

    if (this.config.enabled) {
      console.log(
        `[predictive-engine] Initialized: buffer=${this.config.hfBufferBps}bps, ` +
        `horizon=${this.config.horizonSec}s, scenarios=${this.config.scenarios.join(',')}`
      );
    }
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Update price window for an asset
   */
  public updatePrice(asset: string, price: number, timestamp: number, block: number): void {
    let window = this.priceWindows.get(asset);
    if (!window) {
      window = new PriceWindow(asset);
      this.priceWindows.set(asset, window);
    }
    window.add(price, timestamp, block);
  }

  /**
   * Evaluate users and generate predictive candidates
   * @param users User snapshots to evaluate
   * @param currentBlock Current block number
   * @returns Array of predictive candidates that may cross threshold
   */
  public async evaluate(
    users: UserSnapshot[],
    currentBlock: number
  ): Promise<PredictiveCandidate[]> {
    if (!this.config.enabled) {
      return [];
    }

    // Limit users per tick
    const usersToEvaluate = users.slice(0, this.config.maxUsersPerTick);
    const candidates: PredictiveCandidate[] = [];
    const thresholdHf = 1.0 + this.config.hfBufferBps / 10000;
    const now = Date.now();

    for (const user of usersToEvaluate) {
      // Calculate current HF
      const hfCurrent = HFCalculator.calculateHF(user);

      // Only evaluate users near threshold
      if (hfCurrent > 1.2) {
        continue;
      }

      // Evaluate each scenario
      for (const scenarioSpec of DEFAULT_SCENARIOS) {
        if (!this.config.scenarios.includes(scenarioSpec.scenario)) {
          continue;
        }

        // Build price changes map based on scenario
        const priceChanges = this.buildPriceChangesMap(user, scenarioSpec.priceMultiplier);
        
        // Project HF with price changes
        const hfProjected = HFCalculator.projectHF(user, priceChanges);

        // Check if projected HF crosses threshold
        if (hfProjected < thresholdHf) {
          // Estimate time to crossing (simplified linear projection)
          const hfDelta = hfCurrent - hfProjected;
          const etaSec = hfDelta > 0 
            ? Math.floor((hfCurrent - thresholdHf) / hfDelta * this.config.horizonSec)
            : this.config.horizonSec;

          candidates.push({
            address: user.address,
            scenario: scenarioSpec.scenario,
            hfCurrent,
            hfProjected,
            etaSec: Math.max(0, Math.min(etaSec, this.config.horizonSec)),
            impactedReserves: user.reserves.map(r => r.asset),
            totalDebtUsd: user.reserves.reduce((sum, r) => sum + r.debtUsd, 0),
            totalCollateralUsd: user.reserves.reduce((sum, r) => sum + r.collateralUsd, 0),
            timestamp: now,
            block: currentBlock
          });
        }
      }
    }

    this.lastTickMs = now;

    if (candidates.length > 0) {
      console.log(
        `[predictive-engine] Generated ${candidates.length} candidates ` +
        `(evaluated ${usersToEvaluate.length} users)`
      );
    }

    return candidates;
  }

  /**
   * Build price changes map for a scenario
   */
  private buildPriceChangesMap(user: UserSnapshot, priceMultiplier: number): Map<string, number> {
    const changes = new Map<string, number>();
    
    for (const reserve of user.reserves) {
      // Apply scenario multiplier to collateral assets (conservative approach)
      if (reserve.collateralUsd > 0) {
        changes.set(reserve.asset, priceMultiplier);
      } else {
        changes.set(reserve.asset, 1.0);
      }
    }

    return changes;
  }

  /**
   * Get statistics about the predictive engine
   */
  public getStats(): {
    enabled: boolean;
    priceWindowsCount: number;
    lastTickMs: number;
  } {
    return {
      enabled: this.config.enabled,
      priceWindowsCount: this.priceWindows.size,
      lastTickMs: this.lastTickMs
    };
  }
}
