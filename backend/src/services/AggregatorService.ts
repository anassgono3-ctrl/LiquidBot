// AggregatorService: Unified interface for DEX aggregators with fallback support

import { resolveTokenAddress } from '../config/tokens.js';

import { OneInchQuoteService, type SwapQuoteRequest, type SwapQuoteResponse } from './OneInchQuoteService.js';
import { ZeroXQuoteService } from './ZeroXQuoteService.js';

/**
 * AggregatorService provides a unified interface for DEX aggregators
 * with automatic fallback from 1inch to 0x
 */
export class AggregatorService {
  private oneInchService: OneInchQuoteService;
  private zeroXService: ZeroXQuoteService;
  private preferredAggregator: 'oneinch' | 'zerox' | 'auto';

  constructor(options?: {
    oneInchService?: OneInchQuoteService;
    zeroXService?: ZeroXQuoteService;
    preferredAggregator?: 'oneinch' | 'zerox' | 'auto';
  }) {
    this.oneInchService = options?.oneInchService || new OneInchQuoteService();
    this.zeroXService = options?.zeroXService || new ZeroXQuoteService();
    this.preferredAggregator = options?.preferredAggregator || 'auto';
  }

  /**
   * Get swap calldata with automatic fallback
   * Tries 1inch first, falls back to 0x if 1inch fails
   * 
   * @param request Swap parameters (can use symbols or addresses)
   * @returns Swap calldata and metadata with aggregator info
   */
  async getSwapCalldata(
    request: SwapQuoteRequest
  ): Promise<SwapQuoteResponse & { aggregator: string }> {
    // Resolve token addresses from symbols if needed
    const resolvedRequest: SwapQuoteRequest = {
      ...request,
      fromToken: resolveTokenAddress(request.fromToken),
      toToken: resolveTokenAddress(request.toToken),
    };

    console.log(`[aggregator] Resolving swap: ${request.fromToken} -> ${request.toToken}`);
    console.log(`[aggregator] Addresses: ${resolvedRequest.fromToken} -> ${resolvedRequest.toToken}`);

    // Try preferred aggregator first based on mode
    if (this.preferredAggregator === 'zerox') {
      return await this.tryZeroXFirst(resolvedRequest);
    }

    if (this.preferredAggregator === 'oneinch') {
      return await this.tryOneInchFirst(resolvedRequest);
    }

    // Auto mode: try 1inch first if configured, otherwise 0x
    if (this.oneInchService.isConfigured()) {
      return await this.tryOneInchFirst(resolvedRequest);
    } else {
      return await this.tryZeroXFirst(resolvedRequest);
    }
  }

  /**
   * Try 1inch first, fallback to 0x
   */
  private async tryOneInchFirst(
    request: SwapQuoteRequest
  ): Promise<SwapQuoteResponse & { aggregator: string }> {
    try {
      console.log('[aggregator] Attempting 1inch...');
      const result = await this.oneInchService.getSwapCalldata(request);
      console.log('[aggregator] 1inch successful');
      return { ...result, aggregator: '1inch' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`[aggregator] 1inch failed: ${errorMessage}`);
      console.log('[aggregator] Falling back to 0x...');
      
      try {
        const result = await this.zeroXService.getSwapCalldata({
          fromToken: request.fromToken,
          toToken: request.toToken,
          amount: request.amount,
          slippageBps: request.slippageBps,
          fromAddress: request.fromAddress
        });
        console.log('[aggregator] 0x successful (fallback)');
        return { ...result, aggregator: '0x' };
      } catch (zeroXError) {
        const zeroXErrorMessage = zeroXError instanceof Error ? zeroXError.message : String(zeroXError);
        console.error(`[aggregator] 0x fallback also failed: ${zeroXErrorMessage}`);
        throw new Error(`All aggregators failed. 1inch: ${errorMessage}, 0x: ${zeroXErrorMessage}`);
      }
    }
  }

  /**
   * Try 0x first, fallback to 1inch
   */
  private async tryZeroXFirst(
    request: SwapQuoteRequest
  ): Promise<SwapQuoteResponse & { aggregator: string }> {
    try {
      console.log('[aggregator] Attempting 0x...');
      const result = await this.zeroXService.getSwapCalldata({
        fromToken: request.fromToken,
        toToken: request.toToken,
        amount: request.amount,
        slippageBps: request.slippageBps,
        fromAddress: request.fromAddress
      });
      console.log('[aggregator] 0x successful');
      return { ...result, aggregator: '0x' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`[aggregator] 0x failed: ${errorMessage}`);
      
      if (!this.oneInchService.isConfigured()) {
        throw new Error(`0x failed and 1inch not configured: ${errorMessage}`);
      }
      
      console.log('[aggregator] Falling back to 1inch...');
      
      try {
        const result = await this.oneInchService.getSwapCalldata(request);
        console.log('[aggregator] 1inch successful (fallback)');
        return { ...result, aggregator: '1inch' };
      } catch (oneInchError) {
        const oneInchErrorMessage = oneInchError instanceof Error ? oneInchError.message : String(oneInchError);
        console.error(`[aggregator] 1inch fallback also failed: ${oneInchErrorMessage}`);
        throw new Error(`All aggregators failed. 0x: ${errorMessage}, 1inch: ${oneInchErrorMessage}`);
      }
    }
  }

  /**
   * Check if any aggregator is available
   */
  isConfigured(): boolean {
    return this.oneInchService.isConfigured() || this.zeroXService.isConfigured();
  }

  /**
   * Get configuration for inspection
   */
  getConfig() {
    return {
      preferredAggregator: this.preferredAggregator,
      oneInch: this.oneInchService.getConfig(),
      zeroX: this.zeroXService.getConfig()
    };
  }
}
