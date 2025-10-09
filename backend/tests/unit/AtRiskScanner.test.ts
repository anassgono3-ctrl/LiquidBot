// Unit tests for AtRiskScanner
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AtRiskScanner } from '../../src/services/AtRiskScanner.js';
import { HealthCalculator } from '../../src/services/HealthCalculator.js';
import type { SubgraphService } from '../../src/services/SubgraphService.js';
import type { NotificationService } from '../../src/services/NotificationService.js';
import type { User } from '../../src/types/index.js';

describe('AtRiskScanner', () => {
  let mockSubgraphService: Pick<SubgraphService, 'getUsersPage'>;
  let healthCalculator: HealthCalculator;
  let mockNotificationService: Pick<NotificationService, 'isEnabled' | 'notifyHealthBreach'>;
  
  beforeEach(() => {
    mockSubgraphService = {
      getUsersPage: vi.fn()
    };
    healthCalculator = new HealthCalculator();
    mockNotificationService = {
      isEnabled: vi.fn().mockReturnValue(true),
      notifyHealthBreach: vi.fn()
    };
  });

  describe('scanAndClassify', () => {
    it('should return empty result when limit is 0', async () => {
      const scanner = new AtRiskScanner(
        mockSubgraphService as SubgraphService,
        healthCalculator,
        { warnThreshold: 1.05, liqThreshold: 1.0, dustEpsilon: 1e-9, notifyWarn: false },
        mockNotificationService as NotificationService
      );

      const result = await scanner.scanAndClassify(0);

      expect(result.scannedCount).toBe(0);
      expect(result.criticalCount).toBe(0);
      expect(result.warnCount).toBe(0);
      expect(result.users).toHaveLength(0);
      expect(mockSubgraphService.getUsersPage).not.toHaveBeenCalled();
    });

    it('should classify user with no debt as NO_DEBT', async () => {
      const userNoDebt: User = {
        id: '0x1',
        borrowedReservesCount: 0,
        reserves: [
          {
            currentATokenBalance: '1000000000', // 1000 USDC collateral
            currentVariableDebt: '0',
            currentStableDebt: '0',
            reserve: {
              id: '0xusdc',
              symbol: 'USDC',
              name: 'USD Coin',
              decimals: 6,
              reserveLiquidationThreshold: 8500,
              usageAsCollateralEnabled: true,
              price: { priceInEth: '500000000000000' }
            }
          }
        ]
      };

      mockSubgraphService.getUsersPage = vi.fn().mockResolvedValue([userNoDebt]);

      const scanner = new AtRiskScanner(
        mockSubgraphService as SubgraphService,
        healthCalculator,
        { warnThreshold: 1.05, liqThreshold: 1.0, dustEpsilon: 1e-9, notifyWarn: false },
        mockNotificationService as NotificationService
      );

      const result = await scanner.scanAndClassify(10);

      expect(result.scannedCount).toBe(1);
      expect(result.noDebtCount).toBe(1);
      expect(result.criticalCount).toBe(0);
      expect(result.warnCount).toBe(0);
      expect(result.users).toHaveLength(0); // NO_DEBT users not included in result
    });

    it('should classify user with dust debt as DUST', async () => {
      const userDust: User = {
        id: '0x2',
        borrowedReservesCount: 1,
        reserves: [
          {
            currentATokenBalance: '1000000000', // 1000 USDC collateral
            currentVariableDebt: '1', // 0.000001 USDC debt (dust)
            currentStableDebt: '0',
            reserve: {
              id: '0xusdc',
              symbol: 'USDC',
              name: 'USD Coin',
              decimals: 6,
              reserveLiquidationThreshold: 8500,
              usageAsCollateralEnabled: true,
              price: { priceInEth: '500000000000000' }
            }
          }
        ]
      };

      mockSubgraphService.getUsersPage = vi.fn().mockResolvedValue([userDust]);

      const scanner = new AtRiskScanner(
        mockSubgraphService as SubgraphService,
        healthCalculator,
        { warnThreshold: 1.05, liqThreshold: 1.0, dustEpsilon: 1e-9, notifyWarn: false },
        mockNotificationService as NotificationService
      );

      const result = await scanner.scanAndClassify(10);

      expect(result.scannedCount).toBe(1);
      expect(result.noDebtCount).toBe(1); // Dust counted as noDebt
      expect(result.criticalCount).toBe(0);
      expect(result.warnCount).toBe(0);
    });

    it('should classify user below liquidation threshold as CRITICAL', async () => {
      const userCritical: User = {
        id: '0x3',
        borrowedReservesCount: 1,
        reserves: [
          {
            currentATokenBalance: '1100000000', // 1100 USDC collateral
            currentVariableDebt: '1000000000', // 1000 USDC debt
            currentStableDebt: '0',
            reserve: {
              id: '0xusdc',
              symbol: 'USDC',
              name: 'USD Coin',
              decimals: 6,
              reserveLiquidationThreshold: 8500, // 85%
              usageAsCollateralEnabled: true,
              price: { priceInEth: '500000000000000' }
            }
          }
        ]
      };

      // Collateral: 1100 * 0.0005 = 0.55 ETH
      // Weighted: 0.55 * 0.85 = 0.4675 ETH
      // Debt: 1000 * 0.0005 = 0.5 ETH
      // HF: 0.4675 / 0.5 = 0.935 (< 1.0, so CRITICAL)

      mockSubgraphService.getUsersPage = vi.fn().mockResolvedValue([userCritical]);

      const scanner = new AtRiskScanner(
        mockSubgraphService as SubgraphService,
        healthCalculator,
        { warnThreshold: 1.05, liqThreshold: 1.0, dustEpsilon: 1e-9, notifyWarn: false },
        mockNotificationService as NotificationService
      );

      const result = await scanner.scanAndClassify(10);

      expect(result.scannedCount).toBe(1);
      expect(result.criticalCount).toBe(1);
      expect(result.warnCount).toBe(0);
      expect(result.users).toHaveLength(1);
      expect(result.users[0].classification).toBe('CRITICAL');
      expect(result.users[0].healthFactor).toBeLessThan(1.0);
    });

    it('should classify user between thresholds as WARN', async () => {
      const userWarn: User = {
        id: '0x4',
        borrowedReservesCount: 1,
        reserves: [
          {
            currentATokenBalance: '1200000000', // 1200 USDC collateral
            currentVariableDebt: '1000000000', // 1000 USDC debt
            currentStableDebt: '0',
            reserve: {
              id: '0xusdc',
              symbol: 'USDC',
              name: 'USD Coin',
              decimals: 6,
              reserveLiquidationThreshold: 8500, // 85%
              usageAsCollateralEnabled: true,
              price: { priceInEth: '500000000000000' }
            }
          }
        ]
      };

      // Collateral: 1200 * 0.0005 = 0.6 ETH
      // Weighted: 0.6 * 0.85 = 0.51 ETH
      // Debt: 1000 * 0.0005 = 0.5 ETH
      // HF: 0.51 / 0.5 = 1.02 (< 1.05 but > 1.0, so WARN)

      mockSubgraphService.getUsersPage = vi.fn().mockResolvedValue([userWarn]);

      const scanner = new AtRiskScanner(
        mockSubgraphService as SubgraphService,
        healthCalculator,
        { warnThreshold: 1.05, liqThreshold: 1.0, dustEpsilon: 1e-9, notifyWarn: false },
        mockNotificationService as NotificationService
      );

      const result = await scanner.scanAndClassify(10);

      expect(result.scannedCount).toBe(1);
      expect(result.criticalCount).toBe(0);
      expect(result.warnCount).toBe(1);
      expect(result.users).toHaveLength(1);
      expect(result.users[0].classification).toBe('WARN');
      expect(result.users[0].healthFactor).toBeGreaterThanOrEqual(1.0);
      expect(result.users[0].healthFactor).toBeLessThan(1.05);
    });

    it('should not include OK users in results', async () => {
      const userOk: User = {
        id: '0x5',
        borrowedReservesCount: 1,
        reserves: [
          {
            currentATokenBalance: '2000000000', // 2000 USDC collateral
            currentVariableDebt: '1000000000', // 1000 USDC debt
            currentStableDebt: '0',
            reserve: {
              id: '0xusdc',
              symbol: 'USDC',
              name: 'USD Coin',
              decimals: 6,
              reserveLiquidationThreshold: 8500,
              usageAsCollateralEnabled: true,
              price: { priceInEth: '500000000000000' }
            }
          }
        ]
      };

      // HF = 1.7 (healthy, > 1.05)

      mockSubgraphService.getUsersPage = vi.fn().mockResolvedValue([userOk]);

      const scanner = new AtRiskScanner(
        mockSubgraphService as SubgraphService,
        healthCalculator,
        { warnThreshold: 1.05, liqThreshold: 1.0, dustEpsilon: 1e-9, notifyWarn: false },
        mockNotificationService as NotificationService
      );

      const result = await scanner.scanAndClassify(10);

      expect(result.scannedCount).toBe(1);
      expect(result.criticalCount).toBe(0);
      expect(result.warnCount).toBe(0);
      expect(result.users).toHaveLength(0); // OK users not included
    });

    it('should handle mixed classifications', async () => {
      const users: User[] = [
        // User 1: NO_DEBT
        {
          id: '0x1',
          borrowedReservesCount: 0,
          reserves: [
            {
              currentATokenBalance: '1000000000',
              currentVariableDebt: '0',
              currentStableDebt: '0',
              reserve: {
                id: '0xusdc',
                symbol: 'USDC',
                name: 'USD Coin',
                decimals: 6,
                reserveLiquidationThreshold: 8500,
                usageAsCollateralEnabled: true,
                price: { priceInEth: '500000000000000' }
              }
            }
          ]
        },
        // User 2: CRITICAL
        {
          id: '0x2',
          borrowedReservesCount: 1,
          reserves: [
            {
              currentATokenBalance: '1100000000',
              currentVariableDebt: '1000000000',
              currentStableDebt: '0',
              reserve: {
                id: '0xusdc',
                symbol: 'USDC',
                name: 'USD Coin',
                decimals: 6,
                reserveLiquidationThreshold: 8500,
                usageAsCollateralEnabled: true,
                price: { priceInEth: '500000000000000' }
              }
            }
          ]
        },
        // User 3: WARN
        {
          id: '0x3',
          borrowedReservesCount: 1,
          reserves: [
            {
              currentATokenBalance: '1200000000',
              currentVariableDebt: '1000000000',
              currentStableDebt: '0',
              reserve: {
                id: '0xusdc',
                symbol: 'USDC',
                name: 'USD Coin',
                decimals: 6,
                reserveLiquidationThreshold: 8500,
                usageAsCollateralEnabled: true,
                price: { priceInEth: '500000000000000' }
              }
            }
          ]
        },
        // User 4: OK
        {
          id: '0x4',
          borrowedReservesCount: 1,
          reserves: [
            {
              currentATokenBalance: '2000000000',
              currentVariableDebt: '1000000000',
              currentStableDebt: '0',
              reserve: {
                id: '0xusdc',
                symbol: 'USDC',
                name: 'USD Coin',
                decimals: 6,
                reserveLiquidationThreshold: 8500,
                usageAsCollateralEnabled: true,
                price: { priceInEth: '500000000000000' }
              }
            }
          ]
        }
      ];

      mockSubgraphService.getUsersPage = vi.fn().mockResolvedValue(users);

      const scanner = new AtRiskScanner(
        mockSubgraphService as SubgraphService,
        healthCalculator,
        { warnThreshold: 1.05, liqThreshold: 1.0, dustEpsilon: 1e-9, notifyWarn: false },
        mockNotificationService as NotificationService
      );

      const result = await scanner.scanAndClassify(10);

      expect(result.scannedCount).toBe(4);
      expect(result.noDebtCount).toBe(1);
      expect(result.criticalCount).toBe(1);
      expect(result.warnCount).toBe(1);
      expect(result.users).toHaveLength(2); // Only CRITICAL and WARN
    });

    it('should handle subgraph fetch errors gracefully', async () => {
      mockSubgraphService.getUsersPage = vi.fn().mockRejectedValue(new Error('Network error'));

      const scanner = new AtRiskScanner(
        mockSubgraphService as SubgraphService,
        healthCalculator,
        { warnThreshold: 1.05, liqThreshold: 1.0, dustEpsilon: 1e-9, notifyWarn: false },
        mockNotificationService as NotificationService
      );

      const result = await scanner.scanAndClassify(10);

      expect(result.scannedCount).toBe(0);
      expect(result.criticalCount).toBe(0);
      expect(result.warnCount).toBe(0);
      expect(result.users).toHaveLength(0);
    });
  });

  describe('notifyAtRiskUsers', () => {
    it('should notify CRITICAL users by default', async () => {
      const scanner = new AtRiskScanner(
        mockSubgraphService as SubgraphService,
        healthCalculator,
        { warnThreshold: 1.05, liqThreshold: 1.0, dustEpsilon: 1e-9, notifyWarn: false },
        mockNotificationService as NotificationService
      );

      const users = [
        {
          userId: '0x1',
          healthFactor: 0.95,
          classification: 'CRITICAL' as const,
          totalDebtETH: 0.5,
          totalCollateralETH: 0.55
        }
      ];

      await scanner.notifyAtRiskUsers(users);

      expect(mockNotificationService.notifyHealthBreach).toHaveBeenCalledWith(
        expect.objectContaining({
          user: '0x1',
          healthFactor: 0.95,
          threshold: 1.0
        })
      );
    });

    it('should notify CRITICAL users when notifyCritical is true', async () => {
      const scanner = new AtRiskScanner(
        mockSubgraphService as SubgraphService,
        healthCalculator,
        { warnThreshold: 1.05, liqThreshold: 1.0, dustEpsilon: 1e-9, notifyWarn: false, notifyCritical: true },
        mockNotificationService as NotificationService
      );

      const users = [
        {
          userId: '0x1',
          healthFactor: 0.95,
          classification: 'CRITICAL' as const,
          totalDebtETH: 0.5,
          totalCollateralETH: 0.55
        }
      ];

      await scanner.notifyAtRiskUsers(users);

      expect(mockNotificationService.notifyHealthBreach).toHaveBeenCalledWith(
        expect.objectContaining({
          user: '0x1',
          healthFactor: 0.95,
          threshold: 1.0
        })
      );
    });

    it('should not notify CRITICAL users when notifyCritical is false', async () => {
      const scanner = new AtRiskScanner(
        mockSubgraphService as SubgraphService,
        healthCalculator,
        { warnThreshold: 1.05, liqThreshold: 1.0, dustEpsilon: 1e-9, notifyWarn: false, notifyCritical: false },
        mockNotificationService as NotificationService
      );

      const users = [
        {
          userId: '0x1',
          healthFactor: 0.95,
          classification: 'CRITICAL' as const,
          totalDebtETH: 0.5,
          totalCollateralETH: 0.55
        }
      ];

      await scanner.notifyAtRiskUsers(users);

      expect(mockNotificationService.notifyHealthBreach).not.toHaveBeenCalled();
    });

    it('should not notify WARN users when notifyWarn is false', async () => {
      const scanner = new AtRiskScanner(
        mockSubgraphService as SubgraphService,
        healthCalculator,
        { warnThreshold: 1.05, liqThreshold: 1.0, dustEpsilon: 1e-9, notifyWarn: false },
        mockNotificationService as NotificationService
      );

      const users = [
        {
          userId: '0x2',
          healthFactor: 1.02,
          classification: 'WARN' as const,
          totalDebtETH: 0.5,
          totalCollateralETH: 0.6
        }
      ];

      await scanner.notifyAtRiskUsers(users);

      expect(mockNotificationService.notifyHealthBreach).not.toHaveBeenCalled();
    });

    it('should notify WARN users when notifyWarn is true', async () => {
      const scanner = new AtRiskScanner(
        mockSubgraphService as SubgraphService,
        healthCalculator,
        { warnThreshold: 1.05, liqThreshold: 1.0, dustEpsilon: 1e-9, notifyWarn: true },
        mockNotificationService as NotificationService
      );

      const users = [
        {
          userId: '0x2',
          healthFactor: 1.02,
          classification: 'WARN' as const,
          totalDebtETH: 0.5,
          totalCollateralETH: 0.6
        }
      ];

      await scanner.notifyAtRiskUsers(users);

      expect(mockNotificationService.notifyHealthBreach).toHaveBeenCalledWith(
        expect.objectContaining({
          user: '0x2',
          healthFactor: 1.02,
          threshold: 1.05
        })
      );
    });

    it('should not notify when notification service is not provided', async () => {
      const scanner = new AtRiskScanner(
        mockSubgraphService as SubgraphService,
        healthCalculator,
        { warnThreshold: 1.05, liqThreshold: 1.0, dustEpsilon: 1e-9, notifyWarn: false }
      );

      const users = [
        {
          userId: '0x1',
          healthFactor: 0.95,
          classification: 'CRITICAL' as const,
          totalDebtETH: 0.5,
          totalCollateralETH: 0.55
        }
      ];

      // Should not throw
      await expect(scanner.notifyAtRiskUsers(users)).resolves.not.toThrow();
    });

    it('should not notify when notification service is disabled', async () => {
      mockNotificationService.isEnabled = vi.fn().mockReturnValue(false);

      const scanner = new AtRiskScanner(
        mockSubgraphService as SubgraphService,
        healthCalculator,
        { warnThreshold: 1.05, liqThreshold: 1.0, dustEpsilon: 1e-9, notifyWarn: false },
        mockNotificationService as NotificationService
      );

      const users = [
        {
          userId: '0x1',
          healthFactor: 0.95,
          classification: 'CRITICAL' as const,
          totalDebtETH: 0.5,
          totalCollateralETH: 0.55
        }
      ];

      await scanner.notifyAtRiskUsers(users);

      expect(mockNotificationService.notifyHealthBreach).not.toHaveBeenCalled();
    });
  });
});
