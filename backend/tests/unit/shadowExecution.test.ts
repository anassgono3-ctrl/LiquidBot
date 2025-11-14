import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { buildShadowPlan, maybeShadowExecute, type ShadowExecCandidate } from '../../src/exec/shadowExecution.js';
import { config } from '../../src/config/index.js';

describe('shadowExecution', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('buildShadowPlan', () => {
    it('should build a shadow plan with 50% close factor', () => {
      const candidate: ShadowExecCandidate = {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 0.98,
        blockTag: 12345678,
        debtAsset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        collateralAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        debtAmountWei: BigInt('1000000000'), // 1000 USDC (6 decimals)
        collateralAmountWei: BigInt('500000000000000000') // 0.5 WETH
      };

      const plan = buildShadowPlan(candidate);

      expect(plan.user).toBe(candidate.user);
      expect(plan.blockTag).toBe(candidate.blockTag);
      expect(plan.hf).toBe(candidate.healthFactor);
      expect(plan.debtAsset).toBe(candidate.debtAsset);
      expect(plan.collateralAsset).toBe(candidate.collateralAsset);
      
      // 50% close factor
      expect(plan.closeFactorBps).toBe(5000);
      expect(plan.repayWei).toBe(BigInt('500000000')); // 50% of debt
      expect(plan.seizeWei).toBe(BigInt('250000000000000000')); // 50% of collateral
      
      // Gas configuration
      expect(plan.gas.tipGwei).toBe(config.gasTipGweiFast);
      expect(plan.gas.bumpFactor).toBe(config.gasBumpFactor);
      
      // Mode
      expect(plan.mode).toBe('shadow');
      
      // Path hint
      expect(plan.pathHint).toContain('1inch:');
      expect(plan.pathHint).toContain(candidate.debtAsset);
      expect(plan.pathHint).toContain(candidate.collateralAsset);
    });

    it('should set MEV mode to public by default', () => {
      const candidate: ShadowExecCandidate = {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 0.98,
        blockTag: 12345678,
        debtAsset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        collateralAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        debtAmountWei: BigInt('1000000000'),
        collateralAmountWei: BigInt('500000000000000000')
      };

      const plan = buildShadowPlan(candidate);

      expect(plan.mev.mode).toBe('public');
      expect(plan.mev.endpoint).toBeUndefined();
    });

    it('should handle pending blockTag', () => {
      const candidate: ShadowExecCandidate = {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 0.98,
        blockTag: 'pending',
        debtAsset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        collateralAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        debtAmountWei: BigInt('1000000000'),
        collateralAmountWei: BigInt('500000000000000000')
      };

      const plan = buildShadowPlan(candidate);

      expect(plan.blockTag).toBe('pending');
    });

    it('should calculate amounts correctly with large values', () => {
      const candidate: ShadowExecCandidate = {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 0.98,
        blockTag: 12345678,
        debtAsset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        collateralAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        debtAmountWei: BigInt('999999999999999999'), // Large amount
        collateralAmountWei: BigInt('888888888888888888') // Large amount
      };

      const plan = buildShadowPlan(candidate);

      // Verify 50% calculation
      expect(plan.repayWei).toBe((candidate.debtAmountWei * BigInt(5000)) / BigInt(10000));
      expect(plan.seizeWei).toBe((candidate.collateralAmountWei * BigInt(5000)) / BigInt(10000));
    });
  });

  describe('maybeShadowExecute', () => {
    it('should not log when shadow execution is disabled', () => {
      // Mock config to disable shadow execution
      vi.spyOn(config, 'shadowExecuteEnabled', 'get').mockReturnValue(false);

      const candidate: ShadowExecCandidate = {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 0.98,
        blockTag: 12345678,
        debtAsset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        collateralAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        debtAmountWei: BigInt('1000000000'),
        collateralAmountWei: BigInt('500000000000000000')
      };

      maybeShadowExecute(candidate);

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should not log when HF is above threshold', () => {
      // Mock config to enable shadow execution
      vi.spyOn(config, 'shadowExecuteEnabled', 'get').mockReturnValue(true);
      vi.spyOn(config, 'shadowExecuteThreshold', 'get').mockReturnValue(1.005);

      const candidate: ShadowExecCandidate = {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 1.01, // Above threshold
        blockTag: 12345678,
        debtAsset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        collateralAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        debtAmountWei: BigInt('1000000000'),
        collateralAmountWei: BigInt('500000000000000000')
      };

      maybeShadowExecute(candidate);

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should log when enabled and HF is below threshold', () => {
      // Mock config to enable shadow execution
      vi.spyOn(config, 'shadowExecuteEnabled', 'get').mockReturnValue(true);
      vi.spyOn(config, 'shadowExecuteThreshold', 'get').mockReturnValue(1.005);
      vi.spyOn(config, 'gasTipGweiFast', 'get').mockReturnValue(3);
      vi.spyOn(config, 'gasBumpFactor', 'get').mockReturnValue(1.25);
      vi.spyOn(config, 'txSubmitMode', 'get').mockReturnValue('public');

      const candidate: ShadowExecCandidate = {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 0.98, // Below threshold
        blockTag: 12345678,
        debtAsset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        collateralAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        debtAmountWei: BigInt('1000000000'),
        collateralAmountWei: BigInt('500000000000000000')
      };

      maybeShadowExecute(candidate);

      // Should have been called twice: once for JSON log, once for metrics
      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
      
      // Check that first call is JSON with SHADOW_EXECUTE tag
      const firstCall = consoleLogSpy.mock.calls[0][0];
      const loggedData = JSON.parse(firstCall);
      
      expect(loggedData.tag).toBe('SHADOW_EXECUTE');
      expect(loggedData.user).toBe(candidate.user);
      expect(loggedData.hf).toBe(candidate.healthFactor);
      expect(loggedData.blockTag).toBe(candidate.blockTag);
      expect(loggedData.debtAsset).toBe(candidate.debtAsset);
      expect(loggedData.collateralAsset).toBe(candidate.collateralAsset);
      expect(loggedData.mode).toBe('shadow');
      expect(loggedData.closeFactorBps).toBe(5000);
      
      // Check metrics log
      const secondCall = consoleLogSpy.mock.calls[1][0];
      expect(secondCall).toContain('[metrics]');
      expect(secondCall).toContain('shadow_execute_count+=1');
    });

    it('should respect custom threshold parameter', () => {
      // Mock config to enable shadow execution
      vi.spyOn(config, 'shadowExecuteEnabled', 'get').mockReturnValue(true);
      vi.spyOn(config, 'shadowExecuteThreshold', 'get').mockReturnValue(1.005);

      const candidate: ShadowExecCandidate = {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 1.01, // Above default threshold but below custom
        blockTag: 12345678,
        debtAsset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        collateralAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        debtAmountWei: BigInt('1000000000'),
        collateralAmountWei: BigInt('500000000000000000')
      };

      // Should not log with default threshold
      maybeShadowExecute(candidate);
      expect(consoleLogSpy).not.toHaveBeenCalled();

      // Should log with custom higher threshold
      vi.spyOn(config, 'gasTipGweiFast', 'get').mockReturnValue(3);
      vi.spyOn(config, 'gasBumpFactor', 'get').mockReturnValue(1.25);
      vi.spyOn(config, 'txSubmitMode', 'get').mockReturnValue('public');
      
      maybeShadowExecute(candidate, 1.02); // Custom threshold
      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    });

    it('should format bigint values as strings in JSON', () => {
      // Mock config
      vi.spyOn(config, 'shadowExecuteEnabled', 'get').mockReturnValue(true);
      vi.spyOn(config, 'shadowExecuteThreshold', 'get').mockReturnValue(1.005);
      vi.spyOn(config, 'gasTipGweiFast', 'get').mockReturnValue(3);
      vi.spyOn(config, 'gasBumpFactor', 'get').mockReturnValue(1.25);
      vi.spyOn(config, 'txSubmitMode', 'get').mockReturnValue('public');

      const candidate: ShadowExecCandidate = {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 0.98,
        blockTag: 12345678,
        debtAsset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        collateralAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        debtAmountWei: BigInt('1000000000'),
        collateralAmountWei: BigInt('500000000000000000')
      };

      maybeShadowExecute(candidate);

      const firstCall = consoleLogSpy.mock.calls[0][0];
      const loggedData = JSON.parse(firstCall);
      
      // Should be strings, not bigint (which would fail JSON.parse)
      expect(typeof loggedData.repayWei).toBe('string');
      expect(typeof loggedData.seizeWei).toBe('string');
      expect(loggedData.repayWei).toBe('500000000');
      expect(loggedData.seizeWei).toBe('250000000000000000');
    });

    it('should produce single-line JSON output', () => {
      // Mock config
      vi.spyOn(config, 'shadowExecuteEnabled', 'get').mockReturnValue(true);
      vi.spyOn(config, 'shadowExecuteThreshold', 'get').mockReturnValue(1.005);
      vi.spyOn(config, 'gasTipGweiFast', 'get').mockReturnValue(3);
      vi.spyOn(config, 'gasBumpFactor', 'get').mockReturnValue(1.25);
      vi.spyOn(config, 'txSubmitMode', 'get').mockReturnValue('public');

      const candidate: ShadowExecCandidate = {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 0.98,
        blockTag: 12345678,
        debtAsset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        collateralAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        debtAmountWei: BigInt('1000000000'),
        collateralAmountWei: BigInt('500000000000000000')
      };

      maybeShadowExecute(candidate);

      const firstCall = consoleLogSpy.mock.calls[0][0];
      
      // Should be single line (no newlines)
      expect(firstCall).not.toContain('\n');
      
      // Should be valid JSON
      expect(() => JSON.parse(firstCall)).not.toThrow();
    });
  });
});
