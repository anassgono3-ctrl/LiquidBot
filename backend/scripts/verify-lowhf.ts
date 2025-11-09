#!/usr/bin/env tsx
/**
 * Low HF Dump Verification Script
 * 
 * Verifies the integrity of a low HF dump file by:
 * 1. Recomputing health factors from stored USD components
 * 2. Comparing with reported HF values
 * 3. Flagging mismatches beyond tolerance
 * 
 * Usage:
 *   npm run verify:lowhf diagnostics/lowhf-dump-2025-11-08T17-40-10-123Z.json
 *   tsx scripts/verify-lowhf.ts diagnostics/lowhf-dump-<timestamp>.json
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

interface ReserveData {
  asset: string;
  symbol: string;
  ltv: number;
  liquidationThreshold: number;
  collateralUsd: number;
  debtUsd: number;
  sourcePrice: string;
}

interface LowHFEntry {
  address: string;
  lastHF: number;
  timestamp: number;
  blockNumber: number;
  triggerType: 'event' | 'head' | 'price';
  totalCollateralUsd: number;
  totalDebtUsd: number;
  reserves?: ReserveData[];
}

interface DumpData {
  metadata: {
    schemaVersion?: string;
    timestamp: string;
    mode: 'all' | 'min';
    count: number;
    extendedCount?: number;
    minHF: number | null;
    threshold: number;
  };
  entries: LowHFEntry[];
  extendedEntries?: LowHFEntry[];
}

interface Mismatch {
  address: string;
  reportedHF: number;
  recomputedHF: number;
  delta: number;
  deltaPct: number;
  totalCollateralUsd: number;
  totalDebtUsd: number;
}

/**
 * Recompute health factor from USD components
 * HF = (totalCollateralUsd * avgLiquidationThreshold) / totalDebtUsd
 * 
 * When reserves are available (schema v1.1+), we use the actual weighted liquidation threshold
 * from per-reserve data for deterministic verification. Otherwise, we approximate using 80%.
 */
function recomputeHealthFactor(entry: LowHFEntry): { hf: number; method: 'deterministic' | 'approximate' } {
  if (entry.totalDebtUsd === 0 || entry.totalDebtUsd < 1e-9) {
    return { hf: Infinity, method: 'deterministic' }; // No debt means infinite HF
  }

  // If we have reserves with liquidation thresholds, use weighted average (deterministic)
  if (entry.reserves && entry.reserves.length > 0) {
    let weightedThreshold = 0;
    let totalCollateral = 0;

    for (const reserve of entry.reserves) {
      if (reserve.collateralUsd > 0) {
        weightedThreshold += reserve.collateralUsd * reserve.liquidationThreshold;
        totalCollateral += reserve.collateralUsd;
      }
    }

    const avgLiqThreshold = totalCollateral > 0 ? weightedThreshold / totalCollateral : 0.85; // default to 85%
    const hf = (entry.totalCollateralUsd * avgLiqThreshold) / entry.totalDebtUsd;
    return { hf, method: 'deterministic' };
  }

  // Fallback: use typical average liquidation threshold of 80% (0.80)
  // This is an approximation and may not match exactly
  const estimatedAvgLiqThreshold = 0.80;
  const hf = (entry.totalCollateralUsd * estimatedAvgLiqThreshold) / entry.totalDebtUsd;
  return { hf, method: 'approximate' };
}

/**
 * Verify a dump file
 */
async function verifyDumpFile(filepath: string): Promise<void> {
  console.log(`[verify-lowhf] Verifying dump file: ${filepath}`);

  // Check if file exists
  if (!existsSync(filepath)) {
    console.error(`[verify-lowhf] ❌ File not found: ${filepath}`);
    process.exit(1);
  }

  // Read and parse dump file
  let dumpData: DumpData;
  try {
    const content = await readFile(filepath, 'utf-8');
    dumpData = JSON.parse(content);
  } catch (err) {
    console.error(`[verify-lowhf] ❌ Failed to read or parse file:`, err);
    process.exit(1);
  }

  console.log(`[verify-lowhf] Dump metadata:`);
  console.log(`  Schema Version: ${dumpData.metadata.schemaVersion ?? '1.0'}`);
  console.log(`  Timestamp: ${dumpData.metadata.timestamp}`);
  console.log(`  Mode: ${dumpData.metadata.mode}`);
  console.log(`  Count: ${dumpData.metadata.count}`);
  if (dumpData.metadata.extendedCount !== undefined) {
    console.log(`  Extended Count (with reserves): ${dumpData.metadata.extendedCount}`);
  }
  console.log(`  MinHF: ${dumpData.metadata.minHF?.toFixed(4) ?? 'N/A'}`);
  console.log(`  Threshold: ${dumpData.metadata.threshold}`);
  console.log('');

  // Verify each entry
  const mismatches: Mismatch[] = [];
  const tolerance = 0.05; // 5% tolerance for rounding errors and approximations
  let deterministicCount = 0;
  let approximateCount = 0;

  for (const entry of dumpData.entries) {
    const { hf: recomputedHF, method } = recomputeHealthFactor(entry);
    
    if (method === 'deterministic') {
      deterministicCount++;
    } else {
      approximateCount++;
    }
    
    const delta = Math.abs(entry.lastHF - recomputedHF);
    const deltaPct = Math.abs((entry.lastHF - recomputedHF) / entry.lastHF) * 100;

    // Check if mismatch exceeds tolerance (only for non-infinity values)
    if (entry.lastHF !== Infinity && recomputedHF !== Infinity && deltaPct > tolerance) {
      mismatches.push({
        address: entry.address,
        reportedHF: entry.lastHF,
        recomputedHF,
        delta,
        deltaPct,
        totalCollateralUsd: entry.totalCollateralUsd,
        totalDebtUsd: entry.totalDebtUsd
      });
    }
  }

  console.log(`[verify-lowhf] Verification method breakdown:`);
  console.log(`  Deterministic (with reserves): ${deterministicCount}`);
  console.log(`  Approximate (without reserves): ${approximateCount}`);
  console.log('');

  // Report results
  console.log(`[verify-lowhf] Verification results:`);
  console.log(`  Total entries: ${dumpData.entries.length}`);
  console.log(`  Mismatches (>${tolerance}%): ${mismatches.length}`);
  console.log('');

  if (mismatches.length === 0) {
    console.log('✅ All entries verified successfully!');
    process.exit(0);
  } else {
    console.log('⚠️  Mismatches detected:');
    console.log('');

    // Sort by delta percentage (largest first)
    mismatches.sort((a, b) => b.deltaPct - a.deltaPct);

    // Display top 10 mismatches
    const displayCount = Math.min(10, mismatches.length);
    for (let i = 0; i < displayCount; i++) {
      const m = mismatches[i];
      console.log(`  ${i + 1}. ${m.address}`);
      console.log(`     Reported HF: ${m.reportedHF.toFixed(6)}`);
      console.log(`     Recomputed HF: ${m.recomputedHF.toFixed(6)}`);
      console.log(`     Delta: ${m.delta.toFixed(6)} (${m.deltaPct.toFixed(2)}%)`);
      console.log(`     Collateral: $${m.totalCollateralUsd.toFixed(2)}, Debt: $${m.totalDebtUsd.toFixed(2)}`);
      console.log('');
    }

    if (mismatches.length > displayCount) {
      console.log(`  ... and ${mismatches.length - displayCount} more mismatches`);
      console.log('');
    }

    console.log('Note: Mismatches may be expected if dump was captured without reserve details (mode=min)');
    console.log('      or if liquidation thresholds vary significantly across reserves.');
    console.log('');
    console.log('Troubleshooting:');
    console.log('  - If extendedCount=0, set LOW_HF_EXTENDED_ENABLED=true and LOW_HF_RECORD_MODE=all');
    console.log('  - Ensure reserve data is being passed to tracker.record() from RealTimeHFService');
    console.log('  - Check that reserves are not filtered out due to configuration');
    process.exit(1);
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: npm run verify:lowhf <dump-file-path>');
  console.error('   or: tsx scripts/verify-lowhf.ts <dump-file-path>');
  console.error('');
  console.error('Example:');
  console.error('  npm run verify:lowhf diagnostics/lowhf-dump-2025-11-08T17-40-10-123Z.json');
  process.exit(1);
}

const filepath = args[0];
verifyDumpFile(filepath).catch(err => {
  console.error('[verify-lowhf] Unexpected error:', err);
  process.exit(1);
});
