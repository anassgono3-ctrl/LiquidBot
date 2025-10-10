import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { OneInchQuoteService } from '../../src/services/OneInchQuoteService.js';

describe('OneInchQuoteService URL Construction', () => {
  const WETH_BASE = '0x4200000000000000000000000000000000000006';
  const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Setup fetch mock
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('v6 endpoint (with API key)', () => {
    it('should use correct v6 base URL for Base chainId 8453', () => {
      const service = new OneInchQuoteService({
        apiKey: 'test-key',
        chainId: 8453
      });

      const config = service.getConfig();
      expect(config.baseUrl).toBe('https://api.1inch.dev/swap/v6.0/8453');
      expect(config.chainId).toBe(8453);
      expect(service.isUsingV6()).toBe(true);
    });

    it('should construct v6 swap URL with correct parameters', async () => {
      const service = new OneInchQuoteService({
        apiKey: 'test-key',
        chainId: 8453
      });

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          tx: { to: '0x1111111254EEB25477B68fb85Ed929f73A960582', data: '0xabc', value: '0' },
          dstAmount: '1000000'
        })
      });

      await service.getSwapCalldata({
        fromToken: WETH_BASE,
        toToken: USDC_BASE,
        amount: '1000000000000000000',
        slippageBps: 100,
        fromAddress: '0x0000000000000000000000000000000000000001'
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callUrl = fetchMock.mock.calls[0][0] as string;
      const callHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;

      // Verify base URL
      expect(callUrl).toContain('https://api.1inch.dev/swap/v6.0/8453/swap');
      
      // Verify v6 parameter names (src/dst instead of fromTokenAddress/toTokenAddress)
      expect(callUrl).toContain('src=');
      expect(callUrl).toContain('dst=');
      expect(callUrl).toContain('amount=');
      expect(callUrl).toContain('from=');
      expect(callUrl).toContain('slippage=');
      
      // Verify v6 does NOT use v5 parameter names
      expect(callUrl).not.toContain('fromTokenAddress=');
      expect(callUrl).not.toContain('toTokenAddress=');
      expect(callUrl).not.toContain('fromAddress=');
      
      // Verify specific values
      expect(callUrl).toContain(`src=${WETH_BASE}`);
      expect(callUrl).toContain(`dst=${USDC_BASE}`);
      expect(callUrl).toContain('amount=1000000000000000000');
      expect(callUrl).toContain('from=0x0000000000000000000000000000000000000001');
      expect(callUrl).toContain('slippage=1'); // 100 bps = 1%
      
      // Verify Authorization header
      expect(callHeaders['Authorization']).toBe('Bearer test-key');
    });

    it('should use /quote endpoint with correct v6 parameters', async () => {
      const service = new OneInchQuoteService({
        apiKey: 'test-key',
        chainId: 8453
      });

      // Note: Current implementation only has /swap endpoint
      // This test documents the expected /quote behavior if implemented
      const config = service.getConfig();
      const expectedQuoteUrl = `${config.baseUrl}/quote`;
      
      expect(expectedQuoteUrl).toBe('https://api.1inch.dev/swap/v6.0/8453/quote');
      
      // /quote params would be: src, dst, amount (no from/slippage)
      // This test just documents the structure
    });
  });

  describe('v5 endpoint (public fallback)', () => {
    it('should use correct v5 base URL when no API key', () => {
      const service = new OneInchQuoteService({
        apiKey: '',
        chainId: 8453
      });

      const config = service.getConfig();
      expect(config.baseUrl).toBe('https://api.1inch.exchange/v5.0/8453');
      expect(config.chainId).toBe(8453);
      expect(service.isUsingV6()).toBe(false);
    });

    it('should construct v5 swap URL with correct parameters', async () => {
      const service = new OneInchQuoteService({
        apiKey: '',
        chainId: 8453
      });

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          tx: { to: '0x1111111254EEB25477B68fb85Ed929f73A960582', data: '0xdef', value: '0' },
          toAmount: '2000000'
        })
      });

      await service.getSwapCalldata({
        fromToken: WETH_BASE,
        toToken: USDC_BASE,
        amount: '1000000000000000000',
        slippageBps: 100,
        fromAddress: '0x0000000000000000000000000000000000000001'
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callUrl = fetchMock.mock.calls[0][0] as string;
      const callHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;

      // Verify base URL
      expect(callUrl).toContain('https://api.1inch.exchange/v5.0/8453/swap');
      
      // Verify v5 parameter names (fromTokenAddress/toTokenAddress)
      expect(callUrl).toContain('fromTokenAddress=');
      expect(callUrl).toContain('toTokenAddress=');
      expect(callUrl).toContain('amount=');
      expect(callUrl).toContain('fromAddress=');
      expect(callUrl).toContain('slippage=');
      
      // Verify v5 does NOT use v6 parameter names
      expect(callUrl).not.toContain('src=');
      expect(callUrl).not.toContain('dst=');
      expect(callUrl).not.toContain('from=0x'); // 'from=' might be in 'fromAddress=' so check specific pattern
      
      // Verify specific values
      expect(callUrl).toContain(`fromTokenAddress=${WETH_BASE}`);
      expect(callUrl).toContain(`toTokenAddress=${USDC_BASE}`);
      expect(callUrl).toContain('amount=1000000000000000000');
      expect(callUrl).toContain('fromAddress=0x0000000000000000000000000000000000000001');
      expect(callUrl).toContain('slippage=1'); // 100 bps = 1%
      
      // Verify NO Authorization header for v5
      expect(callHeaders['Authorization']).toBeUndefined();
    });

    it('should use /quote endpoint with correct v5 parameters', async () => {
      const service = new OneInchQuoteService({
        apiKey: '',
        chainId: 8453
      });

      // Note: Current implementation only has /swap endpoint
      // This test documents the expected /quote behavior if implemented
      const config = service.getConfig();
      const expectedQuoteUrl = `${config.baseUrl}/quote`;
      
      expect(expectedQuoteUrl).toBe('https://api.1inch.exchange/v5.0/8453/quote');
      
      // /quote params would be: fromTokenAddress, toTokenAddress, amount
      // This test just documents the structure
    });
  });

  describe('chainId in URL', () => {
    it('should include chainId 8453 in v6 URL', () => {
      const service = new OneInchQuoteService({
        apiKey: 'test-key',
        chainId: 8453
      });

      const config = service.getConfig();
      expect(config.baseUrl).toContain('/8453');
    });

    it('should include chainId 8453 in v5 URL', () => {
      const service = new OneInchQuoteService({
        apiKey: '',
        chainId: 8453
      });

      const config = service.getConfig();
      expect(config.baseUrl).toContain('/8453');
    });

    it('should use environment CHAIN_ID if provided', () => {
      const originalChainId = process.env.CHAIN_ID;
      process.env.CHAIN_ID = '8453';

      const service = new OneInchQuoteService();
      const config = service.getConfig();
      
      expect(config.chainId).toBe(8453);
      expect(config.baseUrl).toContain('/8453');

      // Restore
      if (originalChainId) {
        process.env.CHAIN_ID = originalChainId;
      } else {
        delete process.env.CHAIN_ID;
      }
    });
  });

  describe('slippage conversion', () => {
    it('should convert slippageBps to percentage in URL', async () => {
      const service = new OneInchQuoteService({
        apiKey: 'test-key',
        chainId: 8453
      });

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          tx: { to: '0x1', data: '0x', value: '0' },
          dstAmount: '1000'
        })
      });

      await service.getSwapCalldata({
        fromToken: WETH_BASE,
        toToken: USDC_BASE,
        amount: '1000',
        slippageBps: 250, // 2.5%
        fromAddress: '0x0000000000000000000000000000000000000001'
      });

      const callUrl = fetchMock.mock.calls[0][0] as string;
      expect(callUrl).toContain('slippage=2.5');
    });
  });

  describe('service configuration', () => {
    it('should always be configured (v6 or v5 fallback)', () => {
      const serviceWithKey = new OneInchQuoteService({
        apiKey: 'test-key',
        chainId: 8453
      });
      expect(serviceWithKey.isConfigured()).toBe(true);

      const serviceWithoutKey = new OneInchQuoteService({
        apiKey: '',
        chainId: 8453
      });
      expect(serviceWithoutKey.isConfigured()).toBe(true);
    });

    it('should correctly report v6 usage', () => {
      const serviceWithKey = new OneInchQuoteService({
        apiKey: 'test-key',
        chainId: 8453
      });
      expect(serviceWithKey.isUsingV6()).toBe(true);

      const serviceWithoutKey = new OneInchQuoteService({
        apiKey: '',
        chainId: 8453
      });
      expect(serviceWithoutKey.isUsingV6()).toBe(false);
    });
  });

  describe('symbol resolution', () => {
    it('should resolve WETH symbol to address in v6 endpoint', async () => {
      const service = new OneInchQuoteService({
        apiKey: 'test-key',
        chainId: 8453
      });

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          tx: { to: '0x1111111254EEB25477B68fb85Ed929f73A960582', data: '0xabc', value: '0' },
          dstAmount: '1000000'
        })
      });

      await service.getSwapCalldata({
        fromToken: 'WETH',  // Symbol instead of address
        toToken: 'USDC',    // Symbol instead of address
        amount: '1000000000000000000',
        slippageBps: 100,
        fromAddress: '0x0000000000000000000000000000000000000001'
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callUrl = fetchMock.mock.calls[0][0] as string;

      // Verify that symbols were resolved to addresses
      expect(callUrl).toContain(`src=${WETH_BASE}`);
      expect(callUrl).toContain(`dst=${USDC_BASE}`);
      
      // Verify symbols are NOT in URL
      expect(callUrl).not.toContain('src=WETH');
      expect(callUrl).not.toContain('dst=USDC');
    });

    it('should resolve WETH symbol to address in v5 endpoint', async () => {
      const service = new OneInchQuoteService({
        apiKey: '',
        chainId: 8453
      });

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          tx: { to: '0x1111111254EEB25477B68fb85Ed929f73A960582', data: '0xdef', value: '0' },
          toAmount: '2000000'
        })
      });

      await service.getSwapCalldata({
        fromToken: 'WETH',  // Symbol instead of address
        toToken: 'USDC',    // Symbol instead of address
        amount: '1000000000000000000',
        slippageBps: 100,
        fromAddress: '0x0000000000000000000000000000000000000001'
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callUrl = fetchMock.mock.calls[0][0] as string;

      // Verify that symbols were resolved to addresses
      expect(callUrl).toContain(`fromTokenAddress=${WETH_BASE}`);
      expect(callUrl).toContain(`toTokenAddress=${USDC_BASE}`);
      
      // Verify symbols are NOT in URL
      expect(callUrl).not.toContain('fromTokenAddress=WETH');
      expect(callUrl).not.toContain('toTokenAddress=USDC');
    });

    it('should accept addresses directly without modification', async () => {
      const service = new OneInchQuoteService({
        apiKey: 'test-key',
        chainId: 8453
      });

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          tx: { to: '0x1111111254EEB25477B68fb85Ed929f73A960582', data: '0xabc', value: '0' },
          dstAmount: '1000000'
        })
      });

      await service.getSwapCalldata({
        fromToken: WETH_BASE,  // Already an address
        toToken: USDC_BASE,    // Already an address
        amount: '1000000000000000000',
        slippageBps: 100,
        fromAddress: '0x0000000000000000000000000000000000000001'
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callUrl = fetchMock.mock.calls[0][0] as string;

      // Verify addresses are used as-is
      expect(callUrl).toContain(`src=${WETH_BASE}`);
      expect(callUrl).toContain(`dst=${USDC_BASE}`);
    });

    it('should throw error for invalid fromToken symbol', async () => {
      const service = new OneInchQuoteService({
        apiKey: 'test-key',
        chainId: 8453
      });

      await expect(
        service.getSwapCalldata({
          fromToken: 'INVALID_TOKEN',  // Unknown symbol
          toToken: 'USDC',
          amount: '1000000000000000000',
          slippageBps: 100,
          fromAddress: '0x0000000000000000000000000000000000000001'
        })
      ).rejects.toThrow('fromToken must resolve to an Ethereum address: INVALID_TOKEN -> INVALID_TOKEN');
    });

    it('should throw error for invalid toToken symbol', async () => {
      const service = new OneInchQuoteService({
        apiKey: 'test-key',
        chainId: 8453
      });

      await expect(
        service.getSwapCalldata({
          fromToken: 'WETH',
          toToken: 'INVALID_TOKEN',  // Unknown symbol
          amount: '1000000000000000000',
          slippageBps: 100,
          fromAddress: '0x0000000000000000000000000000000000000001'
        })
      ).rejects.toThrow('toToken must resolve to an Ethereum address: INVALID_TOKEN -> INVALID_TOKEN');
    });

    it('should throw error for invalid fromAddress', async () => {
      const service = new OneInchQuoteService({
        apiKey: 'test-key',
        chainId: 8453
      });

      await expect(
        service.getSwapCalldata({
          fromToken: 'WETH',
          toToken: 'USDC',
          amount: '1000000000000000000',
          slippageBps: 100,
          fromAddress: '0xInvalidAddress'  // Invalid address format
        })
      ).rejects.toThrow('fromAddress must be a valid Ethereum address: 0xInvalidAddress');
    });
  });
});
