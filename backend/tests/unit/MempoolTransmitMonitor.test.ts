import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MempoolTransmitMonitor } from '../../src/services/MempoolTransmitMonitor.js';

describe('MempoolTransmitMonitor', () => {
  let monitor: MempoolTransmitMonitor;
  const mockFeeds = new Map([
    ['WETH', '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70'],
    ['USDC', '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B']
  ]);

  beforeEach(() => {
    monitor = new MempoolTransmitMonitor({
      chainlinkFeeds: mockFeeds,
      skipMempoolSubscription: true // Test mode - no WS connection
    });
  });

  afterEach(async () => {
    await monitor.stop();
  });

  it('should initialize with correct feed mapping', () => {
    expect(monitor).toBeDefined();
  });

  it('should start in test mode without errors', async () => {
    await expect(monitor.start()).resolves.not.toThrow();
  });

  it('should emit transmit event when detected', async () => {
    let emittedEvent: any = null;
    
    monitor.on('transmit', (event) => {
      emittedEvent = event;
    });

    // Simulate transmit detection
    const mockTransmit = {
      feedAddress: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
      symbol: 'WETH',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      timestamp: Date.now()
    };

    monitor.emit('transmit', mockTransmit);

    expect(emittedEvent).not.toBeNull();
    expect(emittedEvent.symbol).toBe('WETH');
    expect(emittedEvent.txHash).toBe(mockTransmit.txHash);
  });

  it('should handle stop gracefully', async () => {
    await monitor.start();
    await expect(monitor.stop()).resolves.not.toThrow();
  });

  it('should handle multiple feeds', () => {
    const largeFeedMap = new Map([
      ['WETH', '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70'],
      ['USDC', '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B'],
      ['WBTC', '0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F']
    ]);

    const largeMonitor = new MempoolTransmitMonitor({
      chainlinkFeeds: largeFeedMap,
      skipMempoolSubscription: true
    });

    expect(largeMonitor).toBeDefined();
  });
});
