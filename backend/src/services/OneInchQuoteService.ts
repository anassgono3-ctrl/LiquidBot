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
 * OneInchQuoteService provides swap calldata generation via 1inch API
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
    this.baseUrl = options?.baseUrl !== undefined ? options.baseUrl : (process.env.ONEINCH_BASE_URL || 'https://api.1inch.dev/swap/v6.0/8453');
    this.chainId = options?.chainId !== undefined ? options.chainId : Number(process.env.CHAIN_ID || 8453);

    if (!this.apiKey) {
      console.warn('[1inch] API key not configured - service will not work');
    }
  }

  /**
   * Get swap calldata from 1inch API
   * @param request Swap parameters
   * @returns Swap calldata and metadata
   */
  async getSwapCalldata(request: SwapQuoteRequest): Promise<SwapQuoteResponse> {
    if (!this.apiKey) {
      throw new Error('1inch API key not configured');
    }

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

    try {
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
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to get 1inch quote: ${error.message}`);
      }
      throw error;
    }
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
