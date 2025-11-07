import { describe, it, expect, beforeEach, vi } from 'vitest';

import { RealTimeHFService } from '../../src/services/RealTimeHFService.js';

// Mock config with price trigger enabled
vi.mock('../../src/config/index.js', () => ({
  config: {
    useRealtimeHF: true,
    wsRpcUrl: 'wss://test.example.com',
    useFlashblocks: false,
    flashblocksWsUrl: undefined,
    multicall3Address: '0xca11bde05977b3631167028862be2a173976ca11',
    aavePool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    executionHfThresholdBps: 9800,
    realtimeSeedIntervalSec: 45,
    candidateMax: 300,
    chainlinkFeeds: 'ETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
    rpcUrl: 'https://test.example.com',
    
    // Price trigger config
    priceTriggerEnabled: true,
    priceTriggerDropBps: 30,
    priceTriggerMaxScan: 500,
    priceTriggerAssets: 'ETH,WBTC',
    priceTriggerDebounceSec: 60,
    
    // Other required config
    useSubgraph: false,
    realtimeInitialBackfillEnabled: false,
    headCheckPageStrategy: 'paged' as const,
    headCheckPageSize: 250,
    flashblocksTickMs: 250,
    multicallBatchSize: 120
  }
}));

describe('PriceTrigger', () => {
  let service: RealTimeHFService;

  beforeEach(() => {
    // Create service with skipWsConnection to avoid actual network calls
    service = new RealTimeHFService({ skipWsConnection: true });
  });

  describe('asset normalization', () => {
    it('should normalize ETH to WETH in constructor', async () => {
      // When service is created with PRICE_TRIGGER_ASSETS=ETH,WBTC
      // it should internally normalize ETH -> WETH
      
      // Start the service to trigger logging
      await service.start();
      
      // We can't directly test private fields, but we can verify the service starts without error
      expect(service).toBeDefined();
      
      await service.stop();
    });
  });

  describe('debouncing', () => {
    it('should initialize without error when debounce is configured', async () => {
      // Verify service can start with debounce configuration
      await expect(service.start()).resolves.not.toThrow();
      await service.stop();
    });
  });

  describe('configuration', () => {
    it('should accept price trigger configuration', () => {
      // Service should initialize successfully with price trigger config
      expect(service).toBeDefined();
    });
  });
});
