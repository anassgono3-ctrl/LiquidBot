import 'dotenv/config';

class SyntheticPriceTrigger {
  constructor(private dropBps: number, private debounceSec: number) {}
  private lastPrice: bigint | null = null;
  private lastTriggerTs = 0;

  onUpdate(price: bigint, nowMs: number, runScan: () => void) {
    if (this.lastPrice === null) {
      this.lastPrice = price;
      console.log(`[unit] baseline set price=${price}`);
      return;
    }
    if (price <= 0n || this.lastPrice <= 0n) {
      this.lastPrice = price;
      console.log('[unit] invalid price encountered; baseline reset');
      return;
    }
    let dropBps = 0;
    if (price < this.lastPrice) {
      // Convert to number first to avoid integer truncation in bigint division
      const lastPriceNum = Number(this.lastPrice);
      const priceNum = Number(price);
      dropBps = Math.round((lastPriceNum - priceNum) / lastPriceNum * 10000);
    }
    console.log(`[unit] update prev=${this.lastPrice} current=${price} dropBps=${dropBps}`);
    this.lastPrice = price;

    if (dropBps >= this.dropBps) {
      const since = (nowMs - this.lastTriggerTs)/1000;
      if (since < this.debounceSec) {
        console.log(`[unit] trigger suppressed by debounce (${since.toFixed(1)}s < ${this.debounceSec}s)`);
        return;
      }
      this.lastTriggerTs = nowMs;
      console.log(`[unit] TRIGGER firing (dropBps=${dropBps} >= ${this.dropBps})`);
      runScan();
    }
  }
}

async function main() {
  const trigger = new SyntheticPriceTrigger(10, 5); // 10 bps threshold, 5s debounce
  const now = () => Date.now();

  trigger.onUpdate(100_000_000n, now(), () => console.log('[unit] scan executed')); // baseline 100,000,000
  trigger.onUpdate(99_950_000n, now(), () => console.log('[unit] scan executed')); // 99,950,000 - 5 bps drop (no trigger)
  trigger.onUpdate(99_880_000n, now(), () => console.log('[unit] scan executed')); // 99,880,000 - 12 bps drop from baseline, 7 bps from prev
  trigger.onUpdate(99_770_000n, now(), () => console.log('[unit] scan executed')); // 99,770,000 - 11 bps drop from prev (should trigger)
  trigger.onUpdate(99_660_000n, now(), () => console.log('[unit] scan executed')); // 99,660,000 - 11 bps drop from prev (debounce suppress)
  await new Promise(r => setTimeout(r, 6000));
  trigger.onUpdate(99_550_000n, now(), () => console.log('[unit] scan executed')); // 99,550,000 - 11 bps drop from prev (after debounce)
}

main().catch(console.error);
