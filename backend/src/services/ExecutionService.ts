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
import { calculateUsdValue, formatTokenAmount } from '../utils/usdMath.js';
import { AaveMetadata } from '../aave/AaveMetadata.js';

import { OneInchQuoteService } from './OneInchQuoteService.js';
import { AaveDataService } from './AaveDataService.js';
import { UniswapV3QuoteService } from './UniswapV3QuoteService.js';
import { ExecutorRevertDecoder } from './ExecutorRevertDecoder.js';

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
  private uniswapV3Service?: UniswapV3QuoteService;
  private provider?: ethers.JsonRpcProvider;
  private wallet?: ethers.Wallet;
  private executorAddress?: string;
  private aaveDataService?: AaveDataService;
  private aaveMetadata?: AaveMetadata;

  constructor(gasEstimator?: GasEstimator, oneInchService?: OneInchQuoteService, aaveMetadata?: AaveMetadata) {
    this.gasEstimator = gasEstimator;
    this.oneInchService = oneInchService || new OneInchQuoteService();
    this.aaveMetadata = aaveMetadata;
    
    // Initialize provider and wallet if configured
    const rpcUrl = process.env.RPC_URL;
    const privateKey = process.env.EXECUTION_PRIVATE_KEY;
    this.executorAddress = process.env.EXECUTOR_ADDRESS;
    
    if (rpcUrl && privateKey) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      this.wallet = new ethers.Wallet(privateKey, this.provider);
      this.aaveDataService = new AaveDataService(this.provider, aaveMetadata);
      this.uniswapV3Service = new UniswapV3QuoteService(this.provider);
    }
    
    // Set close factor mode metric
    const mode = config.closeFactorExecutionMode;
    realtimeCloseFactorMode.set(mode === 'full' ? 1 : 0);
  }

  /**
   * Set AaveMetadata instance (for dependency injection)
   */
  setAaveMetadata(aaveMetadata: AaveMetadata): void {
    this.aaveMetadata = aaveMetadata;
    // Also update AaveDataService with the metadata
    if (this.aaveDataService) {
      this.aaveDataService.setAaveMetadata(aaveMetadata);
    }
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
      
      // Format health factor: display as "INF" when totalDebtBase == 0
      const hfFormatted = totalDebt === 0n ? 'INF' : (Number(healthFactor) / 1e18).toFixed(4);
      
      // Health factor >= 1e18 means user is not liquidatable
      const threshold = BigInt('1000000000000000000'); // 1e18
      
      if (healthFactor >= threshold) {
        return {
          liquidatable: false,
          healthFactor: hfFormatted,
          totalDebt,
          reason: `user_not_liquidatable: HF=${hfFormatted}`
        };
      }
      
      return {
        liquidatable: true,
        healthFactor: hfFormatted,
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
   * Implementation follows the spec:
   * - Enumerate all reserves and select target debt asset (prioritize LIQUIDATION_DEBT_ASSETS, else largest USD)
   * - Select collateral from reserves with aToken balance > 0 and collateral enabled (largest USD)
   * - STRICT VALIDATION: Verify both debt and collateral are valid Aave reserves via AaveMetadata
   * - Fetch decimals, liquidation bonus from pool config
   * - Compute debtToCoverRaw based on HEALTH FACTOR: 100% if HF < 0.95, else 50%
   * - Compute USD with precise math using token decimals and oracle prices
   * - Gate by PROFIT_MIN_USD - return null if below threshold
   * 
   * @param userAddress The user address
   * @param options Additional options (healthFactor, blockNumber, triggerType)
   * @returns ActionableOpportunity or null if not actionable
   */
  async prepareActionableOpportunity(
    userAddress: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: {
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
      // Get user account data to check if liquidatable and fetch HF
      const accountData = await this.aaveDataService.getUserAccountData(userAddress);
      const healthFactor = Number(accountData.healthFactor) / 1e18;
      
      // Check if user has any debt
      if (accountData.totalDebtBase === 0n) {
        return null;
      }

      // Get all reserves with user positions (debt or collateral)
      const reserves = await this.aaveDataService.getAllUserReserves(userAddress);

      // Separate debt and collateral reserves
      const debtReserves = reserves.filter(r => r.totalDebt > 0n);
      const collateralReserves = reserves.filter(r => r.aTokenBalance > 0n && r.usageAsCollateralEnabled);

      if (debtReserves.length === 0) {
        return null;
      }

      if (collateralReserves.length === 0) {
        return null;
      }

      // Select debt asset
      // 1. Check LIQUIDATION_DEBT_ASSETS preference
      let selectedDebt = null;
      const preferredDebtAssets = config.liquidationDebtAssets;
      
      if (preferredDebtAssets.length > 0) {
        // Find first preferred asset that user has debt in
        for (const preferredAsset of preferredDebtAssets) {
          const found = debtReserves.find(r => r.asset.toLowerCase() === preferredAsset.toLowerCase());
          if (found) {
            selectedDebt = found;
            break;
          }
        }
      }
      
      // 2. If no preferred asset or not found, select largest debt by USD value
      if (!selectedDebt) {
        selectedDebt = debtReserves.reduce((max, r) => r.debtValueUsd > max.debtValueUsd ? r : max);
      }

      // Select collateral asset - largest by USD value
      const selectedCollateral = collateralReserves.reduce((max, r) => r.collateralValueUsd > max.collateralValueUsd ? r : max);

      // STRICT VALIDATION: Check both debt and collateral against AaveMetadata
      if (this.aaveMetadata && this.aaveMetadata.initialized()) {
        // Maybe refresh metadata periodically
        await this.aaveMetadata.maybeRefresh();

        // Validate debt asset is a valid reserve
        if (!this.aaveMetadata.isReserve(selectedDebt.asset)) {
          // eslint-disable-next-line no-console
          console.warn('[execution] Rejected invalid debt asset (not an Aave reserve):', {
            user: userAddress,
            debtAsset: selectedDebt.asset,
            symbol: selectedDebt.symbol
          });
          return null;
        }

        // Validate collateral asset is a valid reserve
        if (!this.aaveMetadata.isReserve(selectedCollateral.asset)) {
          // eslint-disable-next-line no-console
          console.warn('[execution] Rejected invalid collateral asset (not an Aave reserve):', {
            user: userAddress,
            collateralAsset: selectedCollateral.asset,
            symbol: selectedCollateral.symbol
          });
          return null;
        }

        // Get reserve metadata for additional checks
        const debtReserveInfo = this.aaveMetadata.getReserve(selectedDebt.asset);
        const collateralReserveInfo = this.aaveMetadata.getReserve(selectedCollateral.asset);

        if (debtReserveInfo && !debtReserveInfo.borrowingEnabled) {
          // eslint-disable-next-line no-console
          console.warn('[execution] Rejected debt asset with borrowing disabled:', {
            user: userAddress,
            debtAsset: selectedDebt.asset
          });
          return null;
        }

        if (collateralReserveInfo && collateralReserveInfo.liquidationThreshold === 0) {
          // eslint-disable-next-line no-console
          console.warn('[execution] Rejected collateral asset with zero liquidation threshold:', {
            user: userAddress,
            collateralAsset: selectedCollateral.asset
          });
          return null;
        }
      }

      // Fetch liquidation bonus for the selected collateral
      const liquidationBonusPct = await this.aaveDataService.getLiquidationBonusPct(selectedCollateral.asset);

      // Calculate debtToCover based on HEALTH FACTOR (not config mode)
      // Close factor: 100% if HF < 0.95, else 50%
      const closeFactorThreshold = 0.95;
      let debtToCover: bigint;
      
      if (healthFactor < closeFactorThreshold) {
        // HF < 0.95: can liquidate 100% of debt
        debtToCover = selectedDebt.totalDebt;
        // eslint-disable-next-line no-console
        console.log(`[execution] Using 100% close factor (HF ${healthFactor.toFixed(4)} < ${closeFactorThreshold})`);
      } else {
        // HF >= 0.95: liquidate 50% of debt
        debtToCover = selectedDebt.totalDebt / 2n;
        // eslint-disable-next-line no-console
        console.log(`[execution] Using 50% close factor (HF ${healthFactor.toFixed(4)} >= ${closeFactorThreshold})`);
      }

      // Calculate USD value using 1e18 normalization (canonical implementation)
      const debtToCoverUsd = calculateUsdValue(debtToCover, selectedDebt.decimals, selectedDebt.priceRaw);

      // Gate by PROFIT_MIN_USD
      const profitMinUsd = config.profitMinUsd;
      if (debtToCoverUsd < profitMinUsd) {
        // Below minimum threshold - not actionable
        return null;
      }

      // Update metrics
      realtimeLiquidationBonusBps.set(liquidationBonusPct * 10000);
      realtimeDebtToCover.observe(debtToCoverUsd);

      return {
        debtAsset: selectedDebt.asset,
        debtAssetSymbol: selectedDebt.symbol,
        totalDebt: selectedDebt.totalDebt,
        debtToCover,
        debtToCoverUsd,
        liquidationBonusPct,
        collateralAsset: selectedCollateral.asset,
        collateralSymbol: selectedCollateral.symbol
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[execution] Failed to prepare actionable opportunity:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Prepare actionable opportunity with explicit skip reason.
   * Returns actionable plan or skip reason for better logging.
   * @param userAddress The user address
   * @param options Additional options
   * @returns Success with plan or failure with explicit skip reason
   */
  async prepareActionableOpportunityWithReason(
    userAddress: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: {
      collateralAsset?: string;
      healthFactor?: number;
      blockNumber?: number;
      triggerType?: 'event' | 'head' | 'price';
    }
  ): Promise<{
    success: true;
    plan: {
      debtAsset: string;
      debtAssetSymbol: string;
      totalDebt: bigint;
      debtToCover: bigint;
      debtToCoverUsd: number;
      liquidationBonusPct: number;
      collateralAsset: string;
      collateralSymbol: string;
    };
  } | {
    success: false;
    skipReason: 'service_unavailable' | 'no_debt' | 'no_collateral' | 'price_missing' | 'below_min_repay_usd' | 'below_min_usd' | 'invalid_pair' | 'resolve_failed';
    details?: string;
  }> {
    // Validate that AaveDataService is available
    if (!this.aaveDataService || !this.aaveDataService.isInitialized()) {
      return { success: false, skipReason: 'service_unavailable', details: 'AaveDataService not initialized' };
    }

    try {
      // Get user account data to check if liquidatable and fetch HF
      const accountData = await this.aaveDataService.getUserAccountData(userAddress);
      const healthFactor = Number(accountData.healthFactor) / 1e18;
      
      // Check if user has any debt
      if (accountData.totalDebtBase === 0n) {
        return { success: false, skipReason: 'no_debt' };
      }

      // Get all reserves with user positions (debt or collateral)
      const reserves = await this.aaveDataService.getAllUserReserves(userAddress);

      // Separate debt and collateral reserves
      const debtReserves = reserves.filter(r => r.totalDebt > 0n);
      const collateralReserves = reserves.filter(r => r.aTokenBalance > 0n && r.usageAsCollateralEnabled);

      if (debtReserves.length === 0) {
        return { success: false, skipReason: 'no_debt' };
      }

      if (collateralReserves.length === 0) {
        return { success: false, skipReason: 'no_collateral' };
      }

      // Select debt asset
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

      // Select collateral asset
      const selectedCollateral = collateralReserves.reduce((max, r) => r.collateralValueUsd > max.collateralValueUsd ? r : max);

      // STRICT VALIDATION: Check both debt and collateral against AaveMetadata
      if (this.aaveMetadata && this.aaveMetadata.initialized()) {
        await this.aaveMetadata.maybeRefresh();

        // Validate debt asset
        if (!this.aaveMetadata.isReserve(selectedDebt.asset)) {
          return { 
            success: false, 
            skipReason: 'invalid_pair', 
            details: `Debt asset ${selectedDebt.asset} (${selectedDebt.symbol}) is not a valid Aave reserve` 
          };
        }

        // Validate collateral asset
        if (!this.aaveMetadata.isReserve(selectedCollateral.asset)) {
          return { 
            success: false, 
            skipReason: 'invalid_pair', 
            details: `Collateral asset ${selectedCollateral.asset} (${selectedCollateral.symbol}) is not a valid Aave reserve` 
          };
        }

        // Additional config checks
        const debtReserveInfo = this.aaveMetadata.getReserve(selectedDebt.asset);
        const collateralReserveInfo = this.aaveMetadata.getReserve(selectedCollateral.asset);

        if (debtReserveInfo && !debtReserveInfo.borrowingEnabled) {
          return { 
            success: false, 
            skipReason: 'invalid_pair', 
            details: `Debt asset ${selectedDebt.symbol} has borrowing disabled` 
          };
        }

        if (collateralReserveInfo && collateralReserveInfo.liquidationThreshold === 0) {
          return { 
            success: false, 
            skipReason: 'invalid_pair', 
            details: `Collateral asset ${selectedCollateral.symbol} has zero liquidation threshold` 
          };
        }
      }

      // Fetch liquidation bonus
      const liquidationBonusPct = await this.aaveDataService.getLiquidationBonusPct(selectedCollateral.asset);

      // Calculate debtToCover based on HEALTH FACTOR
      const closeFactorThreshold = 0.95;
      let debtToCover: bigint;
      
      if (healthFactor < closeFactorThreshold) {
        debtToCover = selectedDebt.totalDebt;
      } else {
        debtToCover = selectedDebt.totalDebt / 2n;
      }

      // Validate prices before calculating USD values
      // Ensure priceRaw > 0 for both debt and collateral to prevent silent zero-value bugs
      if (selectedDebt.priceRaw <= 0n) {
        // eslint-disable-next-line no-console
        console.error(
          `[execution] price_missing: debt asset ${selectedDebt.symbol} (${selectedDebt.asset}) ` +
          `has invalid price: ${selectedDebt.priceRaw}`
        );
        return { 
          success: false, 
          skipReason: 'price_missing', 
          details: `Debt asset ${selectedDebt.symbol} price unavailable (priceRaw=${selectedDebt.priceRaw})` 
        };
      }
      
      if (selectedCollateral.priceRaw <= 0n) {
        // eslint-disable-next-line no-console
        console.error(
          `[execution] price_missing: collateral asset ${selectedCollateral.symbol} (${selectedCollateral.asset}) ` +
          `has invalid price: ${selectedCollateral.priceRaw}`
        );
        return { 
          success: false, 
          skipReason: 'price_missing', 
          details: `Collateral asset ${selectedCollateral.symbol} price unavailable (priceRaw=${selectedCollateral.priceRaw})` 
        };
      }

      // Calculate USD value (now safe since prices are validated)
      const debtToCoverUsd = calculateUsdValue(debtToCover, selectedDebt.decimals, selectedDebt.priceRaw);
      
      // Scaling detection: check if debtToCoverHuman or collateralHuman exceeds reasonable bounds
      const debtToCoverHuman = Number(debtToCover) / (10 ** selectedDebt.decimals);
      const collateralHuman = Number(selectedCollateral.aTokenBalance) / (10 ** selectedCollateral.decimals);
      
      if (debtToCoverHuman > 1e6) {
        // eslint-disable-next-line no-console
        console.error(
          `[execution] scaling_guard: debtToCoverHuman=${debtToCoverHuman.toFixed(2)} > 1e6 tokens - ABORTING`
        );
        return {
          success: false,
          skipReason: 'resolve_failed',
          details: `scaling_guard: debt amount ${debtToCoverHuman.toFixed(2)} exceeds 1e6 tokens`
        };
      }
      
      if (collateralHuman > 1e6) {
        // eslint-disable-next-line no-console
        console.error(
          `[execution] scaling_guard: collateralHuman=${collateralHuman.toFixed(2)} > 1e6 tokens - ABORTING`
        );
        return {
          success: false,
          skipReason: 'resolve_failed',
          details: `scaling_guard: collateral amount ${collateralHuman.toFixed(2)} exceeds 1e6 tokens`
        };
      }
      
      // Dust guard: check if both collateral and debt are below dust threshold
      const DUST_THRESHOLD_WEI = BigInt(process.env.EXECUTION_DUST_WEI || '1000000000000'); // 1e12 wei by default
      if (accountData.totalCollateralBase < DUST_THRESHOLD_WEI && accountData.totalDebtBase < DUST_THRESHOLD_WEI && healthFactor < 1.0) {
        // eslint-disable-next-line no-console
        console.log(
          `[execution] dust_guard: both collateral and debt below threshold - SKIPPING`
        );
        return {
          success: false,
          skipReason: 'resolve_failed',
          details: `dust_guard: collateral=${accountData.totalCollateralBase.toString()}, debt=${accountData.totalDebtBase.toString()}, threshold=${DUST_THRESHOLD_WEI.toString()}`
        };
      }
      
      // Log intermediate values for debugging (using readable decimals)
      // eslint-disable-next-line no-console
      console.log(
        `[execution] Repay calculation: user=${userAddress} ` +
        `debtAsset=${selectedDebt.symbol} totalDebt=${selectedDebt.totalDebt.toString()} ` +
        `debtToCover=${debtToCover.toString()} decimals=${selectedDebt.decimals} ` +
        `priceRaw=${selectedDebt.priceRaw.toString()} ` +
        `debtToCoverUsd=${debtToCoverUsd.toFixed(6)} debtToCoverHuman=${debtToCoverHuman.toFixed(6)} ` +
        `HF=${healthFactor.toFixed(4)}`
      );

      // Gate by MIN_REPAY_USD (default 50, hardcoded with optional env override)
      const minRepayUsd = config.minRepayUsd;
      if (debtToCoverUsd < minRepayUsd) {
        return { success: false, skipReason: 'below_min_repay_usd', details: `${debtToCoverUsd.toFixed(2)} < ${minRepayUsd}` };
      }

      // Additional gate by PROFIT_MIN_USD
      const profitMinUsd = config.profitMinUsd;
      if (debtToCoverUsd < profitMinUsd) {
        return { success: false, skipReason: 'below_min_usd', details: `${debtToCoverUsd.toFixed(2)} < ${profitMinUsd}` };
      }

      // Update metrics
      realtimeLiquidationBonusBps.set(liquidationBonusPct * 10000);
      realtimeDebtToCover.observe(debtToCoverUsd);

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
          collateralSymbol: selectedCollateral.symbol
        }
      };
    } catch (error) {
      return { 
        success: false, 
        skipReason: 'resolve_failed', 
        details: error instanceof Error ? error.message : String(error) 
      };
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
    // GUARD 0: Check EXECUTION_ENABLED flag BEFORE any processing
    if (!executionConfig.executionEnabled) {
      // eslint-disable-next-line no-console
      console.log('[execution] Execution disabled via EXECUTION_ENABLED=false:', {
        opportunityId: opportunity.id,
        user: opportunity.user
      });
      return {
        success: false,
        simulated: false,
        reason: 'execution_disabled'
      };
    }

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

      // Step 1a: Additional guards - check for dust-level positions
      // Dust threshold: 1e12 wei base (configurable via EXECUTION_DUST_WEI env var)
      const DUST_THRESHOLD_WEI = BigInt(process.env.EXECUTION_DUST_WEI || '1000000000000'); // 1e12 wei by default
      
      // Get collateral and debt from account data (canonical source)
      const accountData = await this.aaveDataService!.getUserAccountData(opportunity.user);
      const totalCollateralBase = accountData.totalCollateralBase;
      const totalDebtBase = accountData.totalDebtBase;
      const healthFactorRaw = accountData.healthFactor;
      const healthFactorNum = Number(healthFactorRaw) / 1e18;
      
      // GUARD 1: Dust guard - both collateral AND debt below threshold
      if (totalCollateralBase < DUST_THRESHOLD_WEI && totalDebtBase < DUST_THRESHOLD_WEI && healthFactorNum < 1.0) {
        // eslint-disable-next-line no-console
        console.log('[execution] GUARD: dust_guard - both collateral and debt below threshold:', {
          opportunityId: opportunity.id,
          user: opportunity.user,
          totalCollateralBase: totalCollateralBase.toString(),
          totalDebtBase: totalDebtBase.toString(),
          dustThreshold: DUST_THRESHOLD_WEI.toString(),
          healthFactor: healthFactorNum.toFixed(4)
        });
        return {
          success: false,
          simulated: false,
          reason: 'dust_guard'
        };
      }
      
      // GUARD 2: Inconsistent zero collateral - If collateralUsd == 0 while HF < 1, abort (likely data issue)
      // Get ETH/USD price for conversion
      try {
        const ethUsdFeed = new ethers.Contract(
          '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70', // ETH/USD on Base
          ['function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80)', 'function decimals() external view returns (uint8)'],
          this.provider
        );
        const roundData = await ethUsdFeed.latestRoundData();
        const ethPrice = roundData[1];
        const ethPriceDecimals = Number(await ethUsdFeed.decimals());
        
        // Convert collateral to USD
        const collateralUsd = Number(totalCollateralBase) * Number(ethPrice) / (10 ** ethPriceDecimals) / 1e18;
        
        if (collateralUsd === 0 && healthFactorNum < 1.0) {
          // eslint-disable-next-line no-console
          console.log('[execution] GUARD: inconsistent_zero_collateral - zero collateral USD with HF < 1:', {
            opportunityId: opportunity.id,
            user: opportunity.user,
            totalCollateralBase: totalCollateralBase.toString(),
            collateralUsd,
            healthFactor: healthFactorNum.toFixed(4)
          });
          return {
            success: false,
            simulated: false,
            reason: 'inconsistent_zero_collateral'
          };
        }
        
        // Log reason for HF < 1
        if (healthFactorNum < 1.0) {
          const debtUsd = Number(totalDebtBase) * Number(ethPrice) / (10 ** ethPriceDecimals) / 1e18;
          // eslint-disable-next-line no-console
          console.log(`[execution] Position details: collateralUSD=$${collateralUsd.toFixed(6)}, debtUSD=$${debtUsd.toFixed(6)}, HF=${healthFactorNum.toFixed(4)}`);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[execution] Failed to check collateral USD:', error instanceof Error ? error.message : error);
      }

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
      let debtInfo;
      try {
        debtInfo = await this.calculateDebtToCover(opportunity, debtAsset, opportunity.user);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[execution] Failed to calculate debt to cover:', error instanceof Error ? error.message : error);
        return {
          success: false,
          simulated: false,
          reason: error instanceof Error ? error.message : 'calculate_debt_failed'
        };
      }
      
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
      
      // Step 3a: Calculate proper USD value using 1e18 math (matching plan resolver)
      // Get decimals and price for debt asset
      // Verify decimals from metadata if available to ensure correctness
      let debtDecimals = opportunity.principalReserve.decimals || 18;
      if (this.aaveMetadata) {
        try {
          const debtMetadata = await this.aaveMetadata.getReserve(debtAsset);
          if (debtMetadata && debtMetadata.decimals !== debtDecimals) {
            // eslint-disable-next-line no-console
            console.warn(
              `[execution] Decimals mismatch for ${opportunity.principalReserve.symbol}: ` +
              `opportunity=${debtDecimals} metadata=${debtMetadata.decimals} - using metadata value`
            );
            debtDecimals = debtMetadata.decimals;
          }
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn('[execution] Failed to verify debt decimals from metadata:', error instanceof Error ? error.message : error);
        }
      }
      
      let debtPriceRaw: bigint;
      let debtToCoverUsdPrecise: number;
      
      try {
        const aave = this.aaveDataService;
        if (!aave) {
          throw new Error('AaveDataService not initialized - cannot fetch asset price');
        }
        debtPriceRaw = await aave.getAssetPrice(debtAsset);
        debtToCoverUsdPrecise = calculateUsdValue(debtToCover, debtDecimals, debtPriceRaw);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[execution] Failed to fetch asset price, using estimated USD:', error instanceof Error ? error.message : error);
        debtToCoverUsdPrecise = debtToCoverUsd;
        debtPriceRaw = BigInt(0);
      }

      // Format human-readable amount
      const debtToCoverHuman = formatTokenAmount(debtToCover, debtDecimals);
      
      // GUARD 3: Scaling anomaly guard - check if debtToCoverHuman exceeds reasonable bounds
      const debtToCoverHumanNum = Number(debtToCoverHuman);
      if (debtToCoverHumanNum > 1e6) {
        // eslint-disable-next-line no-console
        console.log('[execution] GUARD: scaling_guard - debt amount exceeds 1e6 tokens:', {
          opportunityId: opportunity.id,
          user: opportunity.user,
          debtAsset: opportunity.principalReserve.symbol,
          debtToCoverHuman: debtToCoverHumanNum.toFixed(2),
          debtToCoverRaw: debtToCover.toString(),
          decimals: debtDecimals
        });
        return {
          success: false,
          simulated: false,
          reason: 'scaling_guard'
        };
      }

      // Calculate expected collateral amount with bonus
      // collateralAmount = debtToCover * (1 + liquidationBonus) * (priceDebt / priceCollateral)
      const collateralAsset = opportunity.collateralReserve.id;
      // Verify collateral decimals from metadata if available
      let collateralDecimals = opportunity.collateralReserve.decimals || 18;
      if (this.aaveMetadata) {
        try {
          const collateralMetadata = await this.aaveMetadata.getReserve(collateralAsset);
          if (collateralMetadata && collateralMetadata.decimals !== collateralDecimals) {
            // eslint-disable-next-line no-console
            console.warn(
              `[execution] Decimals mismatch for ${opportunity.collateralReserve.symbol}: ` +
              `opportunity=${collateralDecimals} metadata=${collateralMetadata.decimals} - using metadata value`
            );
            collateralDecimals = collateralMetadata.decimals;
          }
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn('[execution] Failed to verify collateral decimals from metadata:', error instanceof Error ? error.message : error);
        }
      }
      
      let expectedCollateralRaw: bigint;
      
      try {
        const aave = this.aaveDataService;
        if (!aave) {
          throw new Error('AaveDataService not initialized - cannot fetch asset price');
        }
        const collateralPriceRaw = await aave.getAssetPrice(collateralAsset);
        
        // Calculate using precise 1e18 math
        // First normalize debt to 1e18
        const debtDecimalDiff = 18 - debtDecimals;
        const debt1e18 = debtDecimalDiff >= 0 
          ? debtToCover * BigInt(10 ** debtDecimalDiff)
          : debtToCover / BigInt(10 ** Math.abs(debtDecimalDiff));
        
        // Multiply by price to get USD value in 1e18
        const debtPrice1e18 = debtPriceRaw * BigInt(1e10); // Convert 1e8 to 1e18
        const debtUsd1e18 = (debt1e18 * debtPrice1e18) / BigInt(1e18);
        
        // Apply liquidation bonus
        const bonusBps = Math.round(liquidationBonusPct * 10000);
        const debtWithBonus1e18 = (debtUsd1e18 * BigInt(10000 + bonusBps)) / BigInt(10000);
        
        // Convert back to collateral amount
        const collateralPrice1e18 = collateralPriceRaw * BigInt(1e10);
        const collateral1e18 = (debtWithBonus1e18 * BigInt(1e18)) / collateralPrice1e18;
        
        // Denormalize from 1e18 to collateral decimals
        const collateralDecimalDiff = 18 - collateralDecimals;
        expectedCollateralRaw = collateralDecimalDiff >= 0
          ? collateral1e18 / BigInt(10 ** collateralDecimalDiff)
          : collateral1e18 * BigInt(10 ** Math.abs(collateralDecimalDiff));
          
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[execution] Failed to calculate expected collateral, using opportunity data:', error instanceof Error ? error.message : error);
        expectedCollateralRaw = BigInt(opportunity.collateralAmountRaw || '0');
      }

      const expectedCollateralHuman = formatTokenAmount(expectedCollateralRaw, collateralDecimals);
      const expectedCollateralHumanNum = Number(expectedCollateralHuman);
      
      // GUARD 4: Scaling anomaly guard - check if seizedCollateralHuman exceeds reasonable bounds
      if (expectedCollateralHumanNum > 1e6) {
        // eslint-disable-next-line no-console
        console.log('[execution] GUARD: scaling_guard - seized collateral amount exceeds 1e6 tokens:', {
          opportunityId: opportunity.id,
          user: opportunity.user,
          collateralAsset: opportunity.collateralReserve.symbol,
          expectedCollateralHuman: expectedCollateralHumanNum.toFixed(2),
          expectedCollateralRaw: expectedCollateralRaw.toString(),
          decimals: collateralDecimals
        });
        return {
          success: false,
          simulated: false,
          reason: 'scaling_guard'
        };
      }
      
      // Decimals verification log
      // eslint-disable-next-line no-console
      console.log('[execution] Decimals check:', {
        debt: `${opportunity.principalReserve.symbol}=${debtDecimals}`,
        collateral: `${opportunity.collateralReserve.symbol}=${collateralDecimals}`
      });
      
      // Calculate seized collateral USD value
      let seizedUsd = 0;
      try {
        const aave = this.aaveDataService;
        if (!aave) {
          throw new Error('AaveDataService not initialized - cannot fetch asset price');
        }
        const collateralPriceRaw = await aave.getAssetPrice(collateralAsset);
        seizedUsd = calculateUsdValue(expectedCollateralRaw, collateralDecimals, collateralPriceRaw);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[execution] Failed to calculate seized USD:', error instanceof Error ? error.message : error);
      }
      
      // GUARD 5: Profit reasonability check - ensure seizedUSD - repayUSD >= PROFIT_MIN_USD
      const grossProfit = seizedUsd - debtToCoverUsdPrecise;
      const profitMinUsd = config.profitMinUsd;
      
      if (grossProfit < profitMinUsd) {
        // eslint-disable-next-line no-console
        console.log('[execution] GUARD: unprofitable - gross profit below threshold:', {
          opportunityId: opportunity.id,
          user: opportunity.user,
          seizedUsd: seizedUsd.toFixed(6),
          repayUsd: debtToCoverUsdPrecise.toFixed(6),
          grossProfit: grossProfit.toFixed(6),
          profitMinUsd: profitMinUsd.toFixed(6)
        });
        return {
          success: false,
          simulated: false,
          reason: 'unprofitable'
        };
      }
      
      // Pre-quote diagnostics: log exact inputs before calling quote service (using readable decimals)
      // eslint-disable-next-line no-console
      console.log('[execution] Pre-quote diagnostics:', {
        debtToCoverRaw: debtToCover.toString(),
        debtToCoverHuman: debtToCoverHuman,
        debtToCoverUsd: debtToCoverUsdPrecise.toFixed(6),
        expectedCollateralRaw: expectedCollateralRaw.toString(),
        expectedCollateralHuman: expectedCollateralHuman,
        seizedUsd: seizedUsd.toFixed(6),
        grossProfit: grossProfit.toFixed(6),
        debtAsset: `${opportunity.principalReserve.symbol} (${debtAsset})`,
        collateralAsset: `${opportunity.collateralReserve.symbol} (${collateralAsset})`,
        liquidationBonusPct: (liquidationBonusPct * 100).toFixed(2) + '%',
        bonusBps: Math.round(liquidationBonusPct * 10000),
        closeFactorMode: config.closeFactorExecutionMode
      });
      
      // Step 3b: Router fallback: Uniswap V3 → 1inch
      // Try Uniswap V3 direct path first (WETH/USDC pools, 0.05%/0.3%)
      const slippageBps = Number(process.env.MAX_SLIPPAGE_BPS || 100); // 1% default
      let swapQuote: { data: string; minOut: string };
      let routeUsed = 'none';
      
      // Try Uniswap V3 first if available
      if (this.uniswapV3Service) {
        try {
          const uniQuote = await this.uniswapV3Service.getQuote({
            tokenIn: collateralAsset,
            tokenOut: debtAsset,
            amountIn: expectedCollateralRaw,
            fee: 500 // Start with 0.05% tier
          });
          
          if (uniQuote.success && uniQuote.amountOut && uniQuote.amountOut > 0n) {
            // Calculate minOut with slippage
            const minOut = (uniQuote.amountOut * BigInt(10000 - slippageBps)) / BigInt(10000);
            
            // eslint-disable-next-line no-console
            console.log('[execution] Uniswap V3 quote successful:', {
              amountOut: uniQuote.amountOut.toString(),
              minOut: minOut.toString(),
              path: uniQuote.path
            });
            
            // Uniswap V3 validation successful - still using 1inch for execution calldata
            // This validates liquidity exists but uses 1inch for actual swap routing
            // Future: Build Uniswap V3 swap calldata directly for full end-to-end routing
            routeUsed = 'uniswap-v3-validated';
          } else {
            // eslint-disable-next-line no-console
            console.log('[execution] Uniswap V3 quote failed, falling back to 1inch:', uniQuote.reason);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[execution] Uniswap V3 quote error, falling back to 1inch:', err instanceof Error ? err.message : err);
        }
      }
      
      // Get 1inch quote (fallback or primary if Uniswap not available)
      try {
        swapQuote = await this.oneInchService.getSwapCalldata({
          fromToken: collateralAsset,
          toToken: debtAsset,
          amount: expectedCollateralRaw.toString(),
          slippageBps: slippageBps,
          fromAddress: this.executorAddress
        });
        
        if (routeUsed === 'none') {
          routeUsed = '1inch';
        }
        
        // eslint-disable-next-line no-console
        console.log('[execution] Using route:', routeUsed);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[execution] All routers failed:', err instanceof Error ? err.message : err);
        return {
          success: false,
          simulated: false,
          reason: 'router_no_liquidity'
        };
      }

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
      // Try to decode executor/contract revert errors
      let errorMsg = error instanceof Error ? error.message : 'unknown_error';
      let shortReason = 'execution_failed';
      
      // Check if error contains revert data
      if (error && typeof error === 'object' && 'data' in error && typeof error.data === 'string') {
        try {
          const decoded = ExecutorRevertDecoder.decode(error.data);
          
          // eslint-disable-next-line no-console
          console.error('[execution] Decoded revert:', {
            selector: decoded.selector,
            name: decoded.name,
            reason: decoded.reason,
            category: decoded.category
          });
          
          errorMsg = decoded.reason;
          shortReason = ExecutorRevertDecoder.getShortReason(error.data);
        } catch (decodeErr) {
          // Fallback to Aave error decoder
          const decodedError = AaveMetadata.decodeAaveError(error.data);
          if (decodedError) {
            const contextMsg = AaveMetadata.formatAaveError(error.data, {
              user: opportunity.user,
              debtAsset: opportunity.principalReserve.id,
              collateralAsset: opportunity.collateralReserve.id,
              healthFactor: opportunity.healthFactor || undefined
            });
            
            // eslint-disable-next-line no-console
            console.error('[execution] Decoded Aave error:', contextMsg);
            errorMsg = contextMsg;
          }
        }
      }
      
      // eslint-disable-next-line no-console
      console.error('[execution] Execution failed:', {
        error: errorMsg,
        shortReason,
        user: opportunity.user
      });
      
      return {
        success: false,
        simulated: false,
        reason: `${shortReason}: ${errorMsg}`
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
        // Fetch canonical user reserve data from Protocol Data Provider
        const userReserveData = await this.aaveDataService.getUserReserveData(debtAsset, userAddress);
        
        // Get total debt using canonical reconstruction (handles variable debt scaling properly)
        totalDebt = await this.aaveDataService.getTotalDebt(debtAsset, userAddress);
        
        // Cross-check: if scaledVariableDebt > 0, verify reconstruction
        if (userReserveData.scaledVariableDebt > 0n) {
          const RAY = BigInt(10 ** 27);
          const reserveData = await this.aaveDataService.getReserveData(debtAsset);
          const variableBorrowIndex = reserveData.variableBorrowIndex;
          
          // Reconstruct variable debt: scaledVariableDebt * variableBorrowIndex / RAY
          const reconstructed = (userReserveData.scaledVariableDebt * variableBorrowIndex) / RAY;
          
          // Compare with currentVariableDebt from getUserReserveData
          if (userReserveData.currentVariableDebt > 0n) {
            const diff = reconstructed > userReserveData.currentVariableDebt
              ? reconstructed - userReserveData.currentVariableDebt
              : userReserveData.currentVariableDebt - reconstructed;
            
            // Tolerance: 0.5% (more lenient than the 0.1% in getTotalDebt)
            const tolerance = reconstructed / 200n;
            
            if (diff > tolerance) {
              // eslint-disable-next-line no-console
              console.error(
                `[execution] SCALING SUSPECTED: Variable debt inconsistency detected: ` +
                `reconstructed=${reconstructed.toString()} vs current=${userReserveData.currentVariableDebt.toString()} ` +
                `diff=${diff.toString()} (>${tolerance.toString()} tolerance) - ABORTING`
              );
              throw new Error('scaling_guard: Variable debt reconstruction inconsistent with canonical values');
            }
          }
        }
        
        // Fetch liquidation bonus for this reserve
        const collateralAsset = opportunity.collateralReserve.id;
        liquidationBonusPct = await this.aaveDataService.getLiquidationBonusPct(collateralAsset);
        
        // Update metrics
        realtimeLiquidationBonusBps.set(liquidationBonusPct * 10000);
        
        // eslint-disable-next-line no-console
        console.log('[execution] Fetched live debt data with canonical accounting:', {
          totalDebt: totalDebt.toString(),
          currentATokenBalance: userReserveData.currentATokenBalance.toString(),
          currentVariableDebt: userReserveData.currentVariableDebt.toString(),
          currentStableDebt: userReserveData.currentStableDebt.toString(),
          scaledVariableDebt: userReserveData.scaledVariableDebt.toString(),
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
    
    // Calculate USD value using canonical USD math (no proportional estimation)
    // This ensures consistency with plan resolution and gating logic
    try {
      const debtDecimals = opportunity.principalReserve.decimals || 18;
      
      if (!this.aaveDataService) {
        throw new Error('AaveDataService not initialized');
      }
      
      const debtPriceRaw = await this.aaveDataService.getAssetPrice(debtAsset);
      
      // Use canonical calculateUsdValue for precise USD computation
      debtToCoverUsd = calculateUsdValue(debtToCover, debtDecimals, debtPriceRaw);
      
      // Debug: compute quick USD for consistency check
      const quickUsd = (Number(debtToCover) / (10 ** debtDecimals)) * (Number(debtPriceRaw) / 1e8);
      
      // eslint-disable-next-line no-console
      console.log('[execution] USD calculation:', {
        debtToCover: debtToCover.toString(),
        canonicalUsd: debtToCoverUsd.toFixed(6),
        quickUsd: quickUsd.toFixed(6),
        diff: Math.abs(debtToCoverUsd - quickUsd).toFixed(6)
      });
      
      // Safety guard: abort if debtToCoverHuman is suspiciously large (possible scaling error)
      const debtToCoverHuman = Number(debtToCover) / (10 ** debtDecimals);
      if (debtToCoverHuman > 1e9) {
        // eslint-disable-next-line no-console
        console.error(
          `[execution] SCALING SUSPECTED: debtToCoverHuman=${debtToCoverHuman.toFixed(2)} > 1e9 tokens ` +
          `(debtToCoverRaw=${debtToCover.toString()}, decimals=${debtDecimals}) - ` +
          `ABORTING execution due to possible scaling error!`
        );
        throw new Error('Scaling error suspected: debt amount exceeds 1e9 tokens');
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[execution] Failed to calculate USD value, using zero:', error instanceof Error ? error.message : error);
      debtToCoverUsd = 0;
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
