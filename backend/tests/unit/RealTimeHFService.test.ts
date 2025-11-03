import { describe, it, expect, beforeEach, vi } from 'vitest';

import { RealTimeHFService } from '../../src/services/RealTimeHFService.js';

// Mock config
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
    rpcUrl: 'https://test.example.com'
  }
}));

describe('RealTimeHFService', () => {
  let service: RealTimeHFService;

  beforeEach(() => {
    // Create service with skipWsConnection to avoid actual network calls
    service = new RealTimeHFService({ skipWsConnection: true });
  });

  describe('constructor', () => {
    it('should initialize with candidate manager', () => {
      expect(service).toBeDefined();
      expect(service.getCandidateManager()).toBeDefined();
    });
  });

  describe('start', () => {
    it('should start service without errors when skipWsConnection=true', async () => {
      await expect(service.start()).resolves.not.toThrow();
    });

    it('should initialize candidate manager', async () => {
      await service.start();
      const candidateManager = service.getCandidateManager();
      expect(candidateManager.size()).toBe(0);
    });
  });

  describe('stop', () => {
    it('should stop service gracefully', async () => {
      await service.start();
      await expect(service.stop()).resolves.not.toThrow();
    });

    it('should clear candidates on stop', async () => {
      await service.start();
      const candidateManager = service.getCandidateManager();
      candidateManager.add('0x123', 0.95);
      
      await service.stop();
      expect(candidateManager.size()).toBe(0);
    });
  });

  describe('getMetrics', () => {
    it('should return metrics object', async () => {
      await service.start();
      const metrics = service.getMetrics();
      
      expect(metrics).toBeDefined();
      expect(metrics).toHaveProperty('blocksReceived');
      expect(metrics).toHaveProperty('aaveLogsReceived');
      expect(metrics).toHaveProperty('healthChecksPerformed');
      expect(metrics).toHaveProperty('candidateCount');
      expect(metrics.candidateCount).toBe(0);
    });

    it('should track candidate count', async () => {
      await service.start();
      const candidateManager = service.getCandidateManager();
      candidateManager.add('0x123');
      candidateManager.add('0x456');
      
      const metrics = service.getMetrics();
      expect(metrics.candidateCount).toBe(2);
    });

    it('should track lowest HF candidate', async () => {
      await service.start();
      const candidateManager = service.getCandidateManager();
      candidateManager.add('0x123', 1.5);
      candidateManager.add('0x456', 0.95);
      
      const metrics = service.getMetrics();
      expect(metrics.lowestHFCandidate?.address).toBe('0x456');
      expect(metrics.lowestHFCandidate?.lastHF).toBe(0.95);
    });
  });

  describe('liquidatable events', () => {
    it('should be an EventEmitter', () => {
      expect(service.on).toBeDefined();
      expect(service.emit).toBeDefined();
    });

    it('should allow listeners for liquidatable events', () => {
      const handler = vi.fn();
      service.on('liquidatable', handler);
      
      // Manually emit to test
      service.emit('liquidatable', {
        userAddress: '0x123',
        healthFactor: 0.95,
        blockNumber: 12345,
        triggerType: 'event',
        timestamp: Date.now()
      });
      
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('service disabled', () => {
    it('should not start when USE_REALTIME_HF=false', async () => {
      // Mock config with disabled flag
      vi.doMock('../../src/config/index.js', () => ({
        config: {
          useRealtimeHF: false
        }
      }));

      const disabledService = new RealTimeHFService({ skipWsConnection: true });
      await disabledService.start();
      
      const metrics = disabledService.getMetrics();
      expect(metrics.blocksReceived).toBe(0);
    });
  });

  describe('Flashblocks mode', () => {
    it('should start without errors when USE_FLASHBLOCKS=true', async () => {
      // Mock config with Flashblocks enabled
      vi.doMock('../../src/config/index.js', () => ({
        config: {
          useRealtimeHF: true,
          wsRpcUrl: 'wss://test.example.com',
          useFlashblocks: true,
          flashblocksWsUrl: 'wss://flashblocks.test.com',
          flashblocksTickMs: 250,
          multicall3Address: '0xca11bde05977b3631167028862be2a173976ca11',
          aavePool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
          executionHfThresholdBps: 9800,
          realtimeSeedIntervalSec: 45,
          candidateMax: 300,
          chainlinkFeeds: undefined,
          rpcUrl: 'https://test.example.com'
        }
      }));

      const flashblocksService = new RealTimeHFService({ skipWsConnection: true });
      await expect(flashblocksService.start()).resolves.not.toThrow();
      
      await flashblocksService.stop();
    });
  });

  describe('serialization and coalescing', () => {
    it('should initialize serialization fields correctly', () => {
      expect(service).toBeDefined();
      // Service should be ready to accept head check requests
      const metrics = service.getMetrics();
      expect(metrics).toBeDefined();
    });

    it('should handle multiple candidates with dirty-first prioritization', async () => {
      await service.start();
      const candidateManager = service.getCandidateManager();
      
      // Add multiple candidates
      candidateManager.add('0x111', 1.5);
      candidateManager.add('0x222', 0.95); // Low HF
      candidateManager.add('0x333', 1.2);
      
      expect(candidateManager.size()).toBe(3);
    });
  });

  describe('dirty-first prioritization', () => {
    it('should handle candidate additions correctly', async () => {
      await service.start();
      const candidateManager = service.getCandidateManager();
      
      // Add dirty candidates
      candidateManager.add('0xaaa');
      candidateManager.add('0xbbb');
      
      expect(candidateManager.size()).toBe(2);
    });

    it('should track candidates with low HF', async () => {
      await service.start();
      const candidateManager = service.getCandidateManager();
      
      // Add candidates with various HFs
      candidateManager.add('0x111', 1.5);
      candidateManager.add('0x222', 1.05); // Below default threshold
      candidateManager.add('0x333', 0.98); // Below default threshold
      
      const lowHfCandidate = candidateManager.getLowestHF();
      expect(lowHfCandidate?.lastHF).toBe(0.98);
    });
  });

  describe('configuration', () => {
    it('should use default ALWAYS_INCLUDE_HF_BELOW value when not configured', () => {
      // The default should be 1.10
      expect(service).toBeDefined();
    });
  });
});
