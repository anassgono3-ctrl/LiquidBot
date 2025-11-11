// AaveDataService.test.ts - Unit tests for variable debt expansion
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

import { AaveDataService } from '../../src/services/AaveDataService.js';

describe('AaveDataService', () => {
  describe('getTotalDebt', () => {
    let mockProvider: ethers.JsonRpcProvider;
    let service: AaveDataService;
    
    beforeEach(() => {
      // Create mock provider
      mockProvider = {
        getNetwork: vi.fn().mockResolvedValue({ chainId: 8453n })
      } as unknown as ethers.JsonRpcProvider;
      
      service = new AaveDataService(mockProvider);
    });

    it('should expand scaled variable debt using variableBorrowIndex', async () => {
      // Mock getUserReserveData to return scaled debt
      const scaledVariableDebt = BigInt('1000000000000000000'); // 1.0 scaled
      const currentStableDebt = BigInt('500000000000000000'); // 0.5 stable
      const variableBorrowIndex = BigInt('1050000000000000000000000000'); // 1.05 * RAY
      
      vi.spyOn(service, 'getUserReserveData').mockResolvedValue({
        currentATokenBalance: 0n,
        currentStableDebt,
        currentVariableDebt: 0n, // Not provided initially
        principalStableDebt: currentStableDebt,
        scaledVariableDebt,
        stableBorrowRate: 0n,
        liquidityRate: 0n,
        stableRateLastUpdated: 0n,
        usageAsCollateralEnabled: false
      });
      
      vi.spyOn(service, 'getReserveData').mockResolvedValue({
        unbacked: 0n,
        accruedToTreasuryScaled: 0n,
        totalAToken: 0n,
        totalStableDebt: 0n,
        totalVariableDebt: 0n,
        liquidityRate: 0n,
        variableBorrowRate: 0n,
        stableBorrowRate: 0n,
        averageStableBorrowRate: 0n,
        liquidityIndex: BigInt(10 ** 27),
        variableBorrowIndex,
        lastUpdateTimestamp: 0n
      });
      
      const totalDebt = await service.getTotalDebt('0xasset', '0xuser');
      
      // Expected: scaledVariableDebt * variableBorrowIndex / RAY + stableDebt
      // = 1.0 * 1.05 + 0.5 = 1.55
      const RAY = BigInt(10 ** 27);
      const expectedVariableDebt = (scaledVariableDebt * variableBorrowIndex) / RAY;
      const expectedTotal = expectedVariableDebt + currentStableDebt;
      
      expect(totalDebt).toBe(expectedTotal);
      // Allow for minor rounding due to BigInt division
      const tolerance = BigInt('100'); // Within 100 wei
      expect(totalDebt - BigInt('1550000000000000000')).toBeLessThan(tolerance);
    });

    it('should handle different variableBorrowIndex values', async () => {
      const scaledVariableDebt = BigInt('2000000000000000000'); // 2.0 scaled
      const currentStableDebt = BigInt('0'); // No stable debt
      const variableBorrowIndex = BigInt('1200000000000000000000000000'); // 1.2 * RAY
      
      vi.spyOn(service, 'getUserReserveData').mockResolvedValue({
        currentATokenBalance: 0n,
        currentStableDebt,
        currentVariableDebt: 0n,
        principalStableDebt: 0n,
        scaledVariableDebt,
        stableBorrowRate: 0n,
        liquidityRate: 0n,
        stableRateLastUpdated: 0n,
        usageAsCollateralEnabled: false
      });
      
      vi.spyOn(service, 'getReserveData').mockResolvedValue({
        unbacked: 0n,
        accruedToTreasuryScaled: 0n,
        totalAToken: 0n,
        totalStableDebt: 0n,
        totalVariableDebt: 0n,
        liquidityRate: 0n,
        variableBorrowRate: 0n,
        stableBorrowRate: 0n,
        averageStableBorrowRate: 0n,
        liquidityIndex: BigInt(10 ** 27),
        variableBorrowIndex,
        lastUpdateTimestamp: 0n
      });
      
      const totalDebt = await service.getTotalDebt('0xasset', '0xuser');
      
      // Expected: 2.0 * 1.2 = 2.4 (with minor rounding tolerance)
      const expected = BigInt('2400000000000000000');
      const tolerance = BigInt('100');
      expect(totalDebt - expected).toBeLessThan(tolerance);
    });

    it('should fallback to currentVariableDebt if getReserveData fails', async () => {
      const scaledVariableDebt = BigInt('1000000000000000000');
      const currentVariableDebt = BigInt('1050000000000000000'); // Fallback value
      const currentStableDebt = BigInt('500000000000000000');
      
      vi.spyOn(service, 'getUserReserveData').mockResolvedValue({
        currentATokenBalance: 0n,
        currentStableDebt,
        currentVariableDebt,
        principalStableDebt: currentStableDebt,
        scaledVariableDebt,
        stableBorrowRate: 0n,
        liquidityRate: 0n,
        stableRateLastUpdated: 0n,
        usageAsCollateralEnabled: false
      });
      
      // Mock getReserveData to fail
      vi.spyOn(service, 'getReserveData').mockRejectedValue(new Error('RPC error'));
      
      const totalDebt = await service.getTotalDebt('0xasset', '0xuser');
      
      // Should use currentVariableDebt as fallback
      expect(totalDebt).toBe(currentVariableDebt + currentStableDebt);
      expect(totalDebt).toBe(BigInt('1550000000000000000'));
    });

    it('should handle zero scaled debt', async () => {
      const currentVariableDebt = BigInt('1000000000000000000');
      const currentStableDebt = BigInt('500000000000000000');
      
      vi.spyOn(service, 'getUserReserveData').mockResolvedValue({
        currentATokenBalance: 0n,
        currentStableDebt,
        currentVariableDebt,
        principalStableDebt: currentStableDebt,
        scaledVariableDebt: 0n, // No scaled debt
        stableBorrowRate: 0n,
        liquidityRate: 0n,
        stableRateLastUpdated: 0n,
        usageAsCollateralEnabled: false
      });
      
      const totalDebt = await service.getTotalDebt('0xasset', '0xuser');
      
      // Should use currentVariableDebt directly
      expect(totalDebt).toBe(currentVariableDebt + currentStableDebt);
      expect(totalDebt).toBe(BigInt('1500000000000000000'));
    });

    it('should handle high borrow index (long-term accrued interest)', async () => {
      const scaledVariableDebt = BigInt('1000000000'); // 1000 in small token (e.g., USDC with 6 decimals)
      const currentStableDebt = BigInt('0');
      // Index after significant time: 1.5 * RAY (50% accrued interest)
      const variableBorrowIndex = BigInt('1500000000000000000000000000');
      
      vi.spyOn(service, 'getUserReserveData').mockResolvedValue({
        currentATokenBalance: 0n,
        currentStableDebt,
        currentVariableDebt: 0n,
        principalStableDebt: 0n,
        scaledVariableDebt,
        stableBorrowRate: 0n,
        liquidityRate: 0n,
        stableRateLastUpdated: 0n,
        usageAsCollateralEnabled: false
      });
      
      vi.spyOn(service, 'getReserveData').mockResolvedValue({
        unbacked: 0n,
        accruedToTreasuryScaled: 0n,
        totalAToken: 0n,
        totalStableDebt: 0n,
        totalVariableDebt: 0n,
        liquidityRate: 0n,
        variableBorrowRate: 0n,
        stableBorrowRate: 0n,
        averageStableBorrowRate: 0n,
        liquidityIndex: BigInt(10 ** 27),
        variableBorrowIndex,
        lastUpdateTimestamp: 0n
      });
      
      const totalDebt = await service.getTotalDebt('0xasset', '0xuser');
      
      // Expected: 1000 * 1.5 = 1500 (with minor rounding tolerance)
      const expected = BigInt('1500000000');
      const tolerance = BigInt('10');
      expect(totalDebt - expected).toBeLessThan(tolerance);
    });
  });
});
