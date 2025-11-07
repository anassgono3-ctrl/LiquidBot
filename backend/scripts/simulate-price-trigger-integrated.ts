import 'dotenv/config';
import { config } from '../src/config/index.js';

/**
 * Standalone PriceTrigger simulation class
 * Mimics the price trigger logic from RealTimeHFService
 */
class PriceTrigger {
  private enabled: boolean;
  private dropBps: number;
  private maxScan: number;
  private assets: string[];
  private debounceSec: number;
  private lastPrices = new Map<string, bigint>();
  private lastTriggerTime = new Map<string, number>();

  constructor(opts: {
    enabled: boolean;
    dropBps: number;
    maxScan: number;
    assets: string[];
    debounceSec: number;
  }) {
    this.enabled = opts.enabled;
    this.dropBps = opts.dropBps;
    this.maxScan = opts.maxScan;
    this.assets = opts.assets;
    this.debounceSec = opts.debounceSec;
  }

  logConfig(logger: (msg: string) => void) {
    logger(`[price-trigger] enabled=${this.enabled} dropBps=${this.dropBps} maxScan=${this.maxScan} debounceSec=${this.debounceSec} assets=${this.assets.join(',')}`);
  }

  onPriceUpdate(
    symbol: string,
    price: bigint,
    nowMs: number,
    runEmergencyScan: (symbol: string) => Promise<{ scanned: number; liquidatable: number }>,
    logger: (msg: string) => void
  ) {
    if (!this.enabled) {
      return;
    }

    const lastPrice = this.lastPrices.get(symbol);
    this.lastPrices.set(symbol, price);

    if (lastPrice === undefined) {
      logger(`[price-trigger] Initialized price tracking for ${symbol} (first update)`);
      return;
    }

    if (lastPrice <= 0n) {
      logger(`[price-trigger] Invalid last price for ${symbol}, skipping trigger`);
      return;
    }

    // Calculate price change in basis points
    const priceDiff = price - lastPrice;
    const priceDiffPct = Number(priceDiff * 10000n / lastPrice);

    // Check if price dropped by threshold or more
    if (priceDiffPct >= -this.dropBps) {
      // Price increased or dropped less than threshold - no emergency scan
      return;
    }

    // Check debounce
    const lastTriggerTime = this.lastTriggerTime.get(symbol);
    const debounceMs = this.debounceSec * 1000;

    if (lastTriggerTime && (nowMs - lastTriggerTime) < debounceMs) {
      const elapsedSec = Math.floor((nowMs - lastTriggerTime) / 1000);
      logger(
        `[price-trigger] Debounced: asset=${symbol} drop=${Math.abs(priceDiffPct).toFixed(2)}bps ` +
        `elapsed=${elapsedSec}s debounce=${this.debounceSec}s`
      );
      return;
    }

    // Update last trigger time
    this.lastTriggerTime.set(symbol, nowMs);

    // Price dropped significantly - trigger emergency scan
    const dropBps = Math.abs(priceDiffPct);
    logger(
      `[price-trigger] Sharp price drop detected: asset=${symbol} ` +
      `drop=${dropBps.toFixed(2)}bps threshold=${this.dropBps}bps trigger=price`
    );

    // Execute emergency scan asynchronously
    runEmergencyScan(symbol).then(result => {
      logger(
        `[price-trigger] Emergency scan complete: asset=${symbol} ` +
        `scanned=${result.scanned} liquidatable=${result.liquidatable} trigger=price`
      );
    }).catch(err => {
      logger(`[price-trigger] Error during emergency scan: ${err}`);
    });
  }
}

interface CandidateManagerLike { list(): string[]; }

async function main() {
  // Load configuration from environment
  const priceTriggerConfig = {
    enabled: config.priceTriggerEnabled,
    dropBps: config.priceTriggerDropBps,
    maxScan: config.priceTriggerMaxScan,
    assets: config.priceTriggerAssets 
      ? config.priceTriggerAssets.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0)
      : ['WETH', 'WBTC'],
    debounceSec: config.priceTriggerDebounceSec
  };

  // Override for testing if not set
  if (!priceTriggerConfig.enabled) {
    console.log('[simulate] Price trigger not enabled in config, forcing enabled=true for simulation');
    priceTriggerConfig.enabled = true;
  }
  if (priceTriggerConfig.dropBps === 0) {
    console.log('[simulate] Setting default dropBps=10 for simulation');
    priceTriggerConfig.dropBps = 10;
  }
  if (priceTriggerConfig.maxScan === 0) {
    console.log('[simulate] Setting default maxScan=5 for simulation');
    priceTriggerConfig.maxScan = 5;
  }
  if (priceTriggerConfig.debounceSec === 0) {
    console.log('[simulate] Setting default debounceSec=5 for simulation');
    priceTriggerConfig.debounceSec = 5;
  }

  const fakeCandidates = Array.from({ length: 20 }, (_, i) => `0x${(i+1).toString(16).padStart(40, '0')}`);
  const candidateManager: CandidateManagerLike = { list: () => fakeCandidates };

  const pt = new PriceTrigger(priceTriggerConfig);

  pt.logConfig(m => console.log(m));

  function runEmergencyScan(symbol: string): Promise<{ scanned: number; liquidatable: number }> {
    const slice = candidateManager.list().slice(0, priceTriggerConfig.maxScan);
    const liquidatable = slice.filter((_, idx) => idx % 2 === 0).length; // synthetic
    return Promise.resolve({ scanned: slice.length, liquidatable });
  }

  const now = () => Date.now();

  console.log('\n[simulate] Starting price update sequence...\n');

  // Baseline
  console.log('[simulate] Update 1: Setting baseline price for WETH');
  pt.onPriceUpdate('WETH', 1_000_000_00n, now(), runEmergencyScan, console.log);
  
  await new Promise(r => setTimeout(r, 100));
  
  // 5 bps drop (no trigger)
  console.log('\n[simulate] Update 2: 5 bps drop (below threshold, no trigger expected)');
  pt.onPriceUpdate('WETH', 999_950_00n, now(), runEmergencyScan, console.log);
  
  await new Promise(r => setTimeout(r, 100));
  
  // 12 bps drop (trigger)
  console.log('\n[simulate] Update 3: 12 bps drop (exceeds threshold, trigger expected)');
  pt.onPriceUpdate('WETH', 998_800_00n, now(), runEmergencyScan, console.log);
  
  await new Promise(r => setTimeout(r, 100));
  
  // Debounce suppression
  console.log('\n[simulate] Update 4: Additional drop (debounce suppression expected)');
  pt.onPriceUpdate('WETH', 997_500_00n, now(), runEmergencyScan, console.log);
  
  // After debounce window
  console.log(`\n[simulate] Waiting ${priceTriggerConfig.debounceSec + 1}s for debounce window to pass...`);
  await new Promise(r => setTimeout(r, (priceTriggerConfig.debounceSec + 1) * 1000));
  
  console.log('\n[simulate] Update 5: Drop after debounce window (trigger expected)');
  pt.onPriceUpdate('WETH', 996_000_00n, now(), runEmergencyScan, console.log);
  
  // Wait for async operations to complete
  await new Promise(r => setTimeout(r, 500));
  
  console.log('\n[simulate] Simulation complete.');
}

main().catch(err => { console.error(err); process.exit(1); });
