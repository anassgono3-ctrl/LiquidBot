// ExecutionService: Execution pipeline with MEV/gas controls
import { ethers } from 'ethers';

import type { Opportunity } from '../types/index.js';
import { executionConfig } from '../config/executionConfig.js';
import { config } from '../config/index.js';
import {
  realtimeLiquidationBonusBps,
  realtimeDebtToCover,
  realtimeCloseFactorMode
} from '../metrics/index.js';

import { OneInchQuoteService } from './OneInchQuoteService.js';
import { AaveDataService } from './AaveDataService.js';

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
  private aaveDataService?: AaveDataService;

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
      this.aaveDataService = new AaveDataService(this.provider);
    }
    
    // Set close factor mode metric
    const mode = config.closeFactorExecutionMode;
    realtimeCloseFactorMode.set(mode === 'full' ? 1 : 0);
  }

  /**
   * Check if user is currently liquidatable by querying Aave health factor
   * @param userAddress The user address to check
   * @returns Health factor check result
   */
  private async checkAaveHealthFactor(userAddress: string): Promise<{ liquidatable: boolean; healthFactor: string; totalDebt: bigint; reason?: string }> {
    if (!this.aaveDataService || !this.aaveDataService.isInitialized()) {
      // No provider configured, skip check
      return { liquidatable: true, healthFactor: 'unknown', totalDebt: 0n };
    }

    try {
      // Query user account data at latest block
      const accountData = await this.aaveDataService.getUserAccountData(userAddress);
      const healthFactor = accountData.healthFactor;
      const totalDebt = accountData.totalDebtBase;
      
      // Health factor >= 1e18 means user is not liquidatable
      const threshold = BigInt('1000000000000000000'); // 1e18
      
      if (healthFactor >= threshold) {
        const hfFormatted = (Number(healthFactor) / 1e18).toFixed(4);
        return {
          liquidatable: false,
          healthFactor: hfFormatted,
          totalDebt,
          reason: `user_not_liquidatable: HF=${hfFormatted}`
        };
      }
      
      return {
        liquidatable: true,
        healthFactor: (Number(healthFactor) / 1e18).toFixed(4),
        totalDebt
      };
      
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[execution] Failed to check Aave health factor, continuing:', error instanceof Error ? error.message : error);
      // On error, assume liquidatable (don't block execution on HF check failure)
      return { liquidatable: true, healthFactor: 'error', totalDebt: 0n };
    }
  }

  /**
   * Prepare an actionable opportunity by resolving debt asset and liquidation plan.
   * Returns null if the opportunity cannot be resolved or is not actionable.
   * 
   * @param userAddress The user address
   * @param options Additional options (collateralAsset hint, healthFactor, etc.)
   * @returns ActionableOpportunity or null if not actionable
   */
  async prepareActionableOpportunity(
    userAddress: string,
    options?: {
      collateralAsset?: string;
      healthFactor?: number;
      blockNumber?: number;
      triggerType?: 'event' | 'head' | 'price';
    }
  ): Promise<{
    debtAsset: string;
    debtAssetSymbol: string;
    totalDebt: bigint;
    debtToCover: bigint;
    debtToCoverUsd: number;
    liquidationBonusPct: number;
    collateralAsset: string;
    collateralSymbol: string;
  } | null> {
    // Validate that AaveDataService is available
    if (!this.aaveDataService || !this.aaveDataService.isInitialized()) {
      return null;
    }

    try {
      // Get user account data to find debt assets
      const accountData = await this.aaveDataService.getUserAccountData(userAddress);
      
      // Check if user has any debt
      if (accountData.totalDebtBase === 0n) {
        return null;
      }

      // For now, we'll use a simple heuristic: check common stablecoins on Base
      // In a production system, you'd want to query all reserves and check debt balances
      const commonDebtAssets = [
        { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC' },  // USDC on Base
        { address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', symbol: 'DAI' },   // DAI on Base
        { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', symbol: 'USDbC' }, // USDbC on Base
      ];

      let debtAsset: string | null = null;
      let debtAssetSymbol: string | null = null;
      let totalDebt = 0n;

      // Try each common debt asset
      for (const asset of commonDebtAssets) {
        try {
          const debt = await this.aaveDataService.getTotalDebt(asset.address, userAddress);
          if (debt > 0n) {
            debtAsset = asset.address;
            debtAssetSymbol = asset.symbol;
            totalDebt = debt;
            break;
          }
        } catch (err) {
          // Continue to next asset
          continue;
        }
      }

      if (!debtAsset || !debtAssetSymbol || totalDebt === 0n) {
        // Could not find any debt asset
        return null;
      }

      // Determine collateral asset (use hint if provided, otherwise default to common collateral)
      const collateralAsset = options?.collateralAsset || '0x4200000000000000000000000000000000000006'; // WETH on Base
      const collateralSymbol = 'WETH';

      // Fetch liquidation bonus for collateral
      let liquidationBonusPct = 0.05; // Default 5%
      try {
        liquidationBonusPct = await this.aaveDataService.getLiquidationBonusPct(collateralAsset);
      } catch (err) {
        // Use default if fetch fails
        // eslint-disable-next-line no-console
        console.warn('[execution] Failed to fetch liquidation bonus, using default 5%');
      }

      // Calculate debtToCover based on close factor mode
      const mode = config.closeFactorExecutionMode;
      let debtToCover: bigint;
      
      if (mode === 'full') {
        debtToCover = totalDebt;
      } else {
        // fixed50: liquidate 50% of debt
        debtToCover = totalDebt / 2n;
      }

      // Estimate USD value (rough estimate, would need price oracle for accurate value)
      // For now, assume $1 for stablecoins
      const debtToCoverUsd = Number(debtToCover) / 1e6; // Assuming 6 decimals for USDC

      return {
        debtAsset,
        debtAssetSymbol,
        totalDebt,
        debtToCover,
        debtToCoverUsd,
        liquidationBonusPct,
        collateralAsset,
        collateralSymbol
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[execution] Failed to prepare actionable opportunity:', error instanceof Error ? error.message : error);
      return null;
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

      // Step 1: Preflight check - verify user is currently liquidatable at latest block
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
      
      // Check for zero debt
      if (hfCheck.totalDebt === 0n) {
        // eslint-disable-next-line no-console
        console.log('[execution] Skipping execution - user has zero debt');
        return {
          success: false,
          simulated: false,
          reason: 'zero_debt'
        };
      }
      
      // eslint-disable-next-line no-console
      console.log('[execution] Health factor check passed:', { 
        healthFactor: hfCheck.healthFactor,
        totalDebt: hfCheck.totalDebt.toString()
      });

      // Step 2: Determine debt asset to liquidate
      // For real-time opportunities, we need to query which assets the user has borrowed
      const debtAsset = opportunity.principalReserve.id;
      
      // If debt asset is not known (real-time path), skip execution for now
      // TODO: Implement debt asset discovery via Protocol Data Provider
      if (debtAsset === 'unknown' || !debtAsset) {
        // eslint-disable-next-line no-console
        console.log('[execution] Skipping execution - debt asset unknown (real-time path needs implementation)');
        return {
          success: false,
          simulated: false,
          reason: 'debt_asset_unknown'
        };
      }
      
      // Step 3: Calculate debt to cover with dynamic data (respecting close factor)
      const debtInfo = await this.calculateDebtToCover(opportunity, debtAsset, opportunity.user);
      const { debtToCover, liquidationBonusPct, debtToCoverUsd } = debtInfo;
      
      // Safety check: skip if debtToCover is zero
      if (debtToCover === 0n) {
        // eslint-disable-next-line no-console
        console.log('[execution] Skipping execution - calculated debtToCover is zero');
        return {
          success: false,
          simulated: false,
          reason: 'zero_debt'
        };
      }
      
      // Log profit components with dynamic bonus
      // eslint-disable-next-line no-console
      console.log('[execution] Profit estimation:', {
        debtToCoverUsd,
        liquidationBonusPct,
        bonusBps: Math.round(liquidationBonusPct * 10000),
        closeFactorMode: config.closeFactorExecutionMode
      });
      
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
   * Calculate debt to cover respecting close factor with live data
   * @param opportunity The liquidation opportunity
   * @param debtAsset The debt asset address (reserve)
   * @param userAddress The user address
   * @returns Object with debt amount to cover in wei and liquidation bonus
   */
  private async calculateDebtToCover(
    opportunity: Opportunity,
    debtAsset: string,
    userAddress: string
  ): Promise<{ debtToCover: bigint; liquidationBonusPct: number; debtToCoverUsd: number }> {
    const mode = config.closeFactorExecutionMode;
    
    // For real-time opportunities with triggerSource='realtime', fetch live debt
    let totalDebt: bigint;
    let liquidationBonusPct = 0.05; // Default 5% fallback
    let debtToCoverUsd = 0;
    
    if (this.aaveDataService && this.aaveDataService.isInitialized() && opportunity.triggerSource === 'realtime') {
      try {
        // Fetch live debt from Protocol Data Provider
        totalDebt = await this.aaveDataService.getTotalDebt(debtAsset, userAddress);
        
        // Fetch liquidation bonus for this reserve
        const collateralAsset = opportunity.collateralReserve.id;
        liquidationBonusPct = await this.aaveDataService.getLiquidationBonusPct(collateralAsset);
        
        // Update metrics
        realtimeLiquidationBonusBps.set(liquidationBonusPct * 10000);
        
        // eslint-disable-next-line no-console
        console.log('[execution] Fetched live debt data:', {
          totalDebt: totalDebt.toString(),
          liquidationBonusPct,
          mode
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[execution] Failed to fetch live debt, using opportunity data:', error instanceof Error ? error.message : error);
        totalDebt = BigInt(opportunity.principalAmountRaw);
      }
    } else {
      // For subgraph opportunities, use the debt from the opportunity event
      totalDebt = BigInt(opportunity.principalAmountRaw);
    }
    
    // Check for zero debt
    if (totalDebt === 0n) {
      return { debtToCover: 0n, liquidationBonusPct, debtToCoverUsd: 0 };
    }
    
    // Calculate debtToCover based on mode
    let debtToCover: bigint;
    if (mode === 'full') {
      // Full debt mode (experimental)
      debtToCover = totalDebt;
    } else {
      // Default: fixed50 mode (safer, 50% of total debt)
      debtToCover = totalDebt / 2n;
    }
    
    // Estimate USD value for metrics
    if (opportunity.principalValueUsd && opportunity.principalAmountRaw) {
      const principalRaw = BigInt(opportunity.principalAmountRaw);
      if (principalRaw > 0n) {
        debtToCoverUsd = (opportunity.principalValueUsd * Number(debtToCover)) / Number(principalRaw);
      }
    }
    
    // Update metrics
    if (debtToCoverUsd > 0) {
      realtimeDebtToCover.observe(debtToCoverUsd);
    }
    
    return { debtToCover, liquidationBonusPct, debtToCoverUsd };
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
