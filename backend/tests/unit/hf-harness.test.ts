// Unit tests for HF Real-time Harness validation
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { describe, it, expect } from 'vitest';

describe('HF Real-time Harness Script', () => {
  const scriptPath = resolve(__dirname, '../../scripts/hf-realtime-harness.ts');
  const scriptContent = readFileSync(scriptPath, 'utf-8');

  describe('Script Structure', () => {
    it('should have proper shebang', () => {
      expect(scriptContent).toMatch(/^#!\/usr\/bin\/env tsx/);
    });

    it('should import required dependencies', () => {
      expect(scriptContent).toContain("import { WebSocketProvider, JsonRpcProvider, Contract, Interface, formatUnits } from 'ethers'");
      expect(scriptContent).toContain("import { config } from '../src/config/index.js'");
      expect(scriptContent).toContain("import { SubgraphService } from '../src/services/SubgraphService.js'");
      expect(scriptContent).toContain("import { HealthCalculator } from '../src/services/HealthCalculator.js'");
    });

    it('should have Multicall3 ABI', () => {
      expect(scriptContent).toContain('MULTICALL3_ABI');
      expect(scriptContent).toContain('aggregate3');
    });

    it('should have Aave Pool ABI', () => {
      expect(scriptContent).toContain('AAVE_POOL_ABI');
      expect(scriptContent).toContain('getUserAccountData');
      expect(scriptContent).toContain('event Borrow');
      expect(scriptContent).toContain('event Repay');
      expect(scriptContent).toContain('event Supply');
      expect(scriptContent).toContain('event Withdraw');
    });

    it('should have HFRealtimeHarness class', () => {
      expect(scriptContent).toContain('class HFRealtimeHarness');
      expect(scriptContent).toContain('async initialize()');
      expect(scriptContent).toContain('async run()');
    });

    it('should have main entry point', () => {
      expect(scriptContent).toContain('async function main()');
      expect(scriptContent).toContain('main().catch');
    });
  });

  describe('Configuration', () => {
    it('should read USE_FLASHBLOCKS from env', () => {
      expect(scriptContent).toContain("USE_FLASHBLOCKS = getEnvBoolean('USE_FLASHBLOCKS', false)");
    });

    it('should read WebSocket URLs from env', () => {
      expect(scriptContent).toContain("FLASHBLOCKS_WS_URL = getEnv('FLASHBLOCKS_WS_URL')");
      expect(scriptContent).toContain("WS_RPC_URL = getEnv('WS_RPC_URL')");
    });

    it('should read Multicall3 address from env with default', () => {
      expect(scriptContent).toContain("MULTICALL3_ADDRESS = getEnv('MULTICALL3_ADDRESS', '0xca11bde05977b3631167028862be2a173976ca11')");
    });

    it('should read Aave Pool address from env with default', () => {
      expect(scriptContent).toContain("AAVE_POOL = getEnv('AAVE_POOL', '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5')");
    });

    it('should read HF threshold from env with default', () => {
      expect(scriptContent).toContain("EXECUTION_HF_THRESHOLD_BPS = getEnvNumber('EXECUTION_HF_THRESHOLD_BPS', 9800)");
    });

    it('should read duration from env with default', () => {
      expect(scriptContent).toContain("HARNESS_DURATION_SEC = getEnvNumber('HARNESS_DURATION_SEC', 60)");
    });
  });

  describe('Core Functionality', () => {
    it('should implement setupProvider method', () => {
      expect(scriptContent).toContain('private async setupProvider()');
      expect(scriptContent).toContain('WebSocket connection failed');
      expect(scriptContent).toContain('Fallback to HTTP RPC');
    });

    it('should implement verifyContracts method', () => {
      expect(scriptContent).toContain('private async verifyContracts()');
      expect(scriptContent).toContain('Multicall3 code detected');
      expect(scriptContent).toContain('Aave Pool code detected');
    });

    it('should implement seedCandidates method', () => {
      expect(scriptContent).toContain('private async seedCandidates()');
      expect(scriptContent).toContain('CANDIDATE_USERS');
      expect(scriptContent).toContain('getUsersPage');
    });

    it('should implement setupSubscriptions method', () => {
      expect(scriptContent).toContain('private async setupSubscriptions()');
      expect(scriptContent).toContain('Subscribed to newHeads');
      expect(scriptContent).toContain('Subscribed to Aave Pool logs');
    });

    it('should implement checkCandidate method', () => {
      expect(scriptContent).toContain('private async checkCandidate');
      expect(scriptContent).toContain('getUserAccountData');
    });

    it('should implement checkAllCandidates method', () => {
      expect(scriptContent).toContain('private async checkAllCandidates()');
      expect(scriptContent).toContain('aggregate3');
      expect(scriptContent).toContain('liquidatable');
    });

    it('should implement shutdown method', () => {
      expect(scriptContent).toContain('private shutdown()');
      expect(scriptContent).toContain('Final Statistics');
      expect(scriptContent).toContain('Shutting down');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing WebSocket URL', () => {
      expect(scriptContent).toContain('No WebSocket URL configured');
      expect(scriptContent).toContain('No RPC_URL for fallback');
    });

    it('should handle missing candidates', () => {
      expect(scriptContent).toContain('No candidates configured');
      expect(scriptContent).toContain('Set CANDIDATE_USERS');
    });

    it('should handle contract verification failures', () => {
      expect(scriptContent).toContain('No code at Multicall3 address');
      expect(scriptContent).toContain('No code at Aave Pool address');
    });

    it('should handle shutdown signals', () => {
      expect(scriptContent).toContain("process.on('SIGINT'");
      expect(scriptContent).toContain("process.on('SIGTERM'");
    });
  });

  describe('Statistics and Output', () => {
    it('should track statistics', () => {
      expect(scriptContent).toContain('blocksReceived');
      expect(scriptContent).toContain('aaveLogsReceived');
      expect(scriptContent).toContain('priceUpdatesReceived');
      expect(scriptContent).toContain('healthChecksPerformed');
      expect(scriptContent).toContain('lowestHF');
      expect(scriptContent).toContain('liquidatableCandidates');
    });

    it('should print startup configuration', () => {
      expect(scriptContent).toContain('[harness] Configuration:');
      expect(scriptContent).toContain('USE_FLASHBLOCKS');
      expect(scriptContent).toContain('MULTICALL3_ADDRESS');
      expect(scriptContent).toContain('AAVE_POOL');
      expect(scriptContent).toContain('HF_THRESHOLD');
    });

    it('should print final statistics on shutdown', () => {
      expect(scriptContent).toContain('Duration:');
      expect(scriptContent).toContain('Blocks received:');
      expect(scriptContent).toContain('Health checks performed:');
      expect(scriptContent).toContain('Liquidatable candidates:');
    });
  });

  describe('Safety Checks', () => {
    it('should explicitly state it is test-only', () => {
      expect(scriptContent).toContain('Test Utility');
      expect(scriptContent).toContain('does not affect bot behavior');
    });

    it('should not execute transactions', () => {
      expect(scriptContent).not.toContain('liquidationCall(');
      expect(scriptContent).not.toContain('sendTransaction');
      // Note: .send() is used for RPC calls (flashblocks_subscribe), not transactions
    });

    it('should only perform read operations', () => {
      expect(scriptContent).toContain('getUserAccountData');
      expect(scriptContent).toContain('aggregate3');
      // These are read-only operations
    });
  });
});
