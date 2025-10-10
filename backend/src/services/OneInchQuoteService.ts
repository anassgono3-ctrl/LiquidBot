// OneInchQuoteService: 1inch API integration for swap calldata generation

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
 * Validate Ethereum address format
 */
function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * OneInchQuoteService provides swap calldata generation via 1inch API
 * Supports v6 (with API key) and falls back to v5 (public) if v6 fails
 */
export class OneInchQuoteService {
  private apiKey: string;
  private baseUrl: string;
  private chainId: number;
  private useV5Fallback: boolean;

  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    chainId?: number;
    useV5Fallback?: boolean;
  }) {
    this.apiKey = options?.apiKey !== undefined ? options.apiKey : (process.env.ONEINCH_API_KEY || '');
    this.baseUrl = options?.baseUrl !== undefined ? options.baseUrl : (process.env.ONEINCH_BASE_URL || 'https://api.1inch.dev/swap/v6.0/8453');
    this.chainId = options?.chainId !== undefined ? options.chainId : Number(process.env.CHAIN_ID || 8453);
    this.useV5Fallback = options?.useV5Fallback !== undefined ? options.useV5Fallback : true;

    if (!this.apiKey) {
      console.warn('[1inch] API key not configured - will attempt v5 fallback if available');
    }
  }

  /**
   * Get swap calldata from 1inch API
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

    // Validate addresses
    if (!isValidAddress(request.fromToken)) {
      throw new Error(`Invalid fromToken address: ${request.fromToken}. Must be a valid Ethereum address (0x...)`);
    }
    if (!isValidAddress(request.toToken)) {
      throw new Error(`Invalid toToken address: ${request.toToken}. Must be a valid Ethereum address (0x...)`);
    }
    if (!isValidAddress(request.fromAddress)) {
      throw new Error(`Invalid fromAddress: ${request.fromAddress}. Must be a valid Ethereum address (0x...)`);
    }

    // Try v6 first if API key is configured
    if (this.apiKey) {
      try {
        return await this.getSwapCalldataV6(request);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[1inch] v6 API failed: ${errorMessage}, attempting v5 fallback...`);
        
        // If v6 fails and fallback is enabled, try v5
        if (this.useV5Fallback) {
          try {
            return await this.getSwapCalldataV5(request);
          } catch (v5Error) {
            // Both failed, throw original v6 error
            throw error;
          }
        }
        throw error;
      }
    }

    // No API key, try v5 directly if fallback enabled
    if (this.useV5Fallback) {
      return await this.getSwapCalldataV5(request);
    }

    throw new Error('1inch API key not configured and v5 fallback is disabled');
  }

  /**
   * Get swap calldata using 1inch v6 API (requires API key)
   */
  private async getSwapCalldataV6(request: SwapQuoteRequest): Promise<SwapQuoteResponse> {
    // Build query parameters
    const params = new URLSearchParams({
      src: request.fromToken,
      dst: request.toToken,
      amount: request.amount,
      from: request.fromAddress,
      slippage: (request.slippageBps / 100).toString(), // Convert bps to percentage
      disableEstimate: 'true',
      allowPartialFill: 'false'
    });

    const url = `${this.baseUrl}/swap?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`1inch API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    // Parse response
    return {
      to: data.tx?.to || data.to,
      data: data.tx?.data || data.data,
      value: data.tx?.value || data.value || '0',
      minOut: data.dstAmount || data.toAmount || '0'
    };
  }

  /**
   * Get swap calldata using 1inch v5 public API (no API key required)
   */
  private async getSwapCalldataV5(request: SwapQuoteRequest): Promise<SwapQuoteResponse> {
    // v5 API uses different base URL
    const v5BaseUrl = `https://api.1inch.io/v5.0/${this.chainId}`;
    
    // Build query parameters for v5
    const params = new URLSearchParams({
      fromTokenAddress: request.fromToken,
      toTokenAddress: request.toToken,
      amount: request.amount,
      fromAddress: request.fromAddress,
      slippage: (request.slippageBps / 100).toString(), // Convert bps to percentage
      disableEstimate: 'true',
      allowPartialFill: 'false'
    });

    const url = `${v5BaseUrl}/swap?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`1inch v5 API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    // Parse v5 response
    return {
      to: data.tx?.to || data.to,
      data: data.tx?.data || data.data,
      value: data.tx?.value || data.value || '0',
      minOut: data.toTokenAmount || data.toAmount || '0'
    };
  }

  /**
   * Check if service is configured and available
   */
  isConfigured(): boolean {
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
