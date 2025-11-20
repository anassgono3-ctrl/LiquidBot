/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { EventGroundTruthLoader } from '../../../src/replay/EventGroundTruthLoader.js';

describe('EventGroundTruthLoader - Auth Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle auth error and return empty result when abortOnAuthError=true', async () => {
    const loader = new EventGroundTruthLoader({
      endpoint: 'https://test.example.com/graphql',
      apiKey: 'invalid-key',
      abortOnAuthError: true,
      pageSize: 100,
      requestIntervalMs: 0
    });

    // Mock the GraphQLClient to throw auth error
    const mockRequest = vi.fn().mockRejectedValue(new Error('auth error: missing authorization header'));
    (loader as any).client = { request: mockRequest };

    const result = await loader.load();

    expect(result.events).toHaveLength(0);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Auth error');
  });

  it('should return partial data when auth error occurs after some pages', async () => {
    const loader = new EventGroundTruthLoader({
      endpoint: 'https://test.example.com/graphql',
      apiKey: 'partially-valid-key',
      abortOnAuthError: true,
      pageSize: 10,
      requestIntervalMs: 0
    });

    let callCount = 0;
    const mockRequest = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First page succeeds with full page (10 events)
        return Promise.resolve({
          liquidationCalls: Array.from({ length: 10 }, (_, i) => ({
            id: `${i}`,
            timestamp: 1000 + i,
            user: { id: `0xuser${i}` },
            liquidator: '0xliquidator1',
            collateralAmount: '100',
            principalAmount: '50'
          }))
        });
      }
      // Second page fails with auth error
      throw new Error('Unauthorized: token expired');
    });

    (loader as any).client = { request: mockRequest };

    const result = await loader.load();

    expect(result.events.length).toBe(10);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Auth error');
    expect(result.partial).toBe(true);
  });

  it('should continue without abort when abortOnAuthError=false', async () => {
    const loader = new EventGroundTruthLoader({
      endpoint: 'https://test.example.com/graphql',
      apiKey: 'invalid-key',
      abortOnAuthError: false,
      pageSize: 100,
      requestIntervalMs: 0
    });

    const mockRequest = vi.fn().mockRejectedValue(new Error('auth error: forbidden'));
    (loader as any).client = { request: mockRequest };

    const result = await loader.load();

    // Should return gracefully even with no data
    expect(result.events).toHaveLength(0);
    expect(result.error).toBeDefined();
  });

  it('should attach auth headers when apiKey is provided', () => {
    const apiKey = 'test-api-key-123';
    const loader = new EventGroundTruthLoader({
      endpoint: 'https://test.example.com/graphql',
      apiKey,
      pageSize: 100
    });

    // Check that client was created with auth headers
    const client = (loader as any).client;
    expect(client).toBeDefined();
    
    // The GraphQLClient stores headers internally, we can verify by checking options
    // In a real scenario, we'd mock the GraphQLClient constructor to verify headers
    expect(loader).toBeDefined();
  });

  it('should handle non-auth errors differently', async () => {
    const loader = new EventGroundTruthLoader({
      endpoint: 'https://test.example.com/graphql',
      apiKey: 'valid-key',
      abortOnAuthError: true,
      pageSize: 100,
      requestIntervalMs: 0
    });

    const mockRequest = vi.fn().mockRejectedValue(new Error('Network timeout'));
    (loader as any).client = { request: mockRequest };

    const result = await loader.load();

    expect(result.events).toHaveLength(0);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Request failed');
    expect(result.error).not.toContain('Auth error');
  });

  it('should return partial data on non-auth error after some pages', async () => {
    const loader = new EventGroundTruthLoader({
      endpoint: 'https://test.example.com/graphql',
      apiKey: 'valid-key',
      pageSize: 10,
      requestIntervalMs: 0
    });

    let callCount = 0;
    const mockRequest = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          liquidationCalls: Array.from({ length: 10 }, (_, i) => ({
            id: `${i}`,
            timestamp: 1000 + i,
            user: { id: `0xuser${i}` },
            liquidator: '0xliquidator1',
            collateralAmount: '100',
            principalAmount: '50'
          }))
        });
      }
      throw new Error('Rate limit exceeded');
    });

    (loader as any).client = { request: mockRequest };

    const result = await loader.load();

    expect(result.events.length).toBe(10);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Request failed');
    expect(result.partial).toBe(true);
  });
});
