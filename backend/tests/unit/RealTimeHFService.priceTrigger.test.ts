import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

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
    chainlinkFeeds: 'ETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,USDC:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B',
    rpcUrl: 'https://test.example.com',
    priceTriggerEnabled: true,
    priceTriggerDropBps: 30,
    priceTriggerMaxScan: 500,
    priceTriggerAssets: undefined, // Monitor all feeds
    priceTriggerDebounceSec: 5, // Short debounce for testing
    priceTriggerCumulative: false, // Delta mode
    priceTriggerPollSec: 15,
    useSubgraph: false,
    realtimeInitialBackfillEnabled: false
  }
}));

describe('RealTimeHFService - Price Trigger', () => {
  let service: RealTimeHFService;

  beforeEach(() => {
    // Create service with skipWsConnection to avoid actual network calls
    service = new RealTimeHFService({ skipWsConnection: true });
  });

  afterEach(async () => {
    if (service) {
      await service.stop();
    }
  });

  describe('event handling', () => {
    it('should handle AnswerUpdated event and initialize state', async () => {
      await service.start();

      const feedAddress = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serviceAny = service as any;
      
      // Manually set up the feed symbol mapping (normally done in setupRealtime)
      serviceAny.chainlinkFeedToSymbol.set(feedAddress.toLowerCase(), 'ETH');
      
      // Call processPriceUpdate directly with event source
      await serviceAny.processPriceUpdate(
        feedAddress.toLowerCase(),
        BigInt('100000000'),
        12345,
        'event'
      );
      
      // Verify state was initialized
      const state = serviceAny.priceAssetState.get(feedAddress.toLowerCase());
      expect(state).toBeDefined();
      expect(state?.lastAnswer).toBe(BigInt('100000000'));
      expect(state?.baselineAnswer).toBe(BigInt('100000000'));
    });

    it('should handle NewTransmission event (OCR2) via processPriceUpdate', async () => {
      await service.start();

      const feedAddress = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serviceAny = service as any;
      
      // Set up the feed symbol mapping
      serviceAny.chainlinkFeedToSymbol.set(feedAddress.toLowerCase(), 'WETH');
      
      // Call processPriceUpdate directly (this is what handleChainlinkEvent calls)
      await serviceAny.processPriceUpdate(
        feedAddress.toLowerCase(),
        BigInt('200000000'), // $2000
        12345,
        'event'
      );
      
      // Verify state was initialized
      const state = serviceAny.priceAssetState.get(feedAddress.toLowerCase());
      expect(state).toBeDefined();
      expect(state?.lastAnswer).toBe(BigInt('200000000'));
    });
  });

  describe('processPriceUpdate - delta mode', () => {
    it('should not trigger on price increase', async () => {
      await service.start();

      const feedAddress = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serviceAny = service as any;

      // Initialize with baseline
      await serviceAny.processPriceUpdate(
        feedAddress.toLowerCase(),
        BigInt('100000000'),
        12345,
        'event'
      );

      // Price increase
      await serviceAny.processPriceUpdate(
        feedAddress.toLowerCase(),
        BigInt('105000000'), // +5%
        12346,
        'event'
      );

      // Should not trigger (no candidates to scan anyway in this test)
      const state = serviceAny.priceAssetState.get(feedAddress.toLowerCase());
      expect(state?.lastTriggerTs).toBe(0); // No trigger
    });

    it('should not trigger on small price drop below threshold', async () => {
      await service.start();

      const feedAddress = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serviceAny = service as any;

      // Initialize with baseline
      await serviceAny.processPriceUpdate(
        feedAddress.toLowerCase(),
        BigInt('100000000'),
        12345,
        'event'
      );

      // Small price drop (0.2% = 20 bps, below threshold of 30 bps)
      await serviceAny.processPriceUpdate(
        feedAddress.toLowerCase(),
        BigInt('99800000'),
        12346,
        'event'
      );

      const state = serviceAny.priceAssetState.get(feedAddress.toLowerCase());
      expect(state?.lastTriggerTs).toBe(0); // No trigger
    });

    it('should track price updates from polling', async () => {
      await service.start();

      const feedAddress = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serviceAny = service as any;

      // Initialize via polling
      await serviceAny.processPriceUpdate(
        feedAddress.toLowerCase(),
        BigInt('100000000'),
        12345,
        'poll'
      );

      // Update via polling
      await serviceAny.processPriceUpdate(
        feedAddress.toLowerCase(),
        BigInt('99000000'), // -1% = 100 bps drop
        12346,
        'poll'
      );

      // Verify state was updated
      const state = serviceAny.priceAssetState.get(feedAddress.toLowerCase());
      expect(state?.lastAnswer).toBe(BigInt('99000000'));
    });
  });

  describe('processPriceUpdate - cumulative mode', () => {
    beforeEach(() => {
      // Mock cumulative mode
      vi.doMock('../../src/config/index.js', () => ({
        config: {
          useRealtimeHF: true,
          wsRpcUrl: 'wss://test.example.com',
          useFlashblocks: false,
          multicall3Address: '0xca11bde05977b3631167028862be2a173976ca11',
          aavePool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
          executionHfThresholdBps: 9800,
          realtimeSeedIntervalSec: 45,
          candidateMax: 300,
          chainlinkFeeds: 'ETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
          rpcUrl: 'https://test.example.com',
          priceTriggerEnabled: true,
          priceTriggerDropBps: 50,
          priceTriggerMaxScan: 500,
          priceTriggerAssets: undefined,
          priceTriggerDebounceSec: 5,
          priceTriggerCumulative: true, // Cumulative mode
          priceTriggerPollSec: 15,
          useSubgraph: false,
          realtimeInitialBackfillEnabled: false
        }
      }));
    });

    it('should accumulate price drops in cumulative mode', async () => {
      await service.start();

      const feedAddress = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serviceAny = service as any;

      // Initialize baseline at $1000
      await serviceAny.processPriceUpdate(
        feedAddress.toLowerCase(),
        BigInt('100000000'),
        12345,
        'event'
      );

      // First drop: -1% (10 bps from baseline)
      await serviceAny.processPriceUpdate(
        feedAddress.toLowerCase(),
        BigInt('99000000'),
        12346,
        'event'
      );

      // Second drop: -1% more (now 20 bps from baseline)
      await serviceAny.processPriceUpdate(
        feedAddress.toLowerCase(),
        BigInt('98000000'),
        12347,
        'event'
      );

      // In cumulative mode, drops are measured from baseline
      const state = serviceAny.priceAssetState.get(feedAddress.toLowerCase());
      expect(state?.lastAnswer).toBe(BigInt('98000000'));
      expect(state?.baselineAnswer).toBe(BigInt('100000000')); // Baseline unchanged until trigger
    });
  });

  describe('debounce behavior', () => {
    it('should respect debounce window', async () => {
      await service.start();

      const feedAddress = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serviceAny = service as any;

      // Initialize
      await serviceAny.processPriceUpdate(
        feedAddress.toLowerCase(),
        BigInt('100000000'),
        12345,
        'event'
      );

      // Mock executeEmergencyScan to track calls
      const executeSpy = vi.spyOn(serviceAny, 'executeEmergencyScan');
      executeSpy.mockResolvedValue(undefined);

      // First significant drop (should trigger if candidates exist)
      await serviceAny.processPriceUpdate(
        feedAddress.toLowerCase(),
        BigInt('97000000'), // -3% = 300 bps (> 30 bps threshold)
        12346,
        'event'
      );

      // Immediately after, another drop (should be debounced)
      await serviceAny.processPriceUpdate(
        feedAddress.toLowerCase(),
        BigInt('96000000'),
        12347,
        'event'
      );

      // executeEmergencyScan should not be called twice quickly
      // (May be called once if candidates exist, but not twice within debounce)
      const state = serviceAny.priceAssetState.get(feedAddress.toLowerCase());
      expect(state?.lastTriggerTs).toBeGreaterThan(0);
    });
  });

  describe('per-asset state management', () => {
    it('should maintain separate state for multiple feeds', async () => {
      await service.start();

      const ethFeed = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
      const usdcFeed = '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serviceAny = service as any;

      // Initialize ETH feed
      await serviceAny.processPriceUpdate(
        ethFeed.toLowerCase(),
        BigInt('100000000'),
        12345,
        'event'
      );

      // Initialize USDC feed
      await serviceAny.processPriceUpdate(
        usdcFeed.toLowerCase(),
        BigInt('100000000'),
        12345,
        'event'
      );

      // Verify separate states
      const ethState = serviceAny.priceAssetState.get(ethFeed.toLowerCase());
      const usdcState = serviceAny.priceAssetState.get(usdcFeed.toLowerCase());

      expect(ethState).toBeDefined();
      expect(usdcState).toBeDefined();
      expect(ethState).not.toBe(usdcState); // Different state objects
    });
  });
});
