import { describe, it, expect } from 'vitest';

import { parseBoolEnv, parseIntEnv, getEnv } from '../../src/config/parseEnv.js';

describe('parseEnv utilities', () => {
  describe('parseBoolEnv', () => {
    it('should return false for "false"', () => {
      expect(parseBoolEnv('false')).toBe(false);
    });

    it('should return false for "FALSE" (case insensitive)', () => {
      expect(parseBoolEnv('FALSE')).toBe(false);
    });

    it('should return false for "0"', () => {
      expect(parseBoolEnv('0')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(parseBoolEnv('')).toBe(false);
    });

    it('should return false for undefined with default false', () => {
      expect(parseBoolEnv(undefined)).toBe(false);
    });

    it('should return true for "true"', () => {
      expect(parseBoolEnv('true')).toBe(true);
    });

    it('should return true for "TRUE" (case insensitive)', () => {
      expect(parseBoolEnv('TRUE')).toBe(true);
    });

    it('should return true for "1"', () => {
      expect(parseBoolEnv('1')).toBe(true);
    });

    it('should return true for "yes"', () => {
      expect(parseBoolEnv('yes')).toBe(true);
    });

    it('should return true for "YES" (case insensitive)', () => {
      expect(parseBoolEnv('YES')).toBe(true);
    });

    it('should return default value for unrecognized string', () => {
      expect(parseBoolEnv('maybe', true)).toBe(true);
      expect(parseBoolEnv('maybe', false)).toBe(false);
    });

    it('should return custom default for undefined', () => {
      expect(parseBoolEnv(undefined, true)).toBe(true);
      expect(parseBoolEnv(undefined, false)).toBe(false);
    });

    it('should trim whitespace', () => {
      expect(parseBoolEnv('  true  ')).toBe(true);
      expect(parseBoolEnv('  false  ')).toBe(false);
    });
  });

  describe('parseIntEnv', () => {
    it('should parse valid integer strings', () => {
      expect(parseIntEnv('123', 0)).toBe(123);
      expect(parseIntEnv('0', 10)).toBe(0);
      expect(parseIntEnv('-42', 0)).toBe(-42);
    });

    it('should return default for undefined', () => {
      expect(parseIntEnv(undefined, 100)).toBe(100);
    });

    it('should return default for empty string', () => {
      expect(parseIntEnv('', 100)).toBe(100);
    });

    it('should return default for non-numeric strings', () => {
      expect(parseIntEnv('abc', 50)).toBe(50);
      expect(parseIntEnv('12.5', 50)).toBe(12); // parseInt truncates
    });

    it('should handle large numbers', () => {
      expect(parseIntEnv('50000', 0)).toBe(50000);
    });
  });

  describe('getEnv', () => {
    it('should return environment variable if set', () => {
      process.env.TEST_VAR = 'test_value';
      expect(getEnv('TEST_VAR')).toBe('test_value');
      delete process.env.TEST_VAR;
    });

    it('should return undefined for unset variable without default', () => {
      expect(getEnv('NONEXISTENT_VAR')).toBeUndefined();
    });

    it('should return default for unset variable', () => {
      expect(getEnv('NONEXISTENT_VAR', 'default')).toBe('default');
    });

    it('should prefer actual value over default', () => {
      process.env.TEST_VAR = 'actual';
      expect(getEnv('TEST_VAR', 'default')).toBe('actual');
      delete process.env.TEST_VAR;
    });
  });
});
