/**
 * Unit tests for StartupDiagnosticsService
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { StartupDiagnosticsService } from '../../src/services/StartupDiagnostics.js';

describe('StartupDiagnosticsService', () => {
  let service: StartupDiagnosticsService;

  beforeEach(() => {
    // Create service without provider for basic tests
    service = new StartupDiagnosticsService(undefined, 1000);
  });

  it('should create service instance', () => {
    expect(service).toBeDefined();
  });

  it('should run diagnostics without provider', async () => {
    const result = await service.run();
    
    expect(result).toBeDefined();
    expect(result.wsConnectivity).toBeDefined();
    expect(result.mempoolTransmit).toBeDefined();
    expect(result.feeds).toBeDefined();
    expect(result.projectionEngine).toBeDefined();
    expect(result.coalesce).toBeDefined();
    expect(result.metrics).toBeDefined();
    expect(result.borrowersIndex).toBeDefined();
    expect(result.precompute).toBeDefined();
  });

  it('should report ws connectivity as not connected without provider', async () => {
    const result = await service.run();
    
    expect(result.wsConnectivity.connected).toBe(false);
    expect(result.wsConnectivity.providerType).toBeDefined();
  });

  it('should report mempool status', async () => {
    const result = await service.run();
    
    expect(result.mempoolTransmit.status).toMatch(/ACTIVE|INACTIVE/);
    expect(result.mempoolTransmit.subscriptionMode).toBeDefined();
  });

  it('should format diagnostics as readable string', async () => {
    const result = await service.run();
    const formatted = service.formatDiagnostics(result);
    
    expect(formatted).toContain('STARTUP DIAGNOSTICS');
    expect(formatted).toContain('WebSocket Connectivity');
    expect(formatted).toContain('Mempool Transmit Monitoring');
    expect(formatted).toContain('Chainlink Feeds');
    expect(formatted).toContain('Summary');
  });

  it('should include all required sections in formatted output', async () => {
    const result = await service.run();
    const formatted = service.formatDiagnostics(result);
    
    // Check for all required sections
    expect(formatted).toContain('[WebSocket Connectivity]');
    expect(formatted).toContain('[Mempool Transmit Monitoring]');
    expect(formatted).toContain('[Chainlink Feeds]');
    expect(formatted).toContain('[Projection Engine]');
    expect(formatted).toContain('[Reserve Event Coalescing]');
    expect(formatted).toContain('[Metrics]');
    expect(formatted).toContain('[Borrowers Index]');
    expect(formatted).toContain('[Precompute]');
    expect(formatted).toContain('[Summary]');
  });

  it('should check borrowers index status', async () => {
    const result = await service.run();
    
    expect(result.borrowersIndex).toBeDefined();
    expect(result.borrowersIndex.backfillBlocks).toBeGreaterThan(0);
    expect(result.borrowersIndex.status).toMatch(/in-progress|done|disabled/);
  });

  it('should check precompute configuration', async () => {
    const result = await service.run();
    
    expect(result.precompute).toBeDefined();
    expect(typeof result.precompute.enabled).toBe('boolean');
    expect(result.precompute.topK).toBeGreaterThan(0);
  });

  it('should check metrics configuration', async () => {
    const result = await service.run();
    
    expect(result.metrics).toBeDefined();
    expect(typeof result.metrics.latencyMetricsEnabled).toBe('boolean');
    expect(result.metrics.emitIntervalBlocks).toBeGreaterThan(0);
  });

  it('should check coalesce settings', async () => {
    const result = await service.run();
    
    expect(result.coalesce).toBeDefined();
    expect(result.coalesce.reserveDebounceMs).toBeGreaterThan(0);
    expect(typeof result.coalesce.fastLaneSettings.enabled).toBe('boolean');
  });

  it('should check projection engine', async () => {
    const result = await service.run();
    
    expect(result.projectionEngine).toBeDefined();
    expect(typeof result.projectionEngine.enabled).toBe('boolean');
  });

  it('should check feed discovery', async () => {
    const result = await service.run();
    
    expect(result.feeds).toBeDefined();
    expect(typeof result.feeds.autoDiscoverEnabled).toBe('boolean');
    expect(result.feeds.discoveredCount).toBeGreaterThanOrEqual(0);
    expect(result.feeds.pendingSubscriptions).toBeGreaterThanOrEqual(0);
    expect(result.feeds.onChainSubscriptions).toBeGreaterThanOrEqual(0);
  });
});
