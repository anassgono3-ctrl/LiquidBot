/**
 * PredictiveSignalGate: Strict gating for predictive activation
 * 
 * Purpose: Ensure predictive engine only activates on valid early-warning signals
 * - Pyth price delta exceeds threshold AND TWAP agrees
 * - OR Chainlink NewTransmission delta exceeds threshold
 * - AND user is in near-band or predicted to cross within ETA cap
 * 
 * This prevents predictive from running on every block/event and reduces RPC costs
 */

import { config } from '../../config/index.js';

export type PredictiveSignalMode = 'pyth_twap' | 'chainlink' | 'both' | 'pyth_twap_or_chainlink';

export interface PythSignal {
  asset: string;
  deltaPct: number;
  timestamp: number;
}

export interface TwapSignal {
  asset: string;
  deltaPct: number;
  timestamp: number;
}

export interface ChainlinkSignal {
  asset: string;
  deltaBps: number;
  timestamp: number;
  txHash?: string;
}

export interface PredictiveSignalGateConfig {
  mode: PredictiveSignalMode;
  pythDeltaPct: number;
  twapDeltaPct: number;
  nearBandBps: number;
  etaCapSec: number;
  minDebtUsd: number;
  assets: string[]; // Whitelist of assets to trigger predictive (empty = all)
}

export interface UserSignalContext {
  address: string;
  hfCurrent: number;
  hfProjected?: number;
  etaSec?: number;
  debtUsd: number;
}

export interface SignalGateResult {
  shouldActivate: boolean;
  reason: string;
  source?: 'pyth_twap' | 'chainlink' | 'both';
  asset?: string;
}

/**
 * PredictiveSignalGate validates signals and gates predictive activation
 */
export class PredictiveSignalGate {
  private readonly config: PredictiveSignalGateConfig;
  
  // Recent signal tracking for deduplication
  private recentPythSignals: Map<string, PythSignal> = new Map();
  private recentTwapSignals: Map<string, TwapSignal> = new Map();
  private recentChainlinkSignals: Map<string, ChainlinkSignal> = new Map();
  
  // Signal expiry (signals older than this are ignored)
  private readonly signalExpiryMs = 60000; // 60 seconds

  constructor(configOverride?: Partial<PredictiveSignalGateConfig>) {
    this.config = {
      mode: (configOverride?.mode ?? config.predictiveSignalMode ?? 'pyth_twap_or_chainlink') as PredictiveSignalMode,
      pythDeltaPct: configOverride?.pythDeltaPct ?? config.pythDeltaPct ?? 0.5,
      twapDeltaPct: configOverride?.twapDeltaPct ?? config.twapDeltaPct ?? 0.012,
      nearBandBps: configOverride?.nearBandBps ?? config.predictiveNearBandBps ?? 15,
      etaCapSec: configOverride?.etaCapSec ?? config.fastpathPredictiveEtaCapSec ?? 45,
      minDebtUsd: configOverride?.minDebtUsd ?? config.predictiveMinDebtUsd ?? config.minDebtUsd ?? 1,
      assets: configOverride?.assets ?? config.predictiveAssets ?? []
    };

    console.log(
      `[predictive-signal-gate] Initialized: mode=${this.config.mode}, ` +
      `pythDelta=${this.config.pythDeltaPct}%, twapDelta=${(this.config.twapDeltaPct * 100).toFixed(2)}%, ` +
      `nearBand=${this.config.nearBandBps}bps, etaCap=${this.config.etaCapSec}s, ` +
      `minDebt=$${this.config.minDebtUsd}, assets=[${this.config.assets.join(',')}]`
    );
  }

  /**
   * Record a Pyth price signal
   */
  public recordPythSignal(signal: PythSignal): void {
    this.recentPythSignals.set(signal.asset, signal);
    this.cleanupExpiredSignals();
  }

  /**
   * Record a TWAP signal
   */
  public recordTwapSignal(signal: TwapSignal): void {
    this.recentTwapSignals.set(signal.asset, signal);
    this.cleanupExpiredSignals();
  }

  /**
   * Record a Chainlink transmission signal
   */
  public recordChainlinkSignal(signal: ChainlinkSignal): void {
    this.recentChainlinkSignals.set(signal.asset, signal);
    this.cleanupExpiredSignals();
  }

  /**
   * Check if predictive should activate for a user given current signals
   * @param user User context with HF, debt, ETA
   * @param asset Asset that triggered the check (e.g., from price event)
   * @returns Gate result indicating if predictive should run and why
   */
  public shouldActivatePredictive(user: UserSignalContext, asset?: string): SignalGateResult {
    // Gate 1: Minimum debt threshold
    if (user.debtUsd < this.config.minDebtUsd) {
      return {
        shouldActivate: false,
        reason: `debt_too_low: ${user.debtUsd.toFixed(2)} < ${this.config.minDebtUsd}`
      };
    }

    // Gate 2: Near-band check
    const nearBandThreshold = 1.0 + this.config.nearBandBps / 10000;
    const isInNearBand = user.hfCurrent >= 1.0 && user.hfCurrent <= nearBandThreshold;
    const isPredictedNearBand = user.hfProjected !== undefined && user.hfProjected <= nearBandThreshold;
    const isEtaWithinCap = user.etaSec !== undefined && user.etaSec <= this.config.etaCapSec;

    if (!isInNearBand && !(isPredictedNearBand && isEtaWithinCap)) {
      return {
        shouldActivate: false,
        reason: `hf_not_near_band: hfCurrent=${user.hfCurrent.toFixed(4)}, bounds=[1.0, ${nearBandThreshold.toFixed(4)}], ` +
          `hfProj=${user.hfProjected?.toFixed(4) ?? 'N/A'}, eta=${user.etaSec?.toFixed(0) ?? 'N/A'}s`
      };
    }

    // Gate 3: Asset whitelist (if configured)
    if (this.config.assets.length > 0 && asset) {
      const normalizedAsset = asset.toUpperCase();
      if (!this.config.assets.map(a => a.toUpperCase()).includes(normalizedAsset)) {
        return {
          shouldActivate: false,
          reason: `asset_not_whitelisted: ${asset} not in [${this.config.assets.join(',')}]`
        };
      }
    }

    // Gate 4: Signal validation based on mode
    const pythValid = this.isPythSignalValid(asset);
    const twapValid = this.isTwapSignalValid(asset);
    const chainlinkValid = this.isChainlinkSignalValid(asset);

    const pythTwapValid = pythValid && twapValid;

    switch (this.config.mode) {
      case 'pyth_twap':
        if (!pythTwapValid) {
          return {
            shouldActivate: false,
            reason: `signal_invalid: mode=pyth_twap, pyth=${pythValid}, twap=${twapValid}`
          };
        }
        return {
          shouldActivate: true,
          reason: 'pyth_twap_signal_valid',
          source: 'pyth_twap',
          asset
        };

      case 'chainlink':
        if (!chainlinkValid) {
          return {
            shouldActivate: false,
            reason: `signal_invalid: mode=chainlink, chainlink=${chainlinkValid}`
          };
        }
        return {
          shouldActivate: true,
          reason: 'chainlink_signal_valid',
          source: 'chainlink',
          asset
        };

      case 'both':
        if (!pythTwapValid || !chainlinkValid) {
          return {
            shouldActivate: false,
            reason: `signal_invalid: mode=both, pyth_twap=${pythTwapValid}, chainlink=${chainlinkValid}`
          };
        }
        return {
          shouldActivate: true,
          reason: 'pyth_twap_and_chainlink_valid',
          source: 'both',
          asset
        };

      case 'pyth_twap_or_chainlink':
      default:
        if (!pythTwapValid && !chainlinkValid) {
          return {
            shouldActivate: false,
            reason: `signal_invalid: mode=or, pyth_twap=${pythTwapValid}, chainlink=${chainlinkValid}`
          };
        }
        const source = pythTwapValid && chainlinkValid ? 'both' : pythTwapValid ? 'pyth_twap' : 'chainlink';
        return {
          shouldActivate: true,
          reason: 'signal_valid',
          source,
          asset
        };
    }
  }

  /**
   * Check if there's a valid Pyth signal for an asset
   */
  private isPythSignalValid(asset?: string): boolean {
    if (!asset) {
      // If no asset specified, check if any valid Pyth signal exists
      return Array.from(this.recentPythSignals.values()).some(
        signal => Math.abs(signal.deltaPct) >= this.config.pythDeltaPct
      );
    }
    
    const signal = this.recentPythSignals.get(asset);
    if (!signal) return false;
    
    return Math.abs(signal.deltaPct) >= this.config.pythDeltaPct;
  }

  /**
   * Check if there's a valid TWAP signal for an asset
   */
  private isTwapSignalValid(asset?: string): boolean {
    if (!asset) {
      // If no asset specified, check if any valid TWAP signal exists
      return Array.from(this.recentTwapSignals.values()).some(
        signal => Math.abs(signal.deltaPct) >= this.config.twapDeltaPct
      );
    }
    
    const signal = this.recentTwapSignals.get(asset);
    if (!signal) return false;
    
    return Math.abs(signal.deltaPct) >= this.config.twapDeltaPct;
  }

  /**
   * Check if there's a valid Chainlink signal for an asset
   */
  private isChainlinkSignalValid(asset?: string): boolean {
    if (!asset) {
      // If no asset specified, check if any valid Chainlink signal exists
      return this.recentChainlinkSignals.size > 0;
    }
    
    const signal = this.recentChainlinkSignals.get(asset);
    return signal !== undefined;
  }

  /**
   * Clean up expired signals
   */
  private cleanupExpiredSignals(): void {
    const now = Date.now();
    
    // Clean Pyth signals
    for (const [asset, signal] of this.recentPythSignals.entries()) {
      if (now - signal.timestamp > this.signalExpiryMs) {
        this.recentPythSignals.delete(asset);
      }
    }
    
    // Clean TWAP signals
    for (const [asset, signal] of this.recentTwapSignals.entries()) {
      if (now - signal.timestamp > this.signalExpiryMs) {
        this.recentTwapSignals.delete(asset);
      }
    }
    
    // Clean Chainlink signals
    for (const [asset, signal] of this.recentChainlinkSignals.entries()) {
      if (now - signal.timestamp > this.signalExpiryMs) {
        this.recentChainlinkSignals.delete(asset);
      }
    }
  }

  /**
   * Get current configuration
   */
  public getConfig(): PredictiveSignalGateConfig {
    return { ...this.config };
  }

  /**
   * Clear all recent signals (for testing)
   */
  public clearSignals(): void {
    this.recentPythSignals.clear();
    this.recentTwapSignals.clear();
    this.recentChainlinkSignals.clear();
  }
}
