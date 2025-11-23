/**
 * Flashbots Protect Client
 * 
 * Sends private transactions via eth_sendPrivateTransaction RPC method
 * with Flashbots-style signature headers.
 */

import { ethers } from 'ethers';
import { PrivateRelayErrorCode } from './types.js';

export interface FlashbotsProtectOptions {
  rpcUrl: string;
  signerAddress: string;
  signatureRandom: boolean;
}

export interface SendPrivateTransactionResult {
  success: boolean;
  txHash?: string;
  errorCode?: PrivateRelayErrorCode;
  error?: string;
  latencyMs: number;
}

/**
 * Flashbots Protect Client for eth_sendPrivateTransaction
 */
export class FlashbotsProtectClient {
  private rpcUrl: string;
  private signerAddress: string;
  private signatureRandom: boolean;

  constructor(options: FlashbotsProtectOptions) {
    this.rpcUrl = options.rpcUrl;
    this.signerAddress = options.signerAddress.toLowerCase();
    this.signatureRandom = options.signatureRandom;
  }

  /**
   * Send a private transaction via eth_sendPrivateTransaction
   */
  async sendPrivateTransaction(signedTx: string): Promise<SendPrivateTransactionResult> {
    const startTime = Date.now();

    try {
      // Generate signature suffix (random or static)
      const suffix = this.signatureRandom 
        ? Math.random().toString(36).substring(2, 15)
        : 'liquidbot';

      // Construct Flashbots signature header
      const signature = `${this.signerAddress}:${suffix}`;

      // Prepare JSON-RPC request
      const requestBody = {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_sendPrivateTransaction',
        params: [
          {
            tx: signedTx,
            maxBlockNumber: null, // Let relay determine
            preferences: {
              fast: true
            }
          }
        ]
      };

      // Send HTTP request with signature header
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-flashbots-signature': signature
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        return {
          success: false,
          errorCode: PrivateRelayErrorCode.RPC_ERROR,
          error: `HTTP ${response.status}: ${response.statusText}`,
          latencyMs
        };
      }

      const data = await response.json();

      if (data.error) {
        return {
          success: false,
          errorCode: this.categorizeRpcError(data.error),
          error: data.error.message || JSON.stringify(data.error),
          latencyMs
        };
      }

      if (!data.result) {
        return {
          success: false,
          errorCode: PrivateRelayErrorCode.INVALID_RESPONSE,
          error: 'No result in RPC response',
          latencyMs
        };
      }

      // Extract transaction hash from result
      const txHash = typeof data.result === 'string' 
        ? data.result 
        : data.result.hash || data.result.txHash;

      if (!txHash || !ethers.isHexString(txHash, 32)) {
        return {
          success: false,
          errorCode: PrivateRelayErrorCode.INVALID_RESPONSE,
          error: `Invalid txHash in response: ${txHash}`,
          latencyMs
        };
      }

      return {
        success: true,
        txHash,
        latencyMs
      };

    } catch (error: any) {
      const latencyMs = Date.now() - startTime;

      // Categorize error
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        return {
          success: false,
          errorCode: PrivateRelayErrorCode.RPC_TIMEOUT,
          error: 'Request timeout',
          latencyMs
        };
      }

      if (error.cause?.code === 'ECONNREFUSED' || 
          error.cause?.code === 'ENOTFOUND' ||
          error.message?.includes('fetch failed')) {
        return {
          success: false,
          errorCode: PrivateRelayErrorCode.NETWORK_ERROR,
          error: error.message || 'Network error',
          latencyMs
        };
      }

      return {
        success: false,
        errorCode: PrivateRelayErrorCode.RPC_ERROR,
        error: error.message || 'Unknown error',
        latencyMs
      };
    }
  }

  /**
   * Categorize RPC error response
   */
  private categorizeRpcError(error: any): PrivateRelayErrorCode {
    const errorMsg = (error.message || '').toLowerCase();
    
    if (errorMsg.includes('timeout') || errorMsg.includes('deadline')) {
      return PrivateRelayErrorCode.RPC_TIMEOUT;
    }

    return PrivateRelayErrorCode.RPC_ERROR;
  }
}
