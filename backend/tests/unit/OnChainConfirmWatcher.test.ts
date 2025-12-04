// Unit tests for OnChainConfirmWatcher service
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { OnChainConfirmWatcher } from '../../src/services/OnChainConfirmWatcher.js';
import type { PreSubmitManager } from '../../src/services/PreSubmitManager.js';

describe('OnChainConfirmWatcher', () => {
  let watcher: OnChainConfirmWatcher;

  beforeEach(() => {
    watcher = new OnChainConfirmWatcher();
  });

  afterEach(async () => {
    await watcher.stop();
  });

  describe('initialization', () => {
    it('should initialize with disabled state when PRE_SUBMIT_ENABLED is false', () => {
      expect(watcher.isEnabled()).toBe(false);
    });

    it('should not be watching initially', () => {
      expect(watcher.isWatching()).toBe(false);
    });
  });

  describe('start/stop', () => {
    it('should not start when disabled', async () => {
      await watcher.start();
      expect(watcher.isWatching()).toBe(false);
    });

    it('should handle stop gracefully when not started', async () => {
      await expect(watcher.stop()).resolves.not.toThrow();
    });

    it('should not throw when starting multiple times', async () => {
      await watcher.start();
      await watcher.start();
      expect(watcher.isWatching()).toBe(false);
    });
  });

  describe('PreSubmitManager integration', () => {
    it('should accept PreSubmitManager reference', () => {
      const mockManager = {
        getPendingPreSubmits: () => new Map(),
        cleanupExpired: async () => 0
      } as unknown as PreSubmitManager;
      expect(() => watcher.setPreSubmitManager(mockManager)).not.toThrow();
    });
  });
});
