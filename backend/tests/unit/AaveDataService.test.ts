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

  describe('getSymbolForAsset', () => {
    let mockProvider: ethers.JsonRpcProvider;
    let service: AaveDataService;
    let mockTokenRegistry: any;
    
    beforeEach(() => {
      // Create mock provider
      mockProvider = {
        getNetwork: vi.fn().mockResolvedValue({ chainId: 8453n })
      } as unknown as ethers.JsonRpcProvider;
      
      service = new AaveDataService(mockProvider);
      
      // Create mock TokenMetadataRegistry
      mockTokenRegistry = {
        get: vi.fn()
      };
      
      service.setTokenRegistry(mockTokenRegistry);
    });

    it('should normalize address to lowercase before lookup', async () => {
      const mixedCaseAddress = '0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913';
      const lowerCaseAddress = mixedCaseAddress.toLowerCase();
      
      // Mock registry to return override
      mockTokenRegistry.get.mockResolvedValue({
        address: lowerCaseAddress,
        symbol: 'USDC',
        decimals: 6,
        source: 'override'
      });
      
      // Call private method via reflection for testing
      const result = await (service as any).getSymbolForAsset(mixedCaseAddress);
      
      expect(result).toBe('USDC');
      expect(mockTokenRegistry.get).toHaveBeenCalledWith(lowerCaseAddress);
    });

    it('should resolve symbol via TokenMetadataRegistry override when not in base', async () => {
      const address = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
      
      // Mock registry to return override (base doesn't have it)
      mockTokenRegistry.get.mockResolvedValue({
        address,
        symbol: 'USDC',
        decimals: 6,
        source: 'override'
      });
      
      const result = await (service as any).getSymbolForAsset(address);
      
      expect(result).toBe('USDC');
      expect(mockTokenRegistry.get).toHaveBeenCalledWith(address);
    });

    it('should resolve symbol via TokenMetadataRegistry on-chain when not in base or overrides', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      
      // Mock registry to return on-chain result
      mockTokenRegistry.get.mockResolvedValue({
        address,
        symbol: 'TOKEN',
        decimals: 18,
        source: 'onchain'
      });
      
      const result = await (service as any).getSymbolForAsset(address);
      
      expect(result).toBe('TOKEN');
      expect(mockTokenRegistry.get).toHaveBeenCalledWith(address);
    });

    it('should return UNKNOWN when registry fails to resolve', async () => {
      const address = '0x1234567890123456789012345678901234567890';
      
      // Mock registry to return unknown (both override and on-chain failed)
      mockTokenRegistry.get.mockResolvedValue({
        address,
        symbol: 'UNKNOWN',
        decimals: 18,
        source: 'unknown'
      });
      
      const result = await (service as any).getSymbolForAsset(address);
      
      expect(result).toBe('UNKNOWN');
      expect(mockTokenRegistry.get).toHaveBeenCalledWith(address);
    });

    it('should not log symbol_missing when registry resolves successfully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const address = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
      
      // Mock registry to return override
      mockTokenRegistry.get.mockResolvedValue({
        address,
        symbol: 'USDC',
        decimals: 6,
        source: 'override'
      });
      
      await (service as any).getSymbolForAsset(address);
      
      // Should NOT log symbol_missing
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_missing')
      );
      
      consoleSpy.mockRestore();
    });

    it('should NOT log in AaveDataService when registry succeeds (registry handles logging)', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const address = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
      
      // Mock registry to return override
      mockTokenRegistry.get.mockResolvedValue({
        address,
        symbol: 'USDC',
        decimals: 6,
        source: 'override'
      });
      
      await (service as any).getSymbolForAsset(address);
      
      // AaveDataService should NOT log - registry handles logging
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[aave-data] symbol_resolved')
      );
      
      consoleSpy.mockRestore();
    });

    it('should use fallback when TokenMetadataRegistry is not set', async () => {
      // Create service without registry
      const serviceNoRegistry = new AaveDataService(mockProvider);
      const address = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
      
      // Should use hardcoded fallback
      const result = await (serviceNoRegistry as any).getSymbolForAsset(address);
      
      expect(result).toBe('USDC');
    });

    it('should handle base metadata with missing symbol by routing through registry', async () => {
      const address = '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42'; // EURC
      
      // Mock AaveMetadata to have the address but with UNKNOWN symbol
      const mockAaveMetadata = {
        getReserve: vi.fn().mockReturnValue({
          symbol: 'UNKNOWN',
          decimals: 6,
          underlyingAddress: address
        })
      };
      service.setAaveMetadata(mockAaveMetadata);
      
      // Mock registry to return override
      mockTokenRegistry.get.mockResolvedValue({
        address,
        symbol: 'EURC',
        decimals: 6,
        source: 'override'
      });
      
      const result = await (service as any).getSymbolForAsset(address);
      
      // Should use registry's result, not base metadata's UNKNOWN
      expect(result).toBe('EURC');
    });

    it('should respect base metadata when it has a valid symbol', async () => {
      const address = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
      
      // Mock AaveMetadata to have the address with a valid symbol
      const mockAaveMetadata = {
        getReserve: vi.fn().mockReturnValue({
          symbol: 'AUTHORITATIVE_USDC',
          decimals: 6,
          underlyingAddress: address
        })
      };
      service.setAaveMetadata(mockAaveMetadata);
      
      // Registry should return base metadata (which is what it would do internally)
      // because TokenMetadataRegistry checks base first
      mockTokenRegistry.get.mockResolvedValue({
        address,
        symbol: 'AUTHORITATIVE_USDC', // Must match what AaveMetadata has
        decimals: 6,
        source: 'base' // Indicates it came from base metadata
      });
      
      const result = await (service as any).getSymbolForAsset(address);
      
      // Should use registry which internally checks base first
      expect(result).toBe('AUTHORITATIVE_USDC');
    });
  });
});
