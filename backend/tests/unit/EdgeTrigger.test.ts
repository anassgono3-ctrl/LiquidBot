import { describe, it, expect, beforeEach, vi } from 'vitest';

import { RealTimeHFService } from '../../src/services/RealTimeHFService.js';

// Mock config
vi.mock('../../src/config/index.js', () => ({
  config: {
    useRealtimeHF: true,
    wsRpcUrl: 'wss://test.example.com',
    useFlashblocks: false,
    flashblocksWsUrl: undefined,
    multicall3Address: '0xca11bde05977b3631167028862be2a173976ca11',
    aavePool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    executionHfThresholdBps: 9800, // 0.98
    realtimeSeedIntervalSec: 45,
    candidateMax: 300,
    chainlinkFeeds: undefined,
    rpcUrl: 'https://test.example.com',
    hysteresisBps: 20, // 0.20%
  }
}));

describe('RealTimeHFService Edge Triggering', () => {
  let service: RealTimeHFService;

  beforeEach(() => {
    // Create service with skipWsConnection to avoid actual network calls
    service = new RealTimeHFService({ skipWsConnection: true });
  });

  describe('shouldEmit', () => {
    it('should emit on first safe->liq transition', () => {
      // Access private method via type assertion for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shouldEmit = (service as any).shouldEmit.bind(service);
      
      // First time seeing this user, HF below threshold
      const result = shouldEmit('0x123', 0.95, 1000);
      
      expect(result.shouldEmit).toBe(true);
      expect(result.reason).toBe('safe_to_liq');
    });

    it('should not emit if user is safe', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shouldEmit = (service as any).shouldEmit.bind(service);
      
      // User is safe (HF above 0.98)
      const result = shouldEmit('0x123', 1.05, 1000);
      
      expect(result.shouldEmit).toBe(false);
    });

    it('should emit when HF worsens by hysteresis threshold', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shouldEmit = (service as any).shouldEmit.bind(service);
      
      // First check: user liquidatable at HF=0.95
      shouldEmit('0x123', 0.95, 1000);
      
      // Second check: HF worsened from 0.95 to 0.948 (>0.2% decrease: 0.95 * 0.998 = 0.9481)
      const result = shouldEmit('0x123', 0.948, 1001);
      
      expect(result.shouldEmit).toBe(true);
      expect(result.reason).toBe('worsened');
    });

    it('should not emit if HF worsened but less than hysteresis', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shouldEmit = (service as any).shouldEmit.bind(service);
      
      // First check: user liquidatable at HF=0.95
      shouldEmit('0x123', 0.95, 1000);
      
      // Second check: HF worsened slightly (less than 0.2%)
      const result = shouldEmit('0x123', 0.949, 1001);
      
      expect(result.shouldEmit).toBe(false);
    });

    it('should not emit more than once per block', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shouldEmit = (service as any).shouldEmit.bind(service);
      
      // First emission at block 1000
      const result1 = shouldEmit('0x123', 0.95, 1000);
      expect(result1.shouldEmit).toBe(true);
      
      // Update lastEmitBlock manually
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).lastEmitBlock.set('0x123', 1000);
      
      // Try to emit again at same block
      const result2 = shouldEmit('0x123', 0.94, 1000);
      expect(result2.shouldEmit).toBe(false);
    });

    it('should allow emission at new block after previous emission', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shouldEmit = (service as any).shouldEmit.bind(service);
      
      // First emission at block 1000
      shouldEmit('0x123', 0.95, 1000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).lastEmitBlock.set('0x123', 1000);
      
      // HF worsened significantly at block 1001
      const result = shouldEmit('0x123', 0.93, 1001);
      
      expect(result.shouldEmit).toBe(true);
      expect(result.reason).toBe('worsened');
    });

    it('should transition back to safe and not emit', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shouldEmit = (service as any).shouldEmit.bind(service);
      
      // User was liquidatable
      shouldEmit('0x123', 0.95, 1000);
      
      // User recovered (HF > threshold)
      const result = shouldEmit('0x123', 1.05, 1001);
      
      expect(result.shouldEmit).toBe(false);
    });

    it('should re-emit on safe->liq transition after recovery', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shouldEmit = (service as any).shouldEmit.bind(service);
      
      // Initial liquidatable state
      shouldEmit('0x123', 0.95, 1000);
      
      // User recovered
      shouldEmit('0x123', 1.05, 1001);
      
      // User became liquidatable again (new edge trigger)
      const result = shouldEmit('0x123', 0.96, 1002);
      
      expect(result.shouldEmit).toBe(true);
      expect(result.reason).toBe('safe_to_liq');
    });
  });

  describe('edge triggering with multiple users', () => {
    it('should handle multiple users independently', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shouldEmit = (service as any).shouldEmit.bind(service);
      
      // User A becomes liquidatable
      const resultA1 = shouldEmit('0xA', 0.95, 1000);
      expect(resultA1.shouldEmit).toBe(true);
      
      // User B becomes liquidatable (independent of User A)
      const resultB1 = shouldEmit('0xB', 0.97, 1000);
      expect(resultB1.shouldEmit).toBe(true);
      
      // User A HF worsens slightly (less than hysteresis)
      const resultA2 = shouldEmit('0xA', 0.949, 1001);
      expect(resultA2.shouldEmit).toBe(false);
      
      // User B HF worsens significantly (>0.2% from 0.97)
      const resultB2 = shouldEmit('0xB', 0.968, 1001);
      expect(resultB2.shouldEmit).toBe(true);
    });
  });

  describe('hysteresis calculation', () => {
    it('should calculate 0.2% hysteresis correctly', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shouldEmit = (service as any).shouldEmit.bind(service);
      
      // HF = 0.97 (below threshold), 0.2% of 0.97 = 0.00194
      shouldEmit('0x123', 0.97, 1000);
      
      // HF = 0.968 (>0.2% decrease from 0.97) should trigger
      const result = shouldEmit('0x123', 0.968, 1001);
      expect(result.shouldEmit).toBe(true);
    });

    it('should handle small HF values correctly', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shouldEmit = (service as any).shouldEmit.bind(service);
      
      // HF = 0.90, 0.2% of 0.90 = 0.0018
      shouldEmit('0x123', 0.90, 1000);
      
      // HF = 0.8982 (0.2% decrease) should trigger
      const result = shouldEmit('0x123', 0.8982, 1001);
      expect(result.shouldEmit).toBe(true);
    });
  });

  describe('integration with liquidatable event emission', () => {
    it('should emit liquidatable event with edge trigger reason', async () => {
      // Use promise-based approach instead of done callback
      const eventPromise = new Promise((resolve) => {
        service.on('liquidatable', (event) => {
          expect(event.userAddress).toBe('0x123');
          expect(event.healthFactor).toBeLessThan(0.98);
          expect(event.blockNumber).toBeDefined();
          resolve(event);
        });
      });

      // Manually trigger shouldEmit logic
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shouldEmit = (service as any).shouldEmit.bind(service);
      const result = shouldEmit('0x123', 0.95, 1000);
      
      if (result.shouldEmit) {
        service.emit('liquidatable', {
          userAddress: '0x123',
          healthFactor: 0.95,
          blockNumber: 1000,
          triggerType: 'head' as const,
          timestamp: Date.now()
        });
      }
      
      await eventPromise;
    });
  });
});
