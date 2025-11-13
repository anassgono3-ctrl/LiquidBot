// Unit tests for PerAssetTriggerConfig
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { PerAssetTriggerConfig } from '../../src/services/PerAssetTriggerConfig.js';
import { config } from '../../src/config/index.js';

describe('PerAssetTriggerConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parsing', () => {
    it('should parse per-asset drop BPS correctly', () => {
      // Mock config
      vi.spyOn(config, 'priceTriggerDropBps', 'get').mockReturnValue(30);
      vi.spyOn(config, 'priceTriggerDebounceSec', 'get').mockReturnValue(60);
      vi.spyOn(config, 'priceTriggerBpsByAsset', 'get').mockReturnValue('WETH:8,WBTC:10,USDC:20');
      vi.spyOn(config, 'priceTriggerDebounceByAsset', 'get').mockReturnValue(undefined);

      const cfg = new PerAssetTriggerConfig();

      expect(cfg.getDropBps('WETH')).toBe(8);
      expect(cfg.getDropBps('WBTC')).toBe(10);
      expect(cfg.getDropBps('USDC')).toBe(20);
    });

    it('should parse per-asset debounce seconds correctly', () => {
      vi.spyOn(config, 'priceTriggerDropBps', 'get').mockReturnValue(30);
      vi.spyOn(config, 'priceTriggerDebounceSec', 'get').mockReturnValue(60);
      vi.spyOn(config, 'priceTriggerBpsByAsset', 'get').mockReturnValue(undefined);
      vi.spyOn(config, 'priceTriggerDebounceByAsset', 'get').mockReturnValue('WETH:3,WBTC:3,USDC:5');

      const cfg = new PerAssetTriggerConfig();

      expect(cfg.getDebounceSec('WETH')).toBe(3);
      expect(cfg.getDebounceSec('WBTC')).toBe(3);
      expect(cfg.getDebounceSec('USDC')).toBe(5);
    });

    it('should handle empty/undefined config strings', () => {
      vi.spyOn(config, 'priceTriggerDropBps', 'get').mockReturnValue(30);
      vi.spyOn(config, 'priceTriggerDebounceSec', 'get').mockReturnValue(60);
      vi.spyOn(config, 'priceTriggerBpsByAsset', 'get').mockReturnValue(undefined);
      vi.spyOn(config, 'priceTriggerDebounceByAsset', 'get').mockReturnValue(undefined);

      const cfg = new PerAssetTriggerConfig();

      // Should return global defaults
      expect(cfg.getDropBps('WETH')).toBe(30);
      expect(cfg.getDebounceSec('WETH')).toBe(60);
    });

    it('should handle malformed entries gracefully', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      vi.spyOn(config, 'priceTriggerDropBps', 'get').mockReturnValue(30);
      vi.spyOn(config, 'priceTriggerDebounceSec', 'get').mockReturnValue(60);
      vi.spyOn(config, 'priceTriggerBpsByAsset', 'get').mockReturnValue('WETH:8,INVALID,USDC:invalid,BTC:15');
      vi.spyOn(config, 'priceTriggerDebounceByAsset', 'get').mockReturnValue(undefined);

      const cfg = new PerAssetTriggerConfig();

      // Valid entries should work
      expect(cfg.getDropBps('WETH')).toBe(8);
      expect(cfg.getDropBps('BTC')).toBe(15);
      
      // Invalid entries should use global default
      expect(cfg.getDropBps('INVALID')).toBe(30);
      expect(cfg.getDropBps('USDC')).toBe(30);
      
      // Should have logged warnings
      expect(consoleWarnSpy).toHaveBeenCalled();
      
      consoleWarnSpy.mockRestore();
    });
  });

  describe('fallback to global defaults', () => {
    it('should return global drop BPS for unconfigured assets', () => {
      vi.spyOn(config, 'priceTriggerDropBps', 'get').mockReturnValue(30);
      vi.spyOn(config, 'priceTriggerDebounceSec', 'get').mockReturnValue(60);
      vi.spyOn(config, 'priceTriggerBpsByAsset', 'get').mockReturnValue('WETH:8');
      vi.spyOn(config, 'priceTriggerDebounceByAsset', 'get').mockReturnValue(undefined);

      const cfg = new PerAssetTriggerConfig();

      expect(cfg.getDropBps('WETH')).toBe(8);
      expect(cfg.getDropBps('UNKNOWN')).toBe(30); // global default
    });

    it('should return global debounce for unconfigured assets', () => {
      vi.spyOn(config, 'priceTriggerDropBps', 'get').mockReturnValue(30);
      vi.spyOn(config, 'priceTriggerDebounceSec', 'get').mockReturnValue(60);
      vi.spyOn(config, 'priceTriggerBpsByAsset', 'get').mockReturnValue(undefined);
      vi.spyOn(config, 'priceTriggerDebounceByAsset', 'get').mockReturnValue('WETH:3');

      const cfg = new PerAssetTriggerConfig();

      expect(cfg.getDebounceSec('WETH')).toBe(3);
      expect(cfg.getDebounceSec('UNKNOWN')).toBe(60); // global default
    });
  });

  describe('case insensitivity', () => {
    it('should normalize asset symbols to uppercase', () => {
      vi.spyOn(config, 'priceTriggerDropBps', 'get').mockReturnValue(30);
      vi.spyOn(config, 'priceTriggerDebounceSec', 'get').mockReturnValue(60);
      vi.spyOn(config, 'priceTriggerBpsByAsset', 'get').mockReturnValue('weth:8,WBTC:10');
      vi.spyOn(config, 'priceTriggerDebounceByAsset', 'get').mockReturnValue(undefined);

      const cfg = new PerAssetTriggerConfig();

      // Should work with any casing
      expect(cfg.getDropBps('WETH')).toBe(8);
      expect(cfg.getDropBps('weth')).toBe(8);
      expect(cfg.getDropBps('Weth')).toBe(8);
      expect(cfg.getDropBps('WBTC')).toBe(10);
      expect(cfg.getDropBps('wbtc')).toBe(10);
    });
  });

  describe('getSettings', () => {
    it('should return combined settings for an asset', () => {
      vi.spyOn(config, 'priceTriggerDropBps', 'get').mockReturnValue(30);
      vi.spyOn(config, 'priceTriggerDebounceSec', 'get').mockReturnValue(60);
      vi.spyOn(config, 'priceTriggerBpsByAsset', 'get').mockReturnValue('WETH:8');
      vi.spyOn(config, 'priceTriggerDebounceByAsset', 'get').mockReturnValue('WETH:3');

      const cfg = new PerAssetTriggerConfig();

      const settings = cfg.getSettings('WETH');
      expect(settings.dropBps).toBe(8);
      expect(settings.debounceSec).toBe(3);
    });

    it('should return global defaults for unconfigured asset', () => {
      vi.spyOn(config, 'priceTriggerDropBps', 'get').mockReturnValue(30);
      vi.spyOn(config, 'priceTriggerDebounceSec', 'get').mockReturnValue(60);
      vi.spyOn(config, 'priceTriggerBpsByAsset', 'get').mockReturnValue(undefined);
      vi.spyOn(config, 'priceTriggerDebounceByAsset', 'get').mockReturnValue(undefined);

      const cfg = new PerAssetTriggerConfig();

      const settings = cfg.getSettings('UNKNOWN');
      expect(settings.dropBps).toBe(30);
      expect(settings.debounceSec).toBe(60);
    });
  });

  describe('getConfiguredAssets', () => {
    it('should return list of assets with custom settings', () => {
      vi.spyOn(config, 'priceTriggerDropBps', 'get').mockReturnValue(30);
      vi.spyOn(config, 'priceTriggerDebounceSec', 'get').mockReturnValue(60);
      vi.spyOn(config, 'priceTriggerBpsByAsset', 'get').mockReturnValue('WETH:8,USDC:20');
      vi.spyOn(config, 'priceTriggerDebounceByAsset', 'get').mockReturnValue('WBTC:3');

      const cfg = new PerAssetTriggerConfig();

      const configured = cfg.getConfiguredAssets();
      expect(configured).toContain('WETH');
      expect(configured).toContain('USDC');
      expect(configured).toContain('WBTC');
      expect(configured.length).toBe(3);
    });

    it('should return empty array when no custom settings', () => {
      vi.spyOn(config, 'priceTriggerDropBps', 'get').mockReturnValue(30);
      vi.spyOn(config, 'priceTriggerDebounceSec', 'get').mockReturnValue(60);
      vi.spyOn(config, 'priceTriggerBpsByAsset', 'get').mockReturnValue(undefined);
      vi.spyOn(config, 'priceTriggerDebounceByAsset', 'get').mockReturnValue(undefined);

      const cfg = new PerAssetTriggerConfig();

      const configured = cfg.getConfiguredAssets();
      expect(configured.length).toBe(0);
    });
  });
});
