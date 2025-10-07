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
});
