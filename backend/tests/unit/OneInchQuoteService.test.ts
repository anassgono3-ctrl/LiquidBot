import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OneInchQuoteService } from '../../src/services/OneInchQuoteService.js';

describe('OneInchQuoteService', () => {
  let service: OneInchQuoteService;

  beforeEach(() => {
    // Mock environment variables for dev mode
    process.env.ONEINCH_API_KEY = 'test-api-key';
    process.env.ONEINCH_API_MODE = 'dev';
    process.env.ONEINCH_BASE_URL = 'https://api.1inch.dev/swap/v6.0/8453';
    process.env.CHAIN_ID = '8453';

    service = new OneInchQuoteService();
  });

  describe('constructor', () => {
    it('should initialize with environment variables in dev mode', () => {
      const config = service.getConfig();
      expect(config.configured).toBe(true);
      expect(config.baseUrl).toBe('https://api.1inch.dev/swap/v6.0/8453');
      expect(config.chainId).toBe(8453);
      expect(config.apiMode).toBe('dev');
    });

    it('should default to io mode when ONEINCH_BASE_URL is api.1inch.io', () => {
      delete process.env.ONEINCH_API_MODE;
      process.env.ONEINCH_BASE_URL = 'https://api.1inch.io/v5.0/8453';
      
      const ioService = new OneInchQuoteService();
      const config = ioService.getConfig();
      expect(config.apiMode).toBe('io');
      expect(config.configured).toBe(true); // io mode doesn't require API key
    });

    it('should auto-detect dev mode from api.1inch.dev URL', () => {
      delete process.env.ONEINCH_API_MODE;
      process.env.ONEINCH_BASE_URL = 'https://api.1inch.dev/swap/v6.0/8453';
      
      const devService = new OneInchQuoteService();
      const config = devService.getConfig();
      expect(config.apiMode).toBe('dev');
    });

    it('should warn if API key not configured in dev mode', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn');
      delete process.env.ONEINCH_API_KEY;
      process.env.ONEINCH_API_MODE = 'dev';
      
      const service = new OneInchQuoteService();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[1inch] API key not configured - dev mode requires API key')
      );
      expect(service.isConfigured()).toBe(false);
    });

    it('should not warn if API key not configured in io mode', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn');
      delete process.env.ONEINCH_API_KEY;
      process.env.ONEINCH_API_MODE = 'io';
      process.env.ONEINCH_BASE_URL = 'https://api.1inch.io/v5.0/8453';
      
      const service = new OneInchQuoteService();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(service.isConfigured()).toBe(true);
    });

    it('should accept custom options', () => {
      const customService = new OneInchQuoteService({
        apiKey: 'custom-key',
        baseUrl: 'https://custom.api.com',
        chainId: 1,
        apiMode: 'dev'
      });

      const config = customService.getConfig();
      expect(config.configured).toBe(true);
      expect(config.baseUrl).toBe('https://custom.api.com');
      expect(config.chainId).toBe(1);
      expect(config.apiMode).toBe('dev');
    });
  });

  describe('getSwapCalldata', () => {
    it('should throw if API key not configured in dev mode', async () => {
      const unconfiguredService = new OneInchQuoteService({ 
        apiKey: '',
        apiMode: 'dev',
        baseUrl: 'https://api.1inch.dev/swap/v6.0/8453'
      });
      
      await expect(
        unconfiguredService.getSwapCalldata({
          fromToken: '0x1',
          toToken: '0x2',
          amount: '1000',
          slippageBps: 100,
          fromAddress: '0x3'
        })
      ).rejects.toThrow('1inch API key not configured (required for dev mode)');
    });

    it('should not throw if API key not configured in io mode', async () => {
      const ioService = new OneInchQuoteService({ 
        apiKey: '',
        apiMode: 'io',
        baseUrl: 'https://api.1inch.io/v5.0/8453'
      });
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tx: { to: '0x1', data: '0x', value: '0' },
          dstAmount: '1000'
        })
      });

      // Should not throw
      await ioService.getSwapCalldata({
        fromToken: '0x1',
        toToken: '0x2',
        amount: '1000',
        slippageBps: 100,
        fromAddress: '0x3'
      });
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

    it('should make API request with correct parameters in dev mode', async () => {
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

    it('should make API request with correct parameters in io mode', async () => {
      const ioService = new OneInchQuoteService({
        apiKey: '',
        apiMode: 'io',
        baseUrl: 'https://api.1inch.io/v5.0/8453'
      });

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

      const result = await ioService.getSwapCalldata({
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

      // Should use fromTokenAddress/toTokenAddress for io mode
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('fromTokenAddress=0xAAA'),
        expect.objectContaining({
          headers: expect.not.objectContaining({
            'Authorization': expect.anything()
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

      const callUrl = (fetch as any).mock.calls[0][0];
      expect(callUrl).toContain('slippage=1.5');
    });
  });

  describe('isConfigured', () => {
    it('should return true when API key is set in dev mode', () => {
      expect(service.isConfigured()).toBe(true);
    });

    it('should return false when API key is empty string in dev mode', () => {
      const unconfiguredService = new OneInchQuoteService({ 
        apiKey: '',
        apiMode: 'dev',
        baseUrl: 'https://api.1inch.dev/swap/v6.0/8453',
        chainId: 8453
      });
      expect(unconfiguredService.isConfigured()).toBe(false);
    });

    it('should return true when API key is empty string in io mode', () => {
      const ioService = new OneInchQuoteService({ 
        apiKey: '',
        apiMode: 'io',
        baseUrl: 'https://api.1inch.io/v5.0/8453',
        chainId: 8453
      });
      expect(ioService.isConfigured()).toBe(true);
    });
  });
});
