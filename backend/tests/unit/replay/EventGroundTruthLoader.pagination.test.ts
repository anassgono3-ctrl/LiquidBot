/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { EventGroundTruthLoader } from '../../../src/replay/EventGroundTruthLoader.js';

describe('EventGroundTruthLoader - Pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch multiple pages and aggregate events', async () => {
    const loader = new EventGroundTruthLoader({
      endpoint: 'https://test.example.com/graphql',
      apiKey: 'valid-key',
      pageSize: 10,
      maxPages: 5,
      requestIntervalMs: 0
    });

    let callCount = 0;
    const mockRequest = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 3) {
        // Return 10 events per page for 3 pages
        return Promise.resolve({
          liquidationCalls: Array.from({ length: 10 }, (_, i) => ({
            id: `${callCount}-${i}`,
            timestamp: 1000 + callCount * 100 + i,
            user: { id: `0xuser${callCount}-${i}` },
            liquidator: `0xliquidator${callCount}`,
            collateralAmount: '100',
            principalAmount: '50'
          }))
        });
      }
      // 4th page is empty (end of data)
      return Promise.resolve({ liquidationCalls: [] });
    });

    (loader as any).client = { request: mockRequest };

    const result = await loader.load();

    expect(result.events.length).toBe(30); // 3 pages * 10 events
    expect(mockRequest).toHaveBeenCalledTimes(4); // 3 full pages + 1 empty
    expect(result.error).toBeUndefined();
  });

  it('should stop at short page (last page)', async () => {
    const loader = new EventGroundTruthLoader({
      endpoint: 'https://test.example.com/graphql',
      apiKey: 'valid-key',
      pageSize: 10,
      maxPages: 10,
      requestIntervalMs: 0
    });

    let callCount = 0;
    const mockRequest = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First page full
        return Promise.resolve({
          liquidationCalls: Array.from({ length: 10 }, (_, i) => ({
            id: `1-${i}`,
            timestamp: 1000 + i,
            user: { id: `0xuser${i}` },
            liquidator: '0xliquidator1',
            collateralAmount: '100',
            principalAmount: '50'
          }))
        });
      } else if (callCount === 2) {
        // Second page partial (5 events) - should trigger stop
        return Promise.resolve({
          liquidationCalls: Array.from({ length: 5 }, (_, i) => ({
            id: `2-${i}`,
            timestamp: 2000 + i,
            user: { id: `0xuser2-${i}` },
            liquidator: '0xliquidator2',
            collateralAmount: '200',
            principalAmount: '100'
          }))
        });
      }
      return Promise.resolve({ liquidationCalls: [] });
    });

    (loader as any).client = { request: mockRequest };

    const result = await loader.load();

    expect(result.events.length).toBe(15); // 10 + 5
    expect(mockRequest).toHaveBeenCalledTimes(2); // Should stop after short page
    expect(result.error).toBeUndefined();
  });

  it('should respect maxPages limit', async () => {
    const loader = new EventGroundTruthLoader({
      endpoint: 'https://test.example.com/graphql',
      apiKey: 'valid-key',
      pageSize: 10,
      maxPages: 2, // Limit to 2 pages
      requestIntervalMs: 0
    });

    const mockRequest = vi.fn().mockImplementation(() => {
      // Always return full pages
      return Promise.resolve({
        liquidationCalls: Array.from({ length: 10 }, (_, i) => ({
          id: `event-${i}`,
          timestamp: 1000 + i,
          user: { id: `0xuser${i}` },
          liquidator: '0xliquidator',
          collateralAmount: '100',
          principalAmount: '50'
        }))
      });
    });

    (loader as any).client = { request: mockRequest };

    const result = await loader.load();

    expect(result.events.length).toBe(20); // 2 pages * 10 events
    expect(mockRequest).toHaveBeenCalledTimes(2); // Should stop at maxPages
  });

  it('should use skip parameter for pagination', async () => {
    const loader = new EventGroundTruthLoader({
      endpoint: 'https://test.example.com/graphql',
      apiKey: 'valid-key',
      pageSize: 10,
      maxPages: 3,
      requestIntervalMs: 0
    });

    const mockRequest = vi.fn().mockImplementation((query: string, variables: any) => {
      const expectedSkip = variables.skip;
      
      // Return events based on skip value
      return Promise.resolve({
        liquidationCalls: Array.from({ length: 10 }, (_, i) => ({
          id: `event-${expectedSkip + i}`,
          timestamp: 1000 + expectedSkip + i,
          user: { id: `0xuser${expectedSkip + i}` },
          liquidator: '0xliquidator',
          collateralAmount: '100',
          principalAmount: '50'
        }))
      });
    });

    (loader as any).client = { request: mockRequest };

    const result = await loader.load();

    expect(result.events.length).toBe(30);
    
    // Verify skip values
    expect(mockRequest).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({ skip: 0 }));
    expect(mockRequest).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ skip: 10 }));
    expect(mockRequest).toHaveBeenNthCalledWith(3, expect.anything(), expect.objectContaining({ skip: 20 }));
  });

  it('should respect pageSize limit (max 1000)', async () => {
    // Request page size larger than The Graph's limit
    const loader = new EventGroundTruthLoader({
      endpoint: 'https://test.example.com/graphql',
      apiKey: 'valid-key',
      pageSize: 2000, // Should be clamped to 1000
      maxPages: 1,
      requestIntervalMs: 0
    });

    const mockRequest = vi.fn().mockImplementation((query: string, variables: any) => {
      // Verify that first parameter is clamped to 1000
      expect(variables.first).toBeLessThanOrEqual(1000);
      
      return Promise.resolve({ liquidationCalls: [] });
    });

    (loader as any).client = { request: mockRequest };

    await loader.load();

    expect(mockRequest).toHaveBeenCalled();
  });

  it('should filter by timestamp range when provided', async () => {
    const startTs = 1000;
    const endTs = 2000;
    
    const loader = new EventGroundTruthLoader({
      endpoint: 'https://test.example.com/graphql',
      apiKey: 'valid-key',
      startTimestamp: startTs,
      endTimestamp: endTs,
      pageSize: 10,
      requestIntervalMs: 0
    });

    const mockRequest = vi.fn().mockImplementation((query: string, variables: any) => {
      // Verify timestamp parameters are passed
      expect(variables.startTs).toBe(startTs);
      expect(variables.endTs).toBe(endTs);
      
      return Promise.resolve({ liquidationCalls: [] });
    });

    (loader as any).client = { request: mockRequest };

    await loader.load();

    expect(mockRequest).toHaveBeenCalled();
  });

  it('should handle politeness delay between pages', async () => {
    const requestIntervalMs = 100;
    const loader = new EventGroundTruthLoader({
      endpoint: 'https://test.example.com/graphql',
      apiKey: 'valid-key',
      pageSize: 5,
      maxPages: 3,
      requestIntervalMs
    });

    let callCount = 0;
    const callTimestamps: number[] = [];
    
    const mockRequest = vi.fn().mockImplementation(() => {
      callTimestamps.push(Date.now());
      callCount++;
      
      if (callCount <= 2) {
        return Promise.resolve({
          liquidationCalls: Array.from({ length: 5 }, (_, i) => ({
            id: `${callCount}-${i}`,
            timestamp: 1000 + callCount * 10 + i,
            user: { id: `0xuser${i}` },
            liquidator: '0xliquidator',
            collateralAmount: '100',
            principalAmount: '50'
          }))
        });
      }
      return Promise.resolve({ liquidationCalls: [] });
    });

    (loader as any).client = { request: mockRequest };

    const result = await loader.load();

    expect(result.events.length).toBe(10); // 2 pages * 5 events
    
    // Verify there was delay between calls
    if (callTimestamps.length > 1) {
      const delay = callTimestamps[1] - callTimestamps[0];
      expect(delay).toBeGreaterThanOrEqual(requestIntervalMs - 20); // Allow some timing variance
    }
  });
});
