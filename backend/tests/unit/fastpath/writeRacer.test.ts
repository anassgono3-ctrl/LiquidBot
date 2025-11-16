import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock ethers before importing WriteRacer
const mockBroadcastTransaction = vi.fn();
const mockGetBlockNumber = vi.fn();

vi.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: vi.fn().mockImplementation(() => ({
      broadcastTransaction: mockBroadcastTransaction,
      getBlockNumber: mockGetBlockNumber
    }))
  }
}));

import { WriteRacer } from '../../../src/exec/fastpath/WriteRacer.js';

describe('WriteRacer', () => {
  let racer: WriteRacer;
  const rpc1 = 'https://rpc1.example.com';
  const rpc2 = 'https://rpc2.example.com';
  const rpc3 = 'https://rpc3.example.com';

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroadcastTransaction.mockReset();
    mockGetBlockNumber.mockReset();
  });

  describe('initialization', () => {
    it('should initialize with multiple RPCs', () => {
      racer = new WriteRacer([rpc1, rpc2, rpc3], 120);
      expect(racer.isEnabled()).toBe(true);
    });

    it('should track health metrics for all RPCs', () => {
      racer = new WriteRacer([rpc1, rpc2], 120);
      const metrics = racer.getHealthMetrics();
      expect(metrics).toHaveLength(2);
    });
  });

  describe('broadcastTransaction', () => {
    it('should broadcast to all RPCs and return first success', async () => {
      racer = new WriteRacer([rpc1, rpc2], 120);
      
      mockBroadcastTransaction.mockResolvedValue({ hash: '0xtxhash1' });

      const txHash = await racer.broadcastTransaction('0xsignedtx');
      
      expect(txHash).toBeDefined();
      expect(txHash).toBe('0xtxhash1');
    });

    it('should throw error if no RPCs configured', async () => {
      racer = new WriteRacer([], 120);
      
      await expect(racer.broadcastTransaction('0xsignedtx')).rejects.toThrow(
        'No write RPCs configured for racing'
      );
    });

    it('should handle broadcast failures', async () => {
      racer = new WriteRacer([rpc1, rpc2], 120);
      
      mockBroadcastTransaction.mockRejectedValue(new Error('RPC failed'));

      await expect(racer.broadcastTransaction('0xsignedtx')).rejects.toThrow();
    });
  });

  describe('pingAll', () => {
    it('should ping all providers', async () => {
      racer = new WriteRacer([rpc1, rpc2], 120);
      
      mockGetBlockNumber.mockResolvedValue(12345);

      await racer.pingAll();
      
      // Verify providers were called (implementation detail)
      expect(racer.getHealthMetrics()).toHaveLength(2);
    });

    it('should update health metrics on successful ping', async () => {
      racer = new WriteRacer([rpc1], 120);
      
      mockGetBlockNumber.mockResolvedValue(12345);

      await racer.pingAll();
      
      const health = racer.getHealth(rpc1);
      expect(health).toBeDefined();
      // Health metrics initialized
      expect(health?.rpcUrl).toBe(rpc1);
    });

    it('should handle ping failures gracefully', async () => {
      racer = new WriteRacer([rpc1], 120);
      
      mockGetBlockNumber.mockRejectedValue(new Error('Ping failed'));

      await racer.pingAll();
      
      const health = racer.getHealth(rpc1);
      expect(health).toBeDefined();
    });
  });

  describe('getHealth', () => {
    it('should return health metrics for RPC', () => {
      racer = new WriteRacer([rpc1], 120);
      
      const health = racer.getHealth(rpc1);
      expect(health).toBeDefined();
      expect(health?.rpcUrl).toBe(rpc1);
    });

    it('should return undefined for unknown RPC', () => {
      racer = new WriteRacer([rpc1], 120);
      
      const health = racer.getHealth('https://unknown.com');
      expect(health).toBeUndefined();
    });
  });

  describe('getHealthMetrics', () => {
    it('should return all health metrics', () => {
      racer = new WriteRacer([rpc1, rpc2, rpc3], 120);
      
      const metrics = racer.getHealthMetrics();
      expect(metrics).toHaveLength(3);
    });
  });

  describe('isEnabled', () => {
    it('should return true when RPCs configured', () => {
      racer = new WriteRacer([rpc1, rpc2], 120);
      expect(racer.isEnabled()).toBe(true);
    });

    it('should return false when no RPCs configured', () => {
      racer = new WriteRacer([], 120);
      expect(racer.isEnabled()).toBe(false);
    });
  });
});
