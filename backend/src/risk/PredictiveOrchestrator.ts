/**
 * PredictiveOrchestrator: Integration layer for predictive HF engine
 * 
 * Coordinates predictive candidate flow into execution primitives:
 * - RealTimeHFService (micro-verification, priority queues)
 * - SprinterEngine (pre-staging)
 * - Fast-path readiness
 * 
 * Operates independently of PRE_SIM_ENABLED flag.
 */

import { config } from '../config/index.js';
import { PredictiveEngine } from './PredictiveEngine.js';
import { PriceWindow } from './PriceWindow.js';
import type { UserSnapshot } from './HFCalculator.js';
import type { PredictiveCandidate } from './models/PredictiveCandidate.js';
import {
  predictiveIngestedTotal,
  predictiveQueueEntriesTotal,
  predictiveMicroVerifyScheduledTotal,
  predictivePrestagedTotal,
  predictiveFastpathFlaggedTotal,
  predictiveDynamicBufferCurrentBps
} from '../metrics/index.js';

export interface PredictiveOrchestratorConfig {
  enabled: boolean;
  queueEnabled: boolean;
  microVerifyEnabled: boolean;
  fastpathEnabled: boolean;
  dynamicBufferEnabled: boolean;
  volatilityBpsScaleMin: number;
  volatilityBpsScaleMax: number;
}

export interface PredictiveScenarioEvent {
  type: 'predictive_scenario';
  candidate: PredictiveCandidate;
  priority: number;
  shouldMicroVerify: boolean;
  shouldPrestage: boolean;
  shouldFlagFastpath: boolean;
}

/**
 * Listener interface for predictive events
 */
export interface PredictiveEventListener {
  onPredictiveCandidate(event: PredictiveScenarioEvent): Promise<void>;
}

/**
 * PredictiveOrchestrator manages predictive candidate flow
 */
export class PredictiveOrchestrator {
  private readonly config: PredictiveOrchestratorConfig;
  private readonly engine: PredictiveEngine;
  private readonly listeners: PredictiveEventListener[] = [];
  private readonly priceWindows: Map<string, PriceWindow> = new Map();

  constructor(configOverride?: Partial<PredictiveOrchestratorConfig>) {
    this.config = {
      enabled: configOverride?.enabled ?? config.predictiveEnabled,
      queueEnabled: configOverride?.queueEnabled ?? config.predictiveQueueEnabled,
      microVerifyEnabled: configOverride?.microVerifyEnabled ?? config.predictiveMicroVerifyEnabled,
      fastpathEnabled: configOverride?.fastpathEnabled ?? config.predictiveFastpathEnabled,
      dynamicBufferEnabled: configOverride?.dynamicBufferEnabled ?? config.predictiveDynamicBufferEnabled,
      volatilityBpsScaleMin: configOverride?.volatilityBpsScaleMin ?? config.predictiveVolatilityBpsScaleMin,
      volatilityBpsScaleMax: configOverride?.volatilityBpsScaleMax ?? config.predictiveVolatilityBpsScaleMax
    };

    this.engine = new PredictiveEngine();

    if (this.config.enabled) {
      console.log(
        `[predictive-orchestrator] Initialized: ` +
        `queue=${this.config.queueEnabled}, ` +
        `microVerify=${this.config.microVerifyEnabled}, ` +
        `fastpath=${this.config.fastpathEnabled}, ` +
        `dynamicBuffer=${this.config.dynamicBufferEnabled}`
      );
    }
  }

  /**
   * Check if orchestrator is enabled
   */
  public isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Register a listener for predictive events
   */
  public addListener(listener: PredictiveEventListener): void {
    this.listeners.push(listener);
  }

  /**
   * Update price for an asset
   */
  public updatePrice(asset: string, price: number, timestamp: number, block: number): void {
    if (!this.config.enabled) {
      return;
    }

    // Update engine's price window
    this.engine.updatePrice(asset, price, timestamp, block);

    // Track local price window for volatility calculation if dynamic buffer enabled
    if (this.config.dynamicBufferEnabled) {
      let window = this.priceWindows.get(asset);
      if (!window) {
        window = new PriceWindow(asset);
        this.priceWindows.set(asset, window);
      }
      window.add(price, timestamp, block);
    }
  }

  /**
   * Evaluate users and generate predictive candidates
   */
  public async evaluate(users: UserSnapshot[], currentBlock: number): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Generate candidates from predictive engine
    const candidates = await this.engine.evaluate(users, currentBlock);

    if (candidates.length === 0) {
      return;
    }

    // Calculate dynamic buffer if enabled
    const effectiveBufferBps = this.calculateEffectiveBuffer();
    if (this.config.dynamicBufferEnabled) {
      predictiveDynamicBufferCurrentBps.set(effectiveBufferBps);
    }

    // Process each candidate
    for (const candidate of candidates) {
      await this.processCandidate(candidate, effectiveBufferBps);
    }
  }

  /**
   * Process a single predictive candidate
   */
  private async processCandidate(
    candidate: PredictiveCandidate,
    effectiveBufferBps: number
  ): Promise<void> {
    // Track ingestion metric
    predictiveIngestedTotal.inc({ scenario: candidate.scenario });

    // Calculate priority score (lower = higher priority)
    // Factors: projected HF, ETA, debt size, scenario severity
    const scenarioWeight = this.getScenarioWeight(candidate.scenario);
    const priority = this.calculatePriority(candidate, scenarioWeight);

    // Determine actions based on configuration and thresholds
    const thresholdHf = 1.0 + effectiveBufferBps / 10000;
    const shouldMicroVerify = 
      this.config.microVerifyEnabled && 
      candidate.hfProjected < thresholdHf;
    
    const shouldPrestage = 
      this.config.queueEnabled && 
      candidate.hfProjected < 1.02; // Prestage threshold (1.02)
    
    const shouldFlagFastpath = 
      this.config.fastpathEnabled && 
      candidate.hfProjected < 1.0 && 
      candidate.etaSec <= 30; // Fast-path ETA threshold (30s)

    // Create event
    const event: PredictiveScenarioEvent = {
      type: 'predictive_scenario',
      candidate,
      priority,
      shouldMicroVerify,
      shouldPrestage,
      shouldFlagFastpath
    };

    // Update metrics
    if (shouldMicroVerify) {
      predictiveMicroVerifyScheduledTotal.inc({ scenario: candidate.scenario });
    }
    if (shouldPrestage) {
      predictivePrestagedTotal.inc({ scenario: candidate.scenario });
    }
    if (shouldFlagFastpath) {
      predictiveFastpathFlaggedTotal.inc({ scenario: candidate.scenario });
    }
    if (this.config.queueEnabled) {
      predictiveQueueEntriesTotal.inc({ reason: 'predictive_scenario' });
    }

    // Notify listeners
    await this.notifyListeners(event);
  }

  /**
   * Calculate priority score for a candidate
   * Lower score = higher priority
   */
  private calculatePriority(candidate: PredictiveCandidate, scenarioWeight: number): number {
    // Base priority from projected HF (lower HF = higher priority)
    const hfComponent = candidate.hfProjected * 1000;
    
    // ETA component (sooner = higher priority)
    const etaComponent = candidate.etaSec / 10;
    
    // Debt size component (larger debt = higher priority)
    const debtComponent = -Math.log10(Math.max(candidate.totalDebtUsd, 1));
    
    // Scenario weight (more severe = higher priority)
    const scenarioComponent = scenarioWeight * 100;

    return hfComponent + etaComponent + debtComponent + scenarioComponent;
  }

  /**
   * Get scenario severity weight
   */
  private getScenarioWeight(scenario: string): number {
    switch (scenario) {
      case 'baseline':
        return 1.0;
      case 'adverse':
        return 0.8;
      case 'extreme':
        return 0.6;
      default:
        return 1.0;
    }
  }

  /**
   * Calculate effective buffer based on volatility if dynamic buffer enabled
   */
  private calculateEffectiveBuffer(): number {
    if (!this.config.dynamicBufferEnabled) {
      return config.predictiveHfBufferBps;
    }

    // Calculate average volatility across all tracked assets
    // Use 20-period lookback for volatility calculation
    const periods = 20;
    let totalVolatility = 0;
    let count = 0;

    for (const window of this.priceWindows.values()) {
      const volatility = window.getVolatility(periods);
      if (volatility !== null && volatility > 0) {
        totalVolatility += volatility;
        count++;
      }
    }

    if (count === 0) {
      return config.predictiveHfBufferBps;
    }

    const avgVolatility = totalVolatility / count;

    // Scale buffer based on volatility
    // Higher volatility = higher buffer
    const baseBuffer = config.predictiveHfBufferBps;
    const minBuffer = this.config.volatilityBpsScaleMin;
    const maxBuffer = this.config.volatilityBpsScaleMax;

    // Linear scaling: volatility 0.0-0.05 maps to min-max buffer
    const volatilityFactor = Math.min(avgVolatility / 0.05, 1.0);
    const scaledBuffer = baseBuffer + (maxBuffer - minBuffer) * volatilityFactor;

    return Math.max(minBuffer, Math.min(maxBuffer, scaledBuffer));
  }

  /**
   * Notify all listeners of a predictive event
   */
  private async notifyListeners(event: PredictiveScenarioEvent): Promise<void> {
    const promises = this.listeners.map(listener => 
      listener.onPredictiveCandidate(event).catch(err => {
        console.error(`[predictive-orchestrator] Listener error:`, err);
      })
    );
    await Promise.all(promises);
  }

  /**
   * Get orchestrator statistics
   */
  public getStats(): {
    enabled: boolean;
    queueEnabled: boolean;
    microVerifyEnabled: boolean;
    fastpathEnabled: boolean;
    dynamicBufferEnabled: boolean;
    engineStats: ReturnType<PredictiveEngine['getStats']>;
    priceWindowsCount: number;
  } {
    return {
      enabled: this.config.enabled,
      queueEnabled: this.config.queueEnabled,
      microVerifyEnabled: this.config.microVerifyEnabled,
      fastpathEnabled: this.config.fastpathEnabled,
      dynamicBufferEnabled: this.config.dynamicBufferEnabled,
      engineStats: this.engine.getStats(),
      priceWindowsCount: this.priceWindows.size
    };
  }
}
