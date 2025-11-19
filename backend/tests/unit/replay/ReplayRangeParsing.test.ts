/**
 * ReplayRangeParsing.test.ts
 * 
 * Unit tests for replay block range parsing and validation
 */

import { describe, it, expect } from 'vitest';
import { parseBlockRange } from '../../../src/replay/ReplayRunner.js';

describe('Replay Range Parsing', () => {
  describe('parseBlockRange', () => {
    it('should parse valid block range format', () => {
      const result = parseBlockRange('38393176-38395221');
      expect(result).toEqual({ start: 38393176, end: 38395221 });
    });

    it('should parse range with small numbers', () => {
      const result = parseBlockRange('100-200');
      expect(result).toEqual({ start: 100, end: 200 });
    });

    it('should parse range with same start and end', () => {
      const result = parseBlockRange('12345-12345');
      expect(result).toEqual({ start: 12345, end: 12345 });
    });

    it('should throw error for invalid format (missing dash)', () => {
      expect(() => parseBlockRange('38393176')).toThrow(/Invalid block range format/);
    });

    it('should throw error for invalid format (multiple dashes)', () => {
      expect(() => parseBlockRange('100-200-300')).toThrow(/Invalid block range format/);
    });

    it('should throw error for non-numeric values', () => {
      expect(() => parseBlockRange('abc-def')).toThrow(/Invalid block range format/);
    });

    it('should throw error for start > end', () => {
      expect(() => parseBlockRange('200-100')).toThrow(/start 200 > end 100/);
    });

    it('should throw error for empty string', () => {
      expect(() => parseBlockRange('')).toThrow(/Invalid block range format/);
    });

    it('should throw error for range with spaces', () => {
      expect(() => parseBlockRange('100 - 200')).toThrow(/Invalid block range format/);
    });

    it('should throw error for negative numbers', () => {
      expect(() => parseBlockRange('-100-200')).toThrow(/Invalid block range format/);
    });

    it('should parse large block numbers', () => {
      const result = parseBlockRange('99999999-100000000');
      expect(result).toEqual({ start: 99999999, end: 100000000 });
    });
  });
});
