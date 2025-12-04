/**
 * PreSubmitManager: Pre-submit liquidation transaction manager
 * 
 * Listens to PredictiveOrchestrator events and decides when to pre-submit
 * liquidation transactions ahead of Chainlink oracle updates.
 * 
 * Decision gates:
 * 1. Feature enabled (PRE_SUBMIT_ENABLED)
 * 2. ETA acceptable or fast-path flagged
 * 3. Projected HF below buffer threshold
 * 4. Position size above minimum
 * 5. TWAP sanity check (if enabled)
 * 
 * Tracks pending pre-submits and their outcomes.
 */

import { ethers } from 'ethers';
import { config } from '../config/index.js';
import type { PredictiveEventListener, PredictiveScenarioEvent } from '../risk/PredictiveOrchestrator.js';
import { TwapSanity } from './TwapSanity.js';
import {
  recordPreSubmitAttempt,
  recordGateFailure,
  recordPendingCount
} from '../metrics/preSubmitMetrics.js';

// Aave Pool ABI (minimal - liquidationCall method)
const AAVE_POOL_ABI = [
  'function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken) external'
];

interface PendingPreSubmit {
  txHash: string;
  user: string;
  collateralAsset: string;
  debtAsset: string;
  debtToCover: string;
  submittedBlock: number;
  submittedTime: number;
  etaSec: number;
  hfProjected: number;
  debtUsd: number;
  gasEstimated: number;
  gasPriceGwei: number;
}

export class PreSubmitManager implements PredictiveEventListener {
  private enabled: boolean;
  private etaMax: number;
  private hfBuffer: number;
  private gasPriceMargin: number;
  private ttlBlocks: number;
  private minPositionUsd: number;
  private telemetryEnabled: boolean;
  
  private provider: ethers.JsonRpcProvider | null = null;
  private signer: ethers.Wallet | null = null;
  private aavePool: ethers.Contract | null = null;
  
  private twapSanity: TwapSanity;
  private pendingPreSubmits: Map<string, PendingPreSubmit> = new Map(); // txHash -> metadata
  private userSubmits: Map<string, string[]> = new Map(); // user -> txHash[]
  
  private isShuttingDown = false;

  constructor() {
    this.enabled = config.preSubmitEnabled;
    this.etaMax = config.preSubmitEtaMax;
    this.hfBuffer = config.hfTriggerBuffer;
    this.gasPriceMargin = config.gasPriceMargin;
    this.ttlBlocks = config.ttlBlocks;
    this.minPositionUsd = config.preSubmitMinPositionUsd ?? config.minDebtUsd;
    this.telemetryEnabled = config.telemetryPreSubmitEnabled;
    
    this.twapSanity = new TwapSanity();

    if (this.enabled) {
      this.initialize();
    }
  }

  /**
   * Initialize provider and signer
   */
  private initialize(): void {
    // Get RPC URL
    const rpcUrl = config.chainlinkRpcUrl || process.env.RPC_URL;
    if (!rpcUrl) {
      console.warn('[pre-submit] No RPC_URL configured, disabling');
      this.enabled = false;
      return;
    }

    // Get private key
    const privateKey = process.env.EXECUTION_PRIVATE_KEY;
    if (!privateKey) {
      console.warn('[pre-submit] No EXECUTION_PRIVATE_KEY configured, disabling');
      this.enabled = false;
      return;
    }

    // Get Aave pool address
    const poolAddress = config.aavePool || config.aavePoolAddress;
    if (!poolAddress) {
      console.warn('[pre-submit] No AAVE_POOL address configured, disabling');
      this.enabled = false;
      return;
    }

    try {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      this.signer = new ethers.Wallet(privateKey, this.provider);
      this.aavePool = new ethers.Contract(poolAddress, AAVE_POOL_ABI, this.signer);

      console.log(
        `[pre-submit] Initialized: etaMax=${this.etaMax}s, hfBuffer=${this.hfBuffer}, minPosition=$${this.minPositionUsd}`
      );
    } catch (error) {
      console.error('[pre-submit] Initialization error:', error);
      this.enabled = false;
    }
  }

  /**
   * Handle predictive candidate event
   */
  public async onPredictiveCandidate(event: PredictiveScenarioEvent): Promise<void> {
    if (!this.enabled || this.isShuttingDown) {
      return;
    }

    const { candidate, shouldFlagFastpath } = event;

    try {
      // Gate 1: Feature enabled (already checked)
      
      // Gate 2: ETA acceptable or fast-path flagged
      const etaSec = candidate.etaSec ?? Infinity;
      if (!shouldFlagFastpath && etaSec > this.etaMax) {
        recordGateFailure('eta');
        return;
      }

      // Gate 3: Projected HF below buffer
      if (candidate.hfProjected > this.hfBuffer) {
        recordGateFailure('hf');
        return;
      }

      // Gate 4: Minimum position size
      if (candidate.totalDebtUsd < this.minPositionUsd) {
        recordGateFailure('size');
        return;
      }

      // Gate 5: TWAP sanity check (if enabled)
      if (this.twapSanity.isEnabled()) {
        // TODO: Implement full TWAP validation
        // Currently, TWAP is enabled but validation is a placeholder
        // For production, extract price from candidate and validate against TWAP
        // This is documented as a known limitation
        console.log('[pre-submit] TWAP sanity check enabled but not fully implemented (placeholder)');
      }

      // All gates passed - build and submit transaction
      await this.buildAndSubmit(candidate);
    } catch (error) {
      console.error('[pre-submit] Error processing candidate:', error);
      recordPreSubmitAttempt('error');
    }
  }

  /**
   * Build and submit liquidation transaction
   */
  private async buildAndSubmit(candidate: any): Promise<void> {
    if (!this.aavePool || !this.provider || !this.signer) {
      console.error('[pre-submit] Not initialized');
      return;
    }

    try {
      // Extract candidate data
      const user = candidate.address;
      const debtUsd = candidate.totalDebtUsd;
      const hfProjected = candidate.hfProjected;
      const etaSec = candidate.etaSec ?? 0;

      // TODO: Extract actual collateral and debt asset addresses from candidate
      // Currently using placeholder addresses - this is a known limitation
      // The PredictiveCandidate interface should be extended to include:
      // - collateralAssets: string[]
      // - debtAssets: string[]
      // For MVP, we use WETH/USDC as defaults
      const collateralAsset = '0x4200000000000000000000000000000000000006'; // WETH
      const debtAsset = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC
      
      // Calculate debt to cover (50% close factor as default)
      const closeFactorPct = 0.5;
      const debtToCover = ethers.parseUnits((debtUsd * closeFactorPct).toString(), 6); // Assuming USDC decimals

      // Build transaction
      const tx = await this.aavePool.liquidationCall.populateTransaction(
        collateralAsset,
        debtAsset,
        user,
        debtToCover,
        false // receiveAToken
      );

      // Estimate gas
      const gasEstimate = await this.provider.estimateGas({
        from: this.signer.address,
        to: this.aavePool.target,
        data: tx.data
      });

      // Add gas margin
      const gasLimit = BigInt(Math.floor(Number(gasEstimate) * (1 + this.gasPriceMargin)));

      // Get gas price with margin
      const feeData = await this.provider.getFeeData();
      const baseFee = feeData.gasPrice || ethers.parseUnits('0.05', 'gwei');
      const gasPriceWithMargin = BigInt(Math.floor(Number(baseFee) * (1 + this.gasPriceMargin)));

      // Build final transaction
      const finalTx = {
        to: this.aavePool.target,
        data: tx.data,
        gasLimit,
        gasPrice: gasPriceWithMargin,
        chainId: config.chainId
      };

      // Sign transaction
      const signedTx = await this.signer.signTransaction(finalTx);

      // Submit transaction
      const txResponse = await this.provider.broadcastTransaction(signedTx);
      const txHash = txResponse.hash;

      // Get current block for TTL tracking
      const currentBlock = await this.provider.getBlockNumber();

      // Store pending pre-submit
      const pending: PendingPreSubmit = {
        txHash,
        user,
        collateralAsset,
        debtAsset,
        debtToCover: debtToCover.toString(),
        submittedBlock: currentBlock,
        submittedTime: Date.now(),
        etaSec,
        hfProjected,
        debtUsd,
        gasEstimated: Number(gasEstimate),
        gasPriceGwei: Number(ethers.formatUnits(gasPriceWithMargin, 'gwei'))
      };

      this.pendingPreSubmits.set(txHash, pending);
      
      // Index by user
      if (!this.userSubmits.has(user)) {
        this.userSubmits.set(user, []);
      }
      this.userSubmits.get(user)!.push(txHash);

      // Record metrics
      recordPreSubmitAttempt(
        'submitted',
        pending.gasEstimated,
        pending.gasPriceGwei,
        debtUsd,
        hfProjected
      );
      recordPendingCount(this.pendingPreSubmits.size);

      console.log(
        `[pre-submit] Submitted tx: ${txHash} user=${user} hf=${hfProjected.toFixed(3)} debt=$${debtUsd.toFixed(2)} gas=${pending.gasEstimated}`
      );
    } catch (error) {
      console.error('[pre-submit] Error building/submitting transaction:', error);
      recordPreSubmitAttempt('error');
      throw error;
    }
  }

  /**
   * Get pending pre-submits
   */
  public getPendingPreSubmits(): Map<string, PendingPreSubmit> {
    return this.pendingPreSubmits;
  }

  /**
   * Get pending pre-submits for a user
   */
  public getUserPreSubmits(user: string): PendingPreSubmit[] {
    const txHashes = this.userSubmits.get(user) || [];
    return txHashes
      .map(hash => this.pendingPreSubmits.get(hash))
      .filter((p): p is PendingPreSubmit => p !== undefined);
  }

  /**
   * Remove a pending pre-submit
   */
  public removePending(txHash: string): void {
    const pending = this.pendingPreSubmits.get(txHash);
    if (pending) {
      this.pendingPreSubmits.delete(txHash);
      
      // Remove from user index
      const userTxs = this.userSubmits.get(pending.user);
      if (userTxs) {
        const index = userTxs.indexOf(txHash);
        if (index >= 0) {
          userTxs.splice(index, 1);
        }
        if (userTxs.length === 0) {
          this.userSubmits.delete(pending.user);
        }
      }

      recordPendingCount(this.pendingPreSubmits.size);
    }
  }

  /**
   * Clean up expired pending pre-submits
   */
  public async cleanupExpired(): Promise<number> {
    if (!this.provider) {
      return 0;
    }

    try {
      const currentBlock = await this.provider.getBlockNumber();
      let cleanedCount = 0;

      for (const [txHash, pending] of this.pendingPreSubmits.entries()) {
        const blocksSinceSubmit = currentBlock - pending.submittedBlock;
        
        if (blocksSinceSubmit > this.ttlBlocks) {
          console.log(
            `[pre-submit] Expired: ${txHash} (${blocksSinceSubmit} blocks > ${this.ttlBlocks} TTL)`
          );
          this.removePending(txHash);
          cleanedCount++;
        }
      }

      return cleanedCount;
    } catch (error) {
      console.error('[pre-submit] Error cleaning expired:', error);
      return 0;
    }
  }

  /**
   * Shutdown and cleanup
   */
  public async shutdown(): Promise<void> {
    console.log('[pre-submit] Shutting down');
    this.isShuttingDown = true;
    
    // Log pending pre-submits
    if (this.pendingPreSubmits.size > 0) {
      console.log(`[pre-submit] ${this.pendingPreSubmits.size} pending pre-submits at shutdown`);
    }
  }

  /**
   * Check if enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }
}
