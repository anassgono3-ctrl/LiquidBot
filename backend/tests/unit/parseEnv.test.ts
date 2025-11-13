// Unit tests for parseEnv utilities
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { parseBoolEnv, parseBoolEnvVar } from '../../src/config/parseEnv.js';

describe('parseBoolEnv', () => {
  describe('true values', () => {
    it('should parse "true" as true', () => {
      expect(parseBoolEnv('true')).toBe(true);
    });

    it('should parse "TRUE" as true (case-insensitive)', () => {
      expect(parseBoolEnv('TRUE')).toBe(true);
    });

    it('should parse "1" as true', () => {
      expect(parseBoolEnv('1')).toBe(true);
    });

    it('should parse "yes" as true', () => {
      expect(parseBoolEnv('yes')).toBe(true);
    });

    it('should parse "YES" as true (case-insensitive)', () => {
      expect(parseBoolEnv('YES')).toBe(true);
    });

    it('should parse "on" as true', () => {
      expect(parseBoolEnv('on')).toBe(true);
    });

    it('should parse "ON" as true (case-insensitive)', () => {
      expect(parseBoolEnv('ON')).toBe(true);
    });
  });

  describe('false values', () => {
    it('should parse "false" as false', () => {
      expect(parseBoolEnv('false')).toBe(false);
    });

    it('should parse "FALSE" as false (case-insensitive)', () => {
      expect(parseBoolEnv('FALSE')).toBe(false);
    });

    it('should parse "0" as false', () => {
      expect(parseBoolEnv('0')).toBe(false);
    });

    it('should parse "no" as false', () => {
      expect(parseBoolEnv('no')).toBe(false);
    });

    it('should parse "NO" as false (case-insensitive)', () => {
      expect(parseBoolEnv('NO')).toBe(false);
    });

    it('should parse "off" as false', () => {
      expect(parseBoolEnv('off')).toBe(false);
    });

    it('should parse "OFF" as false (case-insensitive)', () => {
      expect(parseBoolEnv('OFF')).toBe(false);
    });
  });

  describe('default values', () => {
    it('should return false by default for undefined', () => {
      expect(parseBoolEnv(undefined)).toBe(false);
    });

    it('should return false by default for empty string', () => {
      expect(parseBoolEnv('')).toBe(false);
    });

    it('should return false by default for whitespace-only string', () => {
      expect(parseBoolEnv('   ')).toBe(false);
    });

    it('should return custom default for undefined when specified', () => {
      expect(parseBoolEnv(undefined, true)).toBe(true);
    });

    it('should return custom default for empty string when specified', () => {
      expect(parseBoolEnv('', true)).toBe(true);
    });

    it('should return custom default for unknown value', () => {
      expect(parseBoolEnv('unknown', true)).toBe(true);
      expect(parseBoolEnv('invalid', false)).toBe(false);
    });
  });

  describe('whitespace handling', () => {
    it('should trim whitespace before parsing', () => {
      expect(parseBoolEnv('  true  ')).toBe(true);
      expect(parseBoolEnv('  false  ')).toBe(false);
      expect(parseBoolEnv('  1  ')).toBe(true);
      expect(parseBoolEnv('  0  ')).toBe(false);
    });
  });

  describe('with single argument (defaultValue should be false)', () => {
    it('should work with one argument for true values', () => {
      expect(parseBoolEnv('true')).toBe(true);
      expect(parseBoolEnv('1')).toBe(true);
    });

    it('should work with one argument for false values', () => {
      expect(parseBoolEnv('false')).toBe(false);
      expect(parseBoolEnv('0')).toBe(false);
    });

    it('should return false for undefined when called with one argument', () => {
      expect(parseBoolEnv(undefined)).toBe(false);
    });
  });
});

describe('parseBoolEnvVar', () => {
  const TEST_KEY = 'TEST_BOOL_VAR';

  beforeEach(() => {
    // Clean up test env var before each test
    delete process.env[TEST_KEY];
  });

  afterEach(() => {
    // Clean up test env var after each test
    delete process.env[TEST_KEY];
  });

  describe('reading from process.env', () => {
    it('should read and parse "true" from environment', () => {
      process.env[TEST_KEY] = 'true';
      expect(parseBoolEnvVar(TEST_KEY)).toBe(true);
    });

    it('should read and parse "false" from environment', () => {
      process.env[TEST_KEY] = 'false';
      expect(parseBoolEnvVar(TEST_KEY)).toBe(false);
    });

    it('should read and parse "1" from environment', () => {
      process.env[TEST_KEY] = '1';
      expect(parseBoolEnvVar(TEST_KEY)).toBe(true);
    });

    it('should read and parse "0" from environment', () => {
      process.env[TEST_KEY] = '0';
      expect(parseBoolEnvVar(TEST_KEY)).toBe(false);
    });

    it('should return false by default when var is not set', () => {
      expect(parseBoolEnvVar(TEST_KEY)).toBe(false);
    });

    it('should return custom default when var is not set', () => {
      expect(parseBoolEnvVar(TEST_KEY, true)).toBe(true);
    });
  });

  describe('with single argument (defaultValue should be false)', () => {
    it('should return false for unset variable when called with one argument', () => {
      expect(parseBoolEnvVar(TEST_KEY)).toBe(false);
    });

    it('should parse correctly for set variables with one argument', () => {
      process.env[TEST_KEY] = 'true';
      expect(parseBoolEnvVar(TEST_KEY)).toBe(true);
      
      process.env[TEST_KEY] = 'false';
      expect(parseBoolEnvVar(TEST_KEY)).toBe(false);
    });
  });
});
