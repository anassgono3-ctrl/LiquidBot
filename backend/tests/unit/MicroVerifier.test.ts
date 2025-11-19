import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Contract } from 'ethers';

import { MicroVerifier } from '../../src/services/MicroVerifier.js';
import type { MicroVerifyCandidate } from '../../src/services/MicroVerifier.js';

// Mock config
vi.mock('../../src/config/index.js', () => ({
  config: {
    microVerifyEnabled: true,
    microVerifyMaxPerBlock: 25,
    microVerifyIntervalMs: 150,
    nearThresholdBandBps: 30
  }
}));

// Mock metrics
vi.mock('../../src/metrics/index.js', () => ({
  microVerifyTotal: {
    labels: vi.fn().mockReturnValue({
      inc: vi.fn()
    })
  },
  microVerifyLatency: {
    observe: vi.fn()
  }
}));

describe('MicroVerifier', () => {
  let microVerifier: MicroVerifier;
  let mockAavePool: Contract;

  beforeEach(() => {
    // Create mock Aave Pool contract
    mockAavePool = {
      getUserAccountData: vi.fn()
    } as unknown as Contract;

    microVerifier = new MicroVerifier(mockAavePool);
  });

  describe('onNewBlock', () => {
    it('should reset per-block counters on new block', () => {
      microVerifier.onNewBlock(100);
      const stats = microVerifier.getStats();
      
      expect(stats.verificationsThisBlock).toBe(0);
      expect(stats.currentBlock).toBe(100);
    });

    it('should clear verified users set on new block', async () => {
      microVerifier.onNewBlock(100);
      
      // Mock successful verification
      vi.mocked(mockAavePool.getUserAccountData).mockResolvedValueOnce([
        1000000000n, // totalCollateralBase
        900000000n,  // totalDebtBase
        100000000n,  // availableBorrowsBase
        8500n,       // currentLiquidationThreshold
        7500n,       // ltv
        1050000000000000000n // healthFactor (1.05 in wei)
      ]);
      
      const candidate: MicroVerifyCandidate = {
        user: '0x1234567890abcdef1234567890abcdef12345678',
        trigger: 'projection_cross',
        projectedHf: 0.99
      };
      
      // First verification should succeed
      const result1 = await microVerifier.verify(candidate);
      expect(result1).not.toBeNull();
      expect(result1?.success).toBe(true);
      
      // Second verification of same user in same block should be skipped (de-duplication)
      const result2 = await microVerifier.verify(candidate);
      expect(result2).toBeNull();
      
      // New block should allow verification again (resets de-duplication)
      microVerifier.onNewBlock(101);
      
      // Wait for interval throttling to pass
      await new Promise(resolve => setTimeout(resolve, 200));
      
      vi.mocked(mockAavePool.getUserAccountData).mockResolvedValueOnce([
        1000000000n, 900000000n, 100000000n, 8500n, 7500n, 1040000000000000000n
      ]);
      
      const result3 = await microVerifier.verify(candidate);
      expect(result3).not.toBeNull();
      expect(result3?.success).toBe(true);
    });
  });

  describe('canVerify', () => {
    beforeEach(() => {
      microVerifier.onNewBlock(100);
    });

    it('should allow verification when under cap', () => {
      const canVerify = microVerifier.canVerify('0x1234567890abcdef1234567890abcdef12345678');
      expect(canVerify).toBe(true);
    });

    it('should deny verification when per-block cap reached', async () => {
      microVerifier.onNewBlock(100);
      
      // Mock successful verifications up to cap (25)
      for (let i = 0; i < 25; i++) {
        vi.mocked(mockAavePool.getUserAccountData).mockResolvedValueOnce([
          1000000000n, 900000000n, 100000000n, 8500n, 7500n, 1050000000000000000n
        ]);
        
        await microVerifier.verify({
          user: `0x${i.toString().padStart(40, '0')}`,
          trigger: 'projection_cross'
        });
        
        // Wait for interval between calls
        await new Promise(resolve => setTimeout(resolve, 160));
      }
      
      const stats = microVerifier.getStats();
      expect(stats.verificationsThisBlock).toBe(25);
      
      // Next verification should be denied (cap reached)
      const canVerify = microVerifier.canVerify('0xnewuser0000000000000000000000000000000');
      expect(canVerify).toBe(false);
    });

    it('should deny verification for duplicate user in same block', async () => {
      microVerifier.onNewBlock(100);
      
      vi.mocked(mockAavePool.getUserAccountData).mockResolvedValueOnce([
        1000000000n, 900000000n, 100000000n, 8500n, 7500n, 1050000000000000000n
      ]);
      
      const user = '0x1234567890abcdef1234567890abcdef12345678';
      await microVerifier.verify({ user, trigger: 'projection_cross' });
      
      // Second verification of same user should be denied
      const canVerify = microVerifier.canVerify(user);
      expect(canVerify).toBe(false);
    });
  });

  describe('verify', () => {
    beforeEach(() => {
      microVerifier.onNewBlock(100);
    });

    it('should successfully verify a candidate with HF < 1.0', async () => {
      vi.mocked(mockAavePool.getUserAccountData).mockResolvedValueOnce([
        1000000000n,             // totalCollateralBase (10 in 8 decimals)
        900000000n,              // totalDebtBase (9 in 8 decimals)
        100000000n,              // availableBorrowsBase
        8500n,                   // currentLiquidationThreshold
        7500n,                   // ltv
        950000000000000000n      // healthFactor (0.95 in wei = 18 decimals)
      ]);
      
      const candidate: MicroVerifyCandidate = {
        user: '0x1234567890abcdef1234567890abcdef12345678',
        trigger: 'projection_cross',
        projectedHf: 0.99,
        currentHf: 1.01
      };
      
      const result = await microVerifier.verify(candidate);
      
      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
      expect(result?.user).toBe(candidate.user);
      expect(result?.hf).toBeCloseTo(0.95, 2);
      expect(result?.trigger).toBe('projection_cross');
      expect(result?.latencyMs).toBeGreaterThanOrEqual(0); // Latency can be 0 in tests
    });

    it('should successfully verify a candidate with HF > 1.0', async () => {
      vi.mocked(mockAavePool.getUserAccountData).mockResolvedValueOnce([
        1000000000n,             // totalCollateralBase
        900000000n,              // totalDebtBase
        100000000n,              // availableBorrowsBase
        8500n,                   // currentLiquidationThreshold
        7500n,                   // ltv
        1050000000000000000n     // healthFactor (1.05 in wei)
      ]);
      
      const candidate: MicroVerifyCandidate = {
        user: '0x1234567890abcdef1234567890abcdef12345678',
        trigger: 'near_threshold',
        currentHf: 1.02
      };
      
      const result = await microVerifier.verify(candidate);
      
      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
      expect(result?.hf).toBeCloseTo(1.05, 2);
    });

    it('should handle RPC errors gracefully', async () => {
      vi.mocked(mockAavePool.getUserAccountData).mockRejectedValueOnce(
        new Error('RPC timeout')
      );
      
      const candidate: MicroVerifyCandidate = {
        user: '0x1234567890abcdef1234567890abcdef12345678',
        trigger: 'projection_cross'
      };
      
      const result = await microVerifier.verify(candidate);
      
      expect(result).not.toBeNull();
      expect(result?.success).toBe(false);
      expect(result?.hf).toBe(Number.MAX_VALUE); // Safe default
    });

    it('should return null when cap is reached', async () => {
      microVerifier.onNewBlock(100);
      
      // Fill up to cap
      for (let i = 0; i < 25; i++) {
        vi.mocked(mockAavePool.getUserAccountData).mockResolvedValueOnce([
          1000000000n, 900000000n, 100000000n, 8500n, 7500n, 1050000000000000000n
        ]);
        
        await microVerifier.verify({
          user: `0x${i.toString().padStart(40, '0')}`,
          trigger: 'projection_cross'
        });
      }
      
      // Next verification should return null
      const result = await microVerifier.verify({
        user: '0xnewuser0000000000000000000000000000000',
        trigger: 'projection_cross'
      });
      
      expect(result).toBeNull();
    });
  });

  describe('verifyBatch', () => {
    beforeEach(() => {
      microVerifier.onNewBlock(100);
    });

    it('should verify multiple candidates sequentially', async () => {
      const candidates: MicroVerifyCandidate[] = [
        { user: '0x1111111111111111111111111111111111111111', trigger: 'projection_cross' },
        { user: '0x2222222222222222222222222222222222222222', trigger: 'near_threshold' },
        { user: '0x3333333333333333333333333333333333333333', trigger: 'reserve_fast' }
      ];
      
      // Mock responses for each candidate
      vi.mocked(mockAavePool.getUserAccountData)
        .mockResolvedValueOnce([1000000000n, 900000000n, 100000000n, 8500n, 7500n, 950000000000000000n])
        .mockResolvedValueOnce([1000000000n, 900000000n, 100000000n, 8500n, 7500n, 1020000000000000000n])
        .mockResolvedValueOnce([1000000000n, 900000000n, 100000000n, 8500n, 7500n, 990000000000000000n]);
      
      // verifyBatch respects interval throttling between calls
      const results = await microVerifier.verifyBatch(candidates);
      
      // First candidate should always succeed, others may be throttled
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].user).toBe(candidates[0].user);
      expect(results[0].hf).toBeCloseTo(0.95, 2);
    });

    it('should respect per-block cap', async () => {
      microVerifier.onNewBlock(100);
      
      // Pre-fill to near cap (24 out of 25)
      for (let i = 0; i < 24; i++) {
        vi.mocked(mockAavePool.getUserAccountData).mockResolvedValueOnce([
          1000000000n, 900000000n, 100000000n, 8500n, 7500n, 1050000000000000000n
        ]);
        
        await microVerifier.verify({
          user: `0x${i.toString().padStart(40, '0')}`,
          trigger: 'projection_cross'
        });
        
        // Wait for interval
        await new Promise(resolve => setTimeout(resolve, 160));
      }
      
      const candidate: MicroVerifyCandidate = {
        user: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        trigger: 'projection_cross'
      };
      
      vi.mocked(mockAavePool.getUserAccountData).mockResolvedValueOnce([
        1000000000n, 900000000n, 100000000n, 8500n, 7500n, 950000000000000000n
      ]);
      
      // Wait for interval
      await new Promise(resolve => setTimeout(resolve, 160));
      
      // This should succeed (25th verification)
      const result1 = await microVerifier.verify(candidate);
      expect(result1).not.toBeNull();
      
      // Wait for interval
      await new Promise(resolve => setTimeout(resolve, 160));
      
      // Next verification should fail (cap reached at 25)
      const result2 = await microVerifier.verify({
        user: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        trigger: 'projection_cross'
      });
      expect(result2).toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return current verification stats', () => {
      microVerifier.onNewBlock(100);
      
      const stats = microVerifier.getStats();
      
      expect(stats.enabled).toBe(true);
      expect(stats.verificationsThisBlock).toBe(0);
      expect(stats.maxPerBlock).toBe(25);
      expect(stats.intervalMs).toBe(150);
      expect(stats.currentBlock).toBe(100);
    });

    it('should update stats after verifications', async () => {
      microVerifier.onNewBlock(100);
      
      vi.mocked(mockAavePool.getUserAccountData).mockResolvedValueOnce([
        1000000000n, 900000000n, 100000000n, 8500n, 7500n, 950000000000000000n
      ]);
      
      await microVerifier.verify({
        user: '0x1234567890abcdef1234567890abcdef12345678',
        trigger: 'projection_cross'
      });
      
      const stats = microVerifier.getStats();
      expect(stats.verificationsThisBlock).toBe(1);
    });
  });
});
