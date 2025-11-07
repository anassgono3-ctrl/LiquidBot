// Unit tests for price trigger logic (cumulative and delta modes)
import { describe, it, expect, beforeEach } from 'vitest';

/**
 * PriceTriggerSimulator - Simulates the price trigger logic from RealTimeHFService
 * for testing purposes without requiring the full service infrastructure
 */
class PriceTriggerSimulator {
  private lastSeenPrices = new Map<string, number>();
  private baselinePrices = new Map<string, number>();
  private lastTriggerTime = new Map<string, number>();
  private triggers: Array<{
    symbol: string;
    dropBps: number;
    mode: string;
    referencePrice: number;
    currentPrice: number;
  }> = [];

  constructor(
    private dropBps: number,
    private debounceSec: number,
    private cumulativeMode: boolean
  ) {}

  /**
   * Handle a price update and determine if trigger should fire
   */
  onPriceUpdate(symbol: string, price: number, nowMs: number): boolean {
    const lastPrice = this.lastSeenPrices.get(symbol);
    const baselinePrice = this.baselinePrices.get(symbol);

    // Initialize baseline on first update
    if (baselinePrice === undefined) {
      this.baselinePrices.set(symbol, price);
      this.lastSeenPrices.set(symbol, price);
      return false;
    }

    // Skip trigger if this is the first time seeing this feed after baseline (for delta mode)
    if (lastPrice === undefined) {
      this.lastSeenPrices.set(symbol, price);
      return false;
    }

    // Determine reference price based on mode
    const referencePrice = this.cumulativeMode ? baselinePrice : lastPrice;
    
    // Update last seen price AFTER we've used it for comparison
    this.lastSeenPrices.set(symbol, price);

    if (referencePrice <= 0) {
      return false;
    }

    // Calculate price change in basis points
    const priceDiff = price - referencePrice;
    const priceDiffPct = (priceDiff / referencePrice) * 10000;

    // Check if price dropped by threshold or more  
    // Note: priceDiffPct is negative for drops, so we check if it's <= -threshold
    if (priceDiffPct > -this.dropBps) {
      return false;
    }

    // Check debounce
    const lastTriggerTime = this.lastTriggerTime.get(symbol);
    const debounceMs = this.debounceSec * 1000;

    if (lastTriggerTime && (nowMs - lastTriggerTime) < debounceMs) {
      return false; // debounced
    }

    // Update last trigger time
    this.lastTriggerTime.set(symbol, nowMs);

    // Reset baseline to current price after trigger (for cumulative mode)
    if (this.cumulativeMode) {
      this.baselinePrices.set(symbol, price);
    }

    // Record trigger
    const dropBps = Math.abs(priceDiffPct);
    this.triggers.push({
      symbol,
      dropBps,
      mode: this.cumulativeMode ? 'cumulative' : 'delta',
      referencePrice,
      currentPrice: price
    });

    return true;
  }

  getTriggers() {
    return this.triggers;
  }

  getBaselinePrice(symbol: string): number | undefined {
    return this.baselinePrices.get(symbol);
  }

  getLastPrice(symbol: string): number | undefined {
    return this.lastSeenPrices.get(symbol);
  }
}

describe('PriceTrigger - Delta Mode', () => {
  let trigger: PriceTriggerSimulator;
  let currentTime: number;

  beforeEach(() => {
    trigger = new PriceTriggerSimulator(10, 5, false); // 10 bps threshold, 5s debounce, delta mode
    currentTime = Date.now();
  });

  it('should initialize baseline on first update', () => {
    const triggered = trigger.onPriceUpdate('WETH', 100_000_000, currentTime);
    expect(triggered).toBe(false);
    expect(trigger.getBaselinePrice('WETH')).toBe(100_000_000);
  });

  it('should not trigger on small drops (< threshold)', () => {
    trigger.onPriceUpdate('WETH', 100_000_000, currentTime);
    const triggered = trigger.onPriceUpdate('WETH', 99_950_000, currentTime + 1000); // 5 bps drop
    expect(triggered).toBe(false);
    expect(trigger.getTriggers().length).toBe(0);
  });

  it('should trigger on drops >= threshold (single round)', () => {
    trigger.onPriceUpdate('WETH', 100_000_000, currentTime);
    const triggered = trigger.onPriceUpdate('WETH', 99_880_000, currentTime + 1000); // 12 bps drop
    expect(triggered).toBe(true);
    expect(trigger.getTriggers().length).toBe(1);
    expect(trigger.getTriggers()[0].dropBps).toBeCloseTo(12, 1);
  });

  it('should respect debounce window', () => {
    trigger.onPriceUpdate('WETH', 100_000_000, currentTime);
    trigger.onPriceUpdate('WETH', 99_880_000, currentTime + 1000); // 12 bps drop, triggers
    
    // Attempt another trigger within debounce window
    const triggered = trigger.onPriceUpdate('WETH', 98_770_000, currentTime + 2000); // another 11 bps drop
    expect(triggered).toBe(false); // debounced
    expect(trigger.getTriggers().length).toBe(1); // still only 1 trigger
  });

  it('should trigger after debounce window expires', () => {
    trigger.onPriceUpdate('WETH', 100_000_000, currentTime);
    trigger.onPriceUpdate('WETH', 99_880_000, currentTime + 1000); // first trigger
    
    // Wait for debounce window to pass (5 seconds + buffer)
    const triggered = trigger.onPriceUpdate('WETH', 98_770_000, currentTime + 7000); // another 11 bps drop
    expect(triggered).toBe(true);
    expect(trigger.getTriggers().length).toBe(2);
  });

  it('should reset comparison to last price in delta mode', () => {
    trigger.onPriceUpdate('WETH', 100_000_000, currentTime); // baseline
    trigger.onPriceUpdate('WETH', 99_000_000, currentTime + 1000); // 10 bps drop, triggers
    expect(trigger.getTriggers().length).toBe(1);
    
    // Next comparison should be from 99_000_000, not 100_000_000
    currentTime += 7000; // after debounce
    const triggered = trigger.onPriceUpdate('WETH', 98_010_000, currentTime); // 10 bps from 99_000_000
    expect(triggered).toBe(true);
    expect(trigger.getTriggers().length).toBe(2);
  });
});

describe('PriceTrigger - Cumulative Mode', () => {
  let trigger: PriceTriggerSimulator;
  let currentTime: number;

  beforeEach(() => {
    trigger = new PriceTriggerSimulator(30, 5, true); // 30 bps threshold, 5s debounce, cumulative mode
    currentTime = Date.now();
  });

  it('should initialize baseline on first update', () => {
    const triggered = trigger.onPriceUpdate('WETH', 100_000_000, currentTime);
    expect(triggered).toBe(false);
    expect(trigger.getBaselinePrice('WETH')).toBe(100_000_000);
  });

  it('should accumulate drops from baseline', () => {
    trigger.onPriceUpdate('WETH', 100_000_000, currentTime); // baseline
    currentTime += 1000;
    
    // Small drops that don't individually trigger (30 bps = 0.3%)
    // 100M -> 99.9M = 0.1% = 10 bps
    trigger.onPriceUpdate('WETH', 99_900_000, currentTime); // 10 bps from baseline
    expect(trigger.getTriggers().length).toBe(0);
    
    currentTime += 1000;
    // 99.9M -> 99.85M = 0.05% = 5 bps from last, 15 bps from baseline
    trigger.onPriceUpdate('WETH', 99_850_000, currentTime);
    expect(trigger.getTriggers().length).toBe(0);
    
    currentTime += 1000;
    // 99.85M -> 99.7M = 0.15% = 15 bps from last, 30 bps from baseline - should trigger!
    trigger.onPriceUpdate('WETH', 99_700_000, currentTime);
    expect(trigger.getTriggers().length).toBe(1);
    expect(trigger.getTriggers()[0].dropBps).toBeCloseTo(30, 1);
    expect(trigger.getTriggers()[0].referencePrice).toBe(100_000_000);
  });

  it('should reset baseline after trigger', () => {
    trigger.onPriceUpdate('WETH', 100_000_000, currentTime); // baseline
    currentTime += 1000;
    trigger.onPriceUpdate('WETH', 99_700_000, currentTime); // 30 bps drop = 0.3%, triggers
    
    // Baseline should now be 99_700_000
    expect(trigger.getBaselinePrice('WETH')).toBe(99_700_000);
    
    // Next trigger should be from new baseline (30 bps from 99.7M = 99.4M)
    currentTime += 7000; // after debounce
    trigger.onPriceUpdate('WETH', 99_400_000, currentTime); // 30 bps from new baseline
    expect(trigger.getTriggers().length).toBe(2);
    expect(trigger.getTriggers()[1].referencePrice).toBe(99_700_000);
  });

  it('should respect debounce in cumulative mode', () => {
    trigger.onPriceUpdate('WETH', 100_000_000, currentTime);
    trigger.onPriceUpdate('WETH', 99_700_000, currentTime + 1000); // 30 bps, triggers
    
    // Attempt another trigger within debounce window
    const triggered = trigger.onPriceUpdate('WETH', 99_400_000, currentTime + 2000);
    expect(triggered).toBe(false); // debounced
    expect(trigger.getTriggers().length).toBe(1);
  });

  it('should handle price recovery without triggering', () => {
    trigger.onPriceUpdate('WETH', 100_000_000, currentTime); // baseline
    currentTime += 1000;
    
    // Drop but not enough to trigger (20 bps = 0.2%)
    trigger.onPriceUpdate('WETH', 99_800_000, currentTime); // 20 bps from baseline
    expect(trigger.getTriggers().length).toBe(0);
    
    currentTime += 1000;
    // Price recovers (back to 10 bps = 0.1% from baseline)
    trigger.onPriceUpdate('WETH', 99_900_000, currentTime);
    expect(trigger.getTriggers().length).toBe(0);
  });
});

describe('PriceTrigger - Mode Comparison', () => {
  it('should trigger differently in delta vs cumulative mode', () => {
    const deltaTime = Date.now();
    const cumulativeTime = Date.now();
    
    const deltaTrigger = new PriceTriggerSimulator(10, 5, false); // 10 bps = 0.1%
    const cumulativeTrigger = new PriceTriggerSimulator(30, 5, true); // 30 bps = 0.3%
    
    // Same price sequence for both (all small drops, each < 10 bps)
    // Each drop is about 5-6 bps
    const prices = [100_000_000, 99_950_000, 99_900_000, 99_850_000, 99_800_000];
    
    prices.forEach((price, idx) => {
      deltaTrigger.onPriceUpdate('WETH', price, deltaTime + idx * 7000);
      cumulativeTrigger.onPriceUpdate('WETH', price, cumulativeTime + idx * 7000);
    });
    
    // Delta mode: no triggers since each individual drop is < 10 bps
    expect(deltaTrigger.getTriggers().length).toBe(0);
    
    // Cumulative mode: no triggers yet, cumulative drop is 20 bps (< 30 bps)
    expect(cumulativeTrigger.getTriggers().length).toBe(0);
    
    // Add one more drop to push cumulative over 30 bps
    // 99.8M -> 99.7M = 10 bps, cumulative from 100M = 30 bps
    deltaTrigger.onPriceUpdate('WETH', 99_700_000, deltaTime + 5 * 7000);
    cumulativeTrigger.onPriceUpdate('WETH', 99_700_000, cumulativeTime + 5 * 7000);
    
    // Delta mode: triggers because this single drop is 10 bps
    expect(deltaTrigger.getTriggers().length).toBe(1);
    
    // Cumulative mode: triggers because cumulative drop is 30 bps from baseline
    expect(cumulativeTrigger.getTriggers().length).toBe(1);
    expect(cumulativeTrigger.getTriggers()[0].dropBps).toBeCloseTo(30, 1);
  });
});
