// Updated unit tests for SubgraphService with DI support
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SubgraphService } from '../../src/services/SubgraphService.js';

const requestMock = vi.fn();

function liveServiceWith(response: unknown) {
  requestMock.mockReset();
  requestMock.mockResolvedValue(response);
  return new SubgraphService({
    mock: false,
    client: { request: requestMock },
    endpointOverride: 'https://gateway.test/subgraph'
  });
}

describe('SubgraphService', () => {
  beforeEach(() => {
    process.env.USE_MOCK_SUBGRAPH = 'false';
    vi.clearAllMocks();
  });

  describe('getLiquidationCalls', () => {
    it('should fetch and parse liquidation calls', async () => {
      const service = liveServiceWith({
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
      });
      const result = await service.getLiquidationCalls(10);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('0x123');
      expect(requestMock).toHaveBeenCalledTimes(1);
    });

    it('should handle empty results', async () => {
      const service = liveServiceWith({ liquidationCalls: [] });
      const result = await service.getLiquidationCalls(5);
      expect(result).toHaveLength(0);
    });
  });

  describe('getReserves', () => {
    it('should fetch and parse reserve data', async () => {
      const service = liveServiceWith({
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
      });
      const result = await service.getReserves();
      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('USDC');
      expect(result[1].symbol).toBe('WETH');
    });
  });

  describe('getUsersWithDebt', () => {
    it('should fetch and parse users with debt', async () => {
      const service = liveServiceWith({
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
      });
      const result = await service.getUsersWithDebt(100);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('0x123');
    });

    it('should handle multiple users with multiple reserves', async () => {
      const service = liveServiceWith({
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
      });
      const result = await service.getUsersWithDebt(50);
      expect(result).toHaveLength(2);
      expect(result[0].reserves).toHaveLength(2);
      expect(result[1].reserves).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('should throw on GraphQL errors and retry', async () => {
      requestMock.mockReset();
      requestMock.mockRejectedValue(new Error('GraphQL error'));
      const service = new SubgraphService({ mock: false, client: { request: requestMock } });
      await expect(service.getUsersWithDebt(10)).rejects.toThrow();
      // Should have retried multiple times (default is 3)
      expect(requestMock).toHaveBeenCalledTimes(3);
    });

    it('should throw on validation errors', async () => {
      requestMock.mockReset();
      requestMock.mockResolvedValueOnce({
        users: [
          {
            id: '0x123',
            // borrowedReservesCount missing
            reserves: [],
          },
        ],
      });
      const service = new SubgraphService({ mock: false, client: { request: requestMock } });
      await expect(service.getUsersWithDebt(10)).rejects.toThrow();
    });
  });

  describe('mock mode', () => {
    it('returns canned data in mock mode', async () => {
      const service = SubgraphService.createMock();
      const users = await service.getUsersWithDebt();
      expect(users.length).toBe(2);
      expect(requestMock).not.toHaveBeenCalled();
    });
  });
});
