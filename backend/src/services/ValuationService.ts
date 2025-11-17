/**
 * ValuationService: Unified price resolution for HF and liquidation decisions
 * 
 * Makes Aave Oracle the authoritative source for all health factor and valuation
 * decisions, using Chainlink only as fallback or for display/logging purposes.
 * 
 * This resolves price-source drift issues where Chainlink prices (e.g., USDC at $0.99984325)
 * differ from Aave on-chain oracle prices ($1.00), causing incorrect HF calculations.
 */

import { ethers } from 'ethers';

import { config } from '../config/index.js';
import {
  valuationSourceUsedTotal,
  priceMismatchBpsHistogram,
  valuationErrorsTotal
} from '../metrics/index.js';

import { AaveOracleHelper } from './AaveOracleHelper.js';
import { PriceService } from './PriceService.js';

export type ValuationSource = 'aave_oracle' | 'chainlink_fallback' | 'stub_fallback';

export interface PriceResolution {
  price: number;
  source: ValuationSource;
  symbol: string;
  tokenAddress?: string;
}

export interface PriceMismatch {
  symbol: string;
  aavePrice: number;
  chainlinkPrice: number;
  deltaBps: number;
}

/**
 * ValuationService provides unified price resolution for liquidation decisions
 * - Aave Oracle is PRIMARY for all HF/valuation decisions
 * - Chainlink is FALLBACK only (or used for display/logging)
 * - Detects and warns on price mismatches >5bps
 */
export class ValuationService {
  private aaveOracleHelper: AaveOracleHelper;
  private priceService: PriceService;
  private provider: ethers.JsonRpcProvider;
  private readonly mismatchThresholdBps = 5; // Warn if |delta| > 5 bps

  constructor(
    provider: ethers.JsonRpcProvider,
    priceService?: PriceService
  ) {
    this.provider = provider;
    this.aaveOracleHelper = new AaveOracleHelper(provider);
    this.priceService = priceService || new PriceService();
  }

  /**
   * Initialize the Aave Oracle helper
   */
  async initialize(): Promise<void> {
    await this.aaveOracleHelper.initialize();
  }

  /**
   * Get price for liquidation/HF decision (AAVE ORACLE PRIMARY)
   * @param tokenAddress Token contract address
   * @param blockTag Optional block tag for historical pricing
   * @returns Price resolution with source attribution
   */
  async getPriceForDecision(
    tokenAddress: string,
    blockTag?: number | string
  ): Promise<PriceResolution> {
    const symbol = await this.aaveOracleHelper.getSymbol(tokenAddress) || tokenAddress.substring(0, 10);

    // Try Aave Oracle first (primary source)
    try {
      const rawPrice = await this.aaveOracleHelper.getAssetPrice(tokenAddress, blockTag);
      
      if (rawPrice !== null && rawPrice > 0n) {
        // Aave oracle returns prices in 8 decimals (BASE_CURRENCY_UNIT = 1e8)
        const price = Number(rawPrice) / 1e8;
        
        // Validate price is positive and finite
        if (isFinite(price) && price > 0) {
          // Log successful Aave oracle resolution
          // eslint-disable-next-line no-console
          console.log(
            `[valuation] decision_price symbol=${symbol} price=${price.toFixed(8)} ` +
            `source=aave_oracle blockTag=${blockTag || 'latest'}`
          );
          
          valuationSourceUsedTotal.inc({ source: 'aave_oracle' });
          
          return {
            price,
            source: 'aave_oracle',
            symbol,
            tokenAddress
          };
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[valuation] Aave oracle failed for ${symbol}:`, error instanceof Error ? error.message : error);
      valuationErrorsTotal.inc({ source: 'aave_oracle' });
    }

    // Fallback to Chainlink
    try {
      const chainlinkPrice = await this.priceService.getPrice(symbol);
      
      if (chainlinkPrice > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[valuation] decision_price symbol=${symbol} price=${chainlinkPrice.toFixed(8)} ` +
          `source=chainlink_fallback reason=aave_oracle_unavailable`
        );
        
        valuationSourceUsedTotal.inc({ source: 'chainlink_fallback' });
        
        return {
          price: chainlinkPrice,
          source: 'chainlink_fallback',
          symbol,
          tokenAddress
        };
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[valuation] Chainlink fallback failed for ${symbol}:`, error instanceof Error ? error.message : error);
      valuationErrorsTotal.inc({ source: 'chainlink_fallback' });
    }

    // Final fallback to stub prices
    const stubPrice = this.priceService['defaultPrices'][symbol] || this.priceService['defaultPrices']['UNKNOWN'] || 1.0;
    
    // eslint-disable-next-line no-console
    console.error(
      `[valuation] decision_price symbol=${symbol} price=${stubPrice.toFixed(8)} ` +
      `source=stub_fallback reason=all_oracles_failed`
    );
    
    valuationSourceUsedTotal.inc({ source: 'stub_fallback' });
    
    return {
      price: stubPrice,
      source: 'stub_fallback',
      symbol,
      tokenAddress
    };
  }

  /**
   * Compare Aave vs Chainlink prices and detect mismatches
   * Used for monitoring/alerting but not for decision-making
   */
  async detectPriceMismatch(tokenAddress: string): Promise<PriceMismatch | null> {
    const symbol = await this.aaveOracleHelper.getSymbol(tokenAddress) || tokenAddress.substring(0, 10);

    try {
      // Get both prices
      const [rawAavePrice, chainlinkPrice] = await Promise.all([
        this.aaveOracleHelper.getAssetPrice(tokenAddress),
        this.priceService.getPrice(symbol)
      ]);

      if (!rawAavePrice || rawAavePrice === 0n || !chainlinkPrice || chainlinkPrice === 0) {
        return null; // Can't compare if either is missing
      }

      const aavePrice = Number(rawAavePrice) / 1e8;

      // Calculate difference in basis points
      const delta = aavePrice - chainlinkPrice;
      const deltaBps = Math.abs((delta / aavePrice) * 10000);

      // Only report if above threshold
      if (deltaBps > this.mismatchThresholdBps) {
        // eslint-disable-next-line no-console
        console.warn(
          `[valuation] price_mismatch symbol=${symbol} ` +
          `aave=${aavePrice.toFixed(8)} chainlink=${chainlinkPrice.toFixed(8)} ` +
          `delta_bps=${deltaBps.toFixed(2)}`
        );

        priceMismatchBpsHistogram.observe(deltaBps);

        return {
          symbol,
          aavePrice,
          chainlinkPrice,
          deltaBps
        };
      }

      return null;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[valuation] Mismatch detection failed for ${symbol}:`, error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Batch price resolution for multiple tokens (decision-making)
   * @param tokenAddresses Array of token addresses
   * @param blockTag Optional block tag
   * @returns Map of address to price resolution
   */
  async getBatchPricesForDecision(
    tokenAddresses: string[],
    blockTag?: number | string
  ): Promise<Map<string, PriceResolution>> {
    const result = new Map<string, PriceResolution>();

    // Fetch prices in parallel
    await Promise.all(
      tokenAddresses.map(async (address) => {
        const resolution = await this.getPriceForDecision(address, blockTag);
        result.set(address.toLowerCase(), resolution);
      })
    );

    return result;
  }

  /**
   * Get Chainlink price for display/logging purposes only
   * NOT to be used for liquidation decisions
   */
  async getChainlinkPriceForDisplay(symbol: string): Promise<number> {
    return await this.priceService.getPrice(symbol);
  }

  /**
   * Check if oracle is initialized and ready
   */
  isReady(): boolean {
    return this.aaveOracleHelper.isInitialized();
  }
}
