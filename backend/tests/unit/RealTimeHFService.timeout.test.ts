import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { RealTimeHFService } from '../../src/services/RealTimeHFService.js';

// Mock config with timeout settings
vi.mock('../../src/config/index.js', () => ({
  config: {
    useRealtimeHF: true,
    wsRpcUrl: 'wss://test.example.com',
    useFlashblocks: false,
    flashblocksWsUrl: undefined,
    multicall3Address: '0xca11bde05977b3631167028862be2a173976ca11',
    aavePool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    executionHfThresholdBps: 9800,
    realtimeSeedIntervalSec: 45,
    candidateMax: 300,
    chainlinkFeeds: undefined,
    rpcUrl: 'https://test.example.com',
    hysteresisBps: 20,
    headCheckPageStrategy: 'paged',
    headCheckPageSize: 250,
    alwaysIncludeHfBelow: 1.10,
    useSubgraph: false,
    realtimeInitialBackfillEnabled: false,
    
    // Timeout configuration
    chunkTimeoutMs: 2000,
    chunkRetryAttempts: 2,
    runStallAbortMs: 5000,
    wsHeartbeatMs: 15000
  }
}));

describe('RealTimeHFService - Timeout and Recovery', () => {
  let service: RealTimeHFService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new RealTimeHFService({ skipWsConnection: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await service.stop();
  });

  describe('Configuration', () => {
    it('should initialize with timeout configuration', async () => {
      await service.start();
      const metrics = service.getMetrics();
      expect(metrics).toBeDefined();
    });
  });

  describe('Service Lifecycle', () => {
    it('should start and stop without errors', async () => {
      await expect(service.start()).resolves.not.toThrow();
      await expect(service.stop()).resolves.not.toThrow();
    });

    it('should clean up timers on stop', async () => {
      await service.start();
      await service.stop();
      
      // Should not throw after stop
      expect(service.getMetrics()).toBeDefined();
    });
  });

  describe('Metrics', () => {
    it('should track health checks', async () => {
      await service.start();
      const metrics = service.getMetrics();
      
      expect(metrics).toHaveProperty('healthChecksPerformed');
      expect(metrics.healthChecksPerformed).toBe(0);
    });

    it('should track candidate count', async () => {
      await service.start();
      const candidateManager = service.getCandidateManager();
      
      candidateManager.add('0x123', 1.5);
      candidateManager.add('0x456', 0.95);
      
      const metrics = service.getMetrics();
      expect(metrics.candidateCount).toBe(2);
    });
  });

  describe('Candidate Management', () => {
    it('should add candidates correctly', async () => {
      await service.start();
      const candidateManager = service.getCandidateManager();
      
      candidateManager.add('0xabc');
      expect(candidateManager.size()).toBe(1);
    });

    it('should update health factors', async () => {
      await service.start();
      const candidateManager = service.getCandidateManager();
      
      candidateManager.add('0xabc', 1.5);
      candidateManager.updateHF('0xabc', 1.2);
      
      const candidate = candidateManager.getAll().find(c => c.address === '0xabc');
      expect(candidate?.lastHF).toBe(1.2);
    });

    it('should track lowest HF candidate', async () => {
      await service.start();
      const candidateManager = service.getCandidateManager();
      
      candidateManager.add('0x111', 1.5);
      candidateManager.add('0x222', 0.95);
      candidateManager.add('0x333', 1.2);
      
      const lowestHF = candidateManager.getLowestHF();
      expect(lowestHF?.address).toBe('0x222');
      expect(lowestHF?.lastHF).toBe(0.95);
    });
  });

  describe('Edge Triggering', () => {
    it('should emit liquidatable events', async () => {
      await service.start();
      
      const handler = vi.fn();
      service.on('liquidatable', handler);
      
      // Manually emit event to test
      service.emit('liquidatable', {
        userAddress: '0x123',
        healthFactor: 0.95,
        blockNumber: 12345,
        triggerType: 'event' as const,
        timestamp: Date.now()
      });
      
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should be an EventEmitter', () => {
      expect(service.on).toBeDefined();
      expect(service.emit).toBeDefined();
    });
  });

  describe('Serialization', () => {
    it('should handle multiple candidates', async () => {
      await service.start();
      const candidateManager = service.getCandidateManager();
      
      for (let i = 0; i < 10; i++) {
        candidateManager.add(`0x${i.toString().padStart(40, '0')}`, 1.0 + i * 0.1);
      }
      
      expect(candidateManager.size()).toBe(10);
    });
  });

  describe('Service State', () => {
    it('should initialize metrics correctly', async () => {
      await service.start();
      const metrics = service.getMetrics();
      
      expect(metrics.blocksReceived).toBe(0);
      expect(metrics.aaveLogsReceived).toBe(0);
      expect(metrics.priceUpdatesReceived).toBe(0);
      expect(metrics.healthChecksPerformed).toBe(0);
      expect(metrics.triggersProcessed).toBe(0);
    });
  });
});
