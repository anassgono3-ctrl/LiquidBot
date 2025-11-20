import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { parseReplayConfig, validateReplayConfig, getSleepDuration } from '../../../src/replay/ReplayConfig.js';

describe('ReplayConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('parseReplayConfig', () => {
    it('should return disabled config when REPLAY_ENABLED is not set', () => {
      delete process.env.REPLAY_ENABLED;
      const config = parseReplayConfig();
      expect(config.enabled).toBe(false);
    });

    it('should parse basic replay configuration', () => {
      process.env.REPLAY_ENABLED = 'true';
      process.env.REPLAY_START_BLOCK = '1000';
      process.env.REPLAY_END_BLOCK = '2000';
      process.env.REPLAY_MODE = 'simulate';

      const config = parseReplayConfig();
      expect(config.enabled).toBe(true);
      expect(config.startBlock).toBe(1000);
      expect(config.endBlock).toBe(2000);
      expect(config.mode).toBe('simulate');
    });

    it('should use default values for optional settings', () => {
      process.env.REPLAY_ENABLED = 'true';
      process.env.REPLAY_START_BLOCK = '1000';
      process.env.REPLAY_END_BLOCK = '2000';

      const config = parseReplayConfig();
      expect(config.speed).toBe('accelerated');
      expect(config.blockStep).toBe(1);
      expect(config.priceSource).toBe('oracle');
      expect(config.chainId).toBe(8453);
    });

    it('should throw error when startBlock is missing but enabled', () => {
      process.env.REPLAY_ENABLED = 'true';
      process.env.REPLAY_END_BLOCK = '2000';

      expect(() => parseReplayConfig()).toThrow('REPLAY_START_BLOCK and REPLAY_END_BLOCK must be set');
    });

    it('should throw error when startBlock >= endBlock', () => {
      process.env.REPLAY_ENABLED = 'true';
      process.env.REPLAY_START_BLOCK = '2000';
      process.env.REPLAY_END_BLOCK = '1000';

      expect(() => parseReplayConfig()).toThrow('REPLAY_START_BLOCK must be less than REPLAY_END_BLOCK');
    });

    it('should parse threshold overrides', () => {
      process.env.REPLAY_ENABLED = 'true';
      process.env.REPLAY_START_BLOCK = '1000';
      process.env.REPLAY_END_BLOCK = '2000';
      process.env.REPLAY_FORCE_MIN_DEBT_USD = '100.5';
      process.env.REPLAY_FORCE_MIN_PROFIT_USD = '10.25';

      const config = parseReplayConfig();
      expect(config.forceMinDebtUsd).toBe(100.5);
      expect(config.forceMinProfitUsd).toBe(10.25);
    });

    it('should require fork URL for exec-fork mode', () => {
      process.env.REPLAY_ENABLED = 'true';
      process.env.REPLAY_START_BLOCK = '1000';
      process.env.REPLAY_END_BLOCK = '2000';
      process.env.REPLAY_MODE = 'exec-fork';

      expect(() => parseReplayConfig()).toThrow('REPLAY_LOCAL_FORK_URL must be set');
    });

    it('should parse fork configuration', () => {
      process.env.REPLAY_ENABLED = 'true';
      process.env.REPLAY_START_BLOCK = '1000';
      process.env.REPLAY_END_BLOCK = '2000';
      process.env.REPLAY_MODE = 'exec-fork';
      process.env.REPLAY_LOCAL_FORK_URL = 'http://localhost:8545';

      const config = parseReplayConfig();
      expect(config.localForkUrl).toBe('http://localhost:8545');
      expect(config.forkAutoAdvance).toBe(true);
    });
  });

  describe('getSleepDuration', () => {
    it('should return custom sleep if set', () => {
      const config = parseReplayConfig();
      config.sleepMs = 500;
      expect(getSleepDuration(config)).toBe(500);
    });

    it('should return 0 for max speed', () => {
      const config = parseReplayConfig();
      config.speed = 'max';
      config.sleepMs = 0;
      expect(getSleepDuration(config)).toBe(0);
    });

    it('should return 100 for accelerated speed', () => {
      const config = parseReplayConfig();
      config.speed = 'accelerated';
      config.sleepMs = 0;
      expect(getSleepDuration(config)).toBe(100);
    });

    it('should return 2000 for realtime speed', () => {
      const config = parseReplayConfig();
      config.speed = 'realtime';
      config.sleepMs = 0;
      expect(getSleepDuration(config)).toBe(2000);
    });
  });

  describe('validateReplayConfig', () => {
    it('should return empty array for disabled config', () => {
      const config = parseReplayConfig();
      config.enabled = false;
      const warnings = validateReplayConfig(config);
      expect(warnings).toHaveLength(0);
    });

    it('should warn about large block ranges', () => {
      const config = parseReplayConfig();
      config.enabled = true;
      config.startBlock = 1000;
      config.endBlock = 20000;

      const warnings = validateReplayConfig(config);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('Large block range');
    });

    it('should warn about simulation at max speed', () => {
      const config = parseReplayConfig();
      config.enabled = true;
      config.mode = 'simulate';
      config.speed = 'max';
      config.startBlock = 1000;
      config.endBlock = 1100;

      const warnings = validateReplayConfig(config);
      expect(warnings.some(w => w.includes('rate-limited'))).toBe(true);
    });

    it('should warn about fork mode localhost setup', () => {
      const config = parseReplayConfig();
      config.enabled = true;
      config.mode = 'exec-fork';
      config.localForkUrl = 'http://localhost:8545';
      config.startBlock = 1000;
      config.endBlock = 1100;

      const warnings = validateReplayConfig(config);
      expect(warnings.some(w => w.includes('local fork'))).toBe(true);
    });
  });
});
