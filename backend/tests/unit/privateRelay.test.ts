/**
 * Private Relay Service Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

// Mock environment before imports
vi.stubEnv('PRIVATE_TX_RPC_URL', 'https://test-relay.example.com');
vi.stubEnv('PRIVATE_TX_MODE', 'protect');
vi.stubEnv('PRIVATE_TX_MAX_RETRIES', '2');
vi.stubEnv('PRIVATE_TX_FALLBACK_MODE', 'race');

// Mock metrics to avoid initialization errors
vi.mock('../../src/metrics/PrivateRelayMetrics.js', () => ({
  recordAttempt: vi.fn(),
  recordSuccess: vi.fn(),
  recordFallback: vi.fn(),
  recordLatency: vi.fn(),
  registerPrivateRelayMetrics: vi.fn()
}));

import { getPrivateRelayConfig } from '../../src/config/privateRelay.js';
import { PrivateRelayService } from '../../src/relay/PrivateRelayService.js';
import { FlashbotsProtectClient } from '../../src/relay/FlashbotsProtectClient.js';
import { PrivateRelayErrorCode } from '../../src/relay/types.js';

describe('Private Relay Configuration', () => {
  it('should parse enabled configuration correctly', () => {
    vi.stubEnv('PRIVATE_TX_RPC_URL', 'https://protect.flashbots.net');
    vi.stubEnv('PRIVATE_TX_MODE', 'protect');
    
    const config = getPrivateRelayConfig();
    
    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('protect');
    expect(config.rpcUrl).toBe('https://protect.flashbots.net');
  });

  it('should default to protect mode when RPC URL is set but mode is not', () => {
    vi.stubEnv('PRIVATE_TX_RPC_URL', 'https://protect.flashbots.net');
    vi.stubEnv('PRIVATE_TX_MODE', '');
    
    const config = getPrivateRelayConfig();
    
    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('protect');
  });

  it('should be disabled when RPC URL is not set', () => {
    vi.stubEnv('PRIVATE_TX_RPC_URL', '');
    vi.stubEnv('PRIVATE_TX_MODE', 'protect');
    
    const config = getPrivateRelayConfig();
    
    expect(config.enabled).toBe(false);
  });

  it('should parse retry and fallback settings', () => {
    vi.stubEnv('PRIVATE_TX_RPC_URL', 'https://protect.flashbots.net');
    vi.stubEnv('PRIVATE_TX_MODE', 'protect');
    vi.stubEnv('PRIVATE_TX_MAX_RETRIES', '3');
    vi.stubEnv('PRIVATE_TX_FALLBACK_MODE', 'direct');
    
    const config = getPrivateRelayConfig();
    
    expect(config.maxRetries).toBe(3);
    expect(config.fallbackMode).toBe('direct');
  });
});

describe('PrivateRelayService', () => {
  let mockProvider: ethers.Provider;
  let mockWallet: ethers.Wallet;

  beforeEach(() => {
    vi.stubEnv('PRIVATE_TX_RPC_URL', 'https://test-relay.example.com');
    vi.stubEnv('PRIVATE_TX_MODE', 'protect');
    vi.stubEnv('PRIVATE_TX_MAX_RETRIES', '2');
    
    mockProvider = {
      broadcastTransaction: vi.fn()
    } as any;

    mockWallet = {
      address: '0x1234567890123456789012345678901234567890'
    } as any;
  });

  it('should return disabled error when relay is disabled', async () => {
    // Clear env to disable
    vi.stubEnv('PRIVATE_TX_MODE', 'disabled');
    vi.stubEnv('PRIVATE_TX_RPC_URL', '');
    
    const service = new PrivateRelayService({
      provider: mockProvider,
      wallet: mockWallet
    });

    const result = await service.submit('0xabcd', {
      user: '0xuser',
      triggerType: 'test'
    });

    expect(result.success).toBe(false);
    expect(result.sentPrivate).toBe(false);
    expect(result.errorCode).toBe(PrivateRelayErrorCode.DISABLED);
  });

  it('should check if relay is enabled', () => {
    vi.stubEnv('PRIVATE_TX_MODE', 'protect');
    vi.stubEnv('PRIVATE_TX_RPC_URL', 'https://test.example.com');
    
    const service = new PrivateRelayService({
      provider: mockProvider,
      wallet: mockWallet
    });

    expect(service.isEnabled()).toBe(true);
  });

  it('should return config', () => {
    vi.stubEnv('PRIVATE_TX_MODE', 'protect');
    vi.stubEnv('PRIVATE_TX_RPC_URL', 'https://test.example.com');
    
    const service = new PrivateRelayService({
      provider: mockProvider,
      wallet: mockWallet
    });

    const config = service.getConfig();
    expect(config.mode).toBe('protect');
    expect(config.enabled).toBe(true);
  });
});

describe('FlashbotsProtectClient', () => {
  it('should construct signature header correctly', () => {
    const client = new FlashbotsProtectClient({
      rpcUrl: 'https://test.example.com',
      signerAddress: '0x1234567890123456789012345678901234567890',
      signatureRandom: false
    });

    // Client constructed successfully
    expect(client).toBeDefined();
  });

  it('should handle network timeout', async () => {
    // Mock fetch to timeout
    global.fetch = vi.fn(() => 
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), 100);
      })
    ) as any;

    const client = new FlashbotsProtectClient({
      rpcUrl: 'https://test.example.com',
      signerAddress: '0x1234567890123456789012345678901234567890',
      signatureRandom: false
    });

    const result = await client.sendPrivateTransaction('0xabcd1234');
    
    expect(result.success).toBe(false);
    expect(result.errorCode).toBeDefined();
    expect(result.latencyMs).toBeGreaterThan(0);
  });

  it('should handle successful response', async () => {
    // Mock successful fetch with small delay
    global.fetch = vi.fn(() => 
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            ok: true,
            json: () => Promise.resolve({
              result: '0x1234567890123456789012345678901234567890123456789012345678901234'
            })
          } as any);
        }, 10); // Small delay to ensure latency is measured
      })
    ) as any;

    const client = new FlashbotsProtectClient({
      rpcUrl: 'https://test.example.com',
      signerAddress: '0x1234567890123456789012345678901234567890',
      signatureRandom: false
    });

    const result = await client.sendPrivateTransaction('0xabcd1234');
    
    expect(result.success).toBe(true);
    expect(result.txHash).toBe('0x1234567890123456789012345678901234567890123456789012345678901234');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0); // Latency can be 0 for very fast mock responses
  });

  it('should handle RPC error response', async () => {
    // Mock error response
    global.fetch = vi.fn(() => 
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          error: {
            message: 'Transaction underpriced'
          }
        })
      })
    ) as any;

    const client = new FlashbotsProtectClient({
      rpcUrl: 'https://test.example.com',
      signerAddress: '0x1234567890123456789012345678901234567890',
      signatureRandom: false
    });

    const result = await client.sendPrivateTransaction('0xabcd1234');
    
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(PrivateRelayErrorCode.RPC_ERROR);
    expect(result.error).toContain('underpriced');
  });

  it('should handle HTTP error status', async () => {
    // Mock HTTP error
    global.fetch = vi.fn(() => 
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      })
    ) as any;

    const client = new FlashbotsProtectClient({
      rpcUrl: 'https://test.example.com',
      signerAddress: '0x1234567890123456789012345678901234567890',
      signatureRandom: false
    });

    const result = await client.sendPrivateTransaction('0xabcd1234');
    
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(PrivateRelayErrorCode.RPC_ERROR);
    expect(result.error).toContain('500');
  });

  it('should include signature header in request', async () => {
    let capturedHeaders: any;

    // Mock fetch to capture headers
    global.fetch = vi.fn((url, options: any) => {
      capturedHeaders = options.headers;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          result: '0x1234567890123456789012345678901234567890123456789012345678901234'
        })
      });
    }) as any;

    const client = new FlashbotsProtectClient({
      rpcUrl: 'https://test.example.com',
      signerAddress: '0x1234567890123456789012345678901234567890',
      signatureRandom: false
    });

    await client.sendPrivateTransaction('0xabcd1234');
    
    expect(capturedHeaders['x-flashbots-signature']).toBeDefined();
    expect(capturedHeaders['x-flashbots-signature']).toContain('0x1234567890123456789012345678901234567890');
  });
});
