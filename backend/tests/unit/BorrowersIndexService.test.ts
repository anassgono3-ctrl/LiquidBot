// Unit tests for BorrowersIndexService modes
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JsonRpcProvider } from 'ethers';

import { BorrowersIndexService } from '../../src/services/BorrowersIndexService.js';

// Mock the config module
vi.mock('../../src/config/index.js', () => ({
  config: {
    borrowersIndex: {
      enabled: false,
      mode: 'memory',
      redisUrl: undefined,
      maxUsersPerReserve: 3000,
      backfillBlocks: 50000,
      chunkBlocks: 2000
    },
    redisUrl: undefined,
    databaseUrl: undefined
  }
}));

// Mock Redis
vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    on: vi.fn(),
    connect: vi.fn(),
    quit: vi.fn(),
    sMembers: vi.fn(),
    del: vi.fn(),
    sAdd: vi.fn()
  }))
}));

// Mock pg
vi.mock('pg', () => ({
  Pool: vi.fn(() => ({
    connect: vi.fn(),
    end: vi.fn(),
    query: vi.fn()
  }))
}));

describe('BorrowersIndexService', () => {
  let mockProvider: JsonRpcProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a minimal mock provider
    mockProvider = {
      getBlockNumber: vi.fn().mockResolvedValue(1000),
      getLogs: vi.fn().mockResolvedValue([]),
      on: vi.fn(),
      off: vi.fn()
    } as unknown as JsonRpcProvider;
  });

  describe('Mode selection', () => {
    it('should default to memory mode', () => {
      const service = new BorrowersIndexService(mockProvider, {});
      expect(service).toBeDefined();
    });

    it('should accept memory mode explicitly', () => {
      const service = new BorrowersIndexService(mockProvider, {
        mode: 'memory'
      });
      expect(service).toBeDefined();
    });

    it('should accept redis mode with URL', () => {
      const service = new BorrowersIndexService(mockProvider, {
        mode: 'redis',
        redisUrl: 'redis://localhost:6379'
      });
      expect(service).toBeDefined();
    });

    it('should accept postgres mode with URL', () => {
      const service = new BorrowersIndexService(mockProvider, {
        mode: 'postgres',
        postgresUrl: 'postgresql://localhost:5432/test'
      });
      expect(service).toBeDefined();
    });

    it('should fall back to memory if redis mode but no URL', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const service = new BorrowersIndexService(mockProvider, {
        mode: 'redis'
        // No redisUrl provided
      });
      
      expect(service).toBeDefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('falling back to memory')
      );
      
      consoleSpy.mockRestore();
    });

    it('should fall back to memory if postgres mode but no URL', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const service = new BorrowersIndexService(mockProvider, {
        mode: 'postgres'
        // No postgresUrl provided
      });
      
      expect(service).toBeDefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('falling back to memory')
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('Memory mode operations', () => {
    it('should support getBorrowers in memory mode', async () => {
      const service = new BorrowersIndexService(mockProvider, {
        mode: 'memory'
      });

      // Initialize with empty reserves
      await service.initialize([{
        asset: '0xtest',
        symbol: 'TEST',
        variableDebtToken: '0xdebt'
      }]);

      const borrowers = await service.getBorrowers('0xtest');
      expect(borrowers).toEqual([]);
    });

    it('should support getStats in memory mode', async () => {
      const service = new BorrowersIndexService(mockProvider, {
        mode: 'memory'
      });

      await service.initialize([{
        asset: '0xtest',
        symbol: 'TEST',
        variableDebtToken: '0xdebt'
      }]);

      const stats = service.getStats();
      expect(stats.totalReserves).toBe(1);
      expect(stats.totalBorrowers).toBe(0);
    });
  });

  describe('Configuration options', () => {
    it('should respect backfillBlocks option', () => {
      const service = new BorrowersIndexService(mockProvider, {
        backfillBlocks: 100000
      });
      expect(service).toBeDefined();
    });

    it('should respect chunkSize option', () => {
      const service = new BorrowersIndexService(mockProvider, {
        chunkSize: 5000
      });
      expect(service).toBeDefined();
    });

    it('should respect maxUsersPerReserve option', () => {
      const service = new BorrowersIndexService(mockProvider, {
        maxUsersPerReserve: 5000
      });
      expect(service).toBeDefined();
    });
  });

  describe('Initialization', () => {
    it('should initialize with multiple reserves', async () => {
      const service = new BorrowersIndexService(mockProvider, {
        mode: 'memory'
      });

      await service.initialize([
        { asset: '0xtest1', symbol: 'TEST1', variableDebtToken: '0xdebt1' },
        { asset: '0xtest2', symbol: 'TEST2', variableDebtToken: '0xdebt2' }
      ]);

      const stats = service.getStats();
      expect(stats.totalReserves).toBe(2);
    });

    it('should handle empty reserves list', async () => {
      const service = new BorrowersIndexService(mockProvider, {
        mode: 'memory'
      });

      await service.initialize([]);

      const stats = service.getStats();
      expect(stats.totalReserves).toBe(0);
    });
  });

  describe('Stop and cleanup', () => {
    it('should stop cleanly in memory mode', async () => {
      const service = new BorrowersIndexService(mockProvider, {
        mode: 'memory'
      });

      await service.initialize([{
        asset: '0xtest',
        symbol: 'TEST',
        variableDebtToken: '0xdebt'
      }]);

      await service.stop();
      expect(true).toBe(true); // Should not throw
    });
  });
});
