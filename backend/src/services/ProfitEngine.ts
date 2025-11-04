// ProfitEngine: Liquidation profitability simulation with correct token selection
// Calculates repay/seize amounts with proper scaling and applies slippage/gas guards

import { JsonRpcProvider } from 'ethers';

import { RiskEngine, UserRiskSnapshot, ReserveRisk } from './RiskEngine.js';
import { config } from '../config/index.js';

const WAD = 10n ** 18n;
const BPS = 10000n;

export interface ProfitSimulation {
  profitable: boolean;
  debtAsset: string;
  debtAssetSymbol: string;
  debtAssetDecimals: number;
  collateralAsset: string;
  collateralAssetSymbol: string;
  collateralAssetDecimals: number;
  repayAmount: bigint;
  repayAmountUsd: bigint;
  seizeAmount: bigint;
  seizeAmountUsd: bigint;
  liquidationBonus: bigint;
  grossProfitUsd: bigint;
  slippageCostUsd: bigint;
  gasCostUsd: bigint;
  netProfitUsd: bigint;
  skipReason?: string;
}

export interface ProfitEngineOptions {
  provider: JsonRpcProvider;
  riskEngine: RiskEngine;
  minProfitUsd?: number;
  maxSlippageBps?: number;
  gasCostUsd?: number;
  closeFactorBps?: number; // 5000 = 50%
}

/**
 * ProfitEngine simulates liquidation profitability with proper token selection,
 * amount calculation, and slippage/gas cost application.
 * 
 * All calculations use BigInt for precision.
 */
export class ProfitEngine {
  private provider: JsonRpcProvider;
  private riskEngine: RiskEngine;
  private minProfitUsd: bigint;
  private maxSlippageBps: bigint;
  private gasCostUsd: bigint;
  private closeFactorBps: bigint;
  
  constructor(options: ProfitEngineOptions) {
    this.provider = options.provider;
    this.riskEngine = options.riskEngine;
    
    // Convert USD amounts to bigint (assuming 1e8 precision for USD)
    // Using integer arithmetic to avoid precision loss
    const usdScale = 10n ** 8n;
    const minProfitFloat = options.minProfitUsd ?? config.profitMinUsd ?? 15;
    const gasCostFloat = options.gasCostUsd ?? config.gasCostUsd ?? 0;
    
    // Multiply by 100 first to preserve 2 decimal places, then scale
    this.minProfitUsd = (BigInt(Math.floor(minProfitFloat * 100)) * usdScale) / 100n;
    this.gasCostUsd = (BigInt(Math.floor(gasCostFloat * 100)) * usdScale) / 100n;
    
    this.maxSlippageBps = BigInt(options.maxSlippageBps ?? 80); // 0.8%
    this.closeFactorBps = BigInt(options.closeFactorBps ?? 5000); // 50%
  }
  
  /**
   * Simulate liquidation profitability for a user
   * @param snapshot User risk snapshot with reserve data
   * @returns Profit simulation result
   */
  async simulate(snapshot: UserRiskSnapshot): Promise<ProfitSimulation> {
    // Select best debt and collateral assets
    const selection = this.selectAssets(snapshot.reserves);
    
    if (!selection.debtAsset || !selection.collateralAsset) {
      return this.createUnprofitableResult('no_valid_assets');
    }
    
    const debtReserve = selection.debtAsset;
    const collateralReserve = selection.collateralAsset;
    
    // Calculate repay amount bounded by close factor and available debt
    const maxRepay = (debtReserve.totalDebt * this.closeFactorBps) / BPS;
    const repayAmount = maxRepay < debtReserve.totalDebt ? maxRepay : debtReserve.totalDebt;
    
    // Calculate repay amount in USD (base currency)
    const debtUnit = 10n ** BigInt(debtReserve.decimals);
    const baseCurrencyUnit = await this.riskEngine.getBaseCurrencyUnit();
    const repayAmountUsd = (repayAmount * debtReserve.priceInBase) / debtUnit;
    
    // Calculate seize amount using liquidation bonus
    // seizeAmount = repayAmount * (1 + liquidationBonus) * (debtPrice / collateralPrice)
    const bonusBps = collateralReserve.liquidationBonus;
    const bonusMultiplier = BPS + bonusBps;
    
    const collateralUnit = 10n ** BigInt(collateralReserve.decimals);
    
    // Calculate seize amount with proper scaling
    const seizeAmount = (repayAmount * bonusMultiplier * debtReserve.priceInBase * collateralUnit) / 
                       (BPS * collateralReserve.priceInBase * debtUnit);
    
    const seizeAmountUsd = (seizeAmount * collateralReserve.priceInBase) / collateralUnit;
    
    // Calculate gross profit (seize value - repay value)
    const grossProfitUsd = seizeAmountUsd - repayAmountUsd;
    
    // Apply slippage cost (on the collateral swap)
    const slippageCostUsd = (seizeAmountUsd * this.maxSlippageBps) / BPS;
    
    // Apply gas cost
    const gasCostUsd = this.gasCostUsd;
    
    // Calculate net profit
    const netProfitUsd = grossProfitUsd - slippageCostUsd - gasCostUsd;
    
    // Check if profitable
    const profitable = netProfitUsd >= this.minProfitUsd;
    
    return {
      profitable,
      debtAsset: debtReserve.asset,
      debtAssetSymbol: debtReserve.symbol,
      debtAssetDecimals: debtReserve.decimals,
      collateralAsset: collateralReserve.asset,
      collateralAssetSymbol: collateralReserve.symbol,
      collateralAssetDecimals: collateralReserve.decimals,
      repayAmount,
      repayAmountUsd,
      seizeAmount,
      seizeAmountUsd,
      liquidationBonus: bonusBps,
      grossProfitUsd,
      slippageCostUsd,
      gasCostUsd,
      netProfitUsd,
      skipReason: profitable ? undefined : 'not_profitable'
    };
  }
  
  /**
   * Select best debt and collateral assets based on size, bonus, and constraints
   */
  private selectAssets(reserves: ReserveRisk[]): {
    debtAsset: ReserveRisk | null;
    collateralAsset: ReserveRisk | null;
  } {
    // Filter for debt reserves (totalDebt > 0)
    const debtReserves = reserves.filter(r => r.totalDebt > 0n && r.isActive && !r.isFrozen);
    
    // Filter for collateral reserves (aTokenBalance > 0 and usageAsCollateralEnabled)
    const collateralReserves = reserves.filter(
      r => r.aTokenBalance > 0n && r.usageAsCollateralEnabled && r.isActive && !r.isFrozen
    );
    
    if (debtReserves.length === 0 || collateralReserves.length === 0) {
      return { debtAsset: null, collateralAsset: null };
    }
    
    // Select largest debt by value
    const debtAsset = debtReserves.reduce((max, r) => 
      r.debtValueBase > max.debtValueBase ? r : max
    );
    
    // Select collateral with highest liquidation bonus and sufficient value
    const collateralAsset = collateralReserves.reduce((best, r) => {
      // Prefer higher liquidation bonus
      if (r.liquidationBonus > best.liquidationBonus) return r;
      if (r.liquidationBonus < best.liquidationBonus) return best;
      
      // If equal bonus, prefer higher value
      return r.collateralValueBase > best.collateralValueBase ? r : best;
    });
    
    return { debtAsset, collateralAsset };
  }
  
  /**
   * Create an unprofitable result with a reason
   */
  private createUnprofitableResult(reason: string): ProfitSimulation {
    return {
      profitable: false,
      debtAsset: '',
      debtAssetSymbol: '',
      debtAssetDecimals: 0,
      collateralAsset: '',
      collateralAssetSymbol: '',
      collateralAssetDecimals: 0,
      repayAmount: 0n,
      repayAmountUsd: 0n,
      seizeAmount: 0n,
      seizeAmountUsd: 0n,
      liquidationBonus: 0n,
      grossProfitUsd: 0n,
      slippageCostUsd: 0n,
      gasCostUsd: 0n,
      netProfitUsd: 0n,
      skipReason: reason
    };
  }
  
  /**
   * Format USD amount from bigint (assuming 1e8 precision)
   */
  static formatUsd(amount: bigint): string {
    const usdScale = 10n ** 8n;
    const dollars = amount / usdScale;
    const cents = (amount % usdScale) / (usdScale / 100n);
    return `${dollars}.${cents.toString().padStart(2, '0')}`;
  }
}
