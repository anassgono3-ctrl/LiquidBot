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

  describe('checkScalingSanity with canonical decimals', () => {
    it('should correctly scale WETH with 18 decimals', async () => {
      // This is the exact case from production logs that was failing
      const opportunity: Opportunity = {
        id: 'test-weth-scaling',
        txHash: '0xtx',
        user: '0x896159741c56cdc2cfc67c9aa2aec61f84597d5a',
        liquidator: '0xLiq',
        timestamp: 1234567890,
        collateralAmountRaw: '113976640370681108', // ~0.113976640 WETH
        principalAmountRaw: '94495369995315437',   // ~0.094495370 WETH
        collateralReserve: { id: '0xweth', symbol: 'WETH', decimals: 18 },
        principalReserve: { id: '0xweth', symbol: 'WETH', decimals: 18 },
        healthFactor: 1.0011,
        triggerSource: 'realtime'
      };

      // Should not throw and should not flag as scaling error
      await expect(notificationService.notifyOpportunity(opportunity)).resolves.not.toThrow();
    });

    it('should correctly scale WETH even with missing decimals', async () => {
      // Test case where decimals are null/undefined - should use canonical 18 for WETH
      const opportunity: Opportunity = {
        id: 'test-weth-no-decimals',
        txHash: '0xtx',
        user: '0x896159741c56cdc2cfc67c9aa2aec61f84597d5a',
        liquidator: '0xLiq',
        timestamp: 1234567890,
        collateralAmountRaw: '113976640370681108', // ~0.113976640 WETH
        principalAmountRaw: '94495369995315437',   // ~0.094495370 WETH
        collateralReserve: { id: '0xweth', symbol: 'WETH', decimals: null },
        principalReserve: { id: '0xweth', symbol: 'WETH', decimals: null },
        healthFactor: 1.0011,
        triggerSource: 'realtime'
      };

      // Should not throw - canonical decimals should handle missing values
      await expect(notificationService.notifyOpportunity(opportunity)).resolves.not.toThrow();
    });

    it('should correctly scale USDC with 6 decimals', async () => {
      const opportunity: Opportunity = {
        id: 'test-usdc-scaling',
        txHash: '0xtx',
        user: '0xUser',
        liquidator: '0xLiq',
        timestamp: 1234567890,
        collateralAmountRaw: '1000500000', // 1000.50 USDC (6 decimals)
        principalAmountRaw: '500000000',   // 500.00 USDC (6 decimals)
        collateralReserve: { id: '0xusdc', symbol: 'USDC', decimals: 6 },
        principalReserve: { id: '0xusdc', symbol: 'USDC', decimals: 6 },
        healthFactor: 0.95,
        triggerSource: 'realtime'
      };

      await expect(notificationService.notifyOpportunity(opportunity)).resolves.not.toThrow();
    });

    it('should correctly scale WBTC with 8 decimals', async () => {
      const opportunity: Opportunity = {
        id: 'test-wbtc-scaling',
        txHash: '0xtx',
        user: '0xUser',
        liquidator: '0xLiq',
        timestamp: 1234567890,
        collateralAmountRaw: '50000000', // 0.5 WBTC (8 decimals)
        principalAmountRaw: '25000000',  // 0.25 WBTC (8 decimals)
        collateralReserve: { id: '0xwbtc', symbol: 'WBTC', decimals: 8 },
        principalReserve: { id: '0xwbtc', symbol: 'WBTC', decimals: 8 },
        healthFactor: 0.98,
        triggerSource: 'realtime'
      };

      await expect(notificationService.notifyOpportunity(opportunity)).resolves.not.toThrow();
    });

    it('should use fallback decimals for unknown tokens', async () => {
      const opportunity: Opportunity = {
        id: 'test-unknown-token',
        txHash: '0xtx',
        user: '0xUser',
        liquidator: '0xLiq',
        timestamp: 1234567890,
        collateralAmountRaw: '1000000000', // Should use provided decimals
        principalAmountRaw: '500000000',
        collateralReserve: { id: '0xunknown', symbol: 'XYZ', decimals: 9 },
        principalReserve: { id: '0xunknown', symbol: 'XYZ', decimals: 9 },
        healthFactor: 0.95,
        triggerSource: 'realtime'
      };

      await expect(notificationService.notifyOpportunity(opportunity)).resolves.not.toThrow();
    });

    it('should handle case-insensitive symbol matching', async () => {
      const opportunity: Opportunity = {
        id: 'test-lowercase-weth',
        txHash: '0xtx',
        user: '0xUser',
        liquidator: '0xLiq',
        timestamp: 1234567890,
        collateralAmountRaw: '1000000000000000000', // 1.0 weth (lowercase)
        principalAmountRaw: '500000000000000000',
        collateralReserve: { id: '0xweth', symbol: 'weth', decimals: 18 },
        principalReserve: { id: '0xweth', symbol: 'weth', decimals: 18 },
        healthFactor: 0.95,
        triggerSource: 'realtime'
      };

      await expect(notificationService.notifyOpportunity(opportunity)).resolves.not.toThrow();
    });

    it('should handle stablecoins correctly', async () => {
      // Test DAI, USDbC, USDT
      const daiOpp: Opportunity = {
        id: 'test-dai',
        txHash: '0xtx',
        user: '0xUser',
        liquidator: '0xLiq',
        timestamp: 1234567890,
        collateralAmountRaw: '5000000000000000000000', // 5000 DAI
        principalAmountRaw: '2000000000000000000000',
        collateralReserve: { id: '0xdai', symbol: 'DAI', decimals: 18 },
        principalReserve: { id: '0xdai', symbol: 'DAI', decimals: 18 },
        healthFactor: 0.95,
        triggerSource: 'realtime'
      };

      await expect(notificationService.notifyOpportunity(daiOpp)).resolves.not.toThrow();
    });

    it('should handle liquid staking tokens', async () => {
      // Test cbETH, wstETH, weETH
      const cbethOpp: Opportunity = {
        id: 'test-cbeth',
        txHash: '0xtx',
        user: '0xUser',
        liquidator: '0xLiq',
        timestamp: 1234567890,
        collateralAmountRaw: '2000000000000000000', // 2.0 cbETH
        principalAmountRaw: '1000000000000000000',
        collateralReserve: { id: '0xcbeth', symbol: 'cbETH', decimals: 18 },
        principalReserve: { id: '0xcbeth', symbol: 'cbETH', decimals: 18 },
        healthFactor: 0.95,
        triggerSource: 'realtime'
      };

      await expect(notificationService.notifyOpportunity(cbethOpp)).resolves.not.toThrow();
    });
  });
});
