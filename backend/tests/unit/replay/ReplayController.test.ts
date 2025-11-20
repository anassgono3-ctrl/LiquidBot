/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ReplayController } from '../../../src/replay/ReplayController.js';
import { Reporter } from '../../../src/replay/Reporter.js';

describe('ReplayController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with ground truth available', async () => {
    const mockLoader = {
      load: vi.fn().mockResolvedValue({
        events: [
          { id: '1', timestamp: 1000, user: '0xuser1', liquidator: '0xliq1' },
          { id: '2', timestamp: 2000, user: '0xuser2', liquidator: '0xliq2' }
        ]
      })
    } as any;

    const reporter = new Reporter();
    const controller = new ReplayController(mockLoader, reporter);

    const context = await controller.initialize({
      startTimestamp: 1000,
      endTimestamp: 3000
    });

    expect(context.groundTruthAvailable).toBe(true);
    expect(context.groundTruth.length).toBe(2);
    expect(context.groundTruthError).toBeUndefined();
    expect(mockLoader.load).toHaveBeenCalledOnce();
  });

  it('should gracefully fallback when ground truth loading fails', async () => {
    const mockLoader = {
      load: vi.fn().mockResolvedValue({
        events: [],
        error: 'Auth error: missing authorization header'
      })
    } as any;

    const reporter = new Reporter();
    const controller = new ReplayController(mockLoader, reporter);

    const context = await controller.initialize({
      startTimestamp: 1000,
      endTimestamp: 3000
    });

    expect(context.groundTruthAvailable).toBe(false);
    expect(context.groundTruth.length).toBe(0);
    expect(context.groundTruthError).toBe('Auth error: missing authorization header');
    
    // Controller should not throw, allowing replay to continue
    expect(controller).toBeDefined();
  });

  it('should handle partial ground truth data', async () => {
    const mockLoader = {
      load: vi.fn().mockResolvedValue({
        events: [
          { id: '1', timestamp: 1000, user: '0xuser1', liquidator: '0xliq1' }
        ],
        error: 'Request failed: rate limit exceeded',
        partial: true
      })
    } as any;

    const reporter = new Reporter();
    const controller = new ReplayController(mockLoader, reporter);

    const context = await controller.initialize({
      startTimestamp: 1000,
      endTimestamp: 3000
    });

    expect(context.groundTruthAvailable).toBe(true); // Has some data
    expect(context.groundTruth.length).toBe(1);
    expect(context.groundTruthError).toBeDefined();
    expect(context.groundTruthPartial).toBe(true);
  });

  it('should handle loader throwing unexpected error', async () => {
    const mockLoader = {
      load: vi.fn().mockRejectedValue(new Error('Network failure'))
    } as any;

    const reporter = new Reporter();
    const controller = new ReplayController(mockLoader, reporter);

    const context = await controller.initialize({
      startTimestamp: 1000,
      endTimestamp: 3000
    });

    // Should gracefully handle error and continue in fallback mode
    expect(context.groundTruthAvailable).toBe(false);
    expect(context.groundTruth.length).toBe(0);
    expect(context.groundTruthError).toContain('Network failure');
  });

  it('should process block range and update reporter', async () => {
    const mockLoader = {
      load: vi.fn().mockResolvedValue({
        events: [{ id: '1', timestamp: 1000, user: '0xuser1', liquidator: '0xliq1' }]
      })
    } as any;

    const reporter = new Reporter();
    const controller = new ReplayController(mockLoader, reporter);

    await controller.initialize({ startTimestamp: 1000, endTimestamp: 3000 });
    await controller.processBlockRange(1000, 1100);

    const summary = controller.finalize();
    
    expect(summary.totalBlocks).toBe(101); // 1100 - 1000 + 1
    expect(summary.groundTruthAvailable).toBe(true);
    expect(summary.groundTruthCount).toBe(1);
  });

  it('should throw if processBlockRange called before initialize', async () => {
    const mockLoader = {
      load: vi.fn()
    } as any;

    const controller = new ReplayController(mockLoader);

    await expect(controller.processBlockRange(1000, 1100)).rejects.toThrow(
      'ReplayController not initialized'
    );
  });

  it('should include ground truth metadata in finalized summary', async () => {
    const mockLoader = {
      load: vi.fn().mockResolvedValue({
        events: [
          { id: '1', timestamp: 1000, user: '0xuser1', liquidator: '0xliq1' },
          { id: '2', timestamp: 2000, user: '0xuser2', liquidator: '0xliq2' },
          { id: '3', timestamp: 3000, user: '0xuser3', liquidator: '0xliq3' }
        ]
      })
    } as any;

    const reporter = new Reporter();
    const controller = new ReplayController(mockLoader, reporter);

    await controller.initialize({
      startTimestamp: 1000,
      endTimestamp: 3000,
      startBlock: 100,
      endBlock: 200
    });

    const summary = controller.finalize();

    expect(summary.groundTruthAvailable).toBe(true);
    expect(summary.groundTruthCount).toBe(3);
    expect(summary.startTimestamp).toBe(1000);
    expect(summary.endTimestamp).toBe(3000);
    expect(summary.startBlock).toBe(100);
    expect(summary.endBlock).toBe(200);
    expect(summary.timestamp).toBeDefined();
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should set groundTruthAvailable=false in summary when no events loaded', async () => {
    const mockLoader = {
      load: vi.fn().mockResolvedValue({
        events: [],
        error: 'Auth error: unauthorized'
      })
    } as any;

    const reporter = new Reporter();
    const controller = new ReplayController(mockLoader, reporter);

    await controller.initialize({ startTimestamp: 1000, endTimestamp: 3000 });
    const summary = controller.finalize();

    expect(summary.groundTruthAvailable).toBe(false);
    expect(summary.groundTruthCount).toBe(0);
    expect(summary.groundTruthErrorMessage).toContain('Auth error');
  });
});
