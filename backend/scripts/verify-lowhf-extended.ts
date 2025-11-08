#!/usr/bin/env tsx
/**
 * Extended Low HF Dump Verification Script
 * 
 * Verifies the integrity of extended low HF dump files by:
 * - Mode A: Pure mathematical recomputation from stored data
 * - Mode B: Archive node re-fetch at blockTag for full provenance validation
 * - Mode C: Sample-based verification (random subset to limit cost)
 * 
 * Usage:
 *   # Mode A: Basic mathematical verification
 *   npm run verify:lowhf-dump diagnostics/lowhf-extended-dump-<timestamp>.json
 *   
 *   # Mode B: Full archive verification
 *   LOW_HF_ARCHIVE_RPC_URL=https://archive.node npm run verify:lowhf-dump <file>
 *   
 *   # Mode C: Sample-based archive verification (10 random entries)
 *   LOW_HF_ARCHIVE_RPC_URL=https://archive.node LOW_HF_ARCHIVE_VERIFY_SAMPLE=10 npm run verify:lowhf-dump <file>
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { ethers } from 'ethers';

// Import types from LowHFTracker
interface LowHFReserveDetail {
  tokenAddress: string;
  symbol: string;
  tokenDecimals: number;
  collateralRaw: string;
  debtRaw: string;
  collateralUsd: number;
  debtUsd: number;
  liquidationThresholdBps: number;
  liquidationBonusBps?: number;
  ltvBps?: number;
  priceSource: 'chainlink' | 'stub' | 'other';
  priceAnswerRaw: string;
  priceDecimals: number;
  priceRoundId?: string;
  priceUpdatedAt?: number;
}

interface LowHFExtendedEntry {
  timestamp: string;
  blockNumber: number;
  blockHash: string;
  trigger: 'head' | 'event' | 'price';
  user: string;
  reportedHfFloat: number;
  reportedHfRawBps: number;
  reserves: LowHFReserveDetail[];
  weightedCollateralUsd: number;
  totalCollateralUsd: number;
  totalDebtUsd: number;
  recomputedHf: number;
  deltaReportedVsRecomputed: number;
}

interface DumpData {
  metadata: {
    timestamp: string;
    schemaVersion: string;
    mode: 'all' | 'min';
    count: number;
    extendedCount: number;
    minHF: number | null;
    threshold: number;
  };
  entries: unknown[];
  extendedEntries?: LowHFExtendedEntry[];
}

interface VerificationMismatch {
  user: string;
  field: string;
  expected: string | number;
  actual: string | number;
  delta?: string | number;
}

interface VerificationResult {
  totalEntries: number;
  verified: number;
  mismatches: VerificationMismatch[];
  skipped: number;
  errors: string[];
}

/**
 * Recompute health factor from reserve details
 */
function recomputeHealthFactor(entry: LowHFExtendedEntry): {
  weightedCollateralUsd: number;
  totalCollateralUsd: number;
  totalDebtUsd: number;
  hf: number;
} {
  let weightedCollateralUsd = 0;
  let totalCollateralUsd = 0;
  let totalDebtUsd = 0;

  for (const reserve of entry.reserves) {
    totalCollateralUsd += reserve.collateralUsd;
    totalDebtUsd += reserve.debtUsd;
    
    // Apply liquidation threshold
    const threshold = reserve.liquidationThresholdBps / 10000;
    weightedCollateralUsd += reserve.collateralUsd * threshold;
  }

  const hf = totalDebtUsd === 0 || totalDebtUsd < 1e-9 
    ? Infinity 
    : weightedCollateralUsd / totalDebtUsd;

  return {
    weightedCollateralUsd,
    totalCollateralUsd,
    totalDebtUsd,
    hf
  };
}

/**
 * Mode A: Pure mathematical recomputation
 */
function verifyMathematicalConsistency(
  entries: LowHFExtendedEntry[],
  tolerance: number = 1e-6
): VerificationResult {
  const result: VerificationResult = {
    totalEntries: entries.length,
    verified: 0,
    mismatches: [],
    skipped: 0,
    errors: []
  };

  for (const entry of entries) {
    try {
      const recomputed = recomputeHealthFactor(entry);

      // Check weighted collateral
      const weightedDelta = Math.abs(recomputed.weightedCollateralUsd - entry.weightedCollateralUsd);
      if (weightedDelta > tolerance) {
        result.mismatches.push({
          user: entry.user,
          field: 'weightedCollateralUsd',
          expected: entry.weightedCollateralUsd,
          actual: recomputed.weightedCollateralUsd,
          delta: weightedDelta
        });
      }

      // Check total collateral
      const collateralDelta = Math.abs(recomputed.totalCollateralUsd - entry.totalCollateralUsd);
      if (collateralDelta > tolerance) {
        result.mismatches.push({
          user: entry.user,
          field: 'totalCollateralUsd',
          expected: entry.totalCollateralUsd,
          actual: recomputed.totalCollateralUsd,
          delta: collateralDelta
        });
      }

      // Check total debt
      const debtDelta = Math.abs(recomputed.totalDebtUsd - entry.totalDebtUsd);
      if (debtDelta > tolerance) {
        result.mismatches.push({
          user: entry.user,
          field: 'totalDebtUsd',
          expected: entry.totalDebtUsd,
          actual: recomputed.totalDebtUsd,
          delta: debtDelta
        });
      }

      // Check HF (skip if either is Infinity)
      if (recomputed.hf !== Infinity && entry.recomputedHf !== Infinity) {
        const hfDelta = Math.abs(recomputed.hf - entry.recomputedHf);
        const hfDeltaPct = Math.abs((recomputed.hf - entry.recomputedHf) / entry.recomputedHf) * 100;
        if (hfDeltaPct > 0.01) { // 0.01% tolerance for HF
          result.mismatches.push({
            user: entry.user,
            field: 'recomputedHf',
            expected: entry.recomputedHf,
            actual: recomputed.hf,
            delta: `${hfDelta.toFixed(9)} (${hfDeltaPct.toFixed(4)}%)`
          });
        }
      }

      if (result.mismatches.filter(m => m.user === entry.user).length === 0) {
        result.verified++;
      }
    } catch (err) {
      result.errors.push(`Error verifying ${entry.user}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

/**
 * Mode B/C: Archive node verification
 */
async function verifyAgainstArchive(
  entries: LowHFExtendedEntry[],
  archiveRpcUrl: string,
  sampleSize?: number,
  timeoutMs: number = 8000
): Promise<VerificationResult> {
  const result: VerificationResult = {
    totalEntries: entries.length,
    verified: 0,
    mismatches: [],
    skipped: 0,
    errors: []
  };

  // Sample if requested
  let entriesToVerify = entries;
  if (sampleSize && sampleSize > 0 && sampleSize < entries.length) {
    // Random sampling
    const shuffled = [...entries].sort(() => Math.random() - 0.5);
    entriesToVerify = shuffled.slice(0, sampleSize);
    result.skipped = entries.length - sampleSize;
    console.log(`[verify] Sampling ${sampleSize} entries out of ${entries.length}`);
  }

  // Initialize provider
  const provider = new ethers.JsonRpcProvider(archiveRpcUrl);

  // Aave Pool ABI (minimal)
  const POOL_ABI = [
    'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
  ];

  // Note: We would need the actual Aave Pool address from config
  // For now, we'll use a placeholder approach
  console.log('[verify] Archive verification not yet fully implemented (requires pool address config)');
  console.log('[verify] Skipping archive verification - this is a placeholder for future enhancement');
  
  result.skipped = entriesToVerify.length;
  return result;
}

/**
 * Main verification function
 */
async function verifyDumpFile(filepath: string): Promise<void> {
  console.log(`[verify] Verifying dump file: ${filepath}\n`);

  // Check if file exists
  if (!existsSync(filepath)) {
    console.error(`[verify] ❌ File not found: ${filepath}`);
    process.exit(1);
  }

  // Read and parse dump file
  let dumpData: DumpData;
  try {
    const content = await readFile(filepath, 'utf-8');
    dumpData = JSON.parse(content);
  } catch (err) {
    console.error(`[verify] ❌ Failed to read or parse file:`, err);
    process.exit(1);
  }

  // Display metadata
  console.log(`[verify] Dump metadata:`);
  console.log(`  Schema version: ${dumpData.metadata.schemaVersion}`);
  console.log(`  Timestamp: ${dumpData.metadata.timestamp}`);
  console.log(`  Mode: ${dumpData.metadata.mode}`);
  console.log(`  Basic entries: ${dumpData.metadata.count}`);
  console.log(`  Extended entries: ${dumpData.metadata.extendedCount}`);
  console.log(`  MinHF: ${dumpData.metadata.minHF?.toFixed(4) ?? 'N/A'}`);
  console.log(`  Threshold: ${dumpData.metadata.threshold}`);
  console.log('');

  // Check if we have extended entries
  if (!dumpData.extendedEntries || dumpData.extendedEntries.length === 0) {
    console.log('[verify] ⚠️  No extended entries found in dump file.');
    console.log('[verify] This dump may have been created before extended tracking was enabled.');
    console.log('[verify] Mathematical verification requires extended entries with reserve details.');
    process.exit(0);
  }

  console.log(`[verify] Found ${dumpData.extendedEntries.length} extended entries to verify\n`);

  // Mode A: Mathematical consistency check
  console.log('[verify] === Mode A: Mathematical Consistency Check ===');
  const mathResult = verifyMathematicalConsistency(dumpData.extendedEntries);
  
  console.log(`[verify] Results:`);
  console.log(`  Total entries: ${mathResult.totalEntries}`);
  console.log(`  Verified: ${mathResult.verified}`);
  console.log(`  Mismatches: ${mathResult.mismatches.length}`);
  console.log(`  Errors: ${mathResult.errors.length}`);
  console.log('');

  if (mathResult.mismatches.length > 0) {
    console.log('[verify] ⚠️  Mismatches detected:\n');
    
    // Group by user
    const byUser = new Map<string, VerificationMismatch[]>();
    for (const mismatch of mathResult.mismatches) {
      if (!byUser.has(mismatch.user)) {
        byUser.set(mismatch.user, []);
      }
      byUser.get(mismatch.user)!.push(mismatch);
    }

    // Display up to 10 users with mismatches
    let displayCount = 0;
    for (const [user, mismatches] of byUser.entries()) {
      if (displayCount >= 10) break;
      
      console.log(`  User: ${user}`);
      for (const m of mismatches) {
        console.log(`    ${m.field}:`);
        console.log(`      Expected: ${typeof m.expected === 'number' ? m.expected.toFixed(6) : m.expected}`);
        console.log(`      Actual:   ${typeof m.actual === 'number' ? m.actual.toFixed(6) : m.actual}`);
        if (m.delta) {
          console.log(`      Delta:    ${m.delta}`);
        }
      }
      console.log('');
      displayCount++;
    }

    if (byUser.size > 10) {
      console.log(`  ... and ${byUser.size - 10} more users with mismatches\n`);
    }
  }

  if (mathResult.errors.length > 0) {
    console.log('[verify] Errors during verification:\n');
    for (const error of mathResult.errors.slice(0, 5)) {
      console.log(`  - ${error}`);
    }
    if (mathResult.errors.length > 5) {
      console.log(`  ... and ${mathResult.errors.length - 5} more errors\n`);
    }
  }

  // Mode B/C: Archive verification (if configured)
  const archiveRpcUrl = process.env.LOW_HF_ARCHIVE_RPC_URL;
  const archiveSample = process.env.LOW_HF_ARCHIVE_VERIFY_SAMPLE 
    ? parseInt(process.env.LOW_HF_ARCHIVE_VERIFY_SAMPLE) 
    : 0;
  const archiveTimeout = process.env.LOW_HF_ARCHIVE_TIMEOUT_MS
    ? parseInt(process.env.LOW_HF_ARCHIVE_TIMEOUT_MS)
    : 8000;

  if (archiveRpcUrl) {
    console.log('[verify] === Mode B/C: Archive Node Verification ===');
    console.log(`[verify] Archive RPC: ${archiveRpcUrl}`);
    if (archiveSample > 0) {
      console.log(`[verify] Sample size: ${archiveSample}`);
    }
    console.log(`[verify] Timeout: ${archiveTimeout}ms\n`);

    const archiveResult = await verifyAgainstArchive(
      dumpData.extendedEntries,
      archiveRpcUrl,
      archiveSample > 0 ? archiveSample : undefined,
      archiveTimeout
    );

    console.log(`[verify] Archive verification results:`);
    console.log(`  Verified: ${archiveResult.verified}`);
    console.log(`  Mismatches: ${archiveResult.mismatches.length}`);
    console.log(`  Skipped: ${archiveResult.skipped}`);
    console.log(`  Errors: ${archiveResult.errors.length}`);
    console.log('');
  } else {
    console.log('[verify] Skipping archive verification (LOW_HF_ARCHIVE_RPC_URL not set)\n');
  }

  // Final summary
  const hasMismatches = mathResult.mismatches.length > 0;
  const hasErrors = mathResult.errors.length > 0;

  if (!hasMismatches && !hasErrors) {
    console.log('✅ All entries verified successfully!');
    console.log('   Mathematical consistency: PASS');
    process.exit(0);
  } else {
    console.log('⚠️  Verification completed with issues:');
    if (hasMismatches) {
      console.log(`   - ${mathResult.mismatches.length} field mismatches detected`);
    }
    if (hasErrors) {
      console.log(`   - ${mathResult.errors.length} verification errors`);
    }
    console.log('');
    console.log('Note: Minor mismatches may be due to floating-point precision or rounding.');
    console.log('      Review the delta values to determine if they are acceptable.');
    process.exit(1);
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: npm run verify:lowhf-dump <dump-file-path>');
  console.error('   or: tsx scripts/verify-lowhf-extended.ts <dump-file-path>');
  console.error('');
  console.error('Environment variables:');
  console.error('  LOW_HF_ARCHIVE_RPC_URL     - Archive node RPC URL for Mode B/C verification');
  console.error('  LOW_HF_ARCHIVE_VERIFY_SAMPLE - Sample size for Mode C (default: 0 = all)');
  console.error('  LOW_HF_ARCHIVE_TIMEOUT_MS   - Timeout per user verification (default: 8000)');
  console.error('');
  console.error('Example:');
  console.error('  npm run verify:lowhf-dump diagnostics/lowhf-extended-dump-2025-11-08T17-40-10-123Z.json');
  console.error('  LOW_HF_ARCHIVE_RPC_URL=https://archive.node npm run verify:lowhf-dump <file>');
  process.exit(1);
}

const filepath = args[0];
verifyDumpFile(filepath).catch(err => {
  console.error('[verify] Unexpected error:', err);
  process.exit(1);
});
