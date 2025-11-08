// LowHFTracker: Non-intrusive observability for low health factor candidates
// Captures detailed per-user snapshots for analysis and verification

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

import { config } from '../config/index.js';
import {
  lowHfSnapshotTotal,
  lowHfMinHealthFactor,
  lowHfMismatchTotal
} from '../metrics/index.js';

export interface ReserveData {
  asset: string;
  symbol: string;
  ltv: number;
  liquidationThreshold: number;
  collateralUsd: number;
  debtUsd: number;
  sourcePrice: string; // Price source provenance (e.g., "chainlink:0x123...", "oracle", "cached")
}

/**
 * Extended reserve detail with full provenance for verification
 */
export interface LowHFReserveDetail {
  tokenAddress: string;
  symbol: string;
  tokenDecimals: number;
  collateralRaw: string;       // BigInt string
  debtRaw: string;             // BigInt string
  collateralUsd: number;       // normalized using price
  debtUsd: number;
  liquidationThresholdBps: number;
  liquidationBonusBps?: number;
  ltvBps?: number;
  priceSource: 'chainlink' | 'stub' | 'other';
  priceAnswerRaw: string;      // oracle raw answer as BigInt string
  priceDecimals: number;
  priceRoundId?: string;
  priceUpdatedAt?: number;     // unix seconds
}

export interface LowHFEntry {
  address: string;
  lastHF: number;
  timestamp: number;
  blockNumber: number;
  triggerType: 'event' | 'head' | 'price';
  totalCollateralUsd: number;
  totalDebtUsd: number;
  reserves?: ReserveData[]; // Only included in 'all' mode
}

/**
 * Extended low HF entry with full reserve-level detail and inline verification
 */
export interface LowHFExtendedEntry {
  timestamp: string;              // ISO 8601 timestamp
  blockNumber: number;
  blockHash: string;
  trigger: 'head' | 'event' | 'price';
  user: string;
  reportedHfFloat: number;
  reportedHfRawBps: number;       // HF in basis points for precision
  reserves: LowHFReserveDetail[];
  weightedCollateralUsd: number;  // Σ(collateralUsd * liquidationThresholdBps/10000)
  totalCollateralUsd: number;     // Σ(collateralUsd)
  totalDebtUsd: number;           // Σ(debtUsd)
  recomputedHf: number;           // weightedCollateralUsd / totalDebtUsd (∞ if debt=0)
  deltaReportedVsRecomputed: number;
}

export interface LowHFTrackerOptions {
  maxEntries?: number;
  recordMode?: 'all' | 'min';
  dumpOnShutdown?: boolean;
  summaryIntervalSec?: number;
}

/**
 * LowHFTracker captures and stores snapshots of low health factor candidates
 * for observability and verification without adding additional RPC calls.
 */
export class LowHFTracker {
  private entries: Map<string, LowHFEntry> = new Map();
  private readonly maxEntries: number;
  private readonly recordMode: 'all' | 'min';
  private readonly dumpOnShutdown: boolean;
  private readonly summaryIntervalSec: number;
  private summaryTimer?: NodeJS.Timeout;
  private minHF: number | null = null;
  private lastSummaryTime: number = Date.now();

  constructor(options: LowHFTrackerOptions = {}) {
    this.maxEntries = options.maxEntries ?? config.lowHfTrackerMax;
    this.recordMode = options.recordMode ?? config.lowHfRecordMode;
    this.dumpOnShutdown = options.dumpOnShutdown ?? config.lowHfDumpOnShutdown;
    this.summaryIntervalSec = options.summaryIntervalSec ?? config.lowHfSummaryIntervalSec;

    if (this.summaryIntervalSec > 0) {
      this.startPeriodicSummary();
    }
  }

  /**
   * Record a low HF snapshot from batch check results
   * @param address User address
   * @param healthFactor Current health factor
   * @param blockNumber Block number where HF was checked
   * @param triggerType Type of trigger that caused the check
   * @param totalCollateralUsd Total collateral in USD
   * @param totalDebtUsd Total debt in USD
   * @param reserves Optional reserve breakdown (only used in 'all' mode)
   */
  record(
    address: string,
    healthFactor: number,
    blockNumber: number,
    triggerType: 'event' | 'head' | 'price',
    totalCollateralUsd: number,
    totalDebtUsd: number,
    reserves?: ReserveData[]
  ): void {
    // Check if we should record based on ALWAYS_INCLUDE_HF_BELOW threshold
    if (healthFactor >= config.alwaysIncludeHfBelow) {
      return;
    }

    // Track minimum HF
    if (this.minHF === null || healthFactor < this.minHF) {
      this.minHF = healthFactor;
      lowHfMinHealthFactor.observe(healthFactor);
    }

    // In 'min' mode, only record the minimum HF candidate per batch
    if (this.recordMode === 'min') {
      // Find existing min entry or create new one
      let minEntry: LowHFEntry | null = null;
      for (const entry of this.entries.values()) {
        if (!minEntry || entry.lastHF < minEntry.lastHF) {
          minEntry = entry;
        }
      }

      // Only record if this is lower than current min or no entries exist
      if (!minEntry || healthFactor < minEntry.lastHF) {
        // Remove old min entry if exists
        if (minEntry) {
          this.entries.delete(minEntry.address);
        }

        const entry: LowHFEntry = {
          address,
          lastHF: healthFactor,
          timestamp: Date.now(),
          blockNumber,
          triggerType,
          totalCollateralUsd,
          totalDebtUsd
        };

        this.entries.set(address, entry);
        lowHfSnapshotTotal.inc({ mode: 'min' });
      }
      return;
    }

    // 'all' mode: record all low HF candidates
    // Check if we're at capacity
    if (this.entries.size >= this.maxEntries && !this.entries.has(address)) {
      // At capacity and this is a new address
      // Find and remove the highest HF entry to make room
      let highestEntry: { addr: string; hf: number } | null = null;
      for (const [addr, entry] of this.entries.entries()) {
        if (!highestEntry || entry.lastHF > highestEntry.hf) {
          highestEntry = { addr, hf: entry.lastHF };
        }
      }

      if (highestEntry && healthFactor < highestEntry.hf) {
        // Remove the highest HF entry to make room for this lower one
        this.entries.delete(highestEntry.addr);
      } else {
        // This entry has higher HF than all existing entries, skip it
        return;
      }
    }

    const entry: LowHFEntry = {
      address,
      lastHF: healthFactor,
      timestamp: Date.now(),
      blockNumber,
      triggerType,
      totalCollateralUsd,
      totalDebtUsd,
      reserves: reserves && this.recordMode === 'all' ? reserves : undefined
    };

    this.entries.set(address, entry);
    lowHfSnapshotTotal.inc({ mode: 'all' });
  }

  /**
   * Get all recorded entries
   */
  getAll(): LowHFEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get entries with pagination
   */
  getPaginated(limit: number = 100, offset: number = 0, includeReserves: boolean = true): LowHFEntry[] {
    const all = this.getAll();
    const paginated = all.slice(offset, offset + limit);

    if (!includeReserves) {
      return paginated.map(entry => ({
        ...entry,
        reserves: undefined
      }));
    }

    return paginated;
  }

  /**
   * Get count of tracked entries
   */
  getCount(): number {
    return this.entries.size;
  }

  /**
   * Get minimum HF seen
   */
  getMinHF(): number | null {
    return this.minHF;
  }

  /**
   * Get summary stats
   */
  getStats() {
    return {
      count: this.entries.size,
      minHF: this.minHF,
      mode: this.recordMode,
      maxEntries: this.maxEntries
    };
  }

  /**
   * Start periodic summary logging
   */
  private startPeriodicSummary(): void {
    this.summaryTimer = setInterval(() => {
      this.logSummary();
    }, this.summaryIntervalSec * 1000);
  }

  /**
   * Log summary statistics
   */
  private logSummary(): void {
    const now = Date.now();
    const elapsedSec = Math.floor((now - this.lastSummaryTime) / 1000);
    this.lastSummaryTime = now;

    // eslint-disable-next-line no-console
    console.log(
      `[lowhf-tracker] summary: entries=${this.entries.size}/${this.maxEntries} ` +
      `minHF=${this.minHF !== null ? this.minHF.toFixed(4) : 'N/A'} ` +
      `mode=${this.recordMode} elapsed=${elapsedSec}s`
    );
  }

  /**
   * Dump all entries to a timestamped JSON file
   * @param directory Directory to write the file to (default: diagnostics)
   * @returns Path to the written file
   */
  async dumpToFile(directory: string = 'diagnostics'): Promise<string> {
    try {
      // Create diagnostics directory if it doesn't exist
      const absDir = join(process.cwd(), directory);
      if (!existsSync(absDir)) {
        await mkdir(absDir, { recursive: true });
      }

      // Generate timestamped filename
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
      const filename = `lowhf-dump-${timestamp}.json`;
      const filepath = join(absDir, filename);

      // Prepare dump data
      const dumpData = {
        metadata: {
          timestamp: new Date().toISOString(),
          mode: this.recordMode,
          count: this.entries.size,
          minHF: this.minHF,
          threshold: config.alwaysIncludeHfBelow
        },
        entries: this.getAll()
      };

      // Write to file
      await writeFile(filepath, JSON.stringify(dumpData, null, 2), 'utf-8');

      // eslint-disable-next-line no-console
      console.log(`[lowhf-tracker] Dump written to ${filepath} (${this.entries.size} entries)`);

      return filepath;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[lowhf-tracker] Failed to dump to file:', err);
      throw err;
    }
  }

  /**
   * Stop the tracker and cleanup
   */
  stop(): void {
    if (this.summaryTimer) {
      clearInterval(this.summaryTimer);
      this.summaryTimer = undefined;
    }
  }

  /**
   * Clear all entries (for testing)
   */
  clear(): void {
    this.entries.clear();
    this.minHF = null;
  }
}
