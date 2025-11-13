// Unit tests for parseEnv utilities
import { describe, it, expect } from 'vitest';

import { parseBoolEnv, parseIntEnv, getEnvString, parseEnumEnv } from '../../src/config/parseEnv.js';

describe('parseEnv', () => {
  describe('parseBoolEnv', () => {
    it('should parse "true" as true', () => {
      expect(parseBoolEnv('true', false)).toBe(true);
      expect(parseBoolEnv('TRUE', false)).toBe(true);
      expect(parseBoolEnv('True', false)).toBe(true);
    });

    it('should parse "false" as false', () => {
      expect(parseBoolEnv('false', true)).toBe(false);
      expect(parseBoolEnv('FALSE', true)).toBe(false);
      expect(parseBoolEnv('False', true)).toBe(false);
    });

    it('should parse "1" as true and "0" as false', () => {
      expect(parseBoolEnv('1', false)).toBe(true);
      expect(parseBoolEnv('0', true)).toBe(false);
    });

    it('should parse "yes" as true and "no" as false', () => {
      expect(parseBoolEnv('yes', false)).toBe(true);
      expect(parseBoolEnv('YES', false)).toBe(true);
      expect(parseBoolEnv('no', true)).toBe(false);
      expect(parseBoolEnv('NO', true)).toBe(false);
    });

    it('should return default for undefined or empty', () => {
      expect(parseBoolEnv(undefined, true)).toBe(true);
      expect(parseBoolEnv(undefined, false)).toBe(false);
      expect(parseBoolEnv('', true)).toBe(true);
      expect(parseBoolEnv('', false)).toBe(false);
    });

    it('should return default for invalid values', () => {
      expect(parseBoolEnv('invalid', true)).toBe(true);
      expect(parseBoolEnv('invalid', false)).toBe(false);
      expect(parseBoolEnv('maybe', true)).toBe(true);
    });

    it('should handle whitespace', () => {
      expect(parseBoolEnv('  true  ', false)).toBe(true);
      expect(parseBoolEnv('  false  ', true)).toBe(false);
    });
  });

  describe('parseIntEnv', () => {
    it('should parse valid integers', () => {
      expect(parseIntEnv('42', 0)).toBe(42);
      expect(parseIntEnv('0', 10)).toBe(0);
      expect(parseIntEnv('-5', 0)).toBe(-5);
    });

    it('should return default for undefined or empty', () => {
      expect(parseIntEnv(undefined, 42)).toBe(42);
      expect(parseIntEnv('', 42)).toBe(42);
    });

    it('should return default for invalid values', () => {
      expect(parseIntEnv('not a number', 42)).toBe(42);
      expect(parseIntEnv('12.5', 42)).toBe(12); // parseInt truncates
    });

    it('should enforce min boundary', () => {
      expect(parseIntEnv('5', 0, 10, 100)).toBe(10);
      expect(parseIntEnv('-10', 0, 0, 100)).toBe(0);
    });

    it('should enforce max boundary', () => {
      expect(parseIntEnv('150', 0, 0, 100)).toBe(100);
      expect(parseIntEnv('101', 0, 0, 100)).toBe(100);
    });

    it('should work without boundaries', () => {
      expect(parseIntEnv('999', 0)).toBe(999);
      expect(parseIntEnv('-999', 0)).toBe(-999);
    });
  });

  describe('getEnvString', () => {
    it('should return string value', () => {
      expect(getEnvString('hello', 'default')).toBe('hello');
      expect(getEnvString('world', undefined)).toBe('world');
    });

    it('should return default for undefined', () => {
      expect(getEnvString(undefined, 'default')).toBe('default');
      expect(getEnvString(undefined, undefined)).toBe(undefined);
    });

    it('should return default for empty string', () => {
      expect(getEnvString('', 'default')).toBe('default');
      expect(getEnvString('   ', 'default')).toBe('default');
    });

    it('should trim whitespace', () => {
      expect(getEnvString('  hello  ', 'default')).toBe('hello');
      expect(getEnvString(' world ', undefined)).toBe('world');
    });
  });

  describe('parseEnumEnv', () => {
    const allowedValues = ['apple', 'banana', 'cherry'] as const;

    it('should parse valid enum values', () => {
      expect(parseEnumEnv('apple', allowedValues, 'banana')).toBe('apple');
      expect(parseEnumEnv('cherry', allowedValues, 'banana')).toBe('cherry');
    });

    it('should be case-insensitive', () => {
      expect(parseEnumEnv('APPLE', allowedValues, 'banana')).toBe('apple');
      expect(parseEnumEnv('Cherry', allowedValues, 'banana')).toBe('cherry');
    });

    it('should return default for undefined or empty', () => {
      expect(parseEnumEnv(undefined, allowedValues, 'banana')).toBe('banana');
      expect(parseEnumEnv('', allowedValues, 'banana')).toBe('banana');
    });

    it('should return default for invalid values', () => {
      expect(parseEnumEnv('orange', allowedValues, 'banana')).toBe('banana');
      expect(parseEnumEnv('grape', allowedValues, 'banana')).toBe('banana');
    });

    it('should handle whitespace', () => {
      expect(parseEnumEnv('  apple  ', allowedValues, 'banana')).toBe('apple');
    });
  });
});
