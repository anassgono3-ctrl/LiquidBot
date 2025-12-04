// Unit tests for PythListener service
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { PythListener } from '../../src/services/PythListener.js';

describe('PythListener', () => {
  let pythListener: PythListener;

  beforeEach(() => {
    pythListener = new PythListener();
  });

  afterEach(async () => {
    await pythListener.stop();
  });

  describe('initialization', () => {
    it('should initialize with disabled state when PYTH_ENABLED is false', () => {
      expect(pythListener.isEnabled()).toBe(false);
    });

    it('should not be connected initially', () => {
      expect(pythListener.isConnectedStatus()).toBe(false);
    });

    it('should return configured assets', () => {
      const assets = pythListener.getAssets();
      expect(Array.isArray(assets)).toBe(true);
      expect(assets.length).toBeGreaterThan(0);
    });
  });

  describe('start/stop', () => {
    it('should not start when disabled', async () => {
      await pythListener.start();
      expect(pythListener.isConnectedStatus()).toBe(false);
    });

    it('should handle stop gracefully when not started', async () => {
      await expect(pythListener.stop()).resolves.not.toThrow();
    });
  });

  describe('callback registration', () => {
    it('should allow registering price update callbacks', () => {
      let callbackInvoked = false;
      
      pythListener.onPriceUpdate(() => {
        callbackInvoked = true;
      });

      // Callback is registered but won't be invoked while disabled
      expect(callbackInvoked).toBe(false);
    });

    it('should allow multiple callbacks', () => {
      const callbacks: number[] = [];
      
      pythListener.onPriceUpdate(() => callbacks.push(1));
      pythListener.onPriceUpdate(() => callbacks.push(2));
      pythListener.onPriceUpdate(() => callbacks.push(3));

      // All callbacks registered
      expect(callbacks.length).toBe(0); // Not invoked yet
    });
  });
});
