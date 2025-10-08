// OpportunityService: Detect and evaluate liquidation opportunities
import { config } from '../config/index.js';
import type { LiquidationCall, Opportunity, HealthSnapshot } from '../types/index.js';

import { PriceService } from './PriceService.js';
import { ProfitCalculator } from './ProfitCalculator.js';

export interface OpportunityServiceOptions {
  priceService?: PriceService;
  profitCalculator?: ProfitCalculator;
}

/**
 * OpportunityService transforms liquidation calls into enriched opportunities
 * with profit estimation and health factor information.
 */
export class OpportunityService {
  private priceService: PriceService;
  private profitCalculator: ProfitCalculator;

  constructor(opts: OpportunityServiceOptions = {}) {
    this.priceService = opts.priceService || new PriceService();
    this.profitCalculator = opts.profitCalculator || new ProfitCalculator();
  }

  /**
   * Build opportunities from liquidation calls.
   * @param liquidations Array of liquidation calls
   * @param healthSnapshots Optional map of user ID to health factor
   * @returns Array of enriched opportunities
   */
  async buildOpportunities(
    liquidations: LiquidationCall[],
    healthSnapshots?: Map<string, HealthSnapshot>
  ): Promise<Opportunity[]> {
    const opportunities: Opportunity[] = [];

    for (const liq of liquidations) {
      try {
        const opportunity = await this.buildSingleOpportunity(liq, healthSnapshots);
        opportunities.push(opportunity);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[opportunity] Failed to build opportunity for ${liq.id}:`, err);
        // Continue processing other opportunities
      }
    }

    return opportunities;
  }

  /**
   * Build a single opportunity from a liquidation call
   */
  private async buildSingleOpportunity(
    liq: LiquidationCall,
    healthSnapshots?: Map<string, HealthSnapshot>
  ): Promise<Opportunity> {
    // Get health factor if available
    const healthSnapshot = healthSnapshots?.get(liq.user);
    const healthFactor = healthSnapshot?.healthFactor ?? null;

    // Extract reserve info
    const collateralReserve = liq.collateralReserve || { id: 'unknown', symbol: null, decimals: null };
    const principalReserve = liq.principalReserve || { id: 'unknown', symbol: null, decimals: null };

    // Get prices for collateral and principal
    const collateralSymbol = collateralReserve.symbol || 'UNKNOWN';
    const principalSymbol = principalReserve.symbol || 'UNKNOWN';

    const [collateralPrice, principalPrice] = await Promise.all([
      this.priceService.getPrice(collateralSymbol),
      this.priceService.getPrice(principalSymbol)
    ]);

    // Calculate USD values
    const collateralDecimals = collateralReserve.decimals ?? 18;
    const principalDecimals = principalReserve.decimals ?? 18;

    const collateralAmount = parseFloat(liq.collateralAmount) / Math.pow(10, collateralDecimals);
    const principalAmount = parseFloat(liq.principalAmount) / Math.pow(10, principalDecimals);

    const collateralValueUsd = collateralAmount * collateralPrice;
    const principalValueUsd = principalAmount * principalPrice;

    // Calculate profit using ProfitCalculator
    const profitBreakdown = this.profitCalculator.calculateProfit(
      collateralValueUsd,
      principalValueUsd
    );

    // Get bonus percentage from calculator
    const bonusPct = this.profitCalculator.getBonusPct();

    return {
      id: liq.id,
      txHash: liq.txHash,
      user: liq.user,
      liquidator: liq.liquidator,
      timestamp: liq.timestamp,
      collateralAmountRaw: liq.collateralAmount,
      principalAmountRaw: liq.principalAmount,
      collateralReserve,
      principalReserve,
      healthFactor,
      collateralValueUsd,
      principalValueUsd,
      profitEstimateUsd: profitBreakdown.net,
      bonusPct
    };
  }



  /**
   * Filter opportunities by minimum profit threshold
   * @param opportunities Array of opportunities
   * @returns Filtered opportunities meeting profit threshold
   */
  filterProfitableOpportunities(opportunities: Opportunity[]): Opportunity[] {
    const minProfit = config.profitMinUsd;
    
    return opportunities.filter(op => {
      const profit = op.profitEstimateUsd ?? 0;
      return profit >= minProfit;
    });
  }
}
