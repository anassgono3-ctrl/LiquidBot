import { describe, it, expect, vi, beforeEach } from 'vitest';

import { OneInchQuoteService } from '../../src/services/OneInchQuoteService.js';

describe('OneInchQuoteService', () => {
  let service: OneInchQuoteService;

  beforeEach(() => {
    // Mock environment variables
    process.env.ONEINCH_API_KEY = 'test-api-key';
    process.env.ONEINCH_BASE_URL = 'https://api.1inch.dev/swap/v6.0/8453';
    process.env.CHAIN_ID = '8453';

    service = new OneInchQuoteService();
  });

  describe('constructor', () => {
    it('should initialize with environment variables', () => {
      const config = service.getConfig();
      expect(config.configured).toBe(true);
      expect(config.baseUrl).toBe('https://api.1inch.dev/swap/v6.0/8453');
      expect(config.chainId).toBe(8453);
    });

    it('should warn if API key not configured', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn');
      delete process.env.ONEINCH_API_KEY;
      
      const service = new OneInchQuoteService();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[1inch] API key not configured')
      );
      // Service is always configured (v6 with key or v5 public fallback)
      expect(service.isConfigured()).toBe(true);
      expect(service.isUsingV6()).toBe(false);
    });

    it('should accept custom options', () => {
      const customService = new OneInchQuoteService({
        apiKey: 'custom-key',
        baseUrl: 'https://custom.api.com',
        chainId: 1
      });

      const config = customService.getConfig();
      expect(config.configured).toBe(true);
      expect(config.baseUrl).toBe('https://custom.api.com');
      expect(config.chainId).toBe(1);
    });
  });

  describe('getSwapCalldata', () => {
    it('should work without API key (v5 fallback)', async () => {
      const unconfiguredService = new OneInchQuoteService({ apiKey: '' });
      
      // Mock successful v5 response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tx: { to: '0x1111111254EEB25477B68fb85Ed929f73A960582', data: '0xabc', value: '0' },
          toAmount: '1000'
        })
      });

      const result = await unconfiguredService.getSwapCalldata({
        fromToken: '0x1',
        toToken: '0x2',
        amount: '1000',
        slippageBps: 100,
        fromAddress: '0x3'
      });

      expect(result).toBeDefined();
      expect(result.to).toBe('0x1111111254EEB25477B68fb85Ed929f73A960582');
    });

    it('should validate required parameters', async () => {
      await expect(
        service.getSwapCalldata({
          fromToken: '',
          toToken: '0x2',
          amount: '1000',
          slippageBps: 100,
          fromAddress: '0x3'
        })
      ).rejects.toThrow('fromToken and toToken are required');

      await expect(
        service.getSwapCalldata({
          fromToken: '0x1',
          toToken: '0x2',
          amount: '0',
          slippageBps: 100,
          fromAddress: '0x3'
        })
      ).rejects.toThrow('amount must be greater than 0');
    });

    it('should validate slippage range', async () => {
      await expect(
        service.getSwapCalldata({
          fromToken: '0x1',
          toToken: '0x2',
          amount: '1000',
          slippageBps: -1,
          fromAddress: '0x3'
        })
      ).rejects.toThrow('slippageBps must be between 0 and 5000');

      await expect(
        service.getSwapCalldata({
          fromToken: '0x1',
          toToken: '0x2',
          amount: '1000',
          slippageBps: 6000,
          fromAddress: '0x3'
        })
      ).rejects.toThrow('slippageBps must be between 0 and 5000');
    });

    it('should make API request with correct parameters', async () => {
      const mockResponse = {
        tx: {
          to: '0x1111111254EEB25477B68fb85Ed929f73A960582',
          data: '0xabcdef',
          value: '0'
        },
        dstAmount: '990'
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });

      const result = await service.getSwapCalldata({
        fromToken: '0xAAA',
        toToken: '0xBBB',
        amount: '1000',
        slippageBps: 100,
        fromAddress: '0xCCC'
      });

      expect(result).toEqual({
        to: '0x1111111254EEB25477B68fb85Ed929f73A960582',
        data: '0xabcdef',
        value: '0',
        minOut: '990'
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('src=0xAAA'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
    });

    it('should handle API errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad request'
      });

      await expect(
        service.getSwapCalldata({
          fromToken: '0x1',
          toToken: '0x2',
          amount: '1000',
          slippageBps: 100,
          fromAddress: '0x3'
        })
      ).rejects.toThrow('1inch API error (400)');
    });

    it('should handle network errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(
        service.getSwapCalldata({
          fromToken: '0x1',
          toToken: '0x2',
          amount: '1000',
          slippageBps: 100,
          fromAddress: '0x3'
        })
      ).rejects.toThrow('Failed to get 1inch quote: Network error');
    });

    it('should convert slippage from bps to percentage', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tx: { to: '0x1', data: '0x', value: '0' },
          dstAmount: '1000'
        })
      });

      await service.getSwapCalldata({
        fromToken: '0x1',
        toToken: '0x2',
        amount: '1000',
        slippageBps: 150, // 1.5%
        fromAddress: '0x3'
      });

      const callUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(callUrl).toContain('slippage=1.5');
    });
  });

  describe('isConfigured', () => {
    it('should return true when API key is set', () => {
      expect(service.isConfigured()).toBe(true);
      expect(service.isUsingV6()).toBe(true);
    });

    it('should return true even without API key (v5 fallback)', () => {
      const unconfiguredService = new OneInchQuoteService({ 
        apiKey: '',
        baseUrl: 'https://test.com',
        chainId: 8453
      });
      // Service is always configured (v6 with key or v5 public fallback)
      expect(unconfiguredService.isConfigured()).toBe(true);
      expect(unconfiguredService.isUsingV6()).toBe(false);
    });
  });
});
