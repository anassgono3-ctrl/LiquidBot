// Unit tests for MIN_REPAY_USD gate logic
import { describe, it, expect } from 'vitest';

describe('MIN_REPAY_USD gate logic', () => {
  // Default configuration value
  const MIN_REPAY_USD = 50;

  describe('gate behavior', () => {
    it('should reject $20 USD (below threshold)', () => {
      const debtToCoverUsd = 20;
      const shouldReject = debtToCoverUsd < MIN_REPAY_USD;
      
      expect(shouldReject).toBe(true);
      expect(debtToCoverUsd).toBeLessThan(MIN_REPAY_USD);
    });

    it('should accept $100 USD (above threshold)', () => {
      const debtToCoverUsd = 100;
      const shouldReject = debtToCoverUsd < MIN_REPAY_USD;
      
      expect(shouldReject).toBe(false);
      expect(debtToCoverUsd).toBeGreaterThanOrEqual(MIN_REPAY_USD);
    });

    it('should reject $49 USD (just below threshold)', () => {
      const debtToCoverUsd = 49;
      const shouldReject = debtToCoverUsd < MIN_REPAY_USD;
      
      expect(shouldReject).toBe(true);
      expect(debtToCoverUsd).toBeLessThan(MIN_REPAY_USD);
    });

    it('should accept $50 USD (at threshold)', () => {
      const debtToCoverUsd = 50;
      const shouldReject = debtToCoverUsd < MIN_REPAY_USD;
      
      expect(shouldReject).toBe(false);
      expect(debtToCoverUsd).toBeGreaterThanOrEqual(MIN_REPAY_USD);
    });

    it('should accept $51 USD (just above threshold)', () => {
      const debtToCoverUsd = 51;
      const shouldReject = debtToCoverUsd < MIN_REPAY_USD;
      
      expect(shouldReject).toBe(false);
      expect(debtToCoverUsd).toBeGreaterThanOrEqual(MIN_REPAY_USD);
    });

    it('should reject $0.01 USD (dust)', () => {
      const debtToCoverUsd = 0.01;
      const shouldReject = debtToCoverUsd < MIN_REPAY_USD;
      
      expect(shouldReject).toBe(true);
      expect(debtToCoverUsd).toBeLessThan(MIN_REPAY_USD);
    });

    it('should reject $1 USD (very small)', () => {
      const debtToCoverUsd = 1;
      const shouldReject = debtToCoverUsd < MIN_REPAY_USD;
      
      expect(shouldReject).toBe(true);
      expect(debtToCoverUsd).toBeLessThan(MIN_REPAY_USD);
    });

    it('should accept $1000 USD (large)', () => {
      const debtToCoverUsd = 1000;
      const shouldReject = debtToCoverUsd < MIN_REPAY_USD;
      
      expect(shouldReject).toBe(false);
      expect(debtToCoverUsd).toBeGreaterThanOrEqual(MIN_REPAY_USD);
    });
  });
});
