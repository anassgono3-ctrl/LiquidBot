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
    it('should fetch and parse liquidation calls with nested user object and string timestamp', async () => {
      const service = liveServiceWith({
        liquidationCalls: [
          {
            id: '0x123',
            timestamp: '1234567890',
            liquidator: '0xabc',
            user: { id: '0xdef' },
            principalAmount: '1000000',
            collateralAmount: '2000000',
            txHash: '0xtxhash123',
            principalReserve: { id: '0xusdc', symbol: 'USDC', decimals: 6 },
            collateralReserve: { id: '0xweth', symbol: 'WETH', decimals: 18 },
          },
        ],
      });
      const result = await service.getLiquidationCalls(10);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('0x123');
      expect(result[0].timestamp).toBe(1234567890);
      expect(result[0].user).toBe('0xdef');
      expect(result[0].txHash).toBe('0xtxhash123');
      expect(result[0].principalReserve).toEqual({ id: '0xusdc', symbol: 'USDC', decimals: 6 });
      expect(result[0].collateralReserve).toEqual({ id: '0xweth', symbol: 'WETH', decimals: 18 });
      expect(requestMock).toHaveBeenCalledTimes(1);
    });

    it('should fetch and parse liquidation calls with numeric timestamp', async () => {
      const service = liveServiceWith({
        liquidationCalls: [
          {
            id: '0x789',
            timestamp: 1234567890,
            liquidator: '0xabc',
            user: { id: '0xdef' },
            principalAmount: '1000000',
            collateralAmount: '2000000',
            txHash: '0xtxhash789',
            principalReserve: { id: '0xusdc', symbol: 'USDC', decimals: 6 },
            collateralReserve: { id: '0xweth', symbol: 'WETH', decimals: 18 },
          },
        ],
      });
      const result = await service.getLiquidationCalls(10);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('0x789');
      expect(result[0].timestamp).toBe(1234567890);
      expect(typeof result[0].timestamp).toBe('number');
      expect(result[0].user).toBe('0xdef');
      expect(result[0].txHash).toBe('0xtxhash789');
      expect(requestMock).toHaveBeenCalledTimes(1);
    });

    it('should handle liquidation calls with string decimals in reserves', async () => {
      const service = liveServiceWith({
        liquidationCalls: [
          {
            id: '0x456',
            timestamp: 1234567891,
            liquidator: '0xabc',
            user: { id: '0xdef' },
            principalAmount: '1000000',
            collateralAmount: '2000000',
            principalReserve: { id: '0xusdc', symbol: 'USDC', decimals: '6' },
            collateralReserve: { id: '0xweth', symbol: 'WETH', decimals: '18' },
          },
        ],
      });
      const result = await service.getLiquidationCalls(10);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('0x456');
      expect(result[0].timestamp).toBe(1234567891);
      expect(result[0].principalReserve?.decimals).toBe(6);
      expect(result[0].collateralReserve?.decimals).toBe(18);
      expect(typeof result[0].principalReserve?.decimals).toBe('number');
      expect(typeof result[0].collateralReserve?.decimals).toBe('number');
    });

    it('should handle liquidation calls without reserve metadata', async () => {
      const service = liveServiceWith({
        liquidationCalls: [
          {
            id: '0x999',
            timestamp: '1234567891',
            liquidator: '0xabc',
            user: { id: '0xdef' },
            principalAmount: '1000000',
            collateralAmount: '2000000',
          },
        ],
      });
      const result = await service.getLiquidationCalls(10);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('0x999');
      expect(result[0].timestamp).toBe(1234567891);
      expect(result[0].txHash).toBeNull();
      expect(result[0].principalReserve).toBeNull();
      expect(result[0].collateralReserve).toBeNull();
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

  describe('getSingleUserWithDebt', () => {
    it('should fetch and parse a single user with debt', async () => {
      requestMock.mockResolvedValue({
        user: {
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
      });
      const service = new SubgraphService({ mock: false, client: { request: requestMock } });
      const result = await service.getSingleUserWithDebt('0x123');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('0x123');
      expect(result?.borrowedReservesCount).toBe(1);
    });

    it('should return null for non-existent user', async () => {
      requestMock.mockResolvedValue({ user: null });
      const service = new SubgraphService({ mock: false, client: { request: requestMock } });
      const result = await service.getSingleUserWithDebt('0xnonexistent');
      expect(result).toBeNull();
    });

    it('should handle user with multiple reserves', async () => {
      requestMock.mockResolvedValue({
        user: {
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
      });
      const service = new SubgraphService({ mock: false, client: { request: requestMock } });
      const result = await service.getSingleUserWithDebt('0x111');
      expect(result).not.toBeNull();
      expect(result?.reserves).toHaveLength(2);
    });
  });

  describe('error handling', () => {
    it('should throw on GraphQL errors and retry', async () => {
      requestMock.mockReset();
      requestMock.mockRejectedValue(new Error('GraphQL error'));
      const service = new SubgraphService({ mock: false, client: { request: requestMock } });
      await expect(service.getSingleUserWithDebt('0x123')).rejects.toThrow();
      // Should have retried multiple times (default is 3)
      expect(requestMock).toHaveBeenCalledTimes(3);
    });

    it('should throw on validation errors', async () => {
      requestMock.mockReset();
      requestMock.mockResolvedValueOnce({
        user: {
          id: '0x123',
          // borrowedReservesCount missing
          reserves: [],
        },
      });
      const service = new SubgraphService({ mock: false, client: { request: requestMock } });
      await expect(service.getSingleUserWithDebt('0x123')).rejects.toThrow();
    });
  });

  describe('mock mode', () => {
    it('returns canned data in mock mode for single user', async () => {
      const service = SubgraphService.createMock();
      const user = await service.getSingleUserWithDebt('0x123');
      expect(user).not.toBeNull();
      expect(user?.id).toBe('0x123');
      expect(requestMock).not.toHaveBeenCalled();
    });
  });
});
