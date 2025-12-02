/**
 * FastpathPublisher Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { FastpathPublisher } from '../../../src/fastpath/FastpathPublisher.js';

describe('FastpathPublisher', () => {
  let redis: any;
  let publisher: FastpathPublisher;

  beforeEach(() => {
    // Mock Redis client
    redis = {
      publish: vi.fn().mockResolvedValue(0)
    };
    
    // Enable publishing in tests
    process.env.FASTPATH_EVENT_PUBLISH = 'true';
    process.env.CRITICAL_LANE_PUBLISH_MIN_HF = '1.0';
    publisher = new FastpathPublisher(redis);
  });

  it('should publish event for HF < 1.0', async () => {
    const event = {
      user: '0x1234567890123456789012345678901234567890',
      block: 12345,
      hfRay: '950000000000000000', // 0.95
      ts: Date.now(),
      triggerType: 'event'
    };

    const result = await publisher.publish(event);
    
    expect(result).toBe(false); // No subscribers in test
    expect(redis.publish).toHaveBeenCalledWith(
      'critical_lane.events',
      JSON.stringify(event)
    );
  });

  it('should not publish event for HF >= 1.0', async () => {
    const event = {
      user: '0x1234567890123456789012345678901234567890',
      block: 12345,
      hfRay: '1050000000000000000', // 1.05
      ts: Date.now(),
      triggerType: 'event'
    };

    const result = await publisher.publish(event);
    
    expect(result).toBe(false);
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('should report enabled status and channel name', () => {
    expect(publisher.isEnabled()).toBe(true);
    expect(publisher.getChannelName()).toBe('critical_lane.events');
  });
});
