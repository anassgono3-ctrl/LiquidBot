// HealthFactorProjector: Deterministic next-block Health Factor projection
// Projects HF for accounts in critical band (1.00-1.03) using linear trends
// No ML - simple deterministic projection based on recent price & debt index movements

import { config } from '../config/index.js';
import {
  hfProjectionCalculatedTotal,
  hfProjectionLatencyMs,
  hfProjectionAccuracyTotal
} from '../metrics/index.js';

export interface AccountSnapshot {
  address: string;
  healthFactor: number;
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  blockNumber: number;
  timestamp: number;
}

export interface ProjectionResult {
  address: string;
  currentHf: number;
  projectedHf: number;
  projectedAtBlock: number;
  likelihood: 'high' | 'medium' | 'low';
  factors: {
    priceImpact: number;
    debtGrowthImpact: number;
  };
}

export interface PriceTrend {
  symbol: string;
  currentPrice: number;
  priceChange: number; // Change in last N blocks
  blockWindow: number;
}

export interface DebtIndexTrend {
  reserve: string;
  currentIndex: bigint;
  indexChange: bigint; // Change in last N blocks
  blockWindow: number;
}

/**
 * HealthFactorProjector provides deterministic next-block HF projection
 * for accounts in the critical health factor band.
 * 
 * Uses linear extrapolation based on:
 * - Recent price movements (from Chainlink feeds)
 * - Recent debt index changes (from Aave reserve updates)
 * - Current collateral/debt composition
 * 
 * No machine learning - purely deterministic calculation.
 */
export class HealthFactorProjector {
  private readonly criticalHfMin: number;
  private readonly criticalHfMax: number;
  private readonly projectionBlocks: number;
  
  // Historical data tracking
  private accountHistory: Map<string, AccountSnapshot[]> = new Map();
  private priceHistory: Map<string, number[]> = new Map(); // symbol -> recent prices
  private debtIndexHistory: Map<string, bigint[]> = new Map(); // reserve -> recent indices
  
  private readonly historyWindow = 10; // Keep last 10 observations

  constructor(options?: {
    criticalHfMin?: number;
    criticalHfMax?: number;
    projectionBlocks?: number;
  }) {
    this.criticalHfMin = options?.criticalHfMin ?? 1.00;
    this.criticalHfMax = options?.criticalHfMax ?? 1.03;
    this.projectionBlocks = options?.projectionBlocks ?? 1;

    // eslint-disable-next-line no-console
    console.log(
      `[hf-projector] Initialized with critical band [${this.criticalHfMin}, ${this.criticalHfMax}], ` +
      `projecting ${this.projectionBlocks} block(s) ahead`
    );
  }

  /**
   * Update price history for a token
   */
  updatePriceHistory(symbol: string, price: number): void {
    if (!this.priceHistory.has(symbol)) {
      this.priceHistory.set(symbol, []);
    }
    
    const history = this.priceHistory.get(symbol)!;
    history.push(price);
    
    // Keep only recent window
    if (history.length > this.historyWindow) {
      history.shift();
    }
  }

  /**
   * Update debt index history for a reserve
   */
  updateDebtIndexHistory(reserve: string, index: bigint): void {
    if (!this.debtIndexHistory.has(reserve)) {
      this.debtIndexHistory.set(reserve, []);
    }
    
    const history = this.debtIndexHistory.get(reserve)!;
    history.push(index);
    
    // Keep only recent window
    if (history.length > this.historyWindow) {
      history.shift();
    }
  }

  /**
   * Update account snapshot history
   */
  updateAccountSnapshot(snapshot: AccountSnapshot): void {
    if (!this.accountHistory.has(snapshot.address)) {
      this.accountHistory.set(snapshot.address, []);
    }
    
    const history = this.accountHistory.get(snapshot.address)!;
    history.push(snapshot);
    
    // Keep only recent window
    if (history.length > this.historyWindow) {
      history.shift();
    }
  }

  /**
   * Check if account is in critical HF band
   */
  isInCriticalBand(healthFactor: number): boolean {
    return healthFactor >= this.criticalHfMin && healthFactor <= this.criticalHfMax;
  }

  /**
   * Project next-block health factor for an account
   * 
   * Formula:
   * HF_next = (Collateral_next × LT) / Debt_next
   * 
   * Where:
   * Collateral_next = Collateral_current × (1 + price_trend)
   * Debt_next = Debt_current × (1 + debt_growth_trend)
   * 
   * Trends are calculated from recent observations using linear regression.
   */
  projectHealthFactor(
    snapshot: AccountSnapshot,
    priceTrends: PriceTrend[],
    debtIndexTrends: DebtIndexTrend[]
  ): ProjectionResult | null {
    const startTime = Date.now();

    try {
      // Only project for accounts in critical band
      if (!this.isInCriticalBand(snapshot.healthFactor)) {
        return null;
      }

      // Calculate price impact on collateral
      const priceImpact = this.calculatePriceImpact(priceTrends);

      // Calculate debt growth impact
      const debtGrowthImpact = this.calculateDebtGrowthImpact(debtIndexTrends);

      // Project next-block values
      const collateralMultiplier = 1 + priceImpact;
      const debtMultiplier = 1 + debtGrowthImpact;

      // Simplified projection assuming proportional impact
      // Real implementation would need collateral/debt composition details
      const projectedHf = snapshot.healthFactor * (collateralMultiplier / debtMultiplier);

      // Determine likelihood based on trend strength
      const trendStrength = Math.abs(priceImpact) + Math.abs(debtGrowthImpact);
      const likelihood = this.calculateLikelihood(trendStrength);

      const result: ProjectionResult = {
        address: snapshot.address,
        currentHf: snapshot.healthFactor,
        projectedHf,
        projectedAtBlock: snapshot.blockNumber + this.projectionBlocks,
        likelihood,
        factors: {
          priceImpact,
          debtGrowthImpact
        }
      };

      const latency = Date.now() - startTime;
      hfProjectionLatencyMs.observe(latency);
      
      const resultLabel = projectedHf < 1.0 ? 'liquidatable' : 'safe';
      hfProjectionCalculatedTotal.inc({ result: resultLabel });

      return result;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[hf-projector] Error projecting HF:', err);
      return null;
    }
  }

  /**
   * Calculate aggregate price impact from price trends
   * Returns percentage change (-1 to 1)
   */
  private calculatePriceImpact(priceTrends: PriceTrend[]): number {
    if (priceTrends.length === 0) {
      return 0;
    }

    // Simple average of price changes
    // Real implementation would weight by collateral composition
    const avgPriceChange = priceTrends.reduce((sum, trend) => {
      return sum + trend.priceChange;
    }, 0) / priceTrends.length;

    return avgPriceChange;
  }

  /**
   * Calculate aggregate debt growth impact from debt index trends
   * Returns percentage change (0 to 1)
   */
  private calculateDebtGrowthImpact(debtIndexTrends: DebtIndexTrend[]): number {
    if (debtIndexTrends.length === 0) {
      return 0;
    }

    // Calculate average debt growth rate
    const avgGrowthRate = debtIndexTrends.reduce((sum, trend) => {
      if (trend.currentIndex === 0n) {
        return sum;
      }
      // Convert to percentage change
      const changeRatio = Number(trend.indexChange) / Number(trend.currentIndex);
      return sum + changeRatio;
    }, 0) / debtIndexTrends.length;

    return avgGrowthRate;
  }

  /**
   * Calculate likelihood of projection based on trend strength
   */
  private calculateLikelihood(trendStrength: number): 'high' | 'medium' | 'low' {
    // Trend strength is sum of absolute impacts
    if (trendStrength > 0.01) { // > 1% total impact
      return 'high';
    } else if (trendStrength > 0.005) { // > 0.5% total impact
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Get price trend from history
   */
  getPriceTrend(symbol: string): PriceTrend | null {
    const history = this.priceHistory.get(symbol);
    if (!history || history.length < 2) {
      return null;
    }

    const currentPrice = history[history.length - 1];
    const oldPrice = history[0];
    const priceChange = (currentPrice - oldPrice) / oldPrice;

    return {
      symbol,
      currentPrice,
      priceChange,
      blockWindow: history.length
    };
  }

  /**
   * Get debt index trend from history
   */
  getDebtIndexTrend(reserve: string): DebtIndexTrend | null {
    const history = this.debtIndexHistory.get(reserve);
    if (!history || history.length < 2) {
      return null;
    }

    const currentIndex = history[history.length - 1];
    const oldIndex = history[0];
    const indexChange = currentIndex - oldIndex;

    return {
      reserve,
      currentIndex,
      indexChange,
      blockWindow: history.length
    };
  }

  /**
   * Batch project health factors for multiple accounts
   */
  batchProject(
    snapshots: AccountSnapshot[],
    priceTrends: PriceTrend[],
    debtIndexTrends: DebtIndexTrend[]
  ): ProjectionResult[] {
    const results: ProjectionResult[] = [];

    for (const snapshot of snapshots) {
      const result = this.projectHealthFactor(snapshot, priceTrends, debtIndexTrends);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Record projection accuracy (call after actual outcome is known)
   */
  recordAccuracy(
    projection: ProjectionResult,
    actualHf: number,
    liquidationOccurred: boolean
  ): void {
    const predictedLiquidation = projection.projectedHf < 1.0;

    let outcome: string;
    if (predictedLiquidation && liquidationOccurred) {
      outcome = 'true_positive';
    } else if (predictedLiquidation && !liquidationOccurred) {
      outcome = 'false_positive';
    } else if (!predictedLiquidation && !liquidationOccurred) {
      outcome = 'true_negative';
    } else {
      outcome = 'false_negative';
    }

    hfProjectionAccuracyTotal.inc({ outcome });
  }

  /**
   * Clear history for memory management
   */
  clearHistory(): void {
    this.accountHistory.clear();
    this.priceHistory.clear();
    this.debtIndexHistory.clear();
  }

  /**
   * Get statistics about history size
   */
  getHistoryStats(): {
    accounts: number;
    prices: number;
    debtIndices: number;
  } {
    return {
      accounts: this.accountHistory.size,
      prices: this.priceHistory.size,
      debtIndices: this.debtIndexHistory.size
    };
  }
}
