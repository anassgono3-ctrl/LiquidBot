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
   * Check if user is currently liquidatable by querying Aave health factor
   * @param userAddress The user address to check
   * @returns Health factor check result
   */
  private async checkAaveHealthFactor(userAddress: string): Promise<{ liquidatable: boolean; healthFactor: string; reason?: string }> {
    if (!this.provider) {
      // No provider configured, skip check
      return { liquidatable: true, healthFactor: 'unknown' };
    }

    try {
      // Aave V3 Pool address on Base (default if not specified)
      const aavePoolAddress = process.env.AAVE_POOL || '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
      
      // ABI for getUserAccountData
      const aavePoolAbi = [
        'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
      ];
      
      const aavePool = new ethers.Contract(aavePoolAddress, aavePoolAbi, this.provider);
      
      // Query user account data
      const accountData = await aavePool.getUserAccountData(userAddress);
      const healthFactor = accountData.healthFactor;
      
      // Health factor >= 1e18 means user is not liquidatable
      const threshold = BigInt('1000000000000000000'); // 1e18
      
      if (healthFactor >= threshold) {
        const hfFormatted = (Number(healthFactor) / 1e18).toFixed(4);
        return {
          liquidatable: false,
          healthFactor: hfFormatted,
          reason: `user_not_liquidatable: HF=${hfFormatted}`
        };
      }
      
      return {
        liquidatable: true,
        healthFactor: (Number(healthFactor) / 1e18).toFixed(4)
      };
      
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[execution] Failed to check Aave health factor, continuing:', error instanceof Error ? error.message : error);
      // On error, assume liquidatable (don't block execution on HF check failure)
      return { liquidatable: true, healthFactor: 'error' };
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

      // Step 1: Preflight check - verify user is currently liquidatable
      const hfCheck = await this.checkAaveHealthFactor(opportunity.user);
      
      if (!hfCheck.liquidatable) {
        // eslint-disable-next-line no-console
        console.log('[execution] Skipping execution - user not liquidatable:', hfCheck.reason);
        return {
          success: false,
          simulated: false,
          reason: hfCheck.reason
        };
      }
      
      // eslint-disable-next-line no-console
      console.log('[execution] Health factor check passed:', { healthFactor: hfCheck.healthFactor });

      // Step 2: Calculate debt to cover (respecting close factor)
      const debtToCover = await this.calculateDebtToCover(opportunity);
      
      // Step 3: Get 1inch swap quote
      const slippageBps = Number(process.env.MAX_SLIPPAGE_BPS || 100); // 1% default
      
      const swapQuote = await this.oneInchService.getSwapCalldata({
        fromToken: opportunity.collateralReserve.id,
        toToken: opportunity.principalReserve.id,
        amount: opportunity.collateralAmountRaw, // Use full collateral amount
        slippageBps: slippageBps,
        fromAddress: this.executorAddress
      });

      // Step 4: Build liquidation parameters
      const liquidationParams = {
        user: opportunity.user,
        collateralAsset: opportunity.collateralReserve.id,
        debtAsset: opportunity.principalReserve.id,
        debtToCover: debtToCover,
        oneInchCalldata: swapQuote.data,
        minOut: swapQuote.minOut,
        payout: this.wallet.address // Send profit to executor wallet
      };

      // Step 5: Prepare executor contract call with custom errors for better logging
      const executorAbi = [
        'function initiateLiquidation((address user, address collateralAsset, address debtAsset, uint256 debtToCover, bytes oneInchCalldata, uint256 minOut, address payout) params) external',
        'error AssetNotWhitelisted()',
        'error ContractPaused()',
        'error Unauthorized()'
      ];
      
      const executor = new ethers.Contract(
        this.executorAddress,
        executorAbi,
        this.wallet
      );

      // Step 6: Send transaction
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

      // Step 7: Wait for confirmation
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

      // Step 8: Parse profit from events (optional - placeholder)
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
