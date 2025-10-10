// ZeroXQuoteService: 0x API integration for swap calldata generation

export interface ZeroXSwapRequest {
  fromToken: string;
  toToken: string;
  amount: string;
  slippageBps: number;
  fromAddress: string;
}

export interface ZeroXSwapResponse {
  to: string;          // 0x Exchange Proxy address
  data: string;        // Calldata for the swap
  value: string;       // Native token value (usually 0 for ERC20-to-ERC20)
  minOut: string;      // Minimum output amount after slippage
}

/**
 * ZeroXQuoteService provides swap calldata generation via 0x API
 * Used as a fallback when 1inch is unavailable
 */
export class ZeroXQuoteService {
  private baseUrl: string;
  private chainId: number;
  private apiKey?: string;

  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    chainId?: number;
  }) {
    this.apiKey = options?.apiKey !== undefined ? options.apiKey : process.env.ZEROX_API_KEY;
    this.chainId = options?.chainId !== undefined ? options.chainId : Number(process.env.CHAIN_ID || 8453);
    
    // Default to Base API
    this.baseUrl = options?.baseUrl !== undefined ? options.baseUrl : 
      (this.chainId === 8453 ? 'https://base.api.0x.org' : 'https://api.0x.org');
  }

  /**
   * Get swap calldata from 0x API
   * @param request Swap parameters
   * @returns Swap calldata and metadata
   */
  async getSwapCalldata(request: ZeroXSwapRequest): Promise<ZeroXSwapResponse> {
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
    const slippagePercentage = request.slippageBps / 10000; // Convert bps to decimal (e.g., 100 bps = 0.01 = 1%)
    const params = new URLSearchParams({
      sellToken: request.fromToken,
      buyToken: request.toToken,
      sellAmount: request.amount,
      taker: request.fromAddress,
      slippagePercentage: slippagePercentage.toString(),
      skipValidation: 'true' // Skip validation to get quote without needing approvals
    });

    const url = `${this.baseUrl}/swap/v1/quote?${params.toString()}`;

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json'
      };
      
      // Add API key if configured
      if (this.apiKey) {
        headers['0x-api-key'] = this.apiKey;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`0x API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      // Parse response
      return {
        to: data.to,
        data: data.data,
        value: data.value || '0',
        minOut: data.buyAmount || '0'
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to get 0x quote: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Check if service is available
   */
  isConfigured(): boolean {
    return true; // 0x public API doesn't require API key for Base
  }

  /**
   * Get configuration for inspection
   */
  getConfig() {
    return {
      configured: this.isConfigured(),
      baseUrl: this.baseUrl,
      chainId: this.chainId,
      hasApiKey: !!this.apiKey
    };
  }
}
