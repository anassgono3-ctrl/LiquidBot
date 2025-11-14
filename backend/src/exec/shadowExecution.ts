// shadowExecution.ts: Lightweight "shadow execution" hook for pre-execution verification
// Produces structured logs of WOULD-BE liquidation attempts without submitting transactions

import { config } from '../config/index.js';

/**
 * Shadow execution candidate - represents a user position that might be liquidatable
 */
export interface ShadowExecCandidate {
  user: string;
  healthFactor: number;
  blockTag: number | 'pending';
  debtAsset: string;
  collateralAsset: string;
  debtAmountWei: bigint;
  collateralAmountWei: bigint;
  // Optional reserve data
  reserveLtv?: number;
  reserveLt?: number;
}

/**
 * Shadow execution plan - details of what WOULD be executed
 */
export interface ShadowExecPlan {
  user: string;
  blockTag: number | 'pending';
  hf: number;
  debtAsset: string;
  repayWei: bigint;
  collateralAsset: string;
  seizeWei: bigint;
  closeFactorBps: number;
  gas: {
    tipGwei: number;
    bumpFactor: number;
  };
  mev: {
    mode: 'public' | 'private';
    endpoint?: string;
  };
  pathHint: string;
  mode: 'shadow';
}

/**
 * Build a shadow execution plan from a candidate
 * Uses fixed 50% close factor and naive seize calculation (no bonus/slippage math)
 */
export function buildShadowPlan(candidate: ShadowExecCandidate): ShadowExecPlan {
  // Use CLOSE_FACTOR_MODE=fixed50: compute closeAmtWei = debtAmountWei * 50%
  const closeFactorBps = 5000; // 50%
  const repayWei = (candidate.debtAmountWei * BigInt(closeFactorBps)) / BigInt(10000);
  
  // Naive estimate: seizeWei = collateralAmountWei * 50% (logging only)
  const seizeWei = (candidate.collateralAmountWei * BigInt(closeFactorBps)) / BigInt(10000);
  
  // Gas plan from environment
  const gas = {
    tipGwei: config.gasTipGweiFast,
    bumpFactor: config.gasBumpFactor
  };
  
  // MEV route determination
  const mev: { mode: 'public' | 'private'; endpoint?: string } = { mode: 'public' };
  if (config.txSubmitMode === 'private') {
    const privateRpcUrl = config.privateTxRpcUrl;
    const privateBundleRpc = process.env.PRIVATE_BUNDLE_RPC;
    if (privateRpcUrl || privateBundleRpc) {
      mev.mode = 'private';
      mev.endpoint = privateRpcUrl || privateBundleRpc;
    }
  }
  
  // Path hint for 1inch swap
  const pathHint = `1inch:${candidate.debtAsset}->${candidate.collateralAsset}`;
  
  return {
    user: candidate.user,
    blockTag: candidate.blockTag,
    hf: candidate.healthFactor,
    debtAsset: candidate.debtAsset,
    repayWei,
    collateralAsset: candidate.collateralAsset,
    seizeWei,
    closeFactorBps,
    gas,
    mev,
    pathHint,
    mode: 'shadow'
  };
}

/**
 * Maybe execute a shadow liquidation if conditions are met
 * Logs a single structured JSON line with tag=SHADOW_EXECUTE
 * 
 * @param candidate The candidate to potentially shadow execute
 * @param threshold Health factor threshold (defaults to SHADOW_EXECUTE_THRESHOLD or 1.005)
 */
export function maybeShadowExecute(
  candidate: ShadowExecCandidate,
  threshold?: number
): void {
  // Check if shadow execution is enabled
  if (!config.shadowExecuteEnabled) {
    return;
  }
  
  // Use provided threshold or config default
  const effectiveThreshold = threshold ?? config.shadowExecuteThreshold;
  
  // Only execute if HF is below threshold
  if (candidate.healthFactor >= effectiveThreshold) {
    return;
  }
  
  // Build the shadow execution plan
  const plan = buildShadowPlan(candidate);
  
  // Log a single structured JSON line
  const shadowLog = {
    tag: 'SHADOW_EXECUTE',
    user: plan.user,
    blockTag: plan.blockTag,
    hf: plan.hf,
    debtAsset: plan.debtAsset,
    repayWei: plan.repayWei.toString(), // Convert bigint to string for JSON
    collateralAsset: plan.collateralAsset,
    seizeWei: plan.seizeWei.toString(), // Convert bigint to string for JSON
    closeFactorBps: plan.closeFactorBps,
    gas: plan.gas,
    mev: plan.mev,
    pathHint: plan.pathHint,
    mode: plan.mode
  };
  
  // Single-line JSON output (no pretty printing for grep/ELK friendliness)
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(shadowLog));
  
  // Simple metrics hook (debug log)
  // eslint-disable-next-line no-console
  console.log('[metrics] shadow_execute_count+=1');
}
