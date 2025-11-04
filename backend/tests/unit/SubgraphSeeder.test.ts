/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { SubgraphSeeder } from '../../src/services/SubgraphSeeder.js';
import type { SubgraphService } from '../../src/services/SubgraphService.js';

describe('SubgraphSeeder', () => {
  let mockSubgraphService: SubgraphService;

  beforeEach(() => {
    // Create a mock SubgraphService with necessary methods
    mockSubgraphService = {
      mock: false,
      degraded: false,
      client: {
        request: vi.fn()
      },
      consumeTokenOrDrop: vi.fn().mockReturnValue(true),
      retry: vi.fn((fn) => fn())
    } as any;
  });

  describe('seed', () => {
    it('should fetch users with variable debt', async () => {
      const mockRequest = vi.fn().mockResolvedValue({
        users: [
          { id: '0xuser1' },
          { id: '0xuser2' }
        ]
      });

      (mockSubgraphService as any).client = { request: mockRequest };

      const seeder = new SubgraphSeeder({
        subgraphService: mockSubgraphService,
        maxCandidates: 100,
        pageSize: 10,
        politenessDelayMs: 0 // Skip delays in tests
      });

      const users = await seeder.seed();

      // Should call for variable debt, stable debt, and collateral
      expect(mockRequest).toHaveBeenCalled();
      expect(users.length).toBeGreaterThan(0);
    });

    it('should deduplicate users across queries', async () => {
      let callCount = 0;
      const mockRequest = vi.fn().mockImplementation(() => {
        callCount++;
        // Return same user in multiple queries to test deduplication
        if (callCount <= 3) {
          return Promise.resolve({
            users: [
              { id: '0xuser1' },
              { id: '0xuser2' },
              { id: '0xuser1' } // Duplicate
            ]
          });
        }
        return Promise.resolve({ users: [] });
      });

      (mockSubgraphService as any).client = { request: mockRequest };

      const seeder = new SubgraphSeeder({
        subgraphService: mockSubgraphService,
        maxCandidates: 100,
        pageSize: 10,
        politenessDelayMs: 0
      });

      const users = await seeder.seed();

      // Should have unique users only
      const uniqueUsers = new Set(users);
      expect(uniqueUsers.size).toBe(users.length);
      expect(users).toContain('0xuser1');
      expect(users).toContain('0xuser2');
    });

    it('should respect maxCandidates limit', async () => {
      const mockRequest = vi.fn().mockResolvedValue({
        users: Array.from({ length: 50 }, (_, i) => ({ id: `0xuser${i}` }))
      });

      (mockSubgraphService as any).client = { request: mockRequest };

      const seeder = new SubgraphSeeder({
        subgraphService: mockSubgraphService,
        maxCandidates: 10, // Limit to 10
        pageSize: 10,
        politenessDelayMs: 0
      });

      const users = await seeder.seed();

      expect(users.length).toBeLessThanOrEqual(10);
    });

    it('should handle pagination correctly', async () => {
      let skipValue = 0;
      const mockRequest = vi.fn().mockImplementation((query, variables) => {
        skipValue = variables.skip || 0;
        
        // Return different users for different skip values
        if (skipValue === 0) {
          return Promise.resolve({
            users: [{ id: '0xuser1' }, { id: '0xuser2' }]
          });
        } else if (skipValue === 2) {
          return Promise.resolve({
            users: [{ id: '0xuser3' }, { id: '0xuser4' }]
          });
        }
        
        return Promise.resolve({ users: [] });
      });

      (mockSubgraphService as any).client = { request: mockRequest };

      const seeder = new SubgraphSeeder({
        subgraphService: mockSubgraphService,
        maxCandidates: 100,
        pageSize: 2,
        politenessDelayMs: 0
      });

      const users = await seeder.seed();

      // Should have fetched multiple pages
      expect(users.length).toBeGreaterThanOrEqual(2);
    });

    it('should return empty array when subgraph is in degraded mode', async () => {
      (mockSubgraphService as any).degraded = true;

      const seeder = new SubgraphSeeder({
        subgraphService: mockSubgraphService,
        maxCandidates: 100,
        pageSize: 10,
        politenessDelayMs: 0
      });

      const users = await seeder.seed();

      expect(users).toEqual([]);
    });

    it('should return empty array when subgraph is mocked', async () => {
      (mockSubgraphService as any).mock = true;

      const seeder = new SubgraphSeeder({
        subgraphService: mockSubgraphService,
        maxCandidates: 100,
        pageSize: 10,
        politenessDelayMs: 0
      });

      const users = await seeder.seed();

      expect(users).toEqual([]);
    });

    it('should handle query errors gracefully', async () => {
      const mockRequest = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue({ users: [] });

      (mockSubgraphService as any).client = { request: mockRequest };

      const seeder = new SubgraphSeeder({
        subgraphService: mockSubgraphService,
        maxCandidates: 100,
        pageSize: 10,
        politenessDelayMs: 0
      });

      const users = await seeder.seed();

      // Should return empty array on error
      expect(users).toEqual([]);
    });

    it('should collect metrics during seeding', async () => {
      const mockRequest = vi.fn()
        .mockResolvedValueOnce({ users: [{ id: '0xuser1' }] }) // variable debt
        .mockResolvedValueOnce({ users: [] }) // end of variable debt
        .mockResolvedValueOnce({ users: [{ id: '0xuser2' }] }) // stable debt
        .mockResolvedValueOnce({ users: [] }) // end of stable debt
        .mockResolvedValueOnce({ users: [{ id: '0xuser3' }] }) // collateral
        .mockResolvedValueOnce({ users: [] }); // end of collateral

      (mockSubgraphService as any).client = { request: mockRequest };

      const seeder = new SubgraphSeeder({
        subgraphService: mockSubgraphService,
        maxCandidates: 100,
        pageSize: 10,
        politenessDelayMs: 0
      });

      await seeder.seed();

      const metrics = seeder.getMetrics();

      expect(metrics).not.toBeNull();
      expect(metrics?.totalUsers).toBeGreaterThan(0);
      expect(metrics?.lastRunAt).toBeGreaterThan(0);
    });

    it('should return partial results on partial failure', async () => {
      const mockRequest = vi.fn()
        .mockResolvedValueOnce({ users: [{ id: '0xuser1' }] }) // variable debt
        .mockResolvedValueOnce({ users: [] }) // end of variable debt
        .mockRejectedValueOnce(new Error('Network error')) // stable debt fails
        .mockResolvedValueOnce({ users: [{ id: '0xuser2' }] }) // collateral
        .mockResolvedValueOnce({ users: [] }); // end of collateral

      (mockSubgraphService as any).client = { request: mockRequest };

      const seeder = new SubgraphSeeder({
        subgraphService: mockSubgraphService,
        maxCandidates: 100,
        pageSize: 10,
        politenessDelayMs: 0
      });

      const users = await seeder.seed();

      // Should return users from successful queries
      expect(users.length).toBeGreaterThan(0);
    });
  });

  describe('getMetrics', () => {
    it('should return null before first seed', () => {
      const seeder = new SubgraphSeeder({
        subgraphService: mockSubgraphService,
        maxCandidates: 100,
        pageSize: 10
      });

      expect(seeder.getMetrics()).toBeNull();
    });

    it('should return metrics after seed', async () => {
      const mockRequest = vi.fn().mockResolvedValue({ users: [] });
      (mockSubgraphService as any).client = { request: mockRequest };

      const seeder = new SubgraphSeeder({
        subgraphService: mockSubgraphService,
        maxCandidates: 100,
        pageSize: 10,
        politenessDelayMs: 0
      });

      await seeder.seed();

      const metrics = seeder.getMetrics();

      expect(metrics).not.toBeNull();
      expect(metrics).toHaveProperty('totalUsers');
      expect(metrics).toHaveProperty('variableDebtors');
      expect(metrics).toHaveProperty('stableDebtors');
      expect(metrics).toHaveProperty('collateralHolders');
      expect(metrics).toHaveProperty('pagesProcessed');
      expect(metrics).toHaveProperty('durationMs');
      expect(metrics).toHaveProperty('lastRunAt');
    });
  });
});
