/**
 * report: Generate CSV and JSON summary artifacts for replay results
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { LiquidationAnalysis, ReplaySummary, MissReason } from './types.js';

const OUTPUT_DIR = join(process.cwd(), 'replay', 'output');

/**
 * Ensure output directory exists
 */
function ensureOutputDir(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Write liquidations CSV file
 */
export function writeLiquidationsCSV(analyses: LiquidationAnalysis[]): string {
  ensureOutputDir();
  const csvPath = join(OUTPUT_DIR, 'liquidations.csv');

  const header = 'user,txHash,txBlock,seizedUSD,debtUSD,firstLiquidatableBlock,earliestWouldExecuteBlock,detectionLag,executionLag,missReason\n';
  
  const rows = analyses.map(a => {
    const fields = [
      a.user,
      a.txHash,
      a.txBlock.toString(),
      a.seizedUSD.toFixed(2),
      a.debtUSD.toFixed(2),
      a.firstLiquidatableBlock?.toString() || '',
      a.earliestWouldExecuteBlock?.toString() || '',
      a.detectionLag?.toString() || '',
      a.executionLag?.toString() || '',
      a.missReason
    ];
    return fields.join(',');
  }).join('\n');

  const csv = header + rows + '\n';
  writeFileSync(csvPath, csv, 'utf-8');

  console.log(`[replay] Wrote ${analyses.length} rows to ${csvPath}`);
  return csvPath;
}

/**
 * Calculate median of an array of numbers
 */
function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Generate summary statistics from analyses
 */
export function generateSummary(analyses: LiquidationAnalysis[]): ReplaySummary {
  const totalLiquidations = analyses.length;
  
  const detected = analyses.filter(a => a.firstLiquidatableBlock !== null);
  const executed = analyses.filter(a => a.earliestWouldExecuteBlock !== null);
  
  const detectionCoveragePct = totalLiquidations > 0 
    ? (detected.length / totalLiquidations) * 100 
    : 0;
  
  const executionCoveragePct = totalLiquidations > 0 
    ? (executed.length / totalLiquidations) * 100 
    : 0;

  const detectionLags = analyses
    .map(a => a.detectionLag)
    .filter((lag): lag is number => lag !== null);
  
  const executionLags = analyses
    .map(a => a.executionLag)
    .filter((lag): lag is number => lag !== null);

  const medianDetectionLagBlocks = median(detectionLags);
  const medianExecutionLagBlocks = median(executionLags);

  const missedByReason: Record<MissReason, number> = {
    below_min_debt: 0,
    watch_set_gap: 0,
    profit_filter: 0,
    unknown: 0,
    success: 0
  };

  for (const analysis of analyses) {
    missedByReason[analysis.missReason]++;
  }

  // Calculate missed profit (only for missed liquidations, not successes)
  const totalPotentialProfitMissedUSD = analyses
    .filter(a => a.missReason !== 'success')
    .reduce((sum, a) => sum + Math.max(0, a.seizedUSD - a.debtUSD), 0);

  return {
    totalLiquidations,
    detectionCoveragePct,
    executionCoveragePct,
    medianDetectionLagBlocks,
    medianExecutionLagBlocks,
    missedByReason,
    totalPotentialProfitMissedUSD
  };
}

/**
 * Write summary JSON file
 */
export function writeSummaryJSON(summary: ReplaySummary): string {
  ensureOutputDir();
  const jsonPath = join(OUTPUT_DIR, 'summary.json');

  const content = JSON.stringify(summary, null, 2);
  writeFileSync(jsonPath, content, 'utf-8');

  console.log(`[replay] Wrote summary to ${jsonPath}`);
  return jsonPath;
}

/**
 * Print summary table to console
 */
export function printSummaryTable(summary: ReplaySummary, analyses: LiquidationAnalysis[]): void {
  console.log('\n=== REPLAY SUMMARY ===\n');
  console.log(`Total Liquidations:           ${summary.totalLiquidations}`);
  console.log(`Detection Coverage:           ${summary.detectionCoveragePct.toFixed(2)}%`);
  console.log(`Execution Coverage:           ${summary.executionCoveragePct.toFixed(2)}%`);
  console.log(`Median Detection Lag:         ${summary.medianDetectionLagBlocks !== null ? summary.medianDetectionLagBlocks.toFixed(1) + ' blocks' : 'N/A'}`);
  console.log(`Median Execution Lag:         ${summary.medianExecutionLagBlocks !== null ? summary.medianExecutionLagBlocks.toFixed(1) + ' blocks' : 'N/A'}`);
  console.log(`Total Missed Profit:          $${summary.totalPotentialProfitMissedUSD.toFixed(2)}`);
  
  console.log('\nMiss Reasons:');
  console.log(`  Success:                    ${summary.missedByReason.success}`);
  console.log(`  Below Min Debt:             ${summary.missedByReason.below_min_debt}`);
  console.log(`  Watch Set Gap:              ${summary.missedByReason.watch_set_gap}`);
  console.log(`  Profit Filter:              ${summary.missedByReason.profit_filter}`);
  console.log(`  Unknown:                    ${summary.missedByReason.unknown}`);

  // Top 10 largest missed opportunities
  const missed = analyses
    .filter(a => a.missReason !== 'success')
    .map(a => ({
      user: a.user,
      txHash: a.txHash,
      potentialProfit: Math.max(0, a.seizedUSD - a.debtUSD),
      reason: a.missReason
    }))
    .sort((a, b) => b.potentialProfit - a.potentialProfit)
    .slice(0, 10);

  if (missed.length > 0) {
    console.log('\n=== TOP 10 MISSED OPPORTUNITIES (by potential profit) ===\n');
    console.log('Rank  User                                      TxHash                                                            Profit     Reason');
    console.log('----  ----------------------------------------  ----------------------------------------------------------------  ---------  ----------------');
    
    missed.forEach((m, idx) => {
      const rank = (idx + 1).toString().padEnd(4);
      const user = m.user.substring(0, 40).padEnd(40);
      const txHash = m.txHash.substring(0, 64).padEnd(64);
      const profit = `$${m.potentialProfit.toFixed(2)}`.padEnd(9);
      const reason = m.reason.padEnd(16);
      console.log(`${rank}  ${user}  ${txHash}  ${profit}  ${reason}`);
    });
  }

  console.log('\n');
}
