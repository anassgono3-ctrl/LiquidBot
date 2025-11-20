/**
 * Validation utilities for replay mode
 * 
 * Provides parsing and validation for replay block ranges with safety checks.
 */

import type { ParsedReplayRange } from './types.js';

/**
 * Maximum allowed span between start and end blocks (100,000 blocks)
 * This prevents accidentally replaying too much history at once.
 */
const MAX_BLOCK_SPAN = 100_000;

/**
 * Parse and validate a replay block range string
 * 
 * Expected format: "START-END" where START and END are block numbers.
 * Example: "38393480-38393500"
 * 
 * Validation rules:
 * - Must match format: number-number
 * - Start block must be <= end block
 * - Span (end - start) must not exceed MAX_BLOCK_SPAN
 * 
 * @param raw - Raw block range string in format "START-END"
 * @returns Parsed and validated block range
 * @throws Error if format is invalid or validation fails
 */
export function parseReplayRange(raw: string): ParsedReplayRange {
  // Validate format using regex
  const rangePattern = /^(\d+)-(\d+)$/;
  const match = raw.match(rangePattern);
  
  if (!match) {
    throw new Error(
      `Invalid REPLAY_BLOCK_RANGE format: "${raw}". Expected format: "START-END" (e.g., "38393480-38393500")`
    );
  }
  
  const startBlock = parseInt(match[1], 10);
  const endBlock = parseInt(match[2], 10);
  
  // Validate start <= end
  if (startBlock > endBlock) {
    throw new Error(
      `Invalid REPLAY_BLOCK_RANGE: start block ${startBlock} is greater than end block ${endBlock}`
    );
  }
  
  const span = endBlock - startBlock;
  
  // Validate span does not exceed maximum
  if (span > MAX_BLOCK_SPAN) {
    throw new Error(
      `REPLAY_BLOCK_RANGE span too large: ${span} blocks exceeds maximum of ${MAX_BLOCK_SPAN} blocks. ` +
      `Please use a smaller range.`
    );
  }
  
  return {
    startBlock,
    endBlock,
    span,
    raw
  };
}
