/**
 * PredictiveOrchestrator: Integration layer for predictive HF engine
 * 
 * Coordinates predictive candidate flow into execution primitives:
 * - RealTimeHFService (micro-verification, priority queues)
 * - SprinterEngine (pre-staging)
 * - Fast-path readiness
 * 
 * Features:
 * - Periodic fallback evaluation when events are quiet
 * - Priority scoring based on configurable weights
 * - Dynamic buffer scaling based on volatility
 * 
 * Operates independently of PRE_SIM_ENABLED flag.
 */

import { config } from '../config/index.js';
import {
  predictiveIngestedTotal,
  predictiveQueueEntriesTotal,
  predictiveMicroVerifyScheduledTotal,
  predictivePrestagedTotal,
  predictiveFastpathFlaggedTotal,
  predictiveDynamicBufferCurrentBps,
  predictiveEvaluationRunsTotal,
  predictiveCandidatesGeneratedTotal,
  predictiveCandidatesFilteredTotal,
  predictiveEtaDistributionSec,
  predictiveEvaluationDurationMs
} from '../metrics/index.js';

import { PredictiveEngine } from './PredictiveEngine.js';
import { PriceWindow } from './PriceWindow.js';
import type { UserSnapshot } from './HFCalculator.js';
import type { PredictiveCandidate } from './models/PredictiveCandidate.js';

export interface PredictiveOrchestratorConfig {
  enabled: boolean;
  queueEnabled: boolean;
  microVerifyEnabled: boolean;
  fastpathEnabled: boolean;
  dynamicBufferEnabled: boolean;
  volatilityBpsScaleMin: number;
  volatilityBpsScaleMax: number;
  fallbackIntervalBlocks: number;
  fallbackIntervalMs: number;
  fastpathEtaCapSec: number;
  priorityHfWeight: number;
  priorityEtaWeight: number;
  priorityDebtWeight: number;
  priorityScenarioWeightBaseline: number;
  priorityScenarioWeightAdverse: number;
  priorityScenarioWeightExtreme: number;
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
 * User provider interface for fallback evaluation
 */
export interface UserSnapshotProvider {
  getUserSnapshots(maxUsers: number): Promise<UserSnapshot[]>;
}

/**
 * PredictiveOrchestrator manages predictive candidate flow
 */
export class PredictiveOrchestrator {
  private readonly config: PredictiveOrchestratorConfig;
  private readonly engine: PredictiveEngine;
  private readonly listeners: PredictiveEventListener[] = [];
  private readonly priceWindows: Map<string, PriceWindow> = new Map();
  
  // Periodic fallback evaluation state
  private lastEvaluationBlock = 0;
  private lastEvaluationTs = 0;
  private fallbackTimer?: NodeJS.Timeout;
  private userProvider?: UserSnapshotProvider;
  private isShuttingDown = false;

  constructor(configOverride?: Partial<PredictiveOrchestratorConfig>) {
    this.config = {
      enabled: configOverride?.enabled ?? config.predictiveEnabled,
      queueEnabled: configOverride?.queueEnabled ?? config.predictiveQueueEnabled,
      microVerifyEnabled: configOverride?.microVerifyEnabled ?? config.predictiveMicroVerifyEnabled,
      fastpathEnabled: configOverride?.fastpathEnabled ?? config.predictiveFastpathEnabled,
      dynamicBufferEnabled: configOverride?.dynamicBufferEnabled ?? config.predictiveDynamicBufferEnabled,
      volatilityBpsScaleMin: configOverride?.volatilityBpsScaleMin ?? config.predictiveVolatilityBpsScaleMin,
      volatilityBpsScaleMax: configOverride?.volatilityBpsScaleMax ?? config.predictiveVolatilityBpsScaleMax,
      fallbackIntervalBlocks: configOverride?.fallbackIntervalBlocks ?? config.predictiveFallbackIntervalBlocks,
      fallbackIntervalMs: configOverride?.fallbackIntervalMs ?? config.predictiveFallbackIntervalMs,
      fastpathEtaCapSec: configOverride?.fastpathEtaCapSec ?? config.fastpathPredictiveEtaCapSec,
      priorityHfWeight: configOverride?.priorityHfWeight ?? config.predictivePriorityHfWeight,
      priorityEtaWeight: configOverride?.priorityEtaWeight ?? config.predictivePriorityEtaWeight,
      priorityDebtWeight: configOverride?.priorityDebtWeight ?? config.predictivePriorityDebtWeight,
      priorityScenarioWeightBaseline: configOverride?.priorityScenarioWeightBaseline ?? config.predictivePriorityScenarioWeightBaseline,
      priorityScenarioWeightAdverse: configOverride?.priorityScenarioWeightAdverse ?? config.predictivePriorityScenarioWeightAdverse,
      priorityScenarioWeightExtreme: configOverride?.priorityScenarioWeightExtreme ?? config.predictivePriorityScenarioWeightExtreme
    };

    this.engine = new PredictiveEngine();

    if (this.config.enabled) {
      console.log(
        `[predictive-orchestrator] Initialized: ` +
        `queue=${this.config.queueEnabled}, ` +
        `microVerify=${this.config.microVerifyEnabled}, ` +
        `fastpath=${this.config.fastpathEnabled}, ` +
        `dynamicBuffer=${this.config.dynamicBufferEnabled}, ` +
        `fallbackBlocks=${this.config.fallbackIntervalBlocks}, ` +
        `fallbackMs=${this.config.fallbackIntervalMs}`
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
   * Set user snapshot provider for fallback evaluations
   */
  public setUserProvider(provider: UserSnapshotProvider): void {
    this.userProvider = provider;
  }

  /**
   * Start periodic fallback evaluation timer
   */
  public startFallbackTimer(): void {
    if (!this.config.enabled || this.fallbackTimer) {
      return;
    }

    console.log(
      `[predictive-orchestrator] Starting fallback timer: intervalMs=${this.config.fallbackIntervalMs}`
    );

    this.fallbackTimer = setInterval(() => {
      if (!this.isShuttingDown) {
        this.maybeRunFallbackEvaluation().catch(err => {
          console.error(`[predictive-orchestrator] Fallback evaluation error:`, err);
        });
      }
    }, this.config.fallbackIntervalMs);
  }

  /**
   * Stop the orchestrator and clean up
   */
  public stop(): void {
    this.isShuttingDown = true;
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = undefined;
    }
    console.log('[predictive-orchestrator] Stopped');
  }

  /**
   * Maybe run fallback evaluation if enough time/blocks have passed
   */
  private async maybeRunFallbackEvaluation(): Promise<void> {
    if (!this.userProvider) {
      return;
    }

    const now = Date.now();
    const timeSinceLastEval = now - this.lastEvaluationTs;

    // Check time-based fallback
    if (timeSinceLastEval < this.config.fallbackIntervalMs) {
      return;
    }

    // Fetch users and run evaluation
    try {
      const users = await this.userProvider.getUserSnapshots(config.predictiveMaxUsersPerTick);
      
      if (users.length === 0) {
        return;
      }

      // Use the max block from users as current block
      const currentBlock = Math.max(...users.map(u => u.block));

      // Check block-based fallback
      const blocksSinceLastEval = currentBlock - this.lastEvaluationBlock;
      if (blocksSinceLastEval < this.config.fallbackIntervalBlocks) {
        return;
      }

      await this.evaluateWithReason(users, currentBlock, 'fallback');
    } catch (err) {
      console.error(`[predictive-orchestrator] Fallback user fetch error:`, err);
    }
  }

  /**
   * Notify of a new block (for block-based fallback check)
   */
  public onNewBlock(blockNumber: number): void {
    if (!this.config.enabled) {
      return;
    }

    // Check if we need to trigger fallback based on blocks
    const blocksSinceLastEval = blockNumber - this.lastEvaluationBlock;
    if (blocksSinceLastEval >= this.config.fallbackIntervalBlocks && this.userProvider) {
      this.maybeRunFallbackEvaluation().catch(err => {
        console.error(`[predictive-orchestrator] Block-triggered fallback error:`, err);
      });
    }
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
   * Evaluate users from an event trigger
   */
  public async evaluate(users: UserSnapshot[], currentBlock: number): Promise<void> {
    return this.evaluateWithReason(users, currentBlock, 'event');
  }

  /**
   * Evaluate users and generate predictive candidates with reason tracking
   */
  public async evaluateWithReason(
    users: UserSnapshot[], 
    currentBlock: number, 
    reason: 'event' | 'fallback'
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const startTime = Date.now();

    // Track evaluation run
    predictiveEvaluationRunsTotal.inc({ reason });

    // Update last evaluation tracking
    this.lastEvaluationBlock = currentBlock;
    this.lastEvaluationTs = startTime;

    // Generate candidates from predictive engine
    const candidates = await this.engine.evaluate(users, currentBlock);

    const durationMs = Date.now() - startTime;
    predictiveEvaluationDurationMs.observe(durationMs);

    // Log evaluation run
    console.log(
      `[predictive-orchestrator] run block=${currentBlock} reason=${reason} ` +
      `usersEvaluated=${users.length} candidates=${candidates.length} durationMs=${durationMs}`
    );

    if (candidates.length === 0) {
      return;
    }

    // Track generated candidates by scenario
    for (const candidate of candidates) {
      predictiveCandidatesGeneratedTotal.inc({ scenario: candidate.scenario });
    }

    // Calculate dynamic buffer if enabled
    const effectiveBufferBps = this.calculateEffectiveBuffer();
    if (this.config.dynamicBufferEnabled) {
      predictiveDynamicBufferCurrentBps.set(effectiveBufferBps);
    }

    // Process each candidate
    for (const candidate of candidates) {
      await this.processCandidate(candidate, effectiveBufferBps, currentBlock);
    }
  }

  /**
   * Process a single predictive candidate
   */
  private async processCandidate(
    candidate: PredictiveCandidate,
    effectiveBufferBps: number,
    currentBlock: number
  ): Promise<void> {
    // Track ingestion metric
    predictiveIngestedTotal.inc({ scenario: candidate.scenario });

    // Track ETA distribution
    predictiveEtaDistributionSec.observe({ scenario: candidate.scenario }, candidate.etaSec);

    // Log candidate details (debug level)
    console.log(
      `[predictive-orchestrator] candidate user=${candidate.address} scenario=${candidate.scenario} ` +
      `hfCurrent=${candidate.hfCurrent?.toFixed(4) ?? 'N/A'} hfProjected=${candidate.hfProjected.toFixed(4)} ` +
      `etaSec=${candidate.etaSec} debtUsd=${candidate.totalDebtUsd.toFixed(2)}`
    );

    // Calculate priority score (lower = higher priority)
    // Factors: projected HF, ETA, debt size, scenario severity
    const scenarioWeight = this.getScenarioWeight(candidate.scenario);
    const priority = this.calculatePriority(candidate, scenarioWeight);

    // Determine actions based on configuration and thresholds
    const thresholdHf = 1.0 + effectiveBufferBps / 10000;
    const shouldMicroVerify = 
      this.config.microVerifyEnabled && 
      candidate.hfProjected < thresholdHf;
    
    const prestageThreshold = config.prestageHfBps / 10000;
    const shouldPrestage = 
      this.config.queueEnabled && 
      candidate.hfProjected < prestageThreshold &&
      candidate.totalDebtUsd >= config.minDebtUsd;
    
    const shouldFlagFastpath = 
      this.config.fastpathEnabled && 
      candidate.hfProjected < 1.0 && 
      candidate.etaSec <= this.config.fastpathEtaCapSec;

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
   * Calculate priority score for a candidate using configurable weights
   * Formula: (1/etaSec) * (hfCurrent - hfProjected) * log(totalDebtUsd + 1) * scenarioWeight
   * Lower score = higher priority
   */
  private calculatePriority(candidate: PredictiveCandidate, scenarioWeight: number): number {
    const hfCurrent = candidate.hfCurrent ?? 1.0;
    const hfDelta = Math.max(0, hfCurrent - candidate.hfProjected);
    
    // ETA component: 1/etaSec (faster = higher priority = lower score)
    const etaFactor = candidate.etaSec > 0 ? 1 / candidate.etaSec : 1;
    
    // HF delta component: larger delta = higher priority
    const hfComponent = hfDelta * this.config.priorityHfWeight;
    
    // ETA component with weight
    const etaComponent = etaFactor * this.config.priorityEtaWeight;
    
    // Debt component: log scale for large debt advantage
    const debtComponent = Math.log10(Math.max(candidate.totalDebtUsd, 1) + 1) * this.config.priorityDebtWeight;
    
    // Combined score (invert so lower = higher priority)
    const rawScore = hfComponent * etaComponent * debtComponent * scenarioWeight;
    
    // Return inverted (lower = higher priority)
    return rawScore > 0 ? 1 / rawScore : Number.MAX_VALUE;
  }

  /**
   * Get scenario severity weight from config
   */
  private getScenarioWeight(scenario: string): number {
    switch (scenario) {
      case 'baseline':
        return this.config.priorityScenarioWeightBaseline;
      case 'adverse':
        return this.config.priorityScenarioWeightAdverse;
      case 'extreme':
        return this.config.priorityScenarioWeightExtreme;
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
    lastEvaluationBlock: number;
    lastEvaluationTs: number;
  } {
    return {
      enabled: this.config.enabled,
      queueEnabled: this.config.queueEnabled,
      microVerifyEnabled: this.config.microVerifyEnabled,
      fastpathEnabled: this.config.fastpathEnabled,
      dynamicBufferEnabled: this.config.dynamicBufferEnabled,
      engineStats: this.engine.getStats(),
      priceWindowsCount: this.priceWindows.size,
      lastEvaluationBlock: this.lastEvaluationBlock,
      lastEvaluationTs: this.lastEvaluationTs
    };
  }
}
