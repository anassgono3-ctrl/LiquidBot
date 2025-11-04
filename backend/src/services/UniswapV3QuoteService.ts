// UniswapV3QuoteService: Direct path routing via Uniswap V3 pools
// Provides efficient swap quotes for WETH/USDC pairs on Base

import { ethers, Contract } from 'ethers';

const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'
];

const UNISWAP_V3_QUOTER_V2_ADDRESS = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'; // Uniswap V3 Quoter V2 on Base

interface QuoteParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  fee: number; // in basis points (e.g., 500 for 0.05%)
}

export interface UniswapQuoteResult {
  success: boolean;
  amountOut?: bigint;
  path?: string;
  reason?: string;
}

/**
 * UniswapV3QuoteService provides swap quotes using Uniswap V3 direct paths.
 * Tries multiple fee tiers (0.05%, 0.3%) for optimal routing.
 */
export class UniswapV3QuoteService {
  private provider: ethers.JsonRpcProvider;
  private quoter: Contract;
  private feeTiers: number[] = [500, 3000]; // 0.05%, 0.3%

  constructor(provider: ethers.JsonRpcProvider) {
    this.provider = provider;
    this.quoter = new Contract(UNISWAP_V3_QUOTER_V2_ADDRESS, QUOTER_V2_ABI, this.provider);
  }

  /**
   * Get quote for token swap via Uniswap V3
   * Tries multiple fee tiers and returns the best quote
   */
  async getQuote(params: QuoteParams): Promise<UniswapQuoteResult> {
    const { tokenIn, tokenOut, amountIn } = params;

    if (amountIn === 0n) {
      return { success: false, reason: 'zero_amount_in' };
    }

    let bestQuote: UniswapQuoteResult = { success: false, reason: 'no_valid_pools' };
    let bestAmountOut = 0n;

    // Try each fee tier
    for (const fee of this.feeTiers) {
      try {
        const quoteParams = {
          tokenIn,
          tokenOut,
          amountIn,
          fee,
          sqrtPriceLimitX96: 0 // No price limit
        };

        // Call quoter (view function)
        const result = await this.quoter.quoteExactInputSingle.staticCall(quoteParams);
        const amountOut = result[0]; // First return value is amountOut

        if (amountOut > bestAmountOut) {
          bestAmountOut = amountOut;
          bestQuote = {
            success: true,
            amountOut,
            path: `${tokenIn}-${fee}-${tokenOut}`
          };
        }
      } catch (err) {
        // Pool doesn't exist or insufficient liquidity for this fee tier
        // Continue trying other tiers
        continue;
      }
    }

    return bestQuote;
  }

  /**
   * Get quote with explicit fee tier
   */
  async getQuoteWithFee(tokenIn: string, tokenOut: string, amountIn: bigint, fee: number): Promise<UniswapQuoteResult> {
    if (amountIn === 0n) {
      return { success: false, reason: 'zero_amount_in' };
    }

    try {
      const quoteParams = {
        tokenIn,
        tokenOut,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0
      };

      const result = await this.quoter.quoteExactInputSingle.staticCall(quoteParams);
      const amountOut = result[0];

      return {
        success: true,
        amountOut,
        path: `${tokenIn}-${fee}-${tokenOut}`
      };
    } catch (err) {
      return {
        success: false,
        reason: err instanceof Error ? err.message : 'quote_failed'
      };
    }
  }

  /**
   * Check if a specific pool exists and has sufficient liquidity
   */
  async canRoute(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<boolean> {
    const quote = await this.getQuote({ tokenIn, tokenOut, amountIn, fee: 500 });
    return quote.success && (quote.amountOut ?? 0n) > 0n;
  }
}
