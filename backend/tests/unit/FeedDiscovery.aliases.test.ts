import { describe, it, expect } from 'vitest';

import { FeedDiscoveryService } from '../../src/services/FeedDiscoveryService.js';

describe('FeedDiscoveryService - Aliases and Derived Feeds', () => {
  describe('parseAliases', () => {
    it('should parse alias configuration correctly', () => {
      const config = 'USDbC:USDC,Token1:Token2';
      const aliases = FeedDiscoveryService.parseAliases(config);
      
      expect(aliases.size).toBe(2);
      expect(aliases.get('USDBC')).toBe('USDC');
      expect(aliases.get('TOKEN1')).toBe('TOKEN2');
    });

    it('should handle empty config', () => {
      const aliases = FeedDiscoveryService.parseAliases('');
      expect(aliases.size).toBe(0);
    });

    it('should handle undefined config', () => {
      const aliases = FeedDiscoveryService.parseAliases(undefined);
      expect(aliases.size).toBe(0);
    });

    it('should normalize symbols to uppercase', () => {
      const config = 'usDbC:usdc';
      const aliases = FeedDiscoveryService.parseAliases(config);
      
      expect(aliases.get('USDBC')).toBe('USDC');
    });

    it('should skip malformed entries', () => {
      const config = 'USDbC:USDC,InvalidEntry,Token1:Token2';
      const aliases = FeedDiscoveryService.parseAliases(config);
      
      expect(aliases.size).toBe(2);
      expect(aliases.has('INVALIDENTRY')).toBe(false);
    });
  });

  describe('parseDerivedRatioFeeds', () => {
    it('should parse derived ratio feeds correctly', () => {
      const config = 'wstETH:WSTETH_ETH,weETH:WEETH_ETH';
      const derived = FeedDiscoveryService.parseDerivedRatioFeeds(config);
      
      expect(derived.size).toBe(2);
      expect(derived.get('WSTETH')).toBe('WSTETH_ETH');
      expect(derived.get('WEETH')).toBe('WEETH_ETH');
    });

    it('should handle empty config', () => {
      const derived = FeedDiscoveryService.parseDerivedRatioFeeds('');
      expect(derived.size).toBe(0);
    });

    it('should normalize symbols to uppercase', () => {
      const config = 'wsteth:wsteth_eth';
      const derived = FeedDiscoveryService.parseDerivedRatioFeeds(config);
      
      expect(derived.get('WSTETH')).toBe('WSTETH_ETH');
    });
  });

  describe('classifyFeed', () => {
    it('should classify alias feeds', () => {
      const aliases = new Map([['USDBC', 'USDC']]);
      const derived = new Map<string, string>();
      
      const result = FeedDiscoveryService.classifyFeed('USDbC', aliases, derived);
      
      expect(result.type).toBe('alias');
      expect(result.aliasTarget).toBe('USDC');
    });

    it('should classify derived ratio feeds', () => {
      const aliases = new Map<string, string>();
      const derived = new Map([['WSTETH', 'WSTETH_ETH']]);
      
      const result = FeedDiscoveryService.classifyFeed('wstETH', aliases, derived);
      
      expect(result.type).toBe('ratio');
      expect(result.ratioFeedKey).toBe('WSTETH_ETH');
    });

    it('should classify USD feeds as default', () => {
      const aliases = new Map<string, string>();
      const derived = new Map<string, string>();
      
      const result = FeedDiscoveryService.classifyFeed('WETH', aliases, derived);
      
      expect(result.type).toBe('usd');
      expect(result.aliasTarget).toBeUndefined();
      expect(result.ratioFeedKey).toBeUndefined();
    });

    it('should prioritize alias over derived', () => {
      const aliases = new Map([['WSTETH', 'STETH']]);
      const derived = new Map([['WSTETH', 'WSTETH_ETH']]);
      
      const result = FeedDiscoveryService.classifyFeed('WSTETH', aliases, derived);
      
      expect(result.type).toBe('alias');
      expect(result.aliasTarget).toBe('STETH');
    });
  });
});
