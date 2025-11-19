/**
 * ReplayRangeParser: Parse and validate REPLAY_BLOCK_RANGE
 */

import type { ReplayBlockRange } from './types.js';

export class ReplayRangeParser {
  /**
   * Parse block range string in format "start-end"
   * @param rangeStr Range string like "38393176-38395221"
   * @returns Parsed block range
   * @throws Error if format is invalid
   */
  static parse(rangeStr: string | undefined): ReplayBlockRange {
    if (!rangeStr) {
      throw new Error('REPLAY_BLOCK_RANGE is required when REPLAY=1');
    }

    const trimmed = rangeStr.trim();
    const parts = trimmed.split('-');

    if (parts.length !== 2) {
      throw new Error(
        `Invalid REPLAY_BLOCK_RANGE format: "${rangeStr}". Expected format: "start-end" (e.g., "38393176-38395221")`
      );
    }

    const start = parseInt(parts[0], 10);
    const end = parseInt(parts[1], 10);

    if (isNaN(start) || isNaN(end)) {
      throw new Error(
        `Invalid block numbers in REPLAY_BLOCK_RANGE: "${rangeStr}". Both start and end must be valid integers.`
      );
    }

    if (start < 0 || end < 0) {
      throw new Error(
        `Block numbers must be non-negative in REPLAY_BLOCK_RANGE: "${rangeStr}"`
      );
    }

    if (start > end) {
      throw new Error(
        `Invalid REPLAY_BLOCK_RANGE: start block (${start}) must be less than or equal to end block (${end})`
      );
    }

    return { start, end };
  }

  /**
   * Validate that replay mode is properly configured
   * @param replay REPLAY flag value
   * @param rangeStr REPLAY_BLOCK_RANGE value
   */
  static validate(replay: boolean, rangeStr: string | undefined): void {
    if (replay && !rangeStr) {
      throw new Error('REPLAY_BLOCK_RANGE is required when REPLAY=1');
    }

    if (replay) {
      // This will throw if invalid
      this.parse(rangeStr);
    }
  }

  /**
   * Calculate the total number of blocks in a range
   */
  static getBlockCount(range: ReplayBlockRange): number {
    return range.end - range.start + 1;
  }
}
