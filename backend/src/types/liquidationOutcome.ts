// liquidationOutcome.ts: Type definitions for liquidation attempt outcomes

export type LiquidationOutcome =
  | 'executed'    // Successfully executed on-chain
  | 'raced'       // Detected but another bot liquidated first
  | 'skipped';    // Skipped due to validation failure

export type SkipReason =
  | 'hf_recovered'           // Health factor recovered above threshold
  | 'quote_invalid'          // Swap quote failed or invalid
  | 'slippage_exceeded'      // Slippage tolerance exceeded
  | 'approval_missing'       // Token allowance not set
  | 'gas_cap_exceeded'       // Gas price above maximum cap
  | 'rpc_error'              // RPC/network error
  | 'insufficient_profit'    // Profit below minimum threshold
  | 'dust_position'          // Position too small
  | 'no_liquidity';          // No swap route available

export interface LiquidationDetectEvent {
  user: string;
  healthFactor: number;
  estProfitUsd: number;
  blockNumber: number;
  timestamp: number;
}

export interface LiquidationOutcomeEvent {
  outcome: LiquidationOutcome;
  user: string;
  blockNumber: number;
  timestamp: number;
  
  // For 'executed' outcome
  txHash?: string;
  gasUsed?: number;
  realizedProfitUsd?: number;
  
  // For 'raced' outcome
  competingTxHash?: string;
  timeDeltaMs?: number;
  
  // For 'skipped' outcome
  skipReason?: SkipReason;
  skipDetails?: string;
}
