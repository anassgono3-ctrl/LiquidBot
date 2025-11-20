/**
 * Unit tests for replay block range parsing and validation
 */

import { describe, it, expect } from 'vitest';

import { parseReplayRange } from '../../src/replay/validation.js';

describe('parseReplayRange', () => {
  describe('valid ranges', () => {
    it('should parse a valid range', () => {
      const result = parseReplayRange('38393480-38393500');
      
      expect(result.startBlock).toBe(38393480);
      expect(result.endBlock).toBe(38393500);
      expect(result.span).toBe(20);
      expect(result.raw).toBe('38393480-38393500');
    });
    
    it('should parse a single block range (start equals end)', () => {
      const result = parseReplayRange('1000-1000');
      
      expect(result.startBlock).toBe(1000);
      expect(result.endBlock).toBe(1000);
      expect(result.span).toBe(0);
      expect(result.raw).toBe('1000-1000');
    });
    
    it('should parse a large valid range', () => {
      const result = parseReplayRange('1000000-1099999');
      
      expect(result.startBlock).toBe(1000000);
      expect(result.endBlock).toBe(1099999);
      expect(result.span).toBe(99999);
      expect(result.raw).toBe('1000000-1099999');
    });
    
    it('should parse maximum allowed span (100,000 blocks)', () => {
      const result = parseReplayRange('0-100000');
      
      expect(result.startBlock).toBe(0);
      expect(result.endBlock).toBe(100000);
      expect(result.span).toBe(100000);
      expect(result.raw).toBe('0-100000');
    });
  });
  
  describe('invalid format', () => {
    it('should reject range without hyphen', () => {
      expect(() => parseReplayRange('3839348038393500')).toThrow(
        /Invalid REPLAY_BLOCK_RANGE format/
      );
    });
    
    it('should reject range with non-numeric values', () => {
      expect(() => parseReplayRange('abc-def')).toThrow(
        /Invalid REPLAY_BLOCK_RANGE format/
      );
    });
    
    it('should reject range with only one number', () => {
      expect(() => parseReplayRange('38393480-')).toThrow(
        /Invalid REPLAY_BLOCK_RANGE format/
      );
    });
    
    it('should reject range with extra hyphens', () => {
      expect(() => parseReplayRange('100-200-300')).toThrow(
        /Invalid REPLAY_BLOCK_RANGE format/
      );
    });
    
    it('should reject empty string', () => {
      expect(() => parseReplayRange('')).toThrow(
        /Invalid REPLAY_BLOCK_RANGE format/
      );
    });
    
    it('should reject range with spaces', () => {
      expect(() => parseReplayRange('100 - 200')).toThrow(
        /Invalid REPLAY_BLOCK_RANGE format/
      );
    });
  });
  
  describe('invalid range values', () => {
    it('should reject range where start > end', () => {
      expect(() => parseReplayRange('38393500-38393480')).toThrow(
        /start block 38393500 is greater than end block 38393480/
      );
    });
    
    it('should reject range where start >> end', () => {
      expect(() => parseReplayRange('1000000-100')).toThrow(
        /start block 1000000 is greater than end block 100/
      );
    });
  });
  
  describe('span validation', () => {
    it('should reject span larger than 100,000 blocks', () => {
      expect(() => parseReplayRange('0-100001')).toThrow(
        /span too large: 100001 blocks exceeds maximum of 100000 blocks/
      );
    });
    
    it('should reject very large span', () => {
      expect(() => parseReplayRange('1000000-2000000')).toThrow(
        /span too large.*exceeds maximum of 100000 blocks/
      );
    });
    
    it('should accept span exactly at limit', () => {
      const result = parseReplayRange('1000000-1100000');
      
      expect(result.span).toBe(100000);
    });
  });
});
