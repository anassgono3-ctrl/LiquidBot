/**
 * Unit tests for PredictiveSignalGate
 * Tests signal validation, near-band gating, and asset whitelisting
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PredictiveSignalGate,
  type UserSignalContext,
  type PythSignal,
  type TwapSignal,
  type ChainlinkSignal
} from '../../../src/services/predictive/PredictiveSignalGate.js';

describe('PredictiveSignalGate', () => {
  let gate: PredictiveSignalGate;

  beforeEach(() => {
    gate = new PredictiveSignalGate({
      mode: 'pyth_twap_or_chainlink',
      pythDeltaPct: 0.5,
      twapDeltaPct: 0.012,
      nearBandBps: 15,
      etaCapSec: 45,
      minDebtUsd: 100,
      assets: []
    });
  });

  describe('Debt gating', () => {
    it('should reject user with debt below minimum', () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.001,
        debtUsd: 50
      };

      const result = gate.shouldActivatePredictive(user);
      expect(result.shouldActivate).toBe(false);
      expect(result.reason).toContain('debt_too_low');
    });

    it('should accept user with debt above minimum', () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.001,
        debtUsd: 150
      };

      // Need valid signal for full activation
      gate.recordPythSignal({ asset: 'WETH', deltaPct: 0.6, timestamp: Date.now() });
      gate.recordTwapSignal({ asset: 'WETH', deltaPct: 0.015, timestamp: Date.now() });

      const result = gate.shouldActivatePredictive(user, 'WETH');
      expect(result.shouldActivate).toBe(true);
    });
  });

  describe('Near-band gating', () => {
    it('should accept user in near-band (HF between 1.0 and 1.0015)', () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.001,
        debtUsd: 150
      };

      gate.recordPythSignal({ asset: 'WETH', deltaPct: 0.6, timestamp: Date.now() });
      gate.recordTwapSignal({ asset: 'WETH', deltaPct: 0.015, timestamp: Date.now() });

      const result = gate.shouldActivatePredictive(user, 'WETH');
      expect(result.shouldActivate).toBe(true);
    });

    it('should reject user far above near-band threshold', () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.05, // Far above 1.0015
        debtUsd: 150
      };

      gate.recordPythSignal({ asset: 'WETH', deltaPct: 0.6, timestamp: Date.now() });
      gate.recordTwapSignal({ asset: 'WETH', deltaPct: 0.015, timestamp: Date.now() });

      const result = gate.shouldActivatePredictive(user, 'WETH');
      expect(result.shouldActivate).toBe(false);
      expect(result.reason).toContain('hf_not_near_band');
    });

    it('should accept user with projected HF in near-band and short ETA', () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.05,
        hfProjected: 1.001,
        etaSec: 30,
        debtUsd: 150
      };

      gate.recordPythSignal({ asset: 'WETH', deltaPct: 0.6, timestamp: Date.now() });
      gate.recordTwapSignal({ asset: 'WETH', deltaPct: 0.015, timestamp: Date.now() });

      const result = gate.shouldActivatePredictive(user, 'WETH');
      expect(result.shouldActivate).toBe(true);
    });

    it('should reject user with projected HF in near-band but ETA exceeds cap', () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.05,
        hfProjected: 1.001,
        etaSec: 60, // Exceeds 45s cap
        debtUsd: 150
      };

      gate.recordPythSignal({ asset: 'WETH', deltaPct: 0.6, timestamp: Date.now() });
      gate.recordTwapSignal({ asset: 'WETH', deltaPct: 0.015, timestamp: Date.now() });

      const result = gate.shouldActivatePredictive(user, 'WETH');
      expect(result.shouldActivate).toBe(false);
      expect(result.reason).toContain('hf_not_near_band');
    });
  });

  describe('Asset whitelisting', () => {
    beforeEach(() => {
      gate = new PredictiveSignalGate({
        mode: 'pyth_twap_or_chainlink',
        pythDeltaPct: 0.5,
        twapDeltaPct: 0.012,
        nearBandBps: 15,
        etaCapSec: 45,
        minDebtUsd: 100,
        assets: ['WETH', 'WBTC']
      });
    });

    it('should accept whitelisted asset', () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.001,
        debtUsd: 150
      };

      gate.recordPythSignal({ asset: 'WETH', deltaPct: 0.6, timestamp: Date.now() });
      gate.recordTwapSignal({ asset: 'WETH', deltaPct: 0.015, timestamp: Date.now() });

      const result = gate.shouldActivatePredictive(user, 'WETH');
      expect(result.shouldActivate).toBe(true);
    });

    it('should reject non-whitelisted asset', () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.001,
        debtUsd: 150
      };

      gate.recordPythSignal({ asset: 'USDC', deltaPct: 0.6, timestamp: Date.now() });
      gate.recordTwapSignal({ asset: 'USDC', deltaPct: 0.015, timestamp: Date.now() });

      const result = gate.shouldActivatePredictive(user, 'USDC');
      expect(result.shouldActivate).toBe(false);
      expect(result.reason).toContain('asset_not_whitelisted');
    });
  });

  describe('Signal validation - pyth_twap mode', () => {
    beforeEach(() => {
      gate = new PredictiveSignalGate({
        mode: 'pyth_twap',
        pythDeltaPct: 0.5,
        twapDeltaPct: 0.012,
        nearBandBps: 15,
        etaCapSec: 45,
        minDebtUsd: 100,
        assets: []
      });
    });

    it('should activate with valid Pyth and TWAP signals', () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.001,
        debtUsd: 150
      };

      gate.recordPythSignal({ asset: 'WETH', deltaPct: 0.6, timestamp: Date.now() });
      gate.recordTwapSignal({ asset: 'WETH', deltaPct: 0.015, timestamp: Date.now() });

      const result = gate.shouldActivatePredictive(user, 'WETH');
      expect(result.shouldActivate).toBe(true);
      expect(result.source).toBe('pyth_twap');
    });

    it('should reject with only Pyth signal (TWAP missing)', () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.001,
        debtUsd: 150
      };

      gate.recordPythSignal({ asset: 'WETH', deltaPct: 0.6, timestamp: Date.now() });

      const result = gate.shouldActivatePredictive(user, 'WETH');
      expect(result.shouldActivate).toBe(false);
      expect(result.reason).toContain('signal_invalid');
    });

    it('should reject with insufficient Pyth delta', () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.001,
        debtUsd: 150
      };

      gate.recordPythSignal({ asset: 'WETH', deltaPct: 0.3, timestamp: Date.now() }); // Below 0.5%
      gate.recordTwapSignal({ asset: 'WETH', deltaPct: 0.015, timestamp: Date.now() });

      const result = gate.shouldActivatePredictive(user, 'WETH');
      expect(result.shouldActivate).toBe(false);
    });
  });

  describe('Signal validation - chainlink mode', () => {
    beforeEach(() => {
      gate = new PredictiveSignalGate({
        mode: 'chainlink',
        pythDeltaPct: 0.5,
        twapDeltaPct: 0.012,
        nearBandBps: 15,
        etaCapSec: 45,
        minDebtUsd: 100,
        assets: []
      });
    });

    it('should activate with valid Chainlink signal', () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.001,
        debtUsd: 150
      };

      gate.recordChainlinkSignal({ asset: 'WETH', deltaBps: 100, timestamp: Date.now() });

      const result = gate.shouldActivatePredictive(user, 'WETH');
      expect(result.shouldActivate).toBe(true);
      expect(result.source).toBe('chainlink');
    });

    it('should reject without Chainlink signal', () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.001,
        debtUsd: 150
      };

      // No signal recorded

      const result = gate.shouldActivatePredictive(user, 'WETH');
      expect(result.shouldActivate).toBe(false);
      expect(result.reason).toContain('signal_invalid');
    });
  });

  describe('Signal validation - pyth_twap_or_chainlink mode', () => {
    beforeEach(() => {
      gate = new PredictiveSignalGate({
        mode: 'pyth_twap_or_chainlink',
        pythDeltaPct: 0.5,
        twapDeltaPct: 0.012,
        nearBandBps: 15,
        etaCapSec: 45,
        minDebtUsd: 100,
        assets: []
      });
    });

    it('should activate with only Pyth+TWAP signals', () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.001,
        debtUsd: 150
      };

      gate.recordPythSignal({ asset: 'WETH', deltaPct: 0.6, timestamp: Date.now() });
      gate.recordTwapSignal({ asset: 'WETH', deltaPct: 0.015, timestamp: Date.now() });

      const result = gate.shouldActivatePredictive(user, 'WETH');
      expect(result.shouldActivate).toBe(true);
      expect(result.source).toBe('pyth_twap');
    });

    it('should activate with only Chainlink signal', () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.001,
        debtUsd: 150
      };

      gate.recordChainlinkSignal({ asset: 'WETH', deltaBps: 100, timestamp: Date.now() });

      const result = gate.shouldActivatePredictive(user, 'WETH');
      expect(result.shouldActivate).toBe(true);
      expect(result.source).toBe('chainlink');
    });

    it('should reject without any valid signals', () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.001,
        debtUsd: 150
      };

      const result = gate.shouldActivatePredictive(user, 'WETH');
      expect(result.shouldActivate).toBe(false);
      expect(result.reason).toContain('signal_invalid');
    });
  });

  describe('Signal expiry', () => {
    it('should ignore expired signals', async () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.001,
        debtUsd: 150
      };

      // Record signal with old timestamp (70 seconds ago, beyond 60s expiry)
      const oldTimestamp = Date.now() - 70000;
      gate.recordPythSignal({ asset: 'WETH', deltaPct: 0.6, timestamp: oldTimestamp });
      gate.recordTwapSignal({ asset: 'WETH', deltaPct: 0.015, timestamp: oldTimestamp });

      const result = gate.shouldActivatePredictive(user, 'WETH');
      expect(result.shouldActivate).toBe(false);
    });

    it('should use fresh signals', () => {
      const user: UserSignalContext = {
        address: '0x123',
        hfCurrent: 1.001,
        debtUsd: 150
      };

      // Record fresh signals
      gate.recordPythSignal({ asset: 'WETH', deltaPct: 0.6, timestamp: Date.now() });
      gate.recordTwapSignal({ asset: 'WETH', deltaPct: 0.015, timestamp: Date.now() });

      const result = gate.shouldActivatePredictive(user, 'WETH');
      expect(result.shouldActivate).toBe(true);
    });
  });
});
