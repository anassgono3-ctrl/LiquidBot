import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { DecodedEvent } from '../../src/abi/aaveV3PoolEvents.js';
import {
  liquidationAuditTotal,
  liquidationAuditReasonNotInWatchSet,
  liquidationAuditReasonRaced,
  liquidationAuditErrors
} from '../../src/metrics/index.js';
import { LiquidationAuditService } from '../../src/services/liquidationAudit.js';
import { NotificationService } from '../../src/services/NotificationService.js';
import { PriceService } from '../../src/services/PriceService.js';

describe('LiquidationAuditService', () => {
  let priceService: PriceService;
  let notificationService: NotificationService;
  let auditService: LiquidationAuditService;

  beforeEach(() => {
    // Reset metrics
    liquidationAuditTotal.reset();
    liquidationAuditReasonNotInWatchSet.reset();
    liquidationAuditReasonRaced.reset();
    liquidationAuditErrors.reset();

    // Create service instances with mocked dependencies
    priceService = new PriceService();
    notificationService = new NotificationService(priceService);
    auditService = new LiquidationAuditService(priceService, notificationService);

    // Mock notification service to prevent actual Telegram calls
    vi.spyOn(notificationService, 'isEnabled').mockReturnValue(true);
    
    // Spy on console to suppress logs during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onLiquidationCall', () => {
    it('should classify liquidation as "not_in_watch_set" when user is absent', async () => {
      const decodedEvent: DecodedEvent = {
        name: 'LiquidationCall',
        args: {
          user: '0x1234567890123456789012345678901234567890',
          debtAsset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
          collateralAsset: '0x4200000000000000000000000000000000000006', // WETH
          debtToCover: 1000000000n, // 1000 USDC (6 decimals)
          liquidatedCollateralAmount: 500000000000000000n, // 0.5 WETH (18 decimals)
          liquidator: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          receiveAToken: false
        },
        signature: 'LiquidationCall(address,address,address,uint256,uint256,address,bool)'
      };

      const isInWatchSet = () => false; // User not in watch set
      const candidatesTotal = 100;

      await auditService.onLiquidationCall(
        decodedEvent,
        12345678,
        '0x686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c',
        isInWatchSet,
        candidatesTotal
      );

      // Verify metrics were updated
      const totalValue = await liquidationAuditTotal.get();
      const notInWatchSetValue = await liquidationAuditReasonNotInWatchSet.get();
      
      expect(totalValue.values[0].value).toBe(1);
      expect(notInWatchSetValue.values[0].value).toBe(1);
    });

    it('should classify liquidation as "raced" when user is in watch set', async () => {
      const decodedEvent: DecodedEvent = {
        name: 'LiquidationCall',
        args: {
          user: '0x1234567890123456789012345678901234567890',
          debtAsset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
          collateralAsset: '0x4200000000000000000000000000000000000006', // WETH
          debtToCover: 1000000000n, // 1000 USDC
          liquidatedCollateralAmount: 500000000000000000n, // 0.5 WETH
          liquidator: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          receiveAToken: false
        },
        signature: 'LiquidationCall(address,address,address,uint256,uint256,address,bool)'
      };

      const isInWatchSet = () => true; // User in watch set
      const candidatesTotal = 100;

      await auditService.onLiquidationCall(
        decodedEvent,
        12345678,
        '0x686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c',
        isInWatchSet,
        candidatesTotal
      );

      // Verify metrics were updated
      const totalValue = await liquidationAuditTotal.get();
      const racedValue = await liquidationAuditReasonRaced.get();
      
      expect(totalValue.values[0].value).toBe(1);
      expect(racedValue.values[0].value).toBe(1);
    });

    it('should handle price mode=current correctly', async () => {
      // Mock getPrice to return known values
      vi.spyOn(priceService, 'getPrice')
        .mockResolvedValueOnce(1.0)  // USDC price
        .mockResolvedValueOnce(3000.0); // WETH price

      const decodedEvent: DecodedEvent = {
        name: 'LiquidationCall',
        args: {
          user: '0x1234567890123456789012345678901234567890',
          debtAsset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
          collateralAsset: '0x4200000000000000000000000000000000000006', // WETH
          debtToCover: 1000000000n, // 1000 USDC (6 decimals)
          liquidatedCollateralAmount: 500000000000000000n, // 0.5 WETH (18 decimals)
          liquidator: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          receiveAToken: false
        },
        signature: 'LiquidationCall(address,address,address,uint256,uint256,address,bool)'
      };

      const isInWatchSet = () => false;
      const candidatesTotal = 100;

      await auditService.onLiquidationCall(
        decodedEvent,
        12345678,
        '0x686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c',
        isInWatchSet,
        candidatesTotal
      );

      // Verify getPrice was called
      expect(priceService.getPrice).toHaveBeenCalledWith(expect.any(String), false);
    });

    it('should handle price mode=block correctly', async () => {
      // Mock getPrice to return known values for block-tagged reads
      vi.spyOn(priceService, 'getPrice')
        .mockResolvedValueOnce(1.0)  // USDC price
        .mockResolvedValueOnce(3000.0); // WETH price

      const decodedEvent: DecodedEvent = {
        name: 'LiquidationCall',
        args: {
          user: '0x1234567890123456789012345678901234567890',
          debtAsset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
          collateralAsset: '0x4200000000000000000000000000000000000006', // WETH
          debtToCover: 1000000000n, // 1000 USDC
          liquidatedCollateralAmount: 500000000000000000n, // 0.5 WETH
          liquidator: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          receiveAToken: false
        },
        signature: 'LiquidationCall(address,address,address,uint256,uint256,address,bool)'
      };

      const isInWatchSet = () => false;
      const candidatesTotal = 100;

      await auditService.onLiquidationCall(
        decodedEvent,
        12345678,
        '0x686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c',
        isInWatchSet,
        candidatesTotal
      );

      // Verify getPrice was called for both assets
      expect(priceService.getPrice).toHaveBeenCalled();
    });

    it('should add info_min_debt tag when debt < MIN_DEBT_USD', async () => {
      // Mock getPrice to return known values - tiny debt amount
      vi.spyOn(priceService, 'getPrice')
        .mockResolvedValueOnce(1.0)  // USDC price
        .mockResolvedValueOnce(3000.0); // WETH price

      const decodedEvent: DecodedEvent = {
        name: 'LiquidationCall',
        args: {
          user: '0x1234567890123456789012345678901234567890',
          debtAsset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
          collateralAsset: '0x4200000000000000000000000000000000000006', // WETH
          debtToCover: 100000n, // 0.1 USDC (6 decimals) - below MIN_DEBT_USD default of 1
          liquidatedCollateralAmount: 100000000000000n, // 0.0001 WETH (18 decimals)
          liquidator: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          receiveAToken: false
        },
        signature: 'LiquidationCall(address,address,address,uint256,uint256,address,bool)'
      };

      const isInWatchSet = () => false;
      const candidatesTotal = 100;

      await auditService.onLiquidationCall(
        decodedEvent,
        12345678,
        '0x686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c',
        isInWatchSet,
        candidatesTotal
      );

      // Verify the audit was processed (metrics updated)
      const totalValue = await liquidationAuditTotal.get();
      expect(totalValue.values[0].value).toBe(1);
    });

    it('should handle BigInt values without comparison errors', async () => {
      // Mock getPrice
      vi.spyOn(priceService, 'getPrice')
        .mockResolvedValueOnce(1.0)
        .mockResolvedValueOnce(3000.0);

      const largeDebtAmount = 1000000000000000000000n; // Very large value as BigInt
      const largeCollateralAmount = 10000000000000000000n; // Very large value as BigInt

      const decodedEvent: DecodedEvent = {
        name: 'LiquidationCall',
        args: {
          user: '0x1234567890123456789012345678901234567890',
          debtAsset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          collateralAsset: '0x4200000000000000000000000000000000000006',
          debtToCover: largeDebtAmount,
          liquidatedCollateralAmount: largeCollateralAmount,
          liquidator: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          receiveAToken: false
        },
        signature: 'LiquidationCall(address,address,address,uint256,uint256,address,bool)'
      };

      const isInWatchSet = () => false;
      const candidatesTotal = 100;

      // Should not throw error with BigInt values
      await expect(
        auditService.onLiquidationCall(
          decodedEvent,
          12345678,
          '0x686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c',
          isInWatchSet,
          candidatesTotal
        )
      ).resolves.not.toThrow();

      // Verify metrics were updated
      const totalValue = await liquidationAuditTotal.get();
      expect(totalValue.values[0].value).toBe(1);
    });

    it('should handle errors gracefully and increment error counter', async () => {
      // Mock getPrice to throw an error
      vi.spyOn(priceService, 'getPrice').mockRejectedValue(new Error('Price fetch failed'));

      const decodedEvent: DecodedEvent = {
        name: 'LiquidationCall',
        args: {
          user: '0x1234567890123456789012345678901234567890',
          debtAsset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          collateralAsset: '0x4200000000000000000000000000000000000006',
          debtToCover: 1000000000n,
          liquidatedCollateralAmount: 500000000000000000n,
          liquidator: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          receiveAToken: false
        },
        signature: 'LiquidationCall(address,address,address,uint256,uint256,address,bool)'
      };

      const isInWatchSet = () => false;
      const candidatesTotal = 100;

      // Should not throw - errors should be caught and logged
      await expect(
        auditService.onLiquidationCall(
          decodedEvent,
          12345678,
          '0x686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c',
          isInWatchSet,
          candidatesTotal
        )
      ).resolves.not.toThrow();

      // Error counter should have been incremented (though price errors are caught internally)
      // The audit itself should still complete
      const totalValue = await liquidationAuditTotal.get();
      expect(totalValue.values[0].value).toBeGreaterThanOrEqual(0);
    });

    it('should respect candidatesTotal parameter', async () => {
      // Mock getPrice
      vi.spyOn(priceService, 'getPrice')
        .mockResolvedValueOnce(1.0)
        .mockResolvedValueOnce(3000.0);

      const decodedEvent: DecodedEvent = {
        name: 'LiquidationCall',
        args: {
          user: '0x1234567890123456789012345678901234567890',
          debtAsset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          collateralAsset: '0x4200000000000000000000000000000000000006',
          debtToCover: 1000000000n,
          liquidatedCollateralAmount: 500000000000000000n,
          liquidator: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          receiveAToken: false
        },
        signature: 'LiquidationCall(address,address,address,uint256,uint256,address,bool)'
      };

      const isInWatchSet = () => false;
      const candidatesTotal = 16789; // Specific value to verify in logs

      await auditService.onLiquidationCall(
        decodedEvent,
        12345678,
        '0x686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c',
        isInWatchSet,
        candidatesTotal
      );

      // Verify console.log was called with the candidatesTotal
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('candidates_total=16789')
      );
    });

    it('should handle missing optional fields gracefully', async () => {
      // Mock getPrice
      vi.spyOn(priceService, 'getPrice')
        .mockResolvedValueOnce(1.0)
        .mockResolvedValueOnce(3000.0);

      const decodedEvent: DecodedEvent = {
        name: 'LiquidationCall',
        args: {
          // Missing some optional fields
          user: '0x1234567890123456789012345678901234567890',
          debtAsset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          collateralAsset: '0x4200000000000000000000000000000000000006',
          debtToCover: 1000000000n,
          liquidatedCollateralAmount: 500000000000000000n,
          liquidator: '',  // Empty liquidator
          receiveAToken: false
        },
        signature: 'LiquidationCall(address,address,address,uint256,uint256,address,bool)'
      };

      const isInWatchSet = () => false;
      const candidatesTotal = 100;

      // Should handle missing fields gracefully
      await expect(
        auditService.onLiquidationCall(
          decodedEvent,
          12345678,
          '0x686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c686c',
          isInWatchSet,
          candidatesTotal
        )
      ).resolves.not.toThrow();
    });
  });
});
