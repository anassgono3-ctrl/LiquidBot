/**
 * Private Relay Types
 * 
 * Type definitions for private transaction relay submission.
 */

/**
 * Context information for private relay submission
 */
export interface PrivateRelayContext {
  user: string;
  triggerType?: string;
  block?: number;
}

/**
 * Result of private transaction submission
 */
export interface PrivateSendResult {
  success: boolean;
  txHash?: string;
  sentPrivate: boolean;
  fallbackUsed: boolean;
  errorCode?: string;
  latencyMs: number;
  rpcError?: string;
}

/**
 * Error codes for private relay failures
 */
export enum PrivateRelayErrorCode {
  DISABLED = 'DISABLED',
  NO_RPC_URL = 'NO_RPC_URL',
  RPC_TIMEOUT = 'RPC_TIMEOUT',
  RPC_ERROR = 'RPC_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  MAX_RETRIES_EXCEEDED = 'MAX_RETRIES_EXCEEDED'
}
