// PipelineMetrics: Comprehensive observability for the liquidation pipeline
// Tracks the full funnel: candidates → verified → profitable → executed

import { Counter, Histogram, Gauge, register } from 'prom-client';

/**
 * Structured reason codes for decision tracking
 */
export enum SkipReason {
  // Discovery/Dedupe
  DUPLICATE_BLOCK = 'duplicate_block',
  COOLDOWN = 'cooldown',
  
  // Verification
  VERIFICATION_FAILED = 'verification_failed',
  ZERO_DEBT = 'zero_debt',
  BELOW_MIN_DEBT_USD = 'below_min_debt_usd',
  HF_OK = 'hf_ok',
  HF_LT_1 = 'hf_lt_1',
  
  // Risk Model
  STALE_PRICE = 'stale_price',
  PRICE_MISSING = 'price_missing',
  ASSET_FROZEN = 'asset_frozen',
  ASSET_PAUSED = 'asset_paused',
  ASSET_DENIED = 'asset_denied',
  
  // Profitability
  NO_VALID_ASSETS = 'no_valid_assets',
  NOT_PROFITABLE = 'not_profitable',
  GAS_TOO_HIGH = 'gas_too_high',
  SLIPPAGE_TOO_HIGH = 'slippage_too_high',
  
  // Execution
  EXECUTION_DISABLED = 'execution_disabled',
  DRY_RUN = 'dry_run',
  TX_FAILED = 'tx_failed',
  TX_REVERTED = 'tx_reverted',
  
  // Other
  ERROR = 'error',
  UNKNOWN = 'unknown'
}

/**
 * Pipeline stage for funnel tracking
 */
export enum PipelineStage {
  DISCOVERED = 'discovered',
  VERIFIED = 'verified',
  PROFITABLE = 'profitable',
  EXECUTED = 'executed'
}

/**
 * PipelineMetrics provides comprehensive observability for the liquidation pipeline
 */
export class PipelineMetrics {
  // Funnel counters
  private candidatesDiscovered: Counter;
  private candidatesVerified: Counter;
  private candidatesProfitable: Counter;
  private candidatesExecuted: Counter;
  
  // Skip reason tracking
  private candidatesSkipped: Counter;
  
  // Latency histograms
  private verificationLatency: Histogram;
  private profitabilityLatency: Histogram;
  private executionLatency: Histogram;
  
  // Health factor gauge
  private minHealthFactor: Gauge;
  private minHealthFactorValue: number; // Track the actual value internally
  
  // Success/failure tracking
  private executionSuccess: Counter;
  private executionFailure: Counter;
  
  // PnL tracking
  private realizedPnL: Counter;
  
  // Duplicate tracking
  private duplicatesDropped: Counter;
  
  constructor() {
    // Funnel metrics
    this.candidatesDiscovered = new Counter({
      name: 'pipeline_candidates_discovered_total',
      help: 'Total number of candidates discovered',
      labelNames: ['trigger_type'], // event, head, price
      registers: [register]
    });
    
    this.candidatesVerified = new Counter({
      name: 'pipeline_candidates_verified_total',
      help: 'Total number of candidates verified',
      registers: [register]
    });
    
    this.candidatesProfitable = new Counter({
      name: 'pipeline_candidates_profitable_total',
      help: 'Total number of profitable candidates',
      registers: [register]
    });
    
    this.candidatesExecuted = new Counter({
      name: 'pipeline_candidates_executed_total',
      help: 'Total number of candidates executed',
      registers: [register]
    });
    
    // Skip reasons
    this.candidatesSkipped = new Counter({
      name: 'pipeline_candidates_skipped_total',
      help: 'Total number of candidates skipped',
      labelNames: ['reason'],
      registers: [register]
    });
    
    // Latency
    this.verificationLatency = new Histogram({
      name: 'pipeline_verification_latency_ms',
      help: 'Verification latency in milliseconds',
      buckets: [10, 50, 100, 200, 500, 1000, 2000],
      registers: [register]
    });
    
    this.profitabilityLatency = new Histogram({
      name: 'pipeline_profitability_latency_ms',
      help: 'Profitability simulation latency in milliseconds',
      buckets: [10, 50, 100, 200, 500, 1000],
      registers: [register]
    });
    
    this.executionLatency = new Histogram({
      name: 'pipeline_execution_latency_ms',
      help: 'Execution latency in milliseconds',
      buckets: [100, 500, 1000, 2000, 5000, 10000, 30000],
      registers: [register]
    });
    
    // Health factor
    this.minHealthFactor = new Gauge({
      name: 'pipeline_min_health_factor',
      help: 'Minimum health factor seen',
      registers: [register]
    });
    
    // Execution results
    this.executionSuccess = new Counter({
      name: 'pipeline_execution_success_total',
      help: 'Total number of successful executions',
      registers: [register]
    });
    
    this.executionFailure = new Counter({
      name: 'pipeline_execution_failure_total',
      help: 'Total number of failed executions',
      labelNames: ['reason'],
      registers: [register]
    });
    
    // PnL
    this.realizedPnL = new Counter({
      name: 'pipeline_realized_pnl_usd',
      help: 'Realized profit/loss in USD',
      registers: [register]
    });
    
    // Duplicates
    this.duplicatesDropped = new Counter({
      name: 'pipeline_duplicates_dropped_total',
      help: 'Total number of duplicate candidates dropped',
      registers: [register]
    });
    
    // Initialize minimum health factor value
    this.minHealthFactorValue = 0;
  }
  
  /**
   * Record candidate discovery
   */
  recordDiscovery(triggerType: 'event' | 'head' | 'price'): void {
    this.candidatesDiscovered.inc({ trigger_type: triggerType });
  }
  
  /**
   * Record successful verification
   */
  recordVerified(latencyMs: number): void {
    this.candidatesVerified.inc();
    this.verificationLatency.observe(latencyMs);
  }
  
  /**
   * Record profitable candidate
   */
  recordProfitable(latencyMs: number): void {
    this.candidatesProfitable.inc();
    this.profitabilityLatency.observe(latencyMs);
  }
  
  /**
   * Record execution
   */
  recordExecuted(latencyMs: number, success: boolean, profitUsd?: number): void {
    this.candidatesExecuted.inc();
    this.executionLatency.observe(latencyMs);
    
    if (success) {
      this.executionSuccess.inc();
      if (profitUsd !== undefined) {
        this.realizedPnL.inc(profitUsd);
      }
    } else {
      this.executionFailure.inc({ reason: 'execution_failed' });
    }
  }
  
  /**
   * Record skipped candidate with reason
   */
  recordSkipped(reason: SkipReason): void {
    this.candidatesSkipped.inc({ reason });
  }
  
  /**
   * Record duplicate dropped
   */
  recordDuplicate(): void {
    this.duplicatesDropped.inc();
  }
  
  /**
   * Update minimum health factor
   */
  updateMinHealthFactor(hf: number): void {
    if (this.minHealthFactorValue === 0 || hf < this.minHealthFactorValue) {
      this.minHealthFactorValue = hf;
      this.minHealthFactor.set(hf);
    }
  }
  
  /**
   * Get current metrics summary
   */
  getSummary(): {
    discovered: number;
    verified: number;
    profitable: number;
    executed: number;
    skipped: Record<string, number>;
    duplicates: number;
    successRate: number;
  } {
    // Note: This is a simplified summary. For full metrics, use the /metrics endpoint
    return {
      discovered: 0, // Would need to query the Counter
      verified: 0,
      profitable: 0,
      executed: 0,
      skipped: {},
      duplicates: 0,
      successRate: 0
    };
  }
}

// Singleton instance
export const pipelineMetrics = new PipelineMetrics();
