/**
 * CriticalLane: Low-latency execution path for HF < 1.0 accounts
 * 
 * Bypasses batch verification and queue-based staging to achieve <180ms latency.
 * Performs minimal validation, builds intent, and submits immediately.
 */

import type { Contract } from 'ethers';

import { config } from '../../config/index.js';
import { calculateUsdValue } from '../../utils/usdMath.js';
import type { AaveDataService } from '../../services/AaveDataService.js';
import type { ProfitEstimator } from '../../services/ProfitEstimator.js';
import type { IntentBuilder, LiquidationIntent } from '../../execution/IntentBuilder.js';
import type { PrivateTxSender } from '../../execution/PrivateTxSender.js';
import type { LiquidationAuditService } from '../../services/liquidationAudit.js';
import { getExecutionMetrics } from '../../metrics/index.js';

export interface BorrowerState {
  address: string;
  currentHF: number;
  projectedHF?: number;
  totalDebtBase: bigint;
  totalCollateralBase: bigint;
  blockNumber: number;
  timestamp: number;
}

export interface CriticalLaneConfig {
  enabled: boolean;
  profitMinUsd: number;
  allowUnprofitableInitial: boolean;
  latencyWarnMs: number;
  priceStalenessSeconds: number;
}

export interface CriticalLaneResult {
  success: boolean;
  reason?: string;
  txHash?: string;
  latencyMs?: number;
}

/**
 * CriticalLane orchestrates immediate liquidation execution for HF < 1.0 accounts
 */
export class CriticalLane {
  private config: CriticalLaneConfig;
  private aaveDataService: AaveDataService;
  private profitEstimator: ProfitEstimator;
  private intentBuilder?: IntentBuilder;
  private privateTxSender?: PrivateTxSender;
  private liquidationAudit?: LiquidationAuditService;
  private aavePool?: Contract;
  
  // Track unprofitable executions for initial override
  private unprofitableExecutions = 0;
  private readonly maxUnprofitableExecutions = 1;
  
  // Metrics
  private metrics = getExecutionMetrics();

  constructor(
    aaveDataService: AaveDataService,
    profitEstimator: ProfitEstimator,
    options?: {
      intentBuilder?: IntentBuilder;
      privateTxSender?: PrivateTxSender;
      liquidationAudit?: LiquidationAuditService;
      aavePool?: Contract;
    }
  ) {
    this.config = {
      enabled: config.criticalLaneEnabled,
      profitMinUsd: config.criticalLaneProfitMinUsd,
      allowUnprofitableInitial: config.criticalLaneAllowUnprofitableInitial,
      latencyWarnMs: config.criticalLaneLatencyWarnMs,
      priceStalenessSeconds: config.priceStalenessSeconds
    };
    
    this.aaveDataService = aaveDataService;
    this.profitEstimator = profitEstimator;
    this.intentBuilder = options?.intentBuilder;
    this.privateTxSender = options?.privateTxSender;
    this.liquidationAudit = options?.liquidationAudit;
    this.aavePool = options?.aavePool;
    
    if (this.config.enabled) {
      // eslint-disable-next-line no-console
      console.log('[critical-lane] Initialized:', {
        profitMinUsd: this.config.profitMinUsd,
        allowUnprofitableInitial: this.config.allowUnprofitableInitial,
        latencyWarnMs: this.config.latencyWarnMs
      });
    }
  }

  /**
   * Check if a borrower qualifies for critical lane processing
   * Strict numeric check: hf < 1.0 (no rounding)
   */
  shouldProcess(borrower: BorrowerState): boolean {
    if (!this.config.enabled) {
      return false;
    }
    
    // Strict numeric comparison: HF must be strictly less than 1.0
    return borrower.currentHF < 1.0;
  }

  /**
   * Process a critical borrower through the fast lane
   * Main entry point for immediate execution
   */
  async process(borrower: BorrowerState): Promise<CriticalLaneResult> {
    const startMs = Date.now();
    
    // eslint-disable-next-line no-console
    console.log(`[critical] user=${borrower.address} hf=${borrower.currentHF.toFixed(4)} action=fast-path stage=detect`);
    
    try {
      // Step 1: Recompute HF to ensure freshness
      const detectStart = Date.now();
      const recomputedState = await this.recomputeHF(borrower);
      const detectDelta = Date.now() - detectStart;
      this.metrics.criticalLaneDetectMs.observe(detectDelta);
      
      // eslint-disable-next-line no-console
      console.log(`[critical] user=${borrower.address} stage=recompute delta=${detectDelta}ms hf=${recomputedState.currentHF.toFixed(4)}`);
      
      // Verify still liquidatable after recompute
      if (recomputedState.currentHF >= 1.0) {
        this.metrics.criticalLaneSkippedTotal.inc({ reason: 'hf_above_threshold' });
        // eslint-disable-next-line no-console
        console.log(`[critical-audit] user=${borrower.address} reason=CRITICAL_SKIPPED_HF_RECOVERY originalHf=${borrower.currentHF.toFixed(4)} recomputedHf=${recomputedState.currentHF.toFixed(4)}`);
        return {
          success: false,
          reason: 'hf_recovered'
        };
      }
      
      // Step 2: Verify liquidatable and check profitability
      const verifyResult = await this.verifyLiquidatable(recomputedState);
      if (!verifyResult.success) {
        this.metrics.criticalLaneSkippedTotal.inc({ reason: verifyResult.reason || 'verification_failed' });
        // eslint-disable-next-line no-console
        console.log(`[critical-audit] user=${borrower.address} reason=${this.getAuditReason(verifyResult.reason)} details=${JSON.stringify(verifyResult)}`);
        return verifyResult;
      }
      
      // Step 3: Build liquidation intent
      const intentStart = Date.now();
      const intent = await this.buildIntent(recomputedState, verifyResult.plan!);
      const intentDelta = Date.now() - intentStart;
      this.metrics.criticalLaneIntentMs.observe(intentDelta);
      
      if (!intent) {
        this.metrics.criticalLaneSkippedTotal.inc({ reason: 'intent_build_failed' });
        return {
          success: false,
          reason: 'intent_build_failed'
        };
      }
      
      // eslint-disable-next-line no-console
      console.log(`[critical] user=${borrower.address} stage=intent delta=${intentDelta}ms debt=${intent.debtToCover.toString()}`);
      
      // Step 4: Submit transaction
      const submitStart = Date.now();
      const submitResult = await this.submitTx(intent);
      const submitDelta = Date.now() - submitStart;
      this.metrics.criticalLaneSubmitMs.observe(submitDelta);
      
      // eslint-disable-next-line no-console
      console.log(`[critical] user=${borrower.address} stage=submit delta=${submitDelta}ms success=${submitResult.success}`);
      
      // Step 5: Record metrics
      const totalLatency = Date.now() - startMs;
      if (totalLatency > this.config.latencyWarnMs) {
        // eslint-disable-next-line no-console
        console.warn(`[critical] user=${borrower.address} latency=${totalLatency}ms exceeds warn threshold=${this.config.latencyWarnMs}ms`);
      }
      
      if (submitResult.success) {
        this.metrics.criticalLaneExecutedTotal.inc();
        // eslint-disable-next-line no-console
        console.log(`[critical-audit] user=${borrower.address} reason=CRITICAL_EXECUTED txHash=${submitResult.txHash} latencyMs=${totalLatency} profitEstimateUsd=${verifyResult.plan!.profitEstimateUsd.toFixed(2)}`);
      } else {
        this.metrics.criticalLaneSkippedTotal.inc({ reason: submitResult.reason || 'submit_failed' });
      }
      
      return {
        ...submitResult,
        latencyMs: totalLatency
      };
      
    } catch (error) {
      const totalLatency = Date.now() - startMs;
      // eslint-disable-next-line no-console
      console.error(`[critical] user=${borrower.address} error=${error instanceof Error ? error.message : String(error)} latency=${totalLatency}ms`);
      
      this.metrics.criticalLaneSkippedTotal.inc({ reason: 'exception' });
      
      return {
        success: false,
        reason: error instanceof Error ? error.message : 'unknown_error',
        latencyMs: totalLatency
      };
    }
  }

  /**
   * Recompute HF using fresh on-chain data
   */
  private async recomputeHF(borrower: BorrowerState): Promise<BorrowerState> {
    if (!this.aavePool) {
      // If no aavePool, return original state
      return borrower;
    }
    
    try {
      const accountData = await this.aavePool.getUserAccountData(borrower.address);
      const hf = Number(accountData.healthFactor) / 1e18;
      
      return {
        ...borrower,
        currentHF: hf,
        totalDebtBase: accountData.totalDebtBase,
        totalCollateralBase: accountData.totalCollateralBase
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[critical] Failed to recompute HF for ${borrower.address}, using cached:`, error instanceof Error ? error.message : error);
      return borrower;
    }
  }

  /**
   * Verify liquidatable status and check profitability
   */
  private async verifyLiquidatable(borrower: BorrowerState): Promise<{
    success: boolean;
    reason?: string;
    plan?: LiquidationPlan;
  }> {
    // Verify HF is below 1.0 (strict check)
    if (borrower.currentHF >= 1.0) {
      return {
        success: false,
        reason: 'hf_above_threshold'
      };
    }
    
    // Get all reserves with user positions
    const reserves = await this.aaveDataService.getAllUserReserves(borrower.address);
    
    // Separate debt and collateral reserves
    const debtReserves = reserves.filter(r => r.totalDebt > 0n);
    const collateralReserves = reserves.filter(r => r.aTokenBalance > 0n && r.usageAsCollateralEnabled);
    
    if (debtReserves.length === 0) {
      return {
        success: false,
        reason: 'no_debt'
      };
    }
    
    if (collateralReserves.length === 0) {
      return {
        success: false,
        reason: 'no_collateral'
      };
    }
    
    // Select debt asset (prefer configured assets, else largest)
    let selectedDebt = null;
    const preferredDebtAssets = config.liquidationDebtAssets;
    
    if (preferredDebtAssets.length > 0) {
      for (const preferredAsset of preferredDebtAssets) {
        const found = debtReserves.find(r => r.asset.toLowerCase() === preferredAsset.toLowerCase());
        if (found) {
          selectedDebt = found;
          break;
        }
      }
    }
    
    if (!selectedDebt) {
      selectedDebt = debtReserves.reduce((max, r) => r.debtValueUsd > max.debtValueUsd ? r : max);
    }
    
    // Select collateral asset (largest by USD value)
    const selectedCollateral = collateralReserves.reduce((max, r) => r.collateralValueUsd > max.collateralValueUsd ? r : max);
    
    // Validate prices
    if (selectedDebt.priceRaw <= 0n) {
      return {
        success: false,
        reason: 'price_stale_debt'
      };
    }
    
    if (selectedCollateral.priceRaw <= 0n) {
      return {
        success: false,
        reason: 'price_stale_collateral'
      };
    }
    
    // Calculate debt to cover based on HF
    const closeFactorThreshold = 0.95;
    let debtToCover: bigint;
    
    if (borrower.currentHF < closeFactorThreshold) {
      debtToCover = selectedDebt.totalDebt; // 100%
    } else {
      debtToCover = selectedDebt.totalDebt / 2n; // 50%
    }
    
    // Calculate USD value
    const debtToCoverUsd = calculateUsdValue(debtToCover, selectedDebt.decimals, selectedDebt.priceRaw);
    
    // Get liquidation bonus
    const liquidationBonusPct = await this.aaveDataService.getLiquidationBonusPct(selectedCollateral.asset);
    
    // Estimate profit
    const profitEstimate = this.profitEstimator.estimateProfitSimple(
      debtToCoverUsd,
      debtToCoverUsd, // collateral value approximation
      liquidationBonusPct
    );
    
    // Check profitability
    const shouldCheckProfit = !this.config.allowUnprofitableInitial || 
                              this.unprofitableExecutions >= this.maxUnprofitableExecutions;
    
    if (shouldCheckProfit && profitEstimate.grossProfitUsd < this.config.profitMinUsd) {
      return {
        success: false,
        reason: 'unprofitable'
      };
    }
    
    // If allowing unprofitable initial execution and this is unprofitable, count it
    if (this.config.allowUnprofitableInitial && 
        profitEstimate.grossProfitUsd < this.config.profitMinUsd &&
        this.unprofitableExecutions < this.maxUnprofitableExecutions) {
      this.unprofitableExecutions++;
      // eslint-disable-next-line no-console
      console.log(`[critical] Allowing unprofitable execution ${this.unprofitableExecutions}/${this.maxUnprofitableExecutions}`);
    }
    
    return {
      success: true,
      plan: {
        debtAsset: selectedDebt.asset,
        debtAssetSymbol: selectedDebt.symbol,
        totalDebt: selectedDebt.totalDebt,
        debtToCover,
        debtToCoverUsd,
        liquidationBonusPct,
        collateralAsset: selectedCollateral.asset,
        collateralSymbol: selectedCollateral.symbol,
        profitEstimateUsd: profitEstimate.grossProfitUsd
      }
    };
  }

  /**
   * Build liquidation intent using IntentBuilder
   */
  private async buildIntent(
    borrower: BorrowerState,
    plan: LiquidationPlan
  ): Promise<LiquidationIntent | null> {
    if (!this.intentBuilder) {
      // eslint-disable-next-line no-console
      console.warn('[critical] IntentBuilder not configured, cannot build intent');
      return null;
    }
    
    try {
      // Get current gas price suggestion (simplified)
      const gasPrice = {
        maxFeePerGas: BigInt(0), // Placeholder - should get from gas policy
        maxPriorityFeePerGas: BigInt(0)
      };
      
      const intent = await this.intentBuilder.buildIntent(
        borrower.address,
        plan.debtAsset,
        plan.collateralAsset,
        plan.totalDebt,
        borrower.currentHF,
        borrower.blockNumber,
        async (asset: string) => {
          const priceRaw = await this.aaveDataService.getAssetPrice(asset);
          return Number(priceRaw) / 1e8; // Convert to USD
        },
        gasPrice
      );
      
      return intent;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[critical] Failed to build intent:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Submit transaction via PrivateTxSender
   */
  private async submitTx(intent: LiquidationIntent): Promise<{
    success: boolean;
    reason?: string;
    txHash?: string;
  }> {
    if (!this.privateTxSender) {
      return {
        success: false,
        reason: 'tx_sender_not_configured'
      };
    }
    
    // Placeholder - actual submission would require wallet and tx building
    // This would be implemented based on the existing ExecutionService pattern
    
    return {
      success: false,
      reason: 'not_implemented'
    };
  }

  /**
   * Map skip reason to audit reason code
   */
  private getAuditReason(reason?: string): string {
    switch (reason) {
      case 'unprofitable':
        return 'CRITICAL_SKIPPED_PROFIT';
      case 'price_stale_debt':
      case 'price_stale_collateral':
        return 'CRITICAL_SKIPPED_STALE_PRICE';
      case 'hf_above_threshold':
      case 'hf_recovered':
        return 'CRITICAL_SKIPPED_HF_RECOVERY';
      default:
        return 'CRITICAL_SKIPPED_OTHER';
    }
  }

  /**
   * Check if critical lane is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}

interface LiquidationPlan {
  debtAsset: string;
  debtAssetSymbol: string;
  totalDebt: bigint;
  debtToCover: bigint;
  debtToCoverUsd: number;
  liquidationBonusPct: number;
  collateralAsset: string;
  collateralSymbol: string;
  profitEstimateUsd: number;
}
