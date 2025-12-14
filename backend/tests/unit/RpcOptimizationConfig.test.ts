import { describe, it, expect } from 'vitest';
import { config } from '../../src/config/index.js';

describe('RPC Optimization Config Fields', () => {
  it('should have predictiveNearOnly config field', () => {
    expect(config.predictiveNearOnly).toBeDefined();
    expect(typeof config.predictiveNearOnly).toBe('boolean');
  });

  it('should have predictiveNearBandBps config field', () => {
    expect(config.predictiveNearBandBps).toBeDefined();
    expect(typeof config.predictiveNearBandBps).toBe('number');
    expect(config.predictiveNearBandBps).toBeGreaterThanOrEqual(0);
  });

  it('should have reserveMinIndexDeltaBps config field', () => {
    expect(config.reserveMinIndexDeltaBps).toBeDefined();
    expect(typeof config.reserveMinIndexDeltaBps).toBe('number');
    expect(config.reserveMinIndexDeltaBps).toBeGreaterThanOrEqual(0);
  });

  it('should have priceTriggerBpsByAsset config field (optional)', () => {
    // This field is optional and may be undefined if not set in env
    expect(config).toHaveProperty('priceTriggerBpsByAsset');
  });

  it('should have priceTriggerDebounceByAsset config field (optional)', () => {
    // This field is optional and may be undefined if not set in env
    expect(config).toHaveProperty('priceTriggerDebounceByAsset');
  });

  it('should have indexJumpBpsTrigger config field', () => {
    expect(config.indexJumpBpsTrigger).toBeDefined();
    expect(typeof config.indexJumpBpsTrigger).toBe('number');
  });

  it('should have hfPredCritical config field', () => {
    expect(config.hfPredCritical).toBeDefined();
    expect(typeof config.hfPredCritical).toBe('number');
  });
});
