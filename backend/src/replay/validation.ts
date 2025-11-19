// Validation utilities for replay mode

import type { ParsedReplayRange } from './types.js';

const MAX_REPLAY_RANGE = 100000; // Hard safety cap on block range size

/**
 * Parse and validate REPLAY_BLOCK_RANGE string
 * Format: "start-end" (e.g., "38393176-38395221")
 * 
 * @param rangeStr - Block range string
 * @returns Parsed start and end block numbers
 * @throws Error if format is invalid or constraints are violated
 */
export function parseReplayBlockRange(rangeStr: string): ParsedReplayRange {
  if (!rangeStr || typeof rangeStr !== 'string') {
    throw new Error('REPLAY_BLOCK_RANGE is required and must be a string');
  }

  // Find the last hyphen to handle negative numbers correctly
  const lastHyphenIndex = rangeStr.lastIndexOf('-');
  if (lastHyphenIndex === -1) {
    throw new Error(
      `Invalid REPLAY_BLOCK_RANGE format: "${rangeStr}". Expected format: "start-end" (e.g., "38393176-38395221")`
    );
  }

  const startStr = rangeStr.substring(0, lastHyphenIndex).trim();
  const endStr = rangeStr.substring(lastHyphenIndex + 1).trim();

  // Check for empty parts
  if (!startStr || !endStr) {
    throw new Error(
      `Invalid REPLAY_BLOCK_RANGE format: "${rangeStr}". Expected format: "start-end" (e.g., "38393176-38395221")`
    );
  }

  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);

  // Check if parsing was successful and values are exact integers
  if (isNaN(start) || isNaN(end) || startStr !== String(start) || endStr !== String(end)) {
    throw new Error(
      `Invalid REPLAY_BLOCK_RANGE: start and end must be valid integers. Got: start="${startStr}", end="${endStr}"`
    );
  }

  if (start < 0 || end < 0) {
    throw new Error(
      `Invalid REPLAY_BLOCK_RANGE: block numbers must be non-negative. Got: start=${start}, end=${end}`
    );
  }

  if (start > end) {
    throw new Error(
      `Invalid REPLAY_BLOCK_RANGE: start must be <= end. Got: start=${start}, end=${end}`
    );
  }

  const rangeSize = end - start + 1;
  if (rangeSize > MAX_REPLAY_RANGE) {
    throw new Error(
      `Invalid REPLAY_BLOCK_RANGE: range size (${rangeSize}) exceeds maximum allowed (${MAX_REPLAY_RANGE} blocks)`
    );
  }

  return { start, end };
}

/**
 * Validate that replay mode configuration is complete
 * 
 * @param isReplay - Whether replay mode is enabled
 * @param blockRange - Block range string (can be undefined)
 * @throws Error if replay is enabled but blockRange is missing
 */
export function validateReplayConfig(
  isReplay: boolean,
  blockRange: string | undefined
): void {
  if (isReplay && !blockRange) {
    throw new Error(
      'REPLAY_BLOCK_RANGE is required when REPLAY=true. Format: "start-end" (e.g., "38393176-38395221")'
    );
  }
}
