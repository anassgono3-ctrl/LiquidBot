import { describe, it, expect } from 'vitest';
import { ReplayRangeParser } from '../../../src/replay/ReplayRangeParser.js';

describe('ReplayRangeParser', () => {
  describe('parse', () => {
    it('should parse valid block range', () => {
      const range = ReplayRangeParser.parse('38393176-38395221');
      expect(range.start).toBe(38393176);
      expect(range.end).toBe(38395221);
    });

    it('should handle ranges with whitespace', () => {
      const range = ReplayRangeParser.parse('  100-200  ');
      expect(range.start).toBe(100);
      expect(range.end).toBe(200);
    });

    it('should accept equal start and end', () => {
      const range = ReplayRangeParser.parse('1000-1000');
      expect(range.start).toBe(1000);
      expect(range.end).toBe(1000);
    });

    it('should throw on undefined', () => {
      expect(() => ReplayRangeParser.parse(undefined)).toThrow(
        'REPLAY_BLOCK_RANGE is required when REPLAY=1'
      );
    });

    it('should throw on empty string', () => {
      expect(() => ReplayRangeParser.parse('')).toThrow(
        'REPLAY_BLOCK_RANGE is required when REPLAY=1'
      );
    });

    it('should throw on malformed format - no dash', () => {
      expect(() => ReplayRangeParser.parse('100200')).toThrow(
        'Invalid REPLAY_BLOCK_RANGE format'
      );
    });

    it('should throw on malformed format - too many dashes', () => {
      expect(() => ReplayRangeParser.parse('100-200-300')).toThrow(
        'Invalid REPLAY_BLOCK_RANGE format'
      );
    });

    it('should throw on non-numeric start', () => {
      expect(() => ReplayRangeParser.parse('abc-200')).toThrow(
        'Invalid block numbers'
      );
    });

    it('should throw on non-numeric end', () => {
      expect(() => ReplayRangeParser.parse('100-xyz')).toThrow(
        'Invalid block numbers'
      );
    });

    it('should throw on string starting with dash', () => {
      // "-100-200" splits into ["", "100", "200"] so format check catches it
      expect(() => ReplayRangeParser.parse('-100-200')).toThrow(
        'Invalid REPLAY_BLOCK_RANGE format'
      );
    });

    it('should throw on double dash', () => {
      // "100--200" splits into ["100", "", "200"] so format check catches it
      expect(() => ReplayRangeParser.parse('100--200')).toThrow(
        'Invalid REPLAY_BLOCK_RANGE format'
      );
    });

    it('should throw when start > end', () => {
      expect(() => ReplayRangeParser.parse('200-100')).toThrow(
        'start block (200) must be less than or equal to end block (100)'
      );
    });
  });

  describe('validate', () => {
    it('should not throw when replay is false', () => {
      expect(() => ReplayRangeParser.validate(false, undefined)).not.toThrow();
    });

    it('should throw when replay is true but range is missing', () => {
      expect(() => ReplayRangeParser.validate(true, undefined)).toThrow(
        'REPLAY_BLOCK_RANGE is required when REPLAY=1'
      );
    });

    it('should not throw when replay is true and range is valid', () => {
      expect(() => ReplayRangeParser.validate(true, '100-200')).not.toThrow();
    });

    it('should throw when replay is true and range is invalid', () => {
      expect(() => ReplayRangeParser.validate(true, '200-100')).toThrow();
    });
  });

  describe('getBlockCount', () => {
    it('should calculate block count for range', () => {
      const range = { start: 100, end: 200 };
      expect(ReplayRangeParser.getBlockCount(range)).toBe(101);
    });

    it('should return 1 for single block range', () => {
      const range = { start: 100, end: 100 };
      expect(ReplayRangeParser.getBlockCount(range)).toBe(1);
    });

    it('should handle large ranges', () => {
      const range = { start: 38393176, end: 38395221 };
      expect(ReplayRangeParser.getBlockCount(range)).toBe(2046);
    });
  });
});
