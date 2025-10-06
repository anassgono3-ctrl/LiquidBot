// Unit tests for SubgraphService
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphQLClient } from 'graphql-request';

import { SubgraphService } from '../../src/services/SubgraphService.js';

// Mock graphql-request
vi.mock('graphql-request', () => {
  const GraphQLClient = vi.fn();
  GraphQLClient.prototype.request = vi.fn();
  return { GraphQLClient, gql: (strings: TemplateStringsArray) => strings[0] };
});

describe('SubgraphService', () => {
  let service: SubgraphService;
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SubgraphService('https://test-subgraph.example.com');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockRequest = vi.mocked(GraphQLClient.prototype.request) as any;
  });

  describe('getLiquidationCalls', () => {
    it('should fetch and parse liquidation calls', async () => {
      const mockData = {
        liquidationCalls: [
          {
            id: '0x123',
            timestamp: '1234567890',
            liquidator: '0xabc',
            user: '0xdef',
            principalAmount: '1000000',
            collateralAmount: '2000000',
          },
        ],
      };

      mockRequest.mockResolvedValueOnce(mockData);

      const result = await service.getLiquidationCalls(10);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('0x123');
      expect(result[0].liquidator).toBe('0xabc');
      expect(mockRequest).toHaveBeenCalledWith(expect.any(String), { first: 10 });
    });

    it('should handle empty results', async () => {
      mockRequest.mockResolvedValueOnce({ liquidationCalls: [] });

      const result = await service.getLiquidationCalls(10);

      expect(result).toHaveLength(0);
    });
  });

  describe('getReserves', () => {
    it('should fetch and parse reserve data', async () => {
      const mockData = {
        reserves: [
          {
            id: '0xusdc',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            reserveLiquidationThreshold: 8500,
            usageAsCollateralEnabled: true,
            price: { priceInEth: '0.0005' },
          },
          {
            id: '0xweth',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            reserveLiquidationThreshold: 8250,
            usageAsCollateralEnabled: true,
            price: { priceInEth: '1.0' },
          },
        ],
      };

      mockRequest.mockResolvedValueOnce(mockData);

      const result = await service.getReserves();

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('USDC');
      expect(result[0].decimals).toBe(6);
      expect(result[1].symbol).toBe('WETH');
      expect(result[1].decimals).toBe(18);
    });
  });

  describe('getUsersWithDebt', () => {
    it('should fetch and parse users with debt', async () => {
      const mockData = {
        users: [
          {
            id: '0x123',
            borrowedReservesCount: 1,
            reserves: [
              {
                currentATokenBalance: '1000000000',
                currentVariableDebt: '500000000',
                currentStableDebt: '0',
                reserve: {
                  id: '0xusdc',
                  symbol: 'USDC',
                  name: 'USD Coin',
                  decimals: 6,
                  reserveLiquidationThreshold: 8500,
                  usageAsCollateralEnabled: true,
                  price: { priceInEth: '0.0005' },
                },
              },
            ],
          },
        ],
      };

      mockRequest.mockResolvedValueOnce(mockData);

      const result = await service.getUsersWithDebt(100);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('0x123');
      expect(result[0].borrowedReservesCount).toBe(1);
      expect(result[0].reserves).toHaveLength(1);
      expect(result[0].reserves[0].reserve.symbol).toBe('USDC');
      expect(mockRequest).toHaveBeenCalledWith(expect.any(String), { first: 100 });
    });

    it('should handle multiple users with multiple reserves', async () => {
      const mockData = {
        users: [
          {
            id: '0x111',
            borrowedReservesCount: 2,
            reserves: [
              {
                currentATokenBalance: '2000000000',
                currentVariableDebt: '1000000000',
                currentStableDebt: '0',
                reserve: {
                  id: '0xusdc',
                  symbol: 'USDC',
                  name: 'USD Coin',
                  decimals: 6,
                  reserveLiquidationThreshold: 8500,
                  usageAsCollateralEnabled: true,
                  price: { priceInEth: '0.0005' },
                },
              },
              {
                currentATokenBalance: '0',
                currentVariableDebt: '500000000000000000',
                currentStableDebt: '0',
                reserve: {
                  id: '0xweth',
                  symbol: 'WETH',
                  name: 'Wrapped Ether',
                  decimals: 18,
                  reserveLiquidationThreshold: 8250,
                  usageAsCollateralEnabled: true,
                  price: { priceInEth: '1.0' },
                },
              },
            ],
          },
          {
            id: '0x222',
            borrowedReservesCount: 1,
            reserves: [
              {
                currentATokenBalance: '1000000000',
                currentVariableDebt: '500000000',
                currentStableDebt: '0',
                reserve: {
                  id: '0xusdc',
                  symbol: 'USDC',
                  name: 'USD Coin',
                  decimals: 6,
                  reserveLiquidationThreshold: 8500,
                  usageAsCollateralEnabled: true,
                  price: { priceInEth: '0.0005' },
                },
              },
            ],
          },
        ],
      };

      mockRequest.mockResolvedValueOnce(mockData);

      const result = await service.getUsersWithDebt(50);

      expect(result).toHaveLength(2);
      expect(result[0].reserves).toHaveLength(2);
      expect(result[1].reserves).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('should throw on GraphQL errors with contextual message', async () => {
      mockRequest.mockRejectedValueOnce(new Error('GraphQL error'));

      await expect(service.getUsersWithDebt(10)).rejects.toThrow('SUBGRAPH_USERS_FAILED');
    });

    it('should throw on validation errors', async () => {
      const invalidData = {
        users: [
          {
            id: '0x123',
            // Missing borrowedReservesCount
            reserves: [],
          },
        ],
      };

      mockRequest.mockResolvedValueOnce(invalidData);

      await expect(service.getUsersWithDebt(10)).rejects.toThrow();
    });
  });

  describe('mock mode', () => {
    let mockService: SubgraphService;

    beforeEach(() => {
      // Set mock mode in environment
      process.env.USE_MOCK_SUBGRAPH = 'true';
      // Reimport config to pick up env changes
      vi.resetModules();
    });

    it('should return mock liquidation calls in mock mode', async () => {
      // Import config after setting env
      const { config } = await import('../../src/config/index.js');
      const { SubgraphService: MockSubgraphService } = await import(
        '../../src/services/SubgraphService.js'
      );

      expect(config.useMockSubgraph).toBe(true);
      mockService = new MockSubgraphService();

      const result = await mockService.getLiquidationCalls(10);

      expect(result).toEqual([]);
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('should return mock reserves in mock mode', async () => {
      const { SubgraphService: MockSubgraphService } = await import(
        '../../src/services/SubgraphService.js'
      );
      mockService = new MockSubgraphService();

      const result = await mockService.getReserves();

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('MCK');
      expect(result[0].name).toBe('Mock Asset');
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('should return mock users in mock mode', async () => {
      const { SubgraphService: MockSubgraphService } = await import(
        '../../src/services/SubgraphService.js'
      );
      mockService = new MockSubgraphService();

      const result = await mockService.getUsersWithDebt(100);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('0xMockUser1');
      expect(result[1].id).toBe('0xMockUser2');
      expect(mockRequest).not.toHaveBeenCalled();
    });
  });
});
