/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AggregatorService } from '../../src/services/AggregatorService.js';
import type { OneInchQuoteService } from '../../src/services/OneInchQuoteService.js';
import type { ZeroXQuoteService } from '../../src/services/ZeroXQuoteService.js';

describe('AggregatorService', () => {
  let mockOneInch: Partial<OneInchQuoteService> & {
    getSwapCalldata: any;
    isConfigured: any;
    getConfig: any;
  };
  let mockZeroX: Partial<ZeroXQuoteService> & {
    getSwapCalldata: any;
    isConfigured: any;
    getConfig: any;
  };

  beforeEach(() => {
    mockOneInch = {
      getSwapCalldata: vi.fn(),
      isConfigured: vi.fn(),
      getConfig: vi.fn()
    };

    mockZeroX = {
      getSwapCalldata: vi.fn(),
      isConfigured: vi.fn(),
      getConfig: vi.fn()
    };
  });

  describe('getSwapCalldata', () => {
    it('should try 1inch first when configured', async () => {
      const service = new AggregatorService({
        oneInchService: mockOneInch as OneInchQuoteService,
        zeroXService: mockZeroX as ZeroXQuoteService
      });

      (mockOneInch.isConfigured as any).mockReturnValue(true);
      (mockOneInch.getSwapCalldata as any).mockResolvedValue({
        to: '0x1111111254EEB25477B68fb85Ed929f73A960582',
        data: '0xabcdef',
        value: '0',
        minOut: '990'
      });

      const result = await service.getSwapCalldata({
        fromToken: 'USDC',
        toToken: 'WETH',
        amount: '1000',
        slippageBps: 100,
        fromAddress: '0x1111111111111111111111111111111111111111'
      });

      expect(result.aggregator).toBe('1inch');
      expect(mockOneInch.getSwapCalldata).toHaveBeenCalled();
      expect(mockZeroX.getSwapCalldata).not.toHaveBeenCalled();
    });

    it('should fallback to 0x when 1inch fails', async () => {
      const service = new AggregatorService({
        oneInchService: mockOneInch as OneInchQuoteService,
        zeroXService: mockZeroX as ZeroXQuoteService
      });

      (mockOneInch.isConfigured as any).mockReturnValue(true);
      (mockOneInch.getSwapCalldata as any).mockRejectedValue(new Error('1inch failed'));
      (mockZeroX.getSwapCalldata as any).mockResolvedValue({
        to: '0x2222222222222222222222222222222222222222',
        data: '0xfedcba',
        value: '0',
        minOut: '985'
      });

      const result = await service.getSwapCalldata({
        fromToken: 'USDC',
        toToken: 'WETH',
        amount: '1000',
        slippageBps: 100,
        fromAddress: '0x1111111111111111111111111111111111111111'
      });

      expect(result.aggregator).toBe('0x');
      expect(mockOneInch.getSwapCalldata).toHaveBeenCalled();
      expect(mockZeroX.getSwapCalldata).toHaveBeenCalled();
    });

    it('should resolve token symbols to addresses', async () => {
      const service = new AggregatorService({
        oneInchService: mockOneInch as OneInchQuoteService,
        zeroXService: mockZeroX as ZeroXQuoteService
      });

      (mockOneInch.isConfigured as any).mockReturnValue(true);
      (mockOneInch.getSwapCalldata as any).mockResolvedValue({
        to: '0x1111111254EEB25477B68fb85Ed929f73A960582',
        data: '0xabcdef',
        value: '0',
        minOut: '990'
      });

      await service.getSwapCalldata({
        fromToken: 'USDC',
        toToken: 'WETH',
        amount: '1000',
        slippageBps: 100,
        fromAddress: '0x1111111111111111111111111111111111111111'
      });

      const callArgs = (mockOneInch.getSwapCalldata as any).mock.calls[0][0];
      expect(callArgs.fromToken).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'); // USDC
      expect(callArgs.toToken).toBe('0x4200000000000000000000000000000000000006'); // WETH
    });

    it('should throw when all aggregators fail', async () => {
      const service = new AggregatorService({
        oneInchService: mockOneInch as OneInchQuoteService,
        zeroXService: mockZeroX as ZeroXQuoteService
      });

      (mockOneInch.isConfigured as any).mockReturnValue(true);
      (mockOneInch.getSwapCalldata as any).mockRejectedValue(new Error('1inch failed'));
      (mockZeroX.getSwapCalldata as any).mockRejectedValue(new Error('0x failed'));

      await expect(
        service.getSwapCalldata({
          fromToken: 'USDC',
          toToken: 'WETH',
          amount: '1000',
          slippageBps: 100,
          fromAddress: '0x1111111111111111111111111111111111111111'
        })
      ).rejects.toThrow('All aggregators failed');
    });

    it('should use 0x first when preferred', async () => {
      const service = new AggregatorService({
        oneInchService: mockOneInch as OneInchQuoteService,
        zeroXService: mockZeroX as ZeroXQuoteService,
        preferredAggregator: 'zerox'
      });

      (mockZeroX.getSwapCalldata as any).mockResolvedValue({
        to: '0x2222222222222222222222222222222222222222',
        data: '0xfedcba',
        value: '0',
        minOut: '985'
      });

      const result = await service.getSwapCalldata({
        fromToken: 'USDC',
        toToken: 'WETH',
        amount: '1000',
        slippageBps: 100,
        fromAddress: '0x1111111111111111111111111111111111111111'
      });

      expect(result.aggregator).toBe('0x');
      expect(mockZeroX.getSwapCalldata).toHaveBeenCalled();
      expect(mockOneInch.getSwapCalldata).not.toHaveBeenCalled();
    });
  });

  describe('isConfigured', () => {
    it('should return true if 1inch is configured', () => {
      const service = new AggregatorService({
        oneInchService: mockOneInch as OneInchQuoteService,
        zeroXService: mockZeroX as ZeroXQuoteService
      });

      (mockOneInch.isConfigured as any).mockReturnValue(true);
      (mockZeroX.isConfigured as any).mockReturnValue(false);

      expect(service.isConfigured()).toBe(true);
    });

    it('should return true if 0x is configured', () => {
      const service = new AggregatorService({
        oneInchService: mockOneInch as OneInchQuoteService,
        zeroXService: mockZeroX as ZeroXQuoteService
      });

      (mockOneInch.isConfigured as any).mockReturnValue(false);
      (mockZeroX.isConfigured as any).mockReturnValue(true);

      expect(service.isConfigured()).toBe(true);
    });

    it('should return false if none are configured', () => {
      const service = new AggregatorService({
        oneInchService: mockOneInch as OneInchQuoteService,
        zeroXService: mockZeroX as ZeroXQuoteService
      });

      (mockOneInch.isConfigured as any).mockReturnValue(false);
      (mockZeroX.isConfigured as any).mockReturnValue(false);

      expect(service.isConfigured()).toBe(false);
    });
  });
});
