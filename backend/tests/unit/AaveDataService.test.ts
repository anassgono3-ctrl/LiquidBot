// AaveDataService.test.ts - Unit tests for canonical debt values
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

    it('should use canonical currentVariableDebt and currentStableDebt directly', async () => {
      // Mock getUserReserveData to return canonical debt values
      const currentVariableDebt = BigInt('1050000000000000000'); // 1.05 variable debt (already scaled by protocol)
      const currentStableDebt = BigInt('500000000000000000'); // 0.5 stable debt
      
      vi.spyOn(service, 'getUserReserveData').mockResolvedValue({
        currentATokenBalance: 0n,
        currentStableDebt,
        currentVariableDebt, // Canonical value from Protocol Data Provider
        principalStableDebt: currentStableDebt,
        scaledVariableDebt: BigInt('1000000000000000000'), // Not used in new implementation
        stableBorrowRate: 0n,
        liquidityRate: 0n,
        stableRateLastUpdated: 0n,
        usageAsCollateralEnabled: false
      });
      
      const totalDebt = await service.getTotalDebt('0xasset', '0xuser');
      
      // Expected: currentVariableDebt + currentStableDebt (canonical values)
      // = 1.05 + 0.5 = 1.55
      const expectedTotal = currentVariableDebt + currentStableDebt;
      
      expect(totalDebt).toBe(expectedTotal);
      expect(totalDebt).toBe(BigInt('1550000000000000000'));
    });

    it('should handle zero stable debt correctly', async () => {
      const currentVariableDebt = BigInt('2400000000000000000'); // 2.4 variable debt (canonical)
      const currentStableDebt = BigInt('0'); // No stable debt
      
      vi.spyOn(service, 'getUserReserveData').mockResolvedValue({
        currentATokenBalance: 0n,
        currentStableDebt,
        currentVariableDebt,
        principalStableDebt: 0n,
        scaledVariableDebt: BigInt('2000000000000000000'), // Not used in new implementation
        stableBorrowRate: 0n,
        liquidityRate: 0n,
        stableRateLastUpdated: 0n,
        usageAsCollateralEnabled: false
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

    it('should handle USDC-sized debt correctly (6 decimals)', async () => {
      // USDC-sized debt with 6 decimals - canonical value already scaled by protocol
      const currentVariableDebt = BigInt('1500000000'); // 1500 USDC (canonical)
      const currentStableDebt = BigInt('0');
      
      vi.spyOn(service, 'getUserReserveData').mockResolvedValue({
        currentATokenBalance: 0n,
        currentStableDebt,
        currentVariableDebt,
        principalStableDebt: 0n,
        scaledVariableDebt: BigInt('1000000000'), // Not used in new implementation
        stableBorrowRate: 0n,
        liquidityRate: 0n,
        stableRateLastUpdated: 0n,
        usageAsCollateralEnabled: false
      });
      
      const totalDebt = await service.getTotalDebt('0xasset', '0xuser');
      
      // Expected: canonical currentVariableDebt = 1500 USDC
      expect(totalDebt).toBe(currentVariableDebt);
      expect(totalDebt).toBe(BigInt('1500000000'));
    });

    it('should handle mix of variable and stable debt', async () => {
      // Both variable and stable debt present - use canonical values
      const currentVariableDebt = BigInt('2000000000000000000'); // 2.0 variable (canonical)
      const currentStableDebt = BigInt('500000000000000000'); // 0.5 stable
      
      vi.spyOn(service, 'getUserReserveData').mockResolvedValue({
        currentATokenBalance: 0n,
        currentStableDebt,
        currentVariableDebt,
        principalStableDebt: currentStableDebt,
        scaledVariableDebt: BigInt('1666666666666666666'), // Not used in new implementation
        stableBorrowRate: 0n,
        liquidityRate: 0n,
        stableRateLastUpdated: 0n,
        usageAsCollateralEnabled: false
      });
      
      const totalDebt = await service.getTotalDebt('0xasset', '0xuser');
      
      // Should use canonical values directly: currentVariableDebt + currentStableDebt
      expect(totalDebt).toBe(currentVariableDebt + currentStableDebt);
      expect(totalDebt).toBe(BigInt('2500000000000000000'));
    });

    it('should return zero when both scaled and current debt are zero', async () => {
      const currentStableDebt = BigInt('0');
      
      vi.spyOn(service, 'getUserReserveData').mockResolvedValue({
        currentATokenBalance: 0n,
        currentStableDebt,
        currentVariableDebt: 0n,
        principalStableDebt: 0n,
        scaledVariableDebt: 0n,
        stableBorrowRate: 0n,
        liquidityRate: 0n,
        stableRateLastUpdated: 0n,
        usageAsCollateralEnabled: false
      });
      
      const totalDebt = await service.getTotalDebt('0xasset', '0xuser');
      
      expect(totalDebt).toBe(0n);
    });
  });
});
