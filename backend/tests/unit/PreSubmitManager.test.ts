// Unit tests for PreSubmitManager service
import { describe, it, expect, beforeEach } from 'vitest';

import { PreSubmitManager } from '../../src/services/PreSubmitManager.js';

describe('PreSubmitManager', () => {
  let preSubmitManager: PreSubmitManager;

  beforeEach(() => {
    preSubmitManager = new PreSubmitManager();
  });

  describe('initialization', () => {
    it('should initialize with disabled state when PRE_SUBMIT_ENABLED is false', () => {
      expect(preSubmitManager.isEnabled()).toBe(false);
    });
  });

  describe('onPredictiveCandidate', () => {
    it('should not process events when disabled', async () => {
      const event = {
        type: 'predictive_scenario' as const,
        candidate: {
          address: '0x1234567890123456789012345678901234567890',
          scenario: 'adverse' as const,
          hfCurrent: 1.05,
          hfProjected: 0.95,
          etaSec: 30,
          impactedReserves: [],
          totalDebtUsd: 10000,
          totalCollateralUsd: 9500,
          timestamp: Date.now(),
          block: 1000
        },
        priority: 100,
        shouldMicroVerify: false,
        shouldPrestage: false,
        shouldFlagFastpath: true
      };

      // Should not throw when disabled
      await expect(preSubmitManager.onPredictiveCandidate(event)).resolves.not.toThrow();
    });
  });

  describe('pending management', () => {
    it('should return empty map for pending pre-submits initially', () => {
      const pending = preSubmitManager.getPendingPreSubmits();
      expect(pending.size).toBe(0);
    });

    it('should return empty array for user pre-submits with no submissions', () => {
      const userSubmits = preSubmitManager.getUserPreSubmits('0x1234567890123456789012345678901234567890');
      expect(userSubmits.length).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should handle cleanup when no pending submits', async () => {
      const cleaned = await preSubmitManager.cleanupExpired();
      expect(cleaned).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      await expect(preSubmitManager.shutdown()).resolves.not.toThrow();
    });
  });
});
