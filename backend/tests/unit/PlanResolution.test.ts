// Unit tests for liquidation plan resolution
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ethers } from 'ethers';

import { ExecutionService } from '../../src/services/ExecutionService.js';
import { AaveDataService, type ReserveData } from '../../src/services/AaveDataService.js';
import { config } from '../../src/config/index.js';

describe('Liquidation Plan Resolution', () => {
  let executionService: ExecutionService;
  let mockAaveDataService: AaveDataService;

  beforeEach(() => {
    // Create execution service with mocked AaveDataService
    const mockProvider = new ethers.JsonRpcProvider('http://localhost:8545');
    mockAaveDataService = new AaveDataService(mockProvider);
    
    // Use type assertion to access private property for testing
    executionService = new ExecutionService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (executionService as any).aaveDataService = mockAaveDataService;
  });

  describe('prepareActionableOpportunity', () => {
    it('should return null when user has no debt', async () => {
      const mockAccountData = {
        totalCollateralBase: 1000000000n,
        totalDebtBase: 0n,
        availableBorrowsBase: 0n,
        currentLiquidationThreshold: 8500n,
        ltv: 8000n,
        healthFactor: ethers.parseUnits('2.0', 18)
      };

      vi.spyOn(mockAaveDataService, 'getUserAccountData').mockResolvedValue(mockAccountData);

      const result = await executionService.prepareActionableOpportunity('0xuser123');
      
      expect(result).toBeNull();
    });

    it('should return null when user has no collateral', async () => {
      const mockAccountData = {
        totalCollateralBase: 0n,
        totalDebtBase: 1000000000n,
        availableBorrowsBase: 0n,
        currentLiquidationThreshold: 8500n,
        ltv: 8000n,
        healthFactor: ethers.parseUnits('0.98', 18)
      };

      const mockReserves: ReserveData[] = [
        {
          asset: '0xusdc',
          symbol: 'USDC',
          decimals: 6,
          aTokenBalance: 0n,
          stableDebt: 0n,
          variableDebt: 1000000000n, // 1000 USDC
          totalDebt: 1000000000n,
          usageAsCollateralEnabled: false,
          priceInUsd: 1.0,
          priceRaw: BigInt(Math.floor(1.0 * 1e8)),
          debtValueUsd: 1000,
          collateralValueUsd: 0
        }
      ];

      vi.spyOn(mockAaveDataService, 'getUserAccountData').mockResolvedValue(mockAccountData);
      vi.spyOn(mockAaveDataService, 'getAllUserReserves').mockResolvedValue(mockReserves);

      const result = await executionService.prepareActionableOpportunity('0xuser123');
      
      expect(result).toBeNull();
    });

    it('should select largest debt asset by USD value', async () => {
      const mockAccountData = {
        totalCollateralBase: 2000000000n,
        totalDebtBase: 1500000000n,
        availableBorrowsBase: 0n,
        currentLiquidationThreshold: 8500n,
        ltv: 8000n,
        healthFactor: ethers.parseUnits('0.98', 18)
      };

      const mockReserves: ReserveData[] = [
        {
          asset: '0xusdc',
          symbol: 'USDC',
          decimals: 6,
          aTokenBalance: 0n,
          stableDebt: 0n,
          variableDebt: 500000000n, // 500 USDC
          totalDebt: 500000000n,
          usageAsCollateralEnabled: false,
          priceInUsd: 1.0,
          priceRaw: BigInt(Math.floor(1.0 * 1e8)),
          debtValueUsd: 500,
          collateralValueUsd: 0
        },
        {
          asset: '0xdai',
          symbol: 'DAI',
          decimals: 18,
          aTokenBalance: 0n,
          stableDebt: 0n,
          variableDebt: ethers.parseUnits('1000', 18), // 1000 DAI
          totalDebt: ethers.parseUnits('1000', 18),
          usageAsCollateralEnabled: false,
          priceInUsd: 1.0,
          priceRaw: BigInt(Math.floor(1.0 * 1e8)),
          debtValueUsd: 1000, // Largest debt
          collateralValueUsd: 0
        },
        {
          asset: '0xweth',
          symbol: 'WETH',
          decimals: 18,
          aTokenBalance: ethers.parseUnits('1', 18), // 1 WETH
          stableDebt: 0n,
          variableDebt: 0n,
          totalDebt: 0n,
          usageAsCollateralEnabled: true,
          priceInUsd: 2000,
          priceRaw: BigInt(Math.floor(2000 * 1e8)),
          debtValueUsd: 0,
          collateralValueUsd: 2000
        }
      ];

      vi.spyOn(mockAaveDataService, 'getUserAccountData').mockResolvedValue(mockAccountData);
      vi.spyOn(mockAaveDataService, 'getAllUserReserves').mockResolvedValue(mockReserves);
      vi.spyOn(mockAaveDataService, 'getLiquidationBonusPct').mockResolvedValue(0.05);

      const result = await executionService.prepareActionableOpportunity('0xuser123');
      
      expect(result).not.toBeNull();
      expect(result?.debtAsset).toBe('0xdai'); // Should select DAI (largest debt)
      expect(result?.debtAssetSymbol).toBe('DAI');
      expect(result?.collateralAsset).toBe('0xweth'); // Should select WETH (only collateral)
      expect(result?.collateralSymbol).toBe('WETH');
    });

    it('should prioritize LIQUIDATION_DEBT_ASSETS if configured', async () => {
      const mockAccountData = {
        totalCollateralBase: 2000000000n,
        totalDebtBase: 1500000000n,
        availableBorrowsBase: 0n,
        currentLiquidationThreshold: 8500n,
        ltv: 8000n,
        healthFactor: ethers.parseUnits('0.98', 18)
      };

      const mockReserves: ReserveData[] = [
        {
          asset: '0xusdc',
          symbol: 'USDC',
          decimals: 6,
          aTokenBalance: 0n,
          stableDebt: 0n,
          variableDebt: 500000000n, // 500 USDC (preferred asset)
          totalDebt: 500000000n,
          usageAsCollateralEnabled: false,
          priceInUsd: 1.0,
          priceRaw: BigInt(Math.floor(1.0 * 1e8)),
          debtValueUsd: 500,
          collateralValueUsd: 0
        },
        {
          asset: '0xdai',
          symbol: 'DAI',
          decimals: 18,
          aTokenBalance: 0n,
          stableDebt: 0n,
          variableDebt: ethers.parseUnits('1000', 18), // 1000 DAI (larger but not preferred)
          totalDebt: ethers.parseUnits('1000', 18),
          usageAsCollateralEnabled: false,
          priceInUsd: 1.0,
          priceRaw: BigInt(Math.floor(1.0 * 1e8)),
          debtValueUsd: 1000,
          collateralValueUsd: 0
        },
        {
          asset: '0xweth',
          symbol: 'WETH',
          decimals: 18,
          aTokenBalance: ethers.parseUnits('1', 18),
          stableDebt: 0n,
          variableDebt: 0n,
          totalDebt: 0n,
          usageAsCollateralEnabled: true,
          priceInUsd: 2000,
          priceRaw: BigInt(Math.floor(2000 * 1e8)),
          debtValueUsd: 0,
          collateralValueUsd: 2000
        }
      ];

      // Mock config to have preferred debt asset
      vi.spyOn(config, 'liquidationDebtAssets', 'get').mockReturnValue(['0xusdc']);

      vi.spyOn(mockAaveDataService, 'getUserAccountData').mockResolvedValue(mockAccountData);
      vi.spyOn(mockAaveDataService, 'getAllUserReserves').mockResolvedValue(mockReserves);
      vi.spyOn(mockAaveDataService, 'getLiquidationBonusPct').mockResolvedValue(0.05);

      const result = await executionService.prepareActionableOpportunity('0xuser123');
      
      expect(result).not.toBeNull();
      expect(result?.debtAsset).toBe('0xusdc'); // Should select USDC (preferred) not DAI (larger)
      expect(result?.debtAssetSymbol).toBe('USDC');
    });

    it('should select largest collateral by USD value', async () => {
      const mockAccountData = {
        totalCollateralBase: 3000000000n,
        totalDebtBase: 1000000000n,
        availableBorrowsBase: 0n,
        currentLiquidationThreshold: 8500n,
        ltv: 8000n,
        healthFactor: ethers.parseUnits('0.98', 18)
      };

      const mockReserves: ReserveData[] = [
        {
          asset: '0xusdc',
          symbol: 'USDC',
          decimals: 6,
          aTokenBalance: 0n,
          stableDebt: 0n,
          variableDebt: 1000000000n, // 1000 USDC debt
          totalDebt: 1000000000n,
          usageAsCollateralEnabled: false,
          priceInUsd: 1.0,
          priceRaw: BigInt(Math.floor(1.0 * 1e8)),
          debtValueUsd: 1000,
          collateralValueUsd: 0
        },
        {
          asset: '0xweth',
          symbol: 'WETH',
          decimals: 18,
          aTokenBalance: ethers.parseUnits('1', 18), // 1 WETH = $2000
          stableDebt: 0n,
          variableDebt: 0n,
          totalDebt: 0n,
          usageAsCollateralEnabled: true,
          priceInUsd: 2000,
          priceRaw: BigInt(Math.floor(2000 * 1e8)),
          debtValueUsd: 0,
          collateralValueUsd: 2000 // Larger collateral
        },
        {
          asset: '0xcbeth',
          symbol: 'cbETH',
          decimals: 18,
          aTokenBalance: ethers.parseUnits('0.5', 18), // 0.5 cbETH = $1000
          stableDebt: 0n,
          variableDebt: 0n,
          totalDebt: 0n,
          usageAsCollateralEnabled: true,
          priceInUsd: 2000,
          priceRaw: BigInt(Math.floor(2000 * 1e8)),
          debtValueUsd: 0,
          collateralValueUsd: 1000
        }
      ];

      vi.spyOn(mockAaveDataService, 'getUserAccountData').mockResolvedValue(mockAccountData);
      vi.spyOn(mockAaveDataService, 'getAllUserReserves').mockResolvedValue(mockReserves);
      vi.spyOn(mockAaveDataService, 'getLiquidationBonusPct').mockResolvedValue(0.05);

      const result = await executionService.prepareActionableOpportunity('0xuser123');
      
      expect(result).not.toBeNull();
      expect(result?.collateralAsset).toBe('0xweth'); // Should select WETH (larger collateral value)
      expect(result?.collateralSymbol).toBe('WETH');
    });

    it('should calculate debtToCover in fixed50 mode', async () => {
      const mockAccountData = {
        totalCollateralBase: 2000000000n,
        totalDebtBase: 1000000000n,
        availableBorrowsBase: 0n,
        currentLiquidationThreshold: 8500n,
        ltv: 8000n,
        healthFactor: ethers.parseUnits('0.98', 18)
      };

      const mockReserves: ReserveData[] = [
        {
          asset: '0xusdc',
          symbol: 'USDC',
          decimals: 6,
          aTokenBalance: 0n,
          stableDebt: 0n,
          variableDebt: 1000000000n, // 1000 USDC
          totalDebt: 1000000000n,
          usageAsCollateralEnabled: false,
          priceInUsd: 1.0,
          priceRaw: BigInt(Math.floor(1.0 * 1e8)),
          debtValueUsd: 1000,
          collateralValueUsd: 0
        },
        {
          asset: '0xweth',
          symbol: 'WETH',
          decimals: 18,
          aTokenBalance: ethers.parseUnits('1', 18),
          stableDebt: 0n,
          variableDebt: 0n,
          totalDebt: 0n,
          usageAsCollateralEnabled: true,
          priceInUsd: 2000,
          priceRaw: BigInt(Math.floor(2000 * 1e8)),
          debtValueUsd: 0,
          collateralValueUsd: 2000
        }
      ];

      vi.spyOn(config, 'closeFactorExecutionMode', 'get').mockReturnValue('fixed50');
      vi.spyOn(mockAaveDataService, 'getUserAccountData').mockResolvedValue(mockAccountData);
      vi.spyOn(mockAaveDataService, 'getAllUserReserves').mockResolvedValue(mockReserves);
      vi.spyOn(mockAaveDataService, 'getLiquidationBonusPct').mockResolvedValue(0.05);

      const result = await executionService.prepareActionableOpportunity('0xuser123');
      
      expect(result).not.toBeNull();
      expect(result?.totalDebt).toBe(1000000000n); // 1000 USDC
      expect(result?.debtToCover).toBe(500000000n); // 500 USDC (50%)
      expect(result?.debtToCoverUsd).toBe(500); // $500
    });

    it('should calculate debtToCover in full mode', async () => {
      const mockAccountData = {
        totalCollateralBase: 2000000000n,
        totalDebtBase: 1000000000n,
        availableBorrowsBase: 0n,
        currentLiquidationThreshold: 8500n,
        ltv: 8000n,
        healthFactor: ethers.parseUnits('0.98', 18)
      };

      const mockReserves: ReserveData[] = [
        {
          asset: '0xusdc',
          symbol: 'USDC',
          decimals: 6,
          aTokenBalance: 0n,
          stableDebt: 0n,
          variableDebt: 1000000000n, // 1000 USDC
          totalDebt: 1000000000n,
          usageAsCollateralEnabled: false,
          priceInUsd: 1.0,
          priceRaw: BigInt(Math.floor(1.0 * 1e8)),
          debtValueUsd: 1000,
          collateralValueUsd: 0
        },
        {
          asset: '0xweth',
          symbol: 'WETH',
          decimals: 18,
          aTokenBalance: ethers.parseUnits('1', 18),
          stableDebt: 0n,
          variableDebt: 0n,
          totalDebt: 0n,
          usageAsCollateralEnabled: true,
          priceInUsd: 2000,
          priceRaw: BigInt(Math.floor(2000 * 1e8)),
          debtValueUsd: 0,
          collateralValueUsd: 2000
        }
      ];

      vi.spyOn(config, 'closeFactorExecutionMode', 'get').mockReturnValue('full');
      vi.spyOn(mockAaveDataService, 'getUserAccountData').mockResolvedValue(mockAccountData);
      vi.spyOn(mockAaveDataService, 'getAllUserReserves').mockResolvedValue(mockReserves);
      vi.spyOn(mockAaveDataService, 'getLiquidationBonusPct').mockResolvedValue(0.05);

      const result = await executionService.prepareActionableOpportunity('0xuser123');
      
      expect(result).not.toBeNull();
      expect(result?.totalDebt).toBe(1000000000n); // 1000 USDC
      expect(result?.debtToCover).toBe(1000000000n); // 1000 USDC (100%)
      expect(result?.debtToCoverUsd).toBe(1000); // $1000
    });

    it('should return null when below PROFIT_MIN_USD threshold', async () => {
      const mockAccountData = {
        totalCollateralBase: 50000000n,
        totalDebtBase: 5000000n,
        availableBorrowsBase: 0n,
        currentLiquidationThreshold: 8500n,
        ltv: 8000n,
        healthFactor: ethers.parseUnits('0.98', 18)
      };

      const mockReserves: ReserveData[] = [
        {
          asset: '0xusdc',
          symbol: 'USDC',
          decimals: 6,
          aTokenBalance: 0n,
          stableDebt: 0n,
          variableDebt: 5000000n, // 5 USDC (too small)
          totalDebt: 5000000n,
          usageAsCollateralEnabled: false,
          priceInUsd: 1.0,
          priceRaw: BigInt(Math.floor(1.0 * 1e8)),
          debtValueUsd: 5,
          collateralValueUsd: 0
        },
        {
          asset: '0xweth',
          symbol: 'WETH',
          decimals: 18,
          aTokenBalance: ethers.parseUnits('0.025', 18), // 0.025 WETH
          stableDebt: 0n,
          variableDebt: 0n,
          totalDebt: 0n,
          usageAsCollateralEnabled: true,
          priceInUsd: 2000,
          priceRaw: BigInt(Math.floor(2000 * 1e8)),
          debtValueUsd: 0,
          collateralValueUsd: 50
        }
      ];

      // Default PROFIT_MIN_USD is 10, so 5 USDC debt (2.5 USDC in fixed50) should be rejected
      vi.spyOn(config, 'profitMinUsd', 'get').mockReturnValue(10);
      vi.spyOn(config, 'closeFactorExecutionMode', 'get').mockReturnValue('fixed50');
      vi.spyOn(mockAaveDataService, 'getUserAccountData').mockResolvedValue(mockAccountData);
      vi.spyOn(mockAaveDataService, 'getAllUserReserves').mockResolvedValue(mockReserves);
      vi.spyOn(mockAaveDataService, 'getLiquidationBonusPct').mockResolvedValue(0.05);

      const result = await executionService.prepareActionableOpportunity('0xuser123');
      
      expect(result).toBeNull(); // Below threshold
    });

    it('should return plan when above PROFIT_MIN_USD threshold', async () => {
      const mockAccountData = {
        totalCollateralBase: 2000000000n,
        totalDebtBase: 50000000n,
        availableBorrowsBase: 0n,
        currentLiquidationThreshold: 8500n,
        ltv: 8000n,
        healthFactor: ethers.parseUnits('0.98', 18)
      };

      const mockReserves: ReserveData[] = [
        {
          asset: '0xusdc',
          symbol: 'USDC',
          decimals: 6,
          aTokenBalance: 0n,
          stableDebt: 0n,
          variableDebt: 50000000n, // 50 USDC
          totalDebt: 50000000n,
          usageAsCollateralEnabled: false,
          priceInUsd: 1.0,
          priceRaw: BigInt(Math.floor(1.0 * 1e8)),
          debtValueUsd: 50,
          collateralValueUsd: 0
        },
        {
          asset: '0xweth',
          symbol: 'WETH',
          decimals: 18,
          aTokenBalance: ethers.parseUnits('1', 18),
          stableDebt: 0n,
          variableDebt: 0n,
          totalDebt: 0n,
          usageAsCollateralEnabled: true,
          priceInUsd: 2000,
          priceRaw: BigInt(Math.floor(2000 * 1e8)),
          debtValueUsd: 0,
          collateralValueUsd: 2000
        }
      ];

      // 50 USDC debt => 25 USDC in fixed50 mode => above 10 USD threshold
      vi.spyOn(config, 'profitMinUsd', 'get').mockReturnValue(10);
      vi.spyOn(config, 'closeFactorExecutionMode', 'get').mockReturnValue('fixed50');
      vi.spyOn(mockAaveDataService, 'getUserAccountData').mockResolvedValue(mockAccountData);
      vi.spyOn(mockAaveDataService, 'getAllUserReserves').mockResolvedValue(mockReserves);
      vi.spyOn(mockAaveDataService, 'getLiquidationBonusPct').mockResolvedValue(0.05);

      const result = await executionService.prepareActionableOpportunity('0xuser123');
      
      expect(result).not.toBeNull();
      expect(result?.debtToCoverUsd).toBe(25); // Above threshold
    });

    it('should handle precise decimal calculations', async () => {
      const mockAccountData = {
        totalCollateralBase: 3000000000n,
        totalDebtBase: 2500000000000000000n,
        availableBorrowsBase: 0n,
        currentLiquidationThreshold: 8500n,
        ltv: 8000n,
        healthFactor: ethers.parseUnits('0.98', 18)
      };

      const mockReserves: ReserveData[] = [
        {
          asset: '0xweth',
          symbol: 'WETH',
          decimals: 18,
          aTokenBalance: 0n,
          stableDebt: 0n,
          variableDebt: ethers.parseUnits('1.5', 18), // 1.5 WETH at $2000 = $3000
          totalDebt: ethers.parseUnits('1.5', 18),
          usageAsCollateralEnabled: false,
          priceInUsd: 2000,
          priceRaw: BigInt(Math.floor(2000 * 1e8)),
          debtValueUsd: 3000,
          collateralValueUsd: 0
        },
        {
          asset: '0xusdc',
          symbol: 'USDC',
          decimals: 6,
          aTokenBalance: 2000000000n, // 2000 USDC
          stableDebt: 0n,
          variableDebt: 0n,
          totalDebt: 0n,
          usageAsCollateralEnabled: true,
          priceInUsd: 1.0,
          priceRaw: BigInt(Math.floor(1.0 * 1e8)),
          debtValueUsd: 0,
          collateralValueUsd: 2000
        }
      ];

      vi.spyOn(config, 'closeFactorExecutionMode', 'get').mockReturnValue('fixed50');
      vi.spyOn(mockAaveDataService, 'getUserAccountData').mockResolvedValue(mockAccountData);
      vi.spyOn(mockAaveDataService, 'getAllUserReserves').mockResolvedValue(mockReserves);
      vi.spyOn(mockAaveDataService, 'getLiquidationBonusPct').mockResolvedValue(0.05);

      const result = await executionService.prepareActionableOpportunity('0xuser123');
      
      expect(result).not.toBeNull();
      expect(result?.totalDebt).toBe(ethers.parseUnits('1.5', 18));
      expect(result?.debtToCover).toBe(ethers.parseUnits('0.75', 18)); // 0.75 WETH
      expect(result?.debtToCoverUsd).toBe(1500); // 0.75 WETH * $2000 = $1500
      expect(result?.liquidationBonusPct).toBe(0.05);
    });

    it('should include all plan fields with resolved metadata', async () => {
      const mockAccountData = {
        totalCollateralBase: 2000000000n,
        totalDebtBase: 1000000000n,
        availableBorrowsBase: 0n,
        currentLiquidationThreshold: 8500n,
        ltv: 8000n,
        healthFactor: ethers.parseUnits('0.98', 18)
      };

      const mockReserves: ReserveData[] = [
        {
          asset: '0xusdc',
          symbol: 'USDC',
          decimals: 6,
          aTokenBalance: 0n,
          stableDebt: 0n,
          variableDebt: 1000000000n,
          totalDebt: 1000000000n,
          usageAsCollateralEnabled: false,
          priceInUsd: 1.0,
          priceRaw: BigInt(Math.floor(1.0 * 1e8)),
          debtValueUsd: 1000,
          collateralValueUsd: 0
        },
        {
          asset: '0xweth',
          symbol: 'WETH',
          decimals: 18,
          aTokenBalance: ethers.parseUnits('1', 18),
          stableDebt: 0n,
          variableDebt: 0n,
          totalDebt: 0n,
          usageAsCollateralEnabled: true,
          priceInUsd: 2000,
          priceRaw: BigInt(Math.floor(2000 * 1e8)),
          debtValueUsd: 0,
          collateralValueUsd: 2000
        }
      ];

      vi.spyOn(mockAaveDataService, 'getUserAccountData').mockResolvedValue(mockAccountData);
      vi.spyOn(mockAaveDataService, 'getAllUserReserves').mockResolvedValue(mockReserves);
      vi.spyOn(mockAaveDataService, 'getLiquidationBonusPct').mockResolvedValue(0.075);

      const result = await executionService.prepareActionableOpportunity('0xuser123');
      
      expect(result).not.toBeNull();
      // Verify all required fields are present and have correct types
      expect(result?.debtAsset).toBe('0xusdc');
      expect(result?.debtAssetSymbol).toBe('USDC');
      expect(typeof result?.totalDebt).toBe('bigint');
      expect(typeof result?.debtToCover).toBe('bigint');
      expect(typeof result?.debtToCoverUsd).toBe('number');
      expect(result?.liquidationBonusPct).toBe(0.075);
      expect(result?.collateralAsset).toBe('0xweth');
      expect(result?.collateralSymbol).toBe('WETH');
    });
  });
});
