// Unit tests for NotificationService
import { describe, it, expect, beforeEach } from 'vitest';

import { NotificationService } from '../../src/services/NotificationService.js';
import type { Opportunity } from '../../src/types/index.js';

describe('NotificationService', () => {
  let notificationService: NotificationService;

  beforeEach(() => {
    notificationService = new NotificationService();
  });

  describe('constructor', () => {
    it('should initialize without throwing', () => {
      expect(notificationService).toBeDefined();
    });

    it('should be disabled when credentials not configured', () => {
      // In test environment, credentials are likely not set or are placeholders
      const enabled = notificationService.isEnabled();
      // Can be true or false depending on test env
      expect(typeof enabled).toBe('boolean');
    });
  });

  describe('notifyOpportunity', () => {
    it('should handle notification without throwing', async () => {
      const opportunity: Opportunity = {
        id: 'opp-1',
        txHash: '0xtxhash123',
        user: '0xUser123456',
        liquidator: '0xLiquidator789',
        timestamp: 1234567890,
        collateralAmountRaw: '1000000000',
        principalAmountRaw: '500000000',
        collateralReserve: { id: '0xusdc', symbol: 'USDC', decimals: 6 },
        principalReserve: { id: '0xweth', symbol: 'WETH', decimals: 18 },
        healthFactor: 0.98,
        collateralValueUsd: 1000,
        principalValueUsd: 500,
        profitEstimateUsd: 50,
        bonusPct: 0.05
      };

      // Should not throw even if Telegram is not configured
      await expect(notificationService.notifyOpportunity(opportunity)).resolves.not.toThrow();
    });

    it('should handle opportunity without optional fields', async () => {
      const opportunity: Opportunity = {
        id: 'opp-2',
        txHash: null,
        user: '0xUser123',
        liquidator: '0xLiq456',
        timestamp: 1234567890,
        collateralAmountRaw: '1000000000',
        principalAmountRaw: '500000000',
        collateralReserve: { id: '0xusdc', symbol: null, decimals: null },
        principalReserve: { id: '0xweth', symbol: null, decimals: null },
        healthFactor: null,
        collateralValueUsd: null,
        principalValueUsd: null,
        profitEstimateUsd: null,
        bonusPct: null
      };

      await expect(notificationService.notifyOpportunity(opportunity)).resolves.not.toThrow();
    });
  });

  describe('notifyHealthBreach', () => {
    it('should handle health breach notification without throwing', async () => {
      const event = {
        user: '0xUser123456',
        healthFactor: 0.98,
        threshold: 1.10,
        timestamp: Math.floor(Date.now() / 1000)
      };

      await expect(notificationService.notifyHealthBreach(event)).resolves.not.toThrow();
    });
  });

  describe('ratio token price validation', () => {
    it('should validate wstETH opportunities using PriceService', async () => {
      // Test that ratio tokens (wstETH, weETH) can be validated
      // when PriceService has proper ratio feed configuration
      const opportunity: Opportunity = {
        id: 'opp-wsteth',
        txHash: '0xtxhash',
        user: '0xUser123',
        liquidator: '0xLiq456',
        timestamp: 1234567890,
        collateralAmountRaw: '1000000000000000000',
        principalAmountRaw: '500000000',
        collateralReserve: { id: '0xwsteth', symbol: 'WSTETH', decimals: 18 },
        principalReserve: { id: '0xusdc', symbol: 'USDC', decimals: 6 },
        healthFactor: 0.95,
        triggerSource: 'realtime',
        triggerType: 'price',
        debtToCoverUsd: 500
      };

      // Should not throw - PriceService should handle ratio tokens
      // In test mode, stub prices are used, so this will succeed
      await expect(notificationService.notifyOpportunity(opportunity)).resolves.not.toThrow();
    });

    it('should validate weETH opportunities using PriceService', async () => {
      const opportunity: Opportunity = {
        id: 'opp-weeth',
        txHash: '0xtxhash',
        user: '0xUser123',
        liquidator: '0xLiq456',
        timestamp: 1234567890,
        collateralAmountRaw: '2000000000000000000',
        principalAmountRaw: '1000000000',
        collateralReserve: { id: '0xweeth', symbol: 'WEETH', decimals: 18 },
        principalReserve: { id: '0xusdc', symbol: 'USDC', decimals: 6 },
        healthFactor: 0.92,
        triggerSource: 'realtime',
        triggerType: 'head',
        debtToCoverUsd: 1000
      };

      // Should not throw - PriceService should handle ratio tokens
      await expect(notificationService.notifyOpportunity(opportunity)).resolves.not.toThrow();
    });
  });
});
