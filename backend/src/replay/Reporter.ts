/**
 * Reporter - Generates JSONL artifacts for replay results
 * 
 * Outputs three files:
 * - blocks.jsonl: Per-block scan metrics
 * - candidates.jsonl: Per-user candidate details
 * - summary.jsonl: Overall replay summary
 */

import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import type { ReplayContext } from './ReplayContext.js';

export interface BlockRow {
  type: 'block';
  block: number;
  timestamp: number;
  scanLatencyMs: number;
  candidates: number;
  newDetections: number;
  onChainLiquidations: number;
  missed: number;
  detected: number;
  falsePositives: number;
}

export interface CandidateRow {
  type: 'candidate';
  block: number;
  user: string;
  hf: number;
  debtUSD: number;
  collateralUSD: number;
  detectionProfitUSD: number | null;
  eventProfitUSD: number | null;
  firstDetectionBlock: number | null;
  liquidationBlock: number | null;
  leadBlocks: number | null;
  classification: 'detected' | 'missed' | 'false_positive' | 'pending';
  simulationStatus: 'ok' | 'revert' | 'skipped';
  revertReason: string;
  raceViable: boolean;
  hfAtDetection: number | null;
  hfAtLiquidation: number | null;
}

export interface SummaryRow {
  type: 'summary';
  startBlock: number;
  endBlock: number;
  totalBlocks: number;
  groundTruthCount: number;
  detected: number;
  missed: number;
  falsePositives: number;
  coverageRatio: number;
  avgLeadBlocks: number | null;
  medianLeadBlocks: number | null;
  raceViableCount: number;
  detectionProfitTotalUSD: number;
  eventProfitTotalUSD: number;
  durationMs: number;
  groundTruthAvailable: boolean;
}

export class Reporter {
  private blockRows: BlockRow[] = [];
  private candidateRows: CandidateRow[] = [];
  
  constructor(
    private readonly outputDir: string,
    private readonly startBlock: number,
    private readonly endBlock: number
  ) {}
  
  /**
   * Add block metrics row
   */
  addBlockRow(row: BlockRow): void {
    this.blockRows.push(row);
  }
  
  /**
   * Add candidate row (will be sorted deterministically before writing)
   */
  addCandidateRow(row: CandidateRow): void {
    this.candidateRows.push(row);
  }
  
  /**
   * Generate all candidates from context
   */
  generateCandidates(
    context: ReplayContext,
    blockTimestamps: Map<number, number>,
    executionHfThreshold: number,
    minProfitUSD: number
  ): void {
    // Get all users (detected + ground truth)
    const allUsers = new Set<string>([
      ...context.getDetectedUsers(),
      ...context.getGroundTruthUsers()
    ]);
    
    for (const user of allUsers) {
      const detection = context.getDetectionState(user);
      const event = context.getLiquidationEvent(user);
      const classification = context.classifyUser(user);
      const leadBlocks = context.getLeadBlocks(user);
      const raceViable = context.isRaceViable(user, executionHfThreshold / 10000, minProfitUSD);
      
      // Determine representative block for row
      const block = detection?.firstDetectionBlock || event?.block || this.startBlock;
      
      this.candidateRows.push({
        type: 'candidate',
        block,
        user,
        hf: detection?.hfAtDetection || event?.hfAtLiquidation || 0,
        debtUSD: detection?.debtAtDetection || 0,
        collateralUSD: detection?.collateralAtDetection || 0,
        detectionProfitUSD: detection?.detectionProfitUSD || null,
        eventProfitUSD: event?.eventProfitUSD || null,
        firstDetectionBlock: detection?.firstDetectionBlock || null,
        liquidationBlock: event?.block || null,
        leadBlocks,
        classification,
        simulationStatus: detection?.simulationStatus || 'skipped',
        revertReason: detection?.revertReason || '',
        raceViable,
        hfAtDetection: detection?.hfAtDetection || null,
        hfAtLiquidation: event?.hfAtLiquidation || null
      });
    }
  }
  
  /**
   * Write all artifacts to disk
   */
  async writeArtifacts(
    context: ReplayContext,
    durationMs: number
  ): Promise<void> {
    // Ensure output directory exists
    await mkdir(this.outputDir, { recursive: true });
    
    // Write blocks.jsonl (preserves insertion order)
    const blocksPath = join(this.outputDir, 'blocks.jsonl');
    const blocksContent = this.blockRows.map(row => JSON.stringify(row)).join('\n');
    await writeFile(blocksPath, blocksContent + '\n');
    console.log(`[reporter] Wrote ${this.blockRows.length} block rows to ${blocksPath}`);
    
    // Sort candidates deterministically by user address
    this.candidateRows.sort((a, b) => a.user.localeCompare(b.user));
    
    // Write candidates.jsonl
    const candidatesPath = join(this.outputDir, 'candidates.jsonl');
    const candidatesContent = this.candidateRows.map(row => JSON.stringify(row)).join('\n');
    await writeFile(candidatesPath, candidatesContent + '\n');
    console.log(`[reporter] Wrote ${this.candidateRows.length} candidate rows to ${candidatesPath}`);
    
    // Compute summary
    const metrics = context.computeMetrics();
    const coverageRatio = metrics.groundTruthCount > 0 
      ? metrics.detected / metrics.groundTruthCount 
      : 0;
    
    const avgLeadBlocks = metrics.leadBlocksCount > 0
      ? metrics.leadBlocksSum / metrics.leadBlocksCount
      : null;
    
    const medianLeadBlocks = metrics.leadBlocksList.length > 0
      ? this.calculateMedian(metrics.leadBlocksList)
      : null;
    
    const summary: SummaryRow = {
      type: 'summary',
      startBlock: this.startBlock,
      endBlock: this.endBlock,
      totalBlocks: this.endBlock - this.startBlock + 1,
      groundTruthCount: metrics.groundTruthCount,
      detected: metrics.detected,
      missed: metrics.missed,
      falsePositives: metrics.falsePositives,
      coverageRatio,
      avgLeadBlocks,
      medianLeadBlocks,
      raceViableCount: metrics.raceViableCount,
      detectionProfitTotalUSD: metrics.detectionProfitTotalUSD,
      eventProfitTotalUSD: metrics.eventProfitTotalUSD,
      durationMs,
      groundTruthAvailable: true
    };
    
    // Write summary.jsonl
    const summaryPath = join(this.outputDir, 'summary.jsonl');
    await writeFile(summaryPath, JSON.stringify(summary) + '\n');
    console.log(`[reporter] Wrote summary to ${summaryPath}`);
    
    // Print summary to console
    console.log('\n=== REPLAY SUMMARY ===');
    console.log(`Block Range: ${this.startBlock} - ${this.endBlock} (${summary.totalBlocks} blocks)`);
    console.log(`Ground Truth: ${metrics.groundTruthCount} liquidations`);
    console.log(`Detected: ${metrics.detected} (${(coverageRatio * 100).toFixed(1)}% coverage)`);
    console.log(`Missed: ${metrics.missed}`);
    console.log(`False Positives: ${metrics.falsePositives}`);
    console.log(`Race Viable: ${metrics.raceViableCount}`);
    if (avgLeadBlocks !== null) {
      console.log(`Avg Lead Blocks: ${avgLeadBlocks.toFixed(2)}`);
    }
    if (medianLeadBlocks !== null) {
      console.log(`Median Lead Blocks: ${medianLeadBlocks}`);
    }
    console.log(`Detection Profit: $${metrics.detectionProfitTotalUSD.toFixed(2)}`);
    console.log(`Event Profit: $${metrics.eventProfitTotalUSD.toFixed(2)}`);
    console.log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
    console.log('======================\n');
  }
  
  /**
   * Calculate median of a sorted or unsorted array
   */
  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }
}
