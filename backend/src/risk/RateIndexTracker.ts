/**
 * RateIndexTracker: Track reserve variable debt index growth over time
 */

export interface IndexSnapshot {
  index: bigint;
  timestamp: number;
  block: number;
}

export class RateIndexTracker {
  private readonly reserve: string;
  private snapshots: IndexSnapshot[] = [];
  private readonly maxSnapshots: number;

  constructor(reserve: string, maxSnapshots = 100) {
    this.reserve = reserve;
    this.maxSnapshots = maxSnapshots;
  }

  public addSnapshot(index: bigint, timestamp: number, block: number): void {
    this.snapshots.push({ index, timestamp, block });
    
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  public getLatest(): IndexSnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  /**
   * Project index growth over a time horizon (seconds)
   * Uses linear extrapolation from recent growth rate
   */
  public projectIndex(horizonSec: number): bigint | null {
    if (this.snapshots.length < 2) {
      return null;
    }

    const latest = this.snapshots[this.snapshots.length - 1];
    const previous = this.snapshots[this.snapshots.length - 2];

    const timeDelta = latest.timestamp - previous.timestamp;
    if (timeDelta === 0) {
      return latest.index;
    }

    const indexGrowth = Number(latest.index - previous.index);
    const growthRate = indexGrowth / timeDelta; // per second
    const projectedGrowth = growthRate * horizonSec;

    return latest.index + BigInt(Math.floor(projectedGrowth));
  }

  public getReserve(): string {
    return this.reserve;
  }

  public size(): number {
    return this.snapshots.length;
  }
}
