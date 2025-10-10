// OneInchQuoteService: 1inch API integration for swap calldata generation

import { resolveTokenAddress } from '../config/tokens.js';

/**
 * Check if a string is a valid Ethereum address
 */
function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export interface SwapQuoteRequest {
  fromToken: string;
  toToken: string;
  amount: string;
  slippageBps: number;
  fromAddress: string;
}

export interface SwapQuoteResponse {
  to: string;          // 1inch router address
  data: string;        // Calldata for the swap
  value: string;       // Native token value (usually 0 for ERC20-to-ERC20)
  minOut: string;      // Minimum output amount after slippage
}

/**
 * OneInchQuoteService provides swap calldata generation via 1inch API
 * Supports both v6 (with API key) and v5 (public fallback) endpoints
 */
export class OneInchQuoteService {
  private apiKey: string;
  private baseUrl: string;
  private chainId: number;

  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    chainId?: number;
  }) {
    this.apiKey = options?.apiKey !== undefined ? options.apiKey : (process.env.ONEINCH_API_KEY || '');
    this.chainId = options?.chainId !== undefined ? options.chainId : Number(process.env.CHAIN_ID || 8453);
    
    // Determine baseUrl based on API key presence
    if (options?.baseUrl !== undefined) {
      this.baseUrl = options.baseUrl;
    } else if (this.apiKey) {
      // v6 endpoint with API key
      this.baseUrl = process.env.ONEINCH_BASE_URL || `https://api.1inch.dev/swap/v6.0/${this.chainId}`;
    } else {
      // v5 public fallback
      this.baseUrl = `https://api.1inch.exchange/v5.0/${this.chainId}`;
    }

    if (!this.apiKey) {
      console.warn('[1inch] API key not configured - using public v5 API (may have rate limits)');
    }
  }

  /**
   * Get swap calldata from 1inch API
   * Automatically uses v6 (with API key) or v5 (public) endpoints
   * @param request Swap parameters
   * @returns Swap calldata and metadata
   */
  async getSwapCalldata(request: SwapQuoteRequest): Promise<SwapQuoteResponse> {
    // Validate inputs
    if (!request.fromToken || !request.toToken) {
      throw new Error('fromToken and toToken are required');
    }
    if (!request.amount || request.amount === '0') {
      throw new Error('amount must be greater than 0');
    }
    if (request.slippageBps < 0 || request.slippageBps > 5000) {
      throw new Error('slippageBps must be between 0 and 5000 (0-50%)');
    }

    // Validate fromAddress is an Ethereum address
    if (!isAddress(request.fromAddress)) {
      throw new Error(`fromAddress must be a valid Ethereum address: ${request.fromAddress}`);
    }

    // Resolve token symbols to addresses
    const srcAddress = resolveTokenAddress(request.fromToken);
    const dstAddress = resolveTokenAddress(request.toToken);

    // Validate that resolved tokens are valid Ethereum addresses
    if (!isAddress(srcAddress)) {
      throw new Error(`fromToken must resolve to an Ethereum address: ${request.fromToken} -> ${srcAddress}`);
    }
    if (!isAddress(dstAddress)) {
      throw new Error(`toToken must resolve to an Ethereum address: ${request.toToken} -> ${dstAddress}`);
    }

    // Build query parameters based on API version
    let params: URLSearchParams;
    const headers: Record<string, string> = {
      'Accept': 'application/json'
    };

    if (this.apiKey) {
      // v6 endpoint with API key - uses src/dst/amount/from/slippage
      params = new URLSearchParams({
        src: srcAddress,
        dst: dstAddress,
        amount: request.amount,
        from: request.fromAddress,
        slippage: (request.slippageBps / 100).toString(), // Convert bps to percentage
        disableEstimate: 'true',
        allowPartialFill: 'false'
      });
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    } else {
      // v5 public endpoint - uses fromTokenAddress/toTokenAddress/amount/fromAddress/slippage
      params = new URLSearchParams({
        fromTokenAddress: srcAddress,
        toTokenAddress: dstAddress,
        amount: request.amount,
        fromAddress: request.fromAddress,
        slippage: (request.slippageBps / 100).toString(), // Convert bps to percentage
        disableEstimate: 'true'
      });
    }

    const url = `${this.baseUrl}/swap?${params.toString()}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`1inch API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      // Parse response (format is similar for both v5 and v6)
      return {
        to: data.tx?.to || data.to,
        data: data.tx?.data || data.data,
        value: data.tx?.value || data.value || '0',
        minOut: data.dstAmount || data.toAmount || '0'
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to get 1inch quote: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Check if service is configured and available
   * Returns true if API key is configured (v6) or always true for v5 fallback
   */
  isConfigured(): boolean {
    // Service is always available - either with v6 (if API key) or v5 (public)
    return true;
  }

  /**
   * Check if using v6 endpoint (with API key)
   */
  isUsingV6(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  /**
   * Get configuration for inspection
   */
  getConfig() {
    return {
      configured: this.isConfigured(),
      baseUrl: this.baseUrl,
      chainId: this.chainId
    };
  }
}
