import { describe, it, expect, beforeEach } from 'vitest';

import { LatencyTracker } from '../../../src/exec/fastpath/LatencyTracker.js';

describe('LatencyTracker', () => {
  let tracker: LatencyTracker;
  const testId = 'user123';

  beforeEach(() => {
    tracker = new LatencyTracker(true);
    tracker.clear();
  });

  describe('tracking lifecycle', () => {
    it('should start tracking for a given ID', () => {
      tracker.startTracking(testId);
      expect(tracker.getTrackingCount()).toBe(1);
    });

    it('should record all timestamps', async () => {
      tracker.startTracking(testId);
      
      tracker.recordBlockReceived(testId);
      await new Promise(resolve => setTimeout(resolve, 5));
      
      tracker.recordCandidateDetected(testId);
      await new Promise(resolve => setTimeout(resolve, 5));
      
      tracker.recordPlanReady(testId);
      await new Promise(resolve => setTimeout(resolve, 5));
      
      tracker.recordTxSigned(testId);
      await new Promise(resolve => setTimeout(resolve, 5));
      
      tracker.recordTxBroadcast(testId);
      await new Promise(resolve => setTimeout(resolve, 5));
      
      tracker.recordFirstInclusionCheck(testId);

      const timestamps = tracker.getTimestamps(testId);
      expect(timestamps).toBeDefined();
      expect(timestamps?.blockReceivedAt).toBeDefined();
      expect(timestamps?.candidateDetectedAt).toBeDefined();
      expect(timestamps?.planReadyAt).toBeDefined();
      expect(timestamps?.txSignedAt).toBeDefined();
      expect(timestamps?.txBroadcastAt).toBeDefined();
      expect(timestamps?.firstInclusionCheckAt).toBeDefined();
    });

    it('should calculate latency on finalize', async () => {
      tracker.startTracking(testId);
      tracker.recordBlockReceived(testId);
      await new Promise(resolve => setTimeout(resolve, 10));
      tracker.recordTxBroadcast(testId);

      const latency = tracker.finalize(testId);
      expect(latency).toBeDefined();
      expect(latency).toBeGreaterThanOrEqual(10);
    });

    it('should remove tracking after finalize', () => {
      tracker.startTracking(testId);
      tracker.finalize(testId);
      expect(tracker.getTrackingCount()).toBe(0);
    });
  });

  describe('disabled mode', () => {
    beforeEach(() => {
      tracker = new LatencyTracker(false);
    });

    it('should not track when disabled', () => {
      tracker.startTracking(testId);
      tracker.recordBlockReceived(testId);
      expect(tracker.getTimestamps(testId)).toBeUndefined();
    });

    it('should return undefined on finalize when disabled', () => {
      tracker.startTracking(testId);
      expect(tracker.finalize(testId)).toBeUndefined();
    });
  });

  describe('multiple tracking', () => {
    it('should track multiple IDs independently', () => {
      tracker.startTracking('user1');
      tracker.startTracking('user2');
      tracker.startTracking('user3');
      
      expect(tracker.getTrackingCount()).toBe(3);

      tracker.recordBlockReceived('user1');
      tracker.recordBlockReceived('user2');

      const ts1 = tracker.getTimestamps('user1');
      const ts2 = tracker.getTimestamps('user2');
      const ts3 = tracker.getTimestamps('user3');

      expect(ts1?.blockReceivedAt).toBeDefined();
      expect(ts2?.blockReceivedAt).toBeDefined();
      expect(ts3?.blockReceivedAt).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('should clear all tracked timestamps', () => {
      tracker.startTracking('user1');
      tracker.startTracking('user2');
      expect(tracker.getTrackingCount()).toBe(2);

      tracker.clear();
      expect(tracker.getTrackingCount()).toBe(0);
    });
  });

  describe('partial timestamps', () => {
    it('should handle missing intermediate timestamps', () => {
      tracker.startTracking(testId);
      tracker.recordBlockReceived(testId);
      tracker.recordTxBroadcast(testId);

      const latency = tracker.finalize(testId);
      expect(latency).toBeDefined();
    });

    it('should return undefined if no start/end timestamps', () => {
      tracker.startTracking(testId);
      tracker.recordPlanReady(testId);

      const latency = tracker.finalize(testId);
      expect(latency).toBeUndefined();
    });
  });
});
