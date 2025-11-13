import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JsonRpcProvider } from 'ethers';

import { BorrowersIndexService } from '../../src/services/BorrowersIndexService.js';

// Mock the redis module
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

describe('BorrowersIndexService', () => {
  let mockProvider: JsonRpcProvider;

  beforeEach(() => {
    // Create a mock provider
    mockProvider = {
      getBlockNumber: vi.fn().mockResolvedValue(12345),
      getLogs: vi.fn().mockResolvedValue([]),
      on: vi.fn(),
      off: vi.fn()
    } as unknown as JsonRpcProvider;
  });

  describe('Memory fallback mode', () => {
    it('should initialize in memory mode when no Redis URL provided', async () => {
      const service = new BorrowersIndexService(mockProvider, {
        backfillBlocks: 100,
        chunkSize: 50
      });

      // Service should be created successfully
      expect(service).toBeDefined();
      
      // Initialize should work without Redis
      await service.initialize([
        {
          asset: '0xAsset1',
          symbol: 'TEST1',
          variableDebtToken: '0xDebt1'
        }
      ]);

      // Should be able to get stats
      const stats = service.getStats();
      expect(stats.totalReserves).toBe(1);
      expect(stats.totalBorrowers).toBe(0);
    });

    it('should handle memory-only operations', () => {
      const service = new BorrowersIndexService(mockProvider);

      // Should be able to get borrowers (empty initially)
      const borrowers = service.getBorrowers('0xAsset1');
      expect(borrowers).toEqual([]);

      // Should be able to get all borrowers
      const allBorrowers = service.getAllBorrowers();
      expect(allBorrowers).toEqual([]);

      // Should be able to get stats
      const stats = service.getStats();
      expect(stats.totalReserves).toBe(0);
      expect(stats.totalBorrowers).toBe(0);
    });
  });

  describe('Redis connection failure handling', () => {
    it('should fall back to memory mode on Redis connection error', async () => {
      // Mock createClient to throw an error
      const { createClient } = await import('redis');
      const mockCreateClient = createClient as ReturnType<typeof vi.fn>;
      
      mockCreateClient.mockReturnValueOnce({
        on: vi.fn(),
        connect: vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED')),
        quit: vi.fn()
      });

      // Create service with Redis URL (should fail and fall back)
      const service = new BorrowersIndexService(mockProvider, {
        redisUrl: 'redis://localhost:6379',
        backfillBlocks: 100,
        chunkSize: 50
      });

      // Initialize should succeed despite Redis failure
      await service.initialize([
        {
          asset: '0xAsset1',
          symbol: 'TEST1',
          variableDebtToken: '0xDebt1'
        }
      ]);

      // Should still be functional in memory mode
      const stats = service.getStats();
      expect(stats.totalReserves).toBe(1);
    });

    it('should not spam errors on Redis connection failure', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Mock createClient to throw an error
      const { createClient } = await import('redis');
      const mockCreateClient = createClient as ReturnType<typeof vi.fn>;
      
      mockCreateClient.mockReturnValueOnce({
        on: vi.fn(),
        connect: vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED')),
        quit: vi.fn()
      });

      // Create service with Redis URL (should fail and fall back)
      const service = new BorrowersIndexService(mockProvider, {
        redisUrl: 'redis://localhost:6379',
        backfillBlocks: 100,
        chunkSize: 50
      });

      // Initialize
      await service.initialize([
        {
          asset: '0xAsset1',
          symbol: 'TEST1',
          variableDebtToken: '0xDebt1'
        }
      ]);

      // Should have logged warning about fallback, but not spammed errors
      const warnCalls = consoleSpy.mock.calls.filter(call => 
        call[0]?.includes?.('[borrowers-index]') && 
        call[0]?.includes?.('memory mode')
      );
      
      // Should have at most one warning about switching to memory mode
      expect(warnCalls.length).toBeLessThanOrEqual(1);
      
      // Should not have multiple error logs
      const errorCalls = consoleErrorSpy.mock.calls.filter(call =>
        call[0]?.includes?.('[borrowers-index]')
      );
      expect(errorCalls.length).toBe(0);

      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Default configuration', () => {
    it('should use default backfill blocks if not specified', () => {
      const service = new BorrowersIndexService(mockProvider);
      
      // Service should be created with defaults
      expect(service).toBeDefined();
    });

    it('should use provided configuration values', () => {
      const service = new BorrowersIndexService(mockProvider, {
        backfillBlocks: 25000,
        chunkSize: 1000
      });
      
      expect(service).toBeDefined();
    });
  });

  describe('Clean shutdown', () => {
    it('should stop cleanly without Redis', async () => {
      const service = new BorrowersIndexService(mockProvider);
      
      await service.initialize([
        {
          asset: '0xAsset1',
          symbol: 'TEST1',
          variableDebtToken: '0xDebt1'
        }
      ]);

      // Should stop without errors
      await expect(service.stop()).resolves.not.toThrow();
    });
  });
});
