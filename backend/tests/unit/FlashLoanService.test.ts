// Unit tests for FlashLoanService
import { describe, it, expect } from 'vitest';

import { FlashLoanService } from '../../src/services/FlashLoanService.js';

describe('FlashLoanService', () => {
  const service = new FlashLoanService();

  describe('planRefinance', () => {
    it('should return a valid refinance route', async () => {
      const route = await service.planRefinance('0x123', 10000);
      
      expect(route.fromAsset).toBeTruthy();
      expect(route.toAsset).toBeTruthy();
      expect(parseFloat(route.amount)).toBeGreaterThan(0);
      expect(route.slippageBps).toBe(200);
      expect(route.gasEstimate).toBe('150000');
    });
  });

  describe('executeRefinance', () => {
    it('should return a mock transaction hash', async () => {
      const route = await service.planRefinance('0x456', 5000);
      const txHash = await service.executeRefinance('0x456', route);
      
      expect(txHash).toMatch(/^0x[a-f0-9]+$/);
    });
  });

  describe('estimateGasCost', () => {
    it('should calculate gas cost correctly', async () => {
      const route = await service.planRefinance('0x789', 1000);
      const gasCost = service.estimateGasCost(route, 20); // 20 gwei
      
      // 150000 gas * 20 gwei = 3000000 gwei = 0.003 ETH
      expect(gasCost).toBeCloseTo(0.003, 6);
    });
  });

  describe('validateRoute', () => {
    it('should validate a correct route', async () => {
      const route = await service.planRefinance('0xabc', 1000);
      const validation = service.validateRoute(route);
      
      expect(validation.valid).toBe(true);
      expect(validation.error).toBeUndefined();
    });

    it('should reject invalid assets', () => {
      const route = {
        fromAsset: '',
        toAsset: '0x123',
        amount: '100',
        slippageBps: 200,
        gasEstimate: '150000',
      };
      
      const validation = service.validateRoute(route);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('Invalid assets');
    });

    it('should reject invalid amount', () => {
      const route = {
        fromAsset: '0x123',
        toAsset: '0x456',
        amount: '0',
        slippageBps: 200,
        gasEstimate: '150000',
      };
      
      const validation = service.validateRoute(route);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('Invalid amount');
    });

    it('should reject out-of-range slippage', () => {
      const route = {
        fromAsset: '0x123',
        toAsset: '0x456',
        amount: '100',
        slippageBps: 1500, // 15% > max 10%
        gasEstimate: '150000',
      };
      
      const validation = service.validateRoute(route);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('Slippage out of range');
    });
  });
});
