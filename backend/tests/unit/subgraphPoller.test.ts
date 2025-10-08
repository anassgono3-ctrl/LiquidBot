import { describe, it, expect, vi, beforeEach } from 'vitest';

import { startSubgraphPoller } from '../../src/polling/subgraphPoller.js';

vi.useFakeTimers();

describe('subgraphPoller', () => {
  const getLiquidationCalls = vi.fn();
  const logger = {
    info: vi.fn(),
    error: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getLiquidationCalls.mockReset();
  });

  it('invokes immediate tick and subsequent interval', async () => {
    getLiquidationCalls
      .mockResolvedValueOnce([])          // first immediate
      .mockResolvedValueOnce([{ id: 'a' }]); // second (after interval)

    const poller = startSubgraphPoller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service: { getLiquidationCalls } as any,
      intervalMs: 5000,
      logger
    });

    // Immediate tick
    expect(getLiquidationCalls).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(getLiquidationCalls).toHaveBeenCalledTimes(2);

    poller.stop();
    await vi.advanceTimersByTimeAsync(5000);
    // no further calls
    expect(getLiquidationCalls).toHaveBeenCalledTimes(2);
  });

  it('continues after an error', async () => {
    getLiquidationCalls
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const poller = startSubgraphPoller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service: { getLiquidationCalls } as any,
      intervalMs: 2000,
      logger
    });

    await vi.advanceTimersByTimeAsync(2000); // error cycle
    await vi.advanceTimersByTimeAsync(2000); // recovery cycle
    expect(getLiquidationCalls).toHaveBeenCalledTimes(3);

    poller.stop();
  });

  it('calls onLiquidations callback when provided', async () => {
    getLiquidationCalls
      .mockResolvedValueOnce([{ id: 'l1' }])
      .mockResolvedValueOnce([{ id: 'l2' }]);

    const onLiquidations = vi.fn();
    const poller = startSubgraphPoller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service: { getLiquidationCalls } as any,
      intervalMs: 3000,
      onLiquidations
    });

    await vi.advanceTimersByTimeAsync(3000);
    expect(onLiquidations).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it('calls onNewLiquidations only for new events', async () => {
    // Disable bootstrap suppression for this test
    const originalEnv = process.env.IGNORE_BOOTSTRAP_BATCH;
    process.env.IGNORE_BOOTSTRAP_BATCH = 'false';

    const mockEvents = [
      { id: 'l1', timestamp: 1000 },
      { id: 'l2', timestamp: 2000 },
      { id: 'l3', timestamp: 3000 }
    ];

    getLiquidationCalls
      .mockResolvedValueOnce([mockEvents[0], mockEvents[1]])     // first poll: 2 new
      .mockResolvedValueOnce([mockEvents[0], mockEvents[1]])     // second poll: 0 new (overlap)
      .mockResolvedValueOnce([mockEvents[1], mockEvents[2]]);    // third poll: 1 new

    const onNewLiquidations = vi.fn();
    const poller = startSubgraphPoller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service: { getLiquidationCalls } as any,
      intervalMs: 2000,
      onNewLiquidations
    });

    // Wait for first tick to complete
    await vi.waitFor(() => {
      expect(onNewLiquidations).toHaveBeenCalledTimes(1);
    });
    expect(onNewLiquidations).toHaveBeenCalledWith([mockEvents[0], mockEvents[1]]);

    // Second tick - no new events (callback should not be called)
    await vi.advanceTimersByTimeAsync(2000);
    expect(onNewLiquidations).toHaveBeenCalledTimes(1); // still 1

    // Third tick - 1 new event
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => {
      expect(onNewLiquidations).toHaveBeenCalledTimes(2);
    });
    expect(onNewLiquidations).toHaveBeenNthCalledWith(2, [mockEvents[2]]);

    poller.stop();
    
    // Restore env
    if (originalEnv !== undefined) {
      process.env.IGNORE_BOOTSTRAP_BATCH = originalEnv;
    } else {
      delete process.env.IGNORE_BOOTSTRAP_BATCH;
    }
  });

  it('exposes tracker stats via getTrackerStats', async () => {
    getLiquidationCalls.mockResolvedValue([
      { id: 'l1' },
      { id: 'l2' }
    ]);

    const poller = startSubgraphPoller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service: { getLiquidationCalls } as any,
      intervalMs: 5000,
      pollLimit: 100,
      trackMax: 5000
    });

    // Wait for first tick to complete and tracker to be updated
    await vi.waitFor(() => {
      const stats = poller.getTrackerStats();
      expect(stats?.seenTotal).toBe(2);
    }, { timeout: 1000 });

    const stats = poller.getTrackerStats();
    expect(stats).not.toBeNull();
    expect(stats?.pollLimit).toBe(100);

    poller.stop();
  });

  it('attaches health factors to new liquidation events when on-demand resolver provided', async () => {
    // Disable bootstrap suppression for this test
    const originalEnv = process.env.IGNORE_BOOTSTRAP_BATCH;
    process.env.IGNORE_BOOTSTRAP_BATCH = 'false';

    const mockEvents = [
      { id: 'l1', user: '0xuser1', timestamp: 1000 },
      { id: 'l2', user: '0xuser2', timestamp: 2000 }
    ];

    getLiquidationCalls.mockResolvedValue(mockEvents);

    const mockResolver = {
      getHealthFactor: vi.fn()
        .mockResolvedValueOnce(1.5)  // For 0xuser1
        .mockResolvedValueOnce(2.3)  // For 0xuser2
    };

    const onNewLiquidations = vi.fn();
    const poller = startSubgraphPoller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service: { getLiquidationCalls } as any,
      intervalMs: 3000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onDemandHealthFactor: mockResolver as any,
      onNewLiquidations
    });

    // Wait for first tick
    await vi.waitFor(() => {
      expect(onNewLiquidations).toHaveBeenCalledTimes(1);
    }, { timeout: 1000 });

    // Verify resolver was called individually for each unique user
    expect(mockResolver.getHealthFactor).toHaveBeenCalledWith('0xuser1');
    expect(mockResolver.getHealthFactor).toHaveBeenCalledWith('0xuser2');

    // Verify health factors were attached to events
    const calledEvents = onNewLiquidations.mock.calls[0][0];
    expect(calledEvents[0].healthFactor).toBe(1.5);
    expect(calledEvents[1].healthFactor).toBe(2.3);

    poller.stop();
    
    // Restore env
    if (originalEnv !== undefined) {
      process.env.IGNORE_BOOTSTRAP_BATCH = originalEnv;
    } else {
      delete process.env.IGNORE_BOOTSTRAP_BATCH;
    }
  });

  it('handles on-demand resolver errors gracefully without blocking liquidation processing', async () => {
    // Disable bootstrap suppression for this test
    const originalEnv = process.env.IGNORE_BOOTSTRAP_BATCH;
    process.env.IGNORE_BOOTSTRAP_BATCH = 'false';

    const mockEvents = [
      { id: 'l1', user: '0xuser1', timestamp: 1000 }
    ];

    getLiquidationCalls.mockResolvedValue(mockEvents);

    const mockResolver = {
      getHealthFactor: vi.fn().mockRejectedValue(new Error('Resolver failed'))
    };

    const onNewLiquidations = vi.fn();
    const poller = startSubgraphPoller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service: { getLiquidationCalls } as any,
      intervalMs: 3000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onDemandHealthFactor: mockResolver as any,
      onNewLiquidations,
      logger
    });

    // Wait for first tick
    await vi.waitFor(() => {
      expect(onNewLiquidations).toHaveBeenCalledTimes(1);
    }, { timeout: 1000 });

    // Verify onNewLiquidations was still called despite resolver error
    expect(onNewLiquidations).toHaveBeenCalledWith(mockEvents);
    
    // Verify error was logged
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('health factor resolution error')
    );

    poller.stop();
    
    // Restore env
    if (originalEnv !== undefined) {
      process.env.IGNORE_BOOTSTRAP_BATCH = originalEnv;
    } else {
      delete process.env.IGNORE_BOOTSTRAP_BATCH;
    }
  });

  it('does not resolve health factors when resolver not provided', async () => {
    // Disable bootstrap suppression for this test
    const originalEnv = process.env.IGNORE_BOOTSTRAP_BATCH;
    process.env.IGNORE_BOOTSTRAP_BATCH = 'false';

    const mockEvents = [
      { id: 'l1', user: '0xuser1', timestamp: 1000 }
    ];

    getLiquidationCalls.mockResolvedValue(mockEvents);

    const onNewLiquidations = vi.fn();
    const poller = startSubgraphPoller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service: { getLiquidationCalls } as any,
      intervalMs: 3000,
      onNewLiquidations
    });

    // Wait for first tick
    await vi.waitFor(() => {
      expect(onNewLiquidations).toHaveBeenCalledTimes(1);
    }, { timeout: 1000 });

    // Verify events were passed through without HF
    const calledEvents = onNewLiquidations.mock.calls[0][0];
    expect(calledEvents[0].healthFactor).toBeUndefined();

    poller.stop();
    
    // Restore env
    if (originalEnv !== undefined) {
      process.env.IGNORE_BOOTSTRAP_BATCH = originalEnv;
    } else {
      delete process.env.IGNORE_BOOTSTRAP_BATCH;
    }
  });

  it('ignores bootstrap batch when IGNORE_BOOTSTRAP_BATCH=true', async () => {
    // Enable bootstrap suppression for this test
    const originalEnv = process.env.IGNORE_BOOTSTRAP_BATCH;
    process.env.IGNORE_BOOTSTRAP_BATCH = 'true';

    const mockEvents = [
      { id: 'l1', timestamp: 1000 },
      { id: 'l2', timestamp: 2000 }
    ];

    getLiquidationCalls
      .mockResolvedValueOnce(mockEvents)     // first poll (bootstrap)
      .mockResolvedValueOnce([mockEvents[1], { id: 'l3', timestamp: 3000 }]); // second poll

    const onNewLiquidations = vi.fn();
    const onLiquidations = vi.fn();
    const poller = startSubgraphPoller({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service: { getLiquidationCalls } as any,
      intervalMs: 2000,
      onNewLiquidations,
      onLiquidations,
      logger
    });

    // Wait for first tick (bootstrap should be suppressed)
    await vi.waitFor(() => {
      expect(onLiquidations).toHaveBeenCalledTimes(1);
    });
    
    // onNewLiquidations should NOT have been called for bootstrap
    expect(onNewLiquidations).toHaveBeenCalledTimes(0);
    
    // Verify bootstrap suppression was logged
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('bootstrap batch ignored')
    );

    // Second tick should process new events normally
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => {
      expect(onNewLiquidations).toHaveBeenCalledTimes(1);
    });

    poller.stop();
    
    // Restore env
    if (originalEnv !== undefined) {
      process.env.IGNORE_BOOTSTRAP_BATCH = originalEnv;
    } else {
      delete process.env.IGNORE_BOOTSTRAP_BATCH;
    }
  });
});
