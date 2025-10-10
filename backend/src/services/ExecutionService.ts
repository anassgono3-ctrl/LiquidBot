// ExecutionService: Execution pipeline with MEV/gas controls
import { ethers } from 'ethers';

import type { Opportunity } from '../types/index.js';
import { executionConfig } from '../config/executionConfig.js';

import { OneInchQuoteService } from './OneInchQuoteService.js';

export interface ExecutionResult {
  success: boolean;
  simulated: boolean;
  txHash?: string;
  reason?: string;
  gasUsed?: number;
  realizedProfitUsd?: number;
}

export interface GasEstimator {
  getCurrentGasPrice(): Promise<number>; // Returns gas price in Gwei
}

/**
 * ExecutionService orchestrates liquidation execution with safety controls.
 * Implements on-chain execution via LiquidationExecutor contract.
 */
export class ExecutionService {
  private gasEstimator?: GasEstimator;
  private oneInchService: OneInchQuoteService;
  private provider?: ethers.JsonRpcProvider;
  private wallet?: ethers.Wallet;
  private executorAddress?: string;

  constructor(gasEstimator?: GasEstimator, oneInchService?: OneInchQuoteService) {
    this.gasEstimator = gasEstimator;
    this.oneInchService = oneInchService || new OneInchQuoteService();
    
    // Initialize provider and wallet if configured
    const rpcUrl = process.env.RPC_URL;
    const privateKey = process.env.EXECUTION_PRIVATE_KEY;
    this.executorAddress = process.env.EXECUTOR_ADDRESS;
    
    if (rpcUrl && privateKey) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      this.wallet = new ethers.Wallet(privateKey, this.provider);
    }
  }

  /**
   * Execute a liquidation opportunity with all safety checks
   * @param opportunity The opportunity to execute
   * @returns Execution result (simulated or real)
   */
  async execute(opportunity: Opportunity): Promise<ExecutionResult> {
    // Check if execution is enabled
    if (!executionConfig.executionEnabled) {
      return {
        success: false,
        simulated: true,
        reason: 'execution_disabled'
      };
    }

    // Check current gas price vs cap
    if (this.gasEstimator) {
      try {
        const currentGasPrice = await this.gasEstimator.getCurrentGasPrice();
        if (currentGasPrice > executionConfig.maxGasPriceGwei) {
          return {
            success: false,
            simulated: false,
            reason: `gas_price_too_high: ${currentGasPrice} > ${executionConfig.maxGasPriceGwei} gwei`
          };
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[execution] Failed to get gas price:', err);
        // Continue - don't block execution on gas price check failure
      }
    }

    // Dry run mode - simulate without broadcasting
    if (executionConfig.dryRunExecution) {
      return this.simulateExecution(opportunity);
    }

    // Real execution (placeholder - to be implemented)
    return this.executeReal(opportunity);
  }

  /**
   * Simulate execution without broadcasting transactions
   */
  private simulateExecution(opportunity: Opportunity): ExecutionResult {
    // Log structured simulation
    // eslint-disable-next-line no-console
    console.log('[execution] DRY RUN simulation:', {
      opportunityId: opportunity.id,
      user: opportunity.user,
      collateralSymbol: opportunity.collateralReserve.symbol,
      principalSymbol: opportunity.principalReserve.symbol,
      estimatedProfitUsd: opportunity.profitEstimateUsd
    });

    return {
      success: true,
      simulated: true,
      reason: 'dry_run',
      realizedProfitUsd: opportunity.profitEstimateUsd || 0
    };
  }

  /**
   * Execute real liquidation via on-chain executor
   * Orchestrates flash loan, liquidation, and swap
   */
  private async executeReal(opportunity: Opportunity): Promise<ExecutionResult> {
    // Validate configuration
    if (!this.provider || !this.wallet || !this.executorAddress) {
      return {
        success: false,
        simulated: false,
        reason: 'execution_not_configured: missing RPC_URL, EXECUTION_PRIVATE_KEY, or EXECUTOR_ADDRESS'
      };
    }

    // 1inch service is always available (v6 with key or v5 public fallback)
    // Log a warning if using v5 public API
    if (!this.oneInchService.isUsingV6?.()) {
      // eslint-disable-next-line no-console
      console.warn('[execution] Using 1inch v5 public API - consider setting ONEINCH_API_KEY for v6');
    }

    try {
      // eslint-disable-next-line no-console
      console.log('[execution] REAL execution starting:', {
        opportunityId: opportunity.id,
        user: opportunity.user,
        collateral: opportunity.collateralReserve.symbol,
        debt: opportunity.principalReserve.symbol
      });

      // Step 1: Calculate debt to cover (respecting close factor)
      const debtToCover = await this.calculateDebtToCover(opportunity);
      
      // Step 2: Get 1inch swap quote
      const slippageBps = Number(process.env.MAX_SLIPPAGE_BPS || 100); // 1% default
      
      const swapQuote = await this.oneInchService.getSwapCalldata({
        fromToken: opportunity.collateralReserve.id,
        toToken: opportunity.principalReserve.id,
        amount: opportunity.collateralAmountRaw, // Use full collateral amount
        slippageBps: slippageBps,
        fromAddress: this.executorAddress
      });

      // Step 3: Build liquidation parameters
      const liquidationParams = {
        user: opportunity.user,
        collateralAsset: opportunity.collateralReserve.id,
        debtAsset: opportunity.principalReserve.id,
        debtToCover: debtToCover,
        oneInchCalldata: swapQuote.data,
        minOut: swapQuote.minOut,
        payout: this.wallet.address // Send profit to executor wallet
      };

      // Step 4: Prepare executor contract call
      const executorAbi = [
        'function initiateLiquidation((address user, address collateralAsset, address debtAsset, uint256 debtToCover, bytes oneInchCalldata, uint256 minOut, address payout) params) external'
      ];
      
      const executor = new ethers.Contract(
        this.executorAddress,
        executorAbi,
        this.wallet
      );

      // Step 5: Send transaction
      // eslint-disable-next-line no-console
      console.log('[execution] Sending transaction to executor...', {
        executor: this.executorAddress,
        debtToCover: debtToCover.toString(),
        minOut: swapQuote.minOut
      });

      let tx;
      const privateBundleRpc = process.env.PRIVATE_BUNDLE_RPC;
      
      if (privateBundleRpc) {
        // Use private bundle RPC if configured
        // eslint-disable-next-line no-console
        console.log('[execution] Using private bundle RPC:', privateBundleRpc);
        tx = await this.submitPrivateTransaction(executor, liquidationParams);
      } else {
        // Standard transaction
        tx = await executor.initiateLiquidation(liquidationParams);
      }

      // eslint-disable-next-line no-console
      console.log('[execution] Transaction sent:', tx.hash);

      // Step 6: Wait for confirmation
      const receipt = await tx.wait();
      
      // eslint-disable-next-line no-console
      console.log('[execution] Transaction confirmed:', {
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        status: receipt.status
      });

      if (receipt.status !== 1) {
        return {
          success: false,
          simulated: false,
          txHash: receipt.hash,
          reason: 'transaction_reverted'
        };
      }

      // Step 7: Parse profit from events (optional - placeholder)
      const realizedProfit = opportunity.profitEstimateUsd || 0;

      return {
        success: true,
        simulated: false,
        txHash: receipt.hash,
        gasUsed: Number(receipt.gasUsed),
        realizedProfitUsd: realizedProfit
      };

    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[execution] Execution failed:', error);
      
      return {
        success: false,
        simulated: false,
        reason: error instanceof Error ? error.message : 'unknown_error'
      };
    }
  }

  /**
   * Calculate debt to cover respecting close factor
   * @param opportunity The liquidation opportunity
   * @returns Debt amount to cover in wei
   */
  private async calculateDebtToCover(opportunity: Opportunity): Promise<bigint> {
    const closeFactorMode = process.env.CLOSE_FACTOR_MODE || 'auto';
    
    if (closeFactorMode === 'fixed') {
      // Use fixed 50% close factor
      const debtAmount = BigInt(opportunity.principalAmountRaw);
      return debtAmount / 2n;
    }
    
    // Auto mode: use full debt amount from opportunity
    // In production, you would query Aave data provider for actual close factor
    // For now, use the amount from the opportunity which represents what was liquidated
    return BigInt(opportunity.principalAmountRaw);
  }

  /**
   * Submit transaction via private bundle RPC
   * @param executor Contract instance
   * @param params Liquidation parameters
   */
  private async submitPrivateTransaction(
    executor: ethers.Contract,
    params: unknown
  ): Promise<ethers.ContractTransactionResponse> {
    // For now, fall back to standard transaction
    // Full private bundle implementation would require specific bundle RPC protocols
    // eslint-disable-next-line no-console
    console.warn('[execution] Private bundle RPC not fully implemented, using standard transaction');
    return executor.initiateLiquidation(params);
  }

  /**
   * Get execution configuration for inspection
   */
  getConfig() {
    return {
      enabled: executionConfig.executionEnabled,
      dryRun: executionConfig.dryRunExecution,
      maxGasPriceGwei: executionConfig.maxGasPriceGwei,
      privateBundleRpc: executionConfig.privateBundleRpc ? '***' : undefined
    };
  }
}
