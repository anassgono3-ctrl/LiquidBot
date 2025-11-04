// Unit tests for ExecutorRevertDecoder
import { describe, it, expect } from 'vitest';

import { ExecutorRevertDecoder } from '../../src/services/ExecutorRevertDecoder.js';

describe('ExecutorRevertDecoder', () => {
  describe('decode', () => {
    it('should decode InsufficientOutput error (0xb629b0e4)', () => {
      const revertData = '0xb629b0e4';
      const decoded = ExecutorRevertDecoder.decode(revertData);
      
      expect(decoded.selector).toBe('0xb629b0e4');
      expect(decoded.name).toBe('InsufficientOutput');
      expect(decoded.category).toBe('executor');
      expect(decoded.reason).toContain('insufficient output');
    });

    it('should decode UserNotLiquidatable error (0x3b1e7d68)', () => {
      const revertData = '0x3b1e7d68';
      const decoded = ExecutorRevertDecoder.decode(revertData);
      
      expect(decoded.selector).toBe('0x3b1e7d68');
      expect(decoded.name).toBe('UserNotLiquidatable');
      expect(decoded.category).toBe('aave');
    });

    it('should decode ContractPaused error (0xab35696f)', () => {
      const revertData = '0xab35696f';
      const decoded = ExecutorRevertDecoder.decode(revertData);
      
      expect(decoded.selector).toBe('0xab35696f');
      expect(decoded.name).toBe('ContractPaused');
      expect(decoded.category).toBe('executor');
    });

    it('should decode InsufficientLiquidity error (0x7939f424)', () => {
      const revertData = '0x7939f424';
      const decoded = ExecutorRevertDecoder.decode(revertData);
      
      expect(decoded.selector).toBe('0x7939f424');
      expect(decoded.name).toBe('InsufficientLiquidity');
      expect(decoded.category).toBe('common');
    });

    it('should handle unknown error selector', () => {
      const revertData = '0xdeadbeef';
      const decoded = ExecutorRevertDecoder.decode(revertData);
      
      expect(decoded.selector).toBe('0xdeadbeef');
      expect(decoded.name).toBe('UnknownError');
      expect(decoded.category).toBe('unknown');
    });

    it('should normalize selector to lowercase', () => {
      const revertData = '0xB629B0E4'; // Uppercase
      const decoded = ExecutorRevertDecoder.decode(revertData);
      
      expect(decoded.selector).toBe('0xb629b0e4');
      expect(decoded.name).toBe('InsufficientOutput');
    });

    it('should handle selector without 0x prefix', () => {
      const revertData = 'b629b0e4';
      const decoded = ExecutorRevertDecoder.decode(revertData);
      
      expect(decoded.selector).toBe('0xb629b0e4');
      expect(decoded.name).toBe('InsufficientOutput');
    });
  });

  describe('isInsufficientOutput', () => {
    it('should identify InsufficientOutput error', () => {
      expect(ExecutorRevertDecoder.isInsufficientOutput('0xb629b0e4')).toBe(true);
    });

    it('should identify TooLittleReceived error', () => {
      expect(ExecutorRevertDecoder.isInsufficientOutput('0xf1b8a1fe')).toBe(true);
    });

    it('should identify SlippageExceeded error', () => {
      expect(ExecutorRevertDecoder.isInsufficientOutput('0x435e0715')).toBe(true);
    });

    it('should return false for unrelated errors', () => {
      expect(ExecutorRevertDecoder.isInsufficientOutput('0xab35696f')).toBe(false); // ContractPaused
    });
  });

  describe('isNotLiquidatable', () => {
    it('should identify UserNotLiquidatable error', () => {
      expect(ExecutorRevertDecoder.isNotLiquidatable('0x3b1e7d68')).toBe(true);
    });

    it('should identify HealthFactorNotBelowThreshold error', () => {
      expect(ExecutorRevertDecoder.isNotLiquidatable('0x89a5a3c4')).toBe(true);
    });

    it('should return false for unrelated errors', () => {
      expect(ExecutorRevertDecoder.isNotLiquidatable('0xb629b0e4')).toBe(false); // InsufficientOutput
    });
  });

  describe('getShortReason', () => {
    it('should return short code for InsufficientOutput', () => {
      const shortReason = ExecutorRevertDecoder.getShortReason('0xb629b0e4');
      expect(shortReason).toBe('dust_too_small');
    });

    it('should return short code for UserNotLiquidatable', () => {
      const shortReason = ExecutorRevertDecoder.getShortReason('0x3b1e7d68');
      expect(shortReason).toBe('user_not_liquidatable');
    });

    it('should return short code for ContractPaused', () => {
      const shortReason = ExecutorRevertDecoder.getShortReason('0xab35696f');
      expect(shortReason).toBe('executor_paused');
    });

    it('should return short code for InsufficientLiquidity', () => {
      const shortReason = ExecutorRevertDecoder.getShortReason('0x7939f424');
      expect(shortReason).toBe('no_liquidity');
    });

    it('should handle unknown errors', () => {
      const shortReason = ExecutorRevertDecoder.getShortReason('0xdeadbeef');
      expect(shortReason).toBe('unknownerror');
    });
  });

  describe('isError', () => {
    it('should match specific error by name', () => {
      expect(ExecutorRevertDecoder.isError('0xb629b0e4', 'InsufficientOutput')).toBe(true);
      expect(ExecutorRevertDecoder.isError('0xb629b0e4', 'ContractPaused')).toBe(false);
    });
  });
});
