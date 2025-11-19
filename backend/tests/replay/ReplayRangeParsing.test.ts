// Tests for replay block range parsing and validation

import { describe, it, expect } from 'vitest';
import { parseReplayBlockRange, validateReplayConfig } from '../../src/replay/validation.js';

describe('Replay Range Parsing', () => {
  describe('parseReplayBlockRange', () => {
    it('should parse valid block range', () => {
      const result = parseReplayBlockRange('38393176-38395221');
      expect(result).toEqual({ start: 38393176, end: 38395221 });
    });

    it('should parse block range with spaces', () => {
      const result = parseReplayBlockRange(' 38393176 - 38395221 ');
      expect(result).toEqual({ start: 38393176, end: 38395221 });
    });

    it('should parse single block range (start equals end)', () => {
      const result = parseReplayBlockRange('38393176-38393176');
      expect(result).toEqual({ start: 38393176, end: 38393176 });
    });

    it('should parse zero blocks', () => {
      const result = parseReplayBlockRange('0-0');
      expect(result).toEqual({ start: 0, end: 0 });
    });

    it('should throw error for missing range string', () => {
      expect(() => parseReplayBlockRange('')).toThrow('REPLAY_BLOCK_RANGE is required');
    });

    it('should throw error for invalid format (no hyphen)', () => {
      expect(() => parseReplayBlockRange('38393176')).toThrow('Invalid REPLAY_BLOCK_RANGE format');
    });

    it('should throw error for invalid format (multiple hyphens)', () => {
      // With lastIndexOf, this will be parsed as "38393176-38395221" and "38400000"
      // which will fail the integer validation since first part contains hyphen
      expect(() => parseReplayBlockRange('38393176-38395221-38400000')).toThrow(
        'start and end must be valid integers'
      );
    });

    it('should throw error for non-integer start', () => {
      expect(() => parseReplayBlockRange('abc-38395221')).toThrow(
        'start and end must be valid integers'
      );
    });

    it('should throw error for non-integer end', () => {
      expect(() => parseReplayBlockRange('38393176-xyz')).toThrow(
        'start and end must be valid integers'
      );
    });

    it('should throw error for negative start', () => {
      expect(() => parseReplayBlockRange('-100-38395221')).toThrow(
        'block numbers must be non-negative'
      );
    });

    it('should throw error for negative end', () => {
      // Double hyphen will be parsed as "38393176-" and "100" which fails integer check
      expect(() => parseReplayBlockRange('38393176--100')).toThrow(
        'start and end must be valid integers'
      );
    });

    it('should throw error when start > end', () => {
      expect(() => parseReplayBlockRange('38395221-38393176')).toThrow(
        'start must be <= end'
      );
    });

    it('should throw error when range exceeds maximum', () => {
      expect(() => parseReplayBlockRange('1-200000')).toThrow(
        'range size (200000) exceeds maximum allowed (100000 blocks)'
      );
    });

    it('should accept range at maximum limit (100000 blocks)', () => {
      const result = parseReplayBlockRange('1-100000');
      expect(result).toEqual({ start: 1, end: 100000 });
    });

    it('should accept range just under maximum limit', () => {
      const result = parseReplayBlockRange('1-99999');
      expect(result).toEqual({ start: 1, end: 99999 });
    });

    it('should throw error for floating point numbers', () => {
      expect(() => parseReplayBlockRange('38393176.5-38395221')).toThrow(
        'start and end must be valid integers'
      );
    });
  });

  describe('validateReplayConfig', () => {
    it('should pass when replay is disabled', () => {
      expect(() => validateReplayConfig(false, undefined)).not.toThrow();
    });

    it('should pass when replay is disabled even with block range set', () => {
      expect(() => validateReplayConfig(false, '1-100')).not.toThrow();
    });

    it('should pass when replay is enabled and block range is set', () => {
      expect(() => validateReplayConfig(true, '38393176-38395221')).not.toThrow();
    });

    it('should throw error when replay is enabled but block range is missing', () => {
      expect(() => validateReplayConfig(true, undefined)).toThrow(
        'REPLAY_BLOCK_RANGE is required when REPLAY=true'
      );
    });

    it('should throw error when replay is enabled but block range is empty string', () => {
      expect(() => validateReplayConfig(true, '')).toThrow(
        'REPLAY_BLOCK_RANGE is required when REPLAY=true'
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle large block numbers', () => {
      const result = parseReplayBlockRange('999999900-999999999');
      expect(result).toEqual({ start: 999999900, end: 999999999 });
    });

    it('should reject block range with leading zeros', () => {
      // Leading zeros are rejected to ensure exact integer parsing
      expect(() => parseReplayBlockRange('00100-00200')).toThrow(
        'start and end must be valid integers'
      );
    });

    it('should reject scientific notation', () => {
      expect(() => parseReplayBlockRange('1e6-2e6')).toThrow(
        'start and end must be valid integers'
      );
    });
  });

  describe('Real-world Examples', () => {
    it('should parse Base mainnet block range example', () => {
      const result = parseReplayBlockRange('38393176-38395221');
      expect(result.start).toBe(38393176);
      expect(result.end).toBe(38395221);
      expect(result.end - result.start + 1).toBe(2046);
    });

    it('should parse short investigation range', () => {
      const result = parseReplayBlockRange('38393200-38393220');
      expect(result.start).toBe(38393200);
      expect(result.end).toBe(38393220);
      expect(result.end - result.start + 1).toBe(21);
    });

    it('should parse daily range (approx 7200 blocks on Base)', () => {
      const result = parseReplayBlockRange('38393176-38400376');
      expect(result.start).toBe(38393176);
      expect(result.end).toBe(38400376);
      expect(result.end - result.start + 1).toBe(7201);
    });
  });
});
