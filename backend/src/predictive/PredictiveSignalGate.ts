/**
 * PredictiveSignalGate: Gates predictive HF evaluation behind validated price signals
 * 
 * Prevents predictive from running on every block, only triggering when:
 * - Pyth price signal fires with TWAP sanity check
 * - Chainlink NewTransmission event fires on price feed
 * - Per-asset debounce windows are respected
 * 
 * This dramatically reduces RPC spend by eliminating speculative evaluations.
 */

import { config } from '../config/index.js';
import {
  predictiveSignalsTotal,
  predictiveSignalsDebounced
} from '../metrics/index.js';

export type SignalSource = 'pyth' | 'chainlink' | 'twap';

export interface PriceSignal {
  source: SignalSource;
  symbol: string;
  price: number;
  timestamp: number;
  blockNumber?: number;
  delta?: number; // Price delta that triggered signal (for Pyth/Chainlink)
  metadata?: Record<string, any>;
}

export interface SignalGateConfig {
  pythEnabled: boolean;
  twapEnabled: boolean;
  priceTriggerEnabled: boolean;
  pythDeltaPct: number; // Minimum delta to trigger (e.g., 0.01 = 1%)
  twapDeltaPct: number; // Maximum TWAP deviation allowed
  debounceByAsset: Map<string, number>; // Asset -> debounce seconds
  defaultDebounceSec: number;
}

/**
 * PredictiveSignalGate manages signal-based triggering for predictive evaluation
 */
export class PredictiveSignalGate {
  private readonly config: SignalGateConfig;
  private readonly lastSignalTime: Map<string, number> = new Map();
  private readonly lastPriceByAsset: Map<string, number> = new Map();
  
  constructor(configOverride?: Partial<SignalGateConfig>) {
    this.config = {
      pythEnabled: configOverride?.pythEnabled ?? config.pythEnabled,
      twapEnabled: configOverride?.twapEnabled ?? config.twapEnabled,
      priceTriggerEnabled: configOverride?.priceTriggerEnabled ?? config.priceTriggerEnabled,
      pythDeltaPct: configOverride?.pythDeltaPct ?? 0.01, // Default 1%
      twapDeltaPct: configOverride?.twapDeltaPct ?? config.twapDeltaPct,
      debounceByAsset: configOverride?.debounceByAsset ?? this.parseDebounceConfig(),
      defaultDebounceSec: configOverride?.defaultDebounceSec ?? config.priceTriggerDebounceSec
    };

    console.log(
      `[predictive-signal-gate] Initialized: ` +
      `pyth=${this.config.pythEnabled}, ` +
      `twap=${this.config.twapEnabled}, ` +
      `priceTrigger=${this.config.priceTriggerEnabled}, ` +
      `pythDelta=${this.config.pythDeltaPct * 100}%, ` +
      `twapDelta=${this.config.twapDeltaPct * 100}%`
    );
  }

  /**
   * Parse per-asset debounce configuration from environment
   */
  private parseDebounceConfig(): Map<string, number> {
    const debounceMap = new Map<string, number>();
    const debounceByAsset = config.priceTriggerDebounceByAsset;
    
    if (debounceByAsset && typeof debounceByAsset === 'string') {
      const pairs = debounceByAsset.split(',');
      for (const pair of pairs) {
        const [symbol, seconds] = pair.split(':');
        if (symbol && seconds) {
          debounceMap.set(symbol.trim().toUpperCase(), parseInt(seconds.trim(), 10));
        }
      }
    }
    
    return debounceMap;
  }

  /**
   * Check if signal should trigger predictive evaluation
   * Returns true if signal is valid and debounce window has passed
   */
  public shouldTrigger(signal: PriceSignal): boolean {
    const { symbol, source, timestamp } = signal;
    const key = `${symbol}:${source}`;
    
    // Check if source is enabled
    if (source === 'pyth' && !this.config.pythEnabled) {
      return false;
    }
    if (source === 'chainlink' && !this.config.priceTriggerEnabled) {
      return false;
    }
    if (source === 'twap' && !this.config.twapEnabled) {
      return false;
    }

    // Check debounce window
    const lastTime = this.lastSignalTime.get(key);
    const debounceSec = this.config.debounceByAsset.get(symbol) ?? this.config.defaultDebounceSec;
    
    if (lastTime && (timestamp - lastTime) < debounceSec) {
      predictiveSignalsDebounced.inc({ source, symbol });
      return false;
    }

    // Update last signal time
    this.lastSignalTime.set(key, timestamp);
    predictiveSignalsTotal.inc({ source, symbol });
    
    return true;
  }

  /**
   * Validate Pyth price signal with TWAP sanity check
   * Returns true if signal passes validation
   */
  public validatePythSignal(
    symbol: string,
    pythPrice: number,
    twapPrice: number | null,
    chainlinkPrice: number | null
  ): boolean {
    if (!this.config.pythEnabled) {
      return false;
    }

    // Store last price for delta calculation
    const lastPrice = this.lastPriceByAsset.get(symbol) ?? chainlinkPrice ?? pythPrice;
    this.lastPriceByAsset.set(symbol, pythPrice);

    // Check price delta threshold
    const delta = Math.abs(pythPrice - lastPrice) / lastPrice;
    if (delta < this.config.pythDeltaPct) {
      return false;
    }

    // TWAP sanity check (if TWAP enabled and available)
    if (this.config.twapEnabled && twapPrice !== null) {
      const twapDelta = Math.abs(pythPrice - twapPrice) / twapPrice;
      if (twapDelta > this.config.twapDeltaPct) {
        console.warn(
          `[predictive-signal-gate] TWAP sanity check failed for ${symbol}: ` +
          `pythPrice=${pythPrice}, twapPrice=${twapPrice}, delta=${(twapDelta * 100).toFixed(2)}%`
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Validate Chainlink transmission signal
   * Returns true if signal passes validation
   */
  public validateChainlinkSignal(
    symbol: string,
    newPrice: number,
    threshold?: number
  ): boolean {
    if (!this.config.priceTriggerEnabled) {
      return false;
    }

    // Check if price change meets threshold (if specified)
    if (threshold !== undefined) {
      const lastPrice = this.lastPriceByAsset.get(symbol);
      if (lastPrice) {
        const delta = Math.abs(newPrice - lastPrice) / lastPrice;
        if (delta < threshold) {
          return false;
        }
      }
    }

    this.lastPriceByAsset.set(symbol, newPrice);
    return true;
  }

  /**
   * Get debounce window for an asset
   */
  public getDebounceWindow(symbol: string): number {
    return this.config.debounceByAsset.get(symbol) ?? this.config.defaultDebounceSec;
  }

  /**
   * Check if any signal source is enabled
   */
  public isAnySourceEnabled(): boolean {
    return this.config.pythEnabled || this.config.priceTriggerEnabled;
  }
}
