import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GasBurstManager } from '../../../src/exec/fastpath/GasBurstManager.js';

// Mock ethers
vi.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: vi.fn().mockImplementation(() => ({
      getTransactionReceipt: vi.fn().mockResolvedValue(null),
      broadcastTransaction: vi.fn().mockResolvedValue({ hash: '0xnewhash' })
    })),
    Wallet: vi.fn().mockImplementation(() => ({
      signTransaction: vi.fn().mockResolvedValue('0xsignedtx')
    })),
    Transaction: {
      from: vi.fn().mockReturnValue({
        maxFeePerGas: 1000n,
        maxPriorityFeePerGas: 500n,
        gasPrice: 1000n
      })
    }
  }
}));

describe('GasBurstManager', () => {
  let manager: GasBurstManager;

  beforeEach(() => {
    manager = new GasBurstManager(true, 50, 100, 25, 25, 2);
    manager.clear();
    vi.clearAllMocks();
  });

  describe('trackTransaction', () => {
    it('should track a pending transaction', () => {
      const mockProvider = {} as any;
      const mockWallet = {} as any;

      manager.trackTransaction(
        '0xtxhash',
        '0xsignedtx',
        1,
        1000n,
        mockProvider,
        mockWallet
      );

      const pending = manager.getPendingTransactions();
      expect(pending).toHaveLength(1);
      expect(pending[0].txHash).toBe('0xtxhash');
    });

    it('should not track when disabled', () => {
      const disabledManager = new GasBurstManager(false);
      const mockProvider = {} as any;
      const mockWallet = {} as any;

      disabledManager.trackTransaction(
        '0xtxhash',
        '0xsignedtx',
        1,
        1000n,
        mockProvider,
        mockWallet
      );

      expect(disabledManager.getPendingTransactions()).toHaveLength(0);
    });
  });

  describe('confirmTransaction', () => {
    it('should remove confirmed transaction', () => {
      const mockProvider = {} as any;
      const mockWallet = {} as any;

      manager.trackTransaction(
        '0xtxhash',
        '0xsignedtx',
        1,
        1000n,
        mockProvider,
        mockWallet
      );

      expect(manager.getPendingTransactions()).toHaveLength(1);
      
      manager.confirmTransaction('0xtxhash');
      expect(manager.getPendingTransactions()).toHaveLength(0);
    });
  });

  describe('getBumpAttempts', () => {
    it('should return empty array for unknown transaction', () => {
      const attempts = manager.getBumpAttempts('0xunknown');
      expect(attempts).toEqual([]);
    });

    it('should track bump attempts', () => {
      const mockProvider = {} as any;
      const mockWallet = {} as any;

      manager.trackTransaction(
        '0xtxhash',
        '0xsignedtx',
        1,
        1000n,
        mockProvider,
        mockWallet
      );

      const attempts = manager.getBumpAttempts('0xtxhash');
      expect(attempts).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should clear all pending transactions', () => {
      const mockProvider = {} as any;
      const mockWallet = {} as any;

      manager.trackTransaction(
        '0xtxhash1',
        '0xsignedtx',
        1,
        1000n,
        mockProvider,
        mockWallet
      );

      manager.trackTransaction(
        '0xtxhash2',
        '0xsignedtx',
        2,
        1000n,
        mockProvider,
        mockWallet
      );

      expect(manager.getPendingTransactions()).toHaveLength(2);
      
      manager.clear();
      expect(manager.getPendingTransactions()).toHaveLength(0);
    });
  });

  describe('isEnabled', () => {
    it('should return true when enabled', () => {
      expect(manager.isEnabled()).toBe(true);
    });

    it('should return false when disabled', () => {
      const disabledManager = new GasBurstManager(false);
      expect(disabledManager.isEnabled()).toBe(false);
    });
  });

  describe('configuration', () => {
    it('should use custom configuration', () => {
      const customManager = new GasBurstManager(true, 100, 200, 50, 50, 3);
      expect(customManager.isEnabled()).toBe(true);
    });
  });
});
