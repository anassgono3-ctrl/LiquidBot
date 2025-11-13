// PerAssetTriggerConfig: Parse per-asset price trigger thresholds and debounce settings
// Merges global defaults with per-asset overrides from environment variables

import { config } from '../config/index.js';

export interface AssetTriggerSettings {
  dropBps: number;
  debounceSec: number;
}

/**
 * PerAssetTriggerConfig provides per-asset price trigger configuration
 * with fallback to global defaults.
 * 
 * Environment variables:
 * - PRICE_TRIGGER_BPS_BY_ASSET="WETH:8,WBTC:10,USDC:20"
 * - PRICE_TRIGGER_DEBOUNCE_BY_ASSET="WETH:3,WBTC:3,USDC:5"
 */
export class PerAssetTriggerConfig {
  private dropBpsByAsset: Map<string, number> = new Map();
  private debounceSecByAsset: Map<string, number> = new Map();
  private globalDropBps: number;
  private globalDebounceSec: number;

  constructor() {
    this.globalDropBps = config.priceTriggerDropBps;
    this.globalDebounceSec = config.priceTriggerDebounceSec;

    // Parse per-asset drop BPS
    if (config.priceTriggerBpsByAsset) {
      this.dropBpsByAsset = this.parseAssetMap(config.priceTriggerBpsByAsset);
    }

    // Parse per-asset debounce seconds
    if (config.priceTriggerDebounceByAsset) {
      this.debounceSecByAsset = this.parseAssetMap(config.priceTriggerDebounceByAsset);
    }
  }

  /**
   * Parse asset map from string format "ASSET1:value1,ASSET2:value2"
   */
  private parseAssetMap(mapStr: string): Map<string, number> {
    const result = new Map<string, number>();
    
    if (!mapStr || mapStr.trim() === '') {
      return result;
    }

    const entries = mapStr.split(',').map(e => e.trim()).filter(e => e.length > 0);
    
    for (const entry of entries) {
      const [asset, valueStr] = entry.split(':').map(s => s.trim());
      
      if (!asset || !valueStr) {
        // eslint-disable-next-line no-console
        console.warn(`[per-asset-trigger] Invalid entry format: "${entry}", skipping`);
        continue;
      }

      const value = parseFloat(valueStr);
      if (isNaN(value) || value < 0) {
        // eslint-disable-next-line no-console
        console.warn(`[per-asset-trigger] Invalid value for ${asset}: "${valueStr}", skipping`);
        continue;
      }

      // Normalize asset symbol to uppercase for consistency
      result.set(asset.toUpperCase(), value);
    }

    return result;
  }

  /**
   * Get price drop threshold in basis points for an asset
   * @param symbol Asset symbol (e.g., "WETH", "USDC")
   * @returns Drop threshold in basis points
   */
  getDropBps(symbol: string): number {
    const normalized = symbol.toUpperCase();
    return this.dropBpsByAsset.get(normalized) ?? this.globalDropBps;
  }

  /**
   * Get debounce time in seconds for an asset
   * @param symbol Asset symbol (e.g., "WETH", "USDC")
   * @returns Debounce time in seconds
   */
  getDebounceSec(symbol: string): number {
    const normalized = symbol.toUpperCase();
    return this.debounceSecByAsset.get(normalized) ?? this.globalDebounceSec;
  }

  /**
   * Get all configured settings for an asset
   */
  getSettings(symbol: string): AssetTriggerSettings {
    return {
      dropBps: this.getDropBps(symbol),
      debounceSec: this.getDebounceSec(symbol)
    };
  }

  /**
   * Get configured assets with custom settings
   */
  getConfiguredAssets(): string[] {
    const assets = new Set<string>();
    
    for (const asset of this.dropBpsByAsset.keys()) {
      assets.add(asset);
    }
    
    for (const asset of this.debounceSecByAsset.keys()) {
      assets.add(asset);
    }
    
    return Array.from(assets);
  }
}
