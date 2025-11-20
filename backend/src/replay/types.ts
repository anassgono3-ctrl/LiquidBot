/**
 * Type definitions for replay mode
 * 
 * This module exports types used for historical blockchain data replay and analysis.
 */

/**
 * Parsed and validated replay block range
 */
export interface ParsedReplayRange {
  /** Starting block number */
  startBlock: number;
  
  /** Ending block number (inclusive) */
  endBlock: number;
  
  /** Span between start and end blocks */
  span: number;
  
  /** Raw input string that was parsed */
  raw: string;
}

/**
 * Complete replay execution context
 * 
 * Contains all configuration needed to run replay mode, including block range,
 * cache settings, and execution flags.
 */
export interface ReplayContext {
  /** Starting block number */
  startBlock: number;
  
  /** Ending block number (inclusive) */
  endBlock: number;
  
  /** Span between start and end blocks */
  span: number;
  
  /** Raw block range string */
  raw: string;
  
  /** Cache key prefix for this replay session */
  cachePrefix: string;
  
  /** Whether to execute transactions (false for read-only replay) */
  execute: boolean;
  
  /** Whether this is a dry run (no state changes) */
  dryRun: boolean;
  
  /** Optional RPC URL specifically for replay (if different from main RPC) */
  rpcUrl?: string;
}
