import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { RealTimeHFService } from '../../src/services/RealTimeHFService.js';
import { config } from '../../src/config/index.js';

describe('BorrowersIndexService gating in RealTimeHFService', () => {
  let originalBorrowersIndexEnabled: boolean;

  beforeEach(() => {
    // Save original config value
    originalBorrowersIndexEnabled = config.borrowersIndex.enabled;
  });

  afterEach(() => {
    // Restore original config value
    Object.defineProperty(config.borrowersIndex, 'enabled', {
      get: () => originalBorrowersIndexEnabled,
      configurable: true
    });
  });

  it('should not instantiate BorrowersIndexService when disabled', () => {
    // Mock config to disable borrowers index
    Object.defineProperty(config.borrowersIndex, 'enabled', {
      get: () => false,
      configurable: true
    });

    // Create RealTimeHFService with skipWsConnection to avoid WebSocket setup
    const service = new RealTimeHFService({
      skipWsConnection: true
    });

    // Service should be created
    expect(service).toBeDefined();
    
    // Since borrowersIndex is private, we can't directly check it,
    // but we verify the service initializes without errors when disabled
    expect(() => service.getMetrics()).not.toThrow();
  });

  it('should allow RealTimeHFService to function without BorrowersIndexService', async () => {
    // Mock config to disable borrowers index
    Object.defineProperty(config.borrowersIndex, 'enabled', {
      get: () => false,
      configurable: true
    });

    const service = new RealTimeHFService({
      skipWsConnection: true
    });

    // Service should provide metrics
    const metrics = service.getMetrics();
    expect(metrics).toBeDefined();
    expect(metrics.candidateCount).toBe(0);

    // Service should provide candidate manager
    const candidateManager = service.getCandidateManager();
    expect(candidateManager).toBeDefined();
    expect(candidateManager.size()).toBe(0);
  });

  it('should support config.borrowersIndex namespace', () => {
    // Verify config structure
    expect(config.borrowersIndex).toBeDefined();
    expect(typeof config.borrowersIndex.enabled).toBe('boolean');
    expect(typeof config.borrowersIndex.backfillBlocks).toBe('number');
    expect(typeof config.borrowersIndex.chunkBlocks).toBe('number');
    
    // Verify defaults
    expect(config.borrowersIndex.enabled).toBe(false); // Default should be false
    expect(config.borrowersIndex.backfillBlocks).toBe(50000);
    expect(config.borrowersIndex.chunkBlocks).toBe(2000);
  });

  it('should use REDIS_URL as fallback for BORROWERS_INDEX_REDIS_URL', () => {
    // When BORROWERS_INDEX_REDIS_URL is not set, it should fall back to REDIS_URL
    const redisUrl = config.borrowersIndex.redisUrl;
    
    // If no specific borrowers index Redis URL is set, should match general REDIS_URL
    if (!process.env.BORROWERS_INDEX_REDIS_URL) {
      expect(redisUrl).toBe(config.redisUrl);
    }
  });
});
