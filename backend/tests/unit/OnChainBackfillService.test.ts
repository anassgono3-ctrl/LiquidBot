import { describe, it, expect, beforeEach, vi } from 'vitest';

import { OnChainBackfillService } from '../../src/services/OnChainBackfillService.js';

// Mock ethers providers
vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers');
  return {
    ...actual,
    JsonRpcProvider: vi.fn(),
    WebSocketProvider: vi.fn()
  };
});

// Mock config
vi.mock('../../src/config/index.js', () => ({
  config: {
    aavePool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    realtimeInitialBackfillEnabled: true,
    realtimeInitialBackfillBlocks: 1000,
    realtimeInitialBackfillChunkBlocks: 500,
    realtimeInitialBackfillMaxLogs: 5000
  }
}));

// Mock event registry
vi.mock('../../src/abi/aaveV3PoolEvents.js', () => ({
  eventRegistry: {
    getAllTopics: () => [],
    get: () => null,
    decode: () => null
  },
  extractUserFromAaveEvent: () => []
}));

describe('OnChainBackfillService', () => {
  let service: OnChainBackfillService;

  beforeEach(() => {
    service = new OnChainBackfillService();
  });

  describe('provider injection', () => {
    it('should accept injected provider', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(12345),
        getLogs: vi.fn().mockResolvedValue([])
      };
      
      await service.initialize(mockProvider as any);
      const result = await service.backfill();
      
      expect(result).toBeDefined();
      expect(result.logsScanned).toBe(0);
      expect(result.uniqueUsers).toBe(0);
      expect(result.users).toEqual([]);
    });

    it('should not destroy injected provider on cleanup', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(12345),
        destroy: vi.fn()
      };
      
      await service.initialize(mockProvider as any);
      await service.cleanup();
      
      // Injected provider should NOT be destroyed
      expect(mockProvider.destroy).not.toHaveBeenCalled();
    });
  });

  describe('initialization errors', () => {
    it('should throw error when provider connection fails', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockRejectedValue(new Error('Connection failed'))
      };
      
      await expect(service.initialize(mockProvider as any))
        .rejects.toThrow('Failed to connect to RPC');
    });

    it('should throw error when backfill called without initialization', async () => {
      await expect(service.backfill())
        .rejects.toThrow('OnChainBackfillService not initialized');
    });
  });

  describe('backfill results', () => {
    it('should return empty result when no logs found', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(12345),
        getLogs: vi.fn().mockResolvedValue([])
      };
      
      await service.initialize(mockProvider as any);
      const result = await service.backfill();
      
      expect(result.logsScanned).toBe(0);
      expect(result.uniqueUsers).toBe(0);
      expect(result.users).toEqual([]);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should track duration', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(12345),
        getLogs: vi.fn().mockResolvedValue([])
      };
      
      await service.initialize(mockProvider as any);
      const result = await service.backfill();
      
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
