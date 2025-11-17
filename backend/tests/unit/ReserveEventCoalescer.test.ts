import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReserveEventCoalescer, type ReserveEvent, type CoalescedBatch } from '../../src/services/ReserveEventCoalescer.js';

describe('ReserveEventCoalescer', () => {
  let coalescer: ReserveEventCoalescer;

  beforeEach(() => {
    coalescer = new ReserveEventCoalescer({
      debounceWindowMs: 40,
      maxBatchSize: 50,
      perReserveCoalescing: false // Global coalescing for these tests
    });
  });

  afterEach(() => {
    coalescer.stop();
  });

  it('should initialize with correct parameters', () => {
    expect(coalescer).toBeDefined();
  });

  it('should coalesce multiple events in debounce window', async () => {
    let emittedBatch: CoalescedBatch | null = null;
    
    coalescer.on('batch', (batch: CoalescedBatch) => {
      emittedBatch = batch;
    });

    // Add multiple events in quick succession
    const event1: ReserveEvent = {
      reserve: '0xReserve1',
      blockNumber: 1000,
      timestamp: Date.now(),
      eventType: 'ReserveDataUpdated'
    };

    const event2: ReserveEvent = {
      reserve: '0xReserve1',
      blockNumber: 1000,
      timestamp: Date.now() + 10,
      eventType: 'ReserveDataUpdated'
    };

    const event3: ReserveEvent = {
      reserve: '0xReserve2',
      blockNumber: 1000,
      timestamp: Date.now() + 20,
      eventType: 'ReserveDataUpdated'
    };

    coalescer.addEvent(event1);
    coalescer.addEvent(event2);
    coalescer.addEvent(event3);

    // Wait for debounce window to expire
    await new Promise(resolve => setTimeout(resolve, 60));

    expect(emittedBatch).not.toBeNull();
    expect(emittedBatch?.eventCount).toBe(3);
    expect(emittedBatch?.reserves.length).toBeGreaterThanOrEqual(1);
  });

  it('should deduplicate reserves in batch', async () => {
    let emittedBatch: CoalescedBatch | null = null;
    
    coalescer.on('batch', (batch: CoalescedBatch) => {
      emittedBatch = batch;
    });

    // Add multiple events for same reserve
    for (let i = 0; i < 5; i++) {
      coalescer.addEvent({
        reserve: '0xReserve1',
        blockNumber: 1000,
        timestamp: Date.now() + i * 5,
        eventType: 'ReserveDataUpdated'
      });
    }

    await new Promise(resolve => setTimeout(resolve, 60));

    expect(emittedBatch).not.toBeNull();
    expect(emittedBatch?.eventCount).toBe(5);
    // In global mode, reserves are deduplicated
    expect(emittedBatch?.reserves).toContain('0xreserve1'); // Lowercased
  });

  it('should force flush when batch size exceeded', async () => {
    let emittedBatch: CoalescedBatch | null = null;
    
    coalescer.on('batch', (batch: CoalescedBatch) => {
      emittedBatch = batch;
    });

    // Add maxBatchSize + 1 events
    for (let i = 0; i <= 50; i++) {
      coalescer.addEvent({
        reserve: `0xReserve${i}`,
        blockNumber: 1000,
        timestamp: Date.now() + i,
        eventType: 'ReserveDataUpdated'
      });
    }

    // Should have flushed immediately due to size
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(emittedBatch).not.toBeNull();
    expect(emittedBatch?.eventCount).toBeGreaterThanOrEqual(50);
  });

  it('should handle per-reserve coalescing mode', async () => {
    const perReserveCoalescer = new ReserveEventCoalescer({
      debounceWindowMs: 40,
      maxBatchSize: 50,
      perReserveCoalescing: true
    });

    let emittedBatches: CoalescedBatch[] = [];
    
    perReserveCoalescer.on('batch', (batch: CoalescedBatch) => {
      emittedBatches.push(batch);
    });

    // Add events for different reserves
    perReserveCoalescer.addEvent({
      reserve: '0xReserve1',
      blockNumber: 1000,
      timestamp: Date.now(),
      eventType: 'ReserveDataUpdated'
    });

    perReserveCoalescer.addEvent({
      reserve: '0xReserve2',
      blockNumber: 1000,
      timestamp: Date.now() + 10,
      eventType: 'ReserveDataUpdated'
    });

    await new Promise(resolve => setTimeout(resolve, 60));

    // Should emit separate batches for each reserve
    expect(emittedBatches.length).toBeGreaterThan(0);

    perReserveCoalescer.stop();
  });

  it('should flush all pending batches on stop', async () => {
    let emittedBatches: CoalescedBatch[] = [];
    
    coalescer.on('batch', (batch: CoalescedBatch) => {
      emittedBatches.push(batch);
    });

    // Add events but don't wait for debounce
    coalescer.addEvent({
      reserve: '0xReserve1',
      blockNumber: 1000,
      timestamp: Date.now(),
      eventType: 'ReserveDataUpdated'
    });

    coalescer.addEvent({
      reserve: '0xReserve2',
      blockNumber: 1000,
      timestamp: Date.now() + 5,
      eventType: 'ReserveDataUpdated'
    });

    // Stop immediately - should flush pending batches
    coalescer.stop();

    expect(emittedBatches.length).toBeGreaterThan(0);
  });

  it('should track statistics', () => {
    coalescer.addEvent({
      reserve: '0xReserve1',
      blockNumber: 1000,
      timestamp: Date.now(),
      eventType: 'ReserveDataUpdated'
    });

    const stats = coalescer.getStats();
    expect(stats.totalPendingEvents).toBeGreaterThan(0);
  });

  it('should handle rapid bursts efficiently', async () => {
    let emittedBatches: CoalescedBatch[] = [];
    
    coalescer.on('batch', (batch: CoalescedBatch) => {
      emittedBatches.push(batch);
    });

    // Simulate rapid burst of 100 events
    for (let i = 0; i < 100; i++) {
      coalescer.addEvent({
        reserve: `0xReserve${i % 10}`, // 10 unique reserves
        blockNumber: 1000,
        timestamp: Date.now() + i,
        eventType: 'ReserveDataUpdated'
      });
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    // Should coalesce into fewer batches
    expect(emittedBatches.length).toBeLessThan(100);
    
    const totalEvents = emittedBatches.reduce((sum, batch) => sum + batch.eventCount, 0);
    expect(totalEvents).toBe(100);
  });
});
