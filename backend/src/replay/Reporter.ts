// Reporter: JSONL writer and summary aggregator for replay results
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export interface BlockMetrics {
  type: 'block';
  block: number;
  timestamp: number;
  scanLatencyMs: number;
  candidates: number;
  onChainLiquidations: number;
  missed: string[];
  falsePositives: string[];
}

export interface CandidateMetrics {
  type: 'candidate';
  block: number;
  user: string;
  hf: number;
  debtUSD: number;
  collateralUSD: number;
  profitEstUSD: number;
  wouldSend: boolean;
  simulation?: 'ok' | 'revert' | 'skipped';
  onChainLiquidated: boolean;
  classification: 'detected' | 'false-positive' | 'unexecuted';
}

export interface MissedLiquidation {
  type: 'missed';
  block: number;
  user: string;
  txHash: string;
  reason: string;
}

export interface SummaryMetrics {
  type: 'summary';
  blocks: number;
  candidates: number;
  onChainLiquidations: number;
  detected: number;
  missed: number;
  falsePositives: number;
  coverageRatio: number;
  avgLeadBlocks: number;
  medianLeadBlocks: number;
  minLeadBlocks: number;
  maxLeadBlocks: number;
  avgProfitUSD: number;
  totalScanLatencyMs: number;
  avgScanLatencyMs: number;
}

/**
 * Reporter handles JSONL output for replay results.
 * Writes per-block metrics, per-candidate metrics, missed liquidations, and final summary.
 */
export class Reporter {
  private exportDir: string;
  private blocksPath: string;
  private candidatesPath: string;
  private missedPath: string;
  private summaryPath: string;
  
  private blockCount = 0;
  private candidateCount = 0;
  private onChainCount = 0;
  private detectedCount = 0;
  private missedCount = 0;
  private falsePositiveCount = 0;
  private leadBlocksSum = 0;
  private leadBlocksCount = 0;
  private leadBlocksList: number[] = [];
  private profitSum = 0;
  private profitCount = 0;
  private scanLatencySum = 0;
  
  constructor(exportDir: string) {
    this.exportDir = exportDir;
    this.blocksPath = join(exportDir, 'blocks.jsonl');
    this.candidatesPath = join(exportDir, 'candidates.jsonl');
    this.missedPath = join(exportDir, 'missed.jsonl');
    this.summaryPath = join(exportDir, 'summary.jsonl');
    
    // Ensure export directory exists
    if (!existsSync(exportDir)) {
      mkdirSync(exportDir, { recursive: true });
    }
    
    // Initialize files (overwrite if exists)
    writeFileSync(this.blocksPath, '');
    writeFileSync(this.candidatesPath, '');
    writeFileSync(this.missedPath, '');
    writeFileSync(this.summaryPath, '');
  }
  
  /**
   * Write a block metrics row to blocks.jsonl
   */
  writeBlock(metrics: BlockMetrics): void {
    appendFileSync(this.blocksPath, JSON.stringify(metrics) + '\n');
    this.blockCount++;
    this.scanLatencySum += metrics.scanLatencyMs;
    this.onChainCount += metrics.onChainLiquidations;
    this.missedCount += metrics.missed.length;
    this.falsePositiveCount += metrics.falsePositives.length;
  }
  
  /**
   * Write a candidate metrics row to candidates.jsonl
   */
  writeCandidate(metrics: CandidateMetrics): void {
    appendFileSync(this.candidatesPath, JSON.stringify(metrics) + '\n');
    this.candidateCount++;
    
    if (metrics.classification === 'detected') {
      this.detectedCount++;
    }
    
    if (metrics.profitEstUSD > 0) {
      this.profitSum += metrics.profitEstUSD;
      this.profitCount++;
    }
  }
  
  /**
   * Write a missed liquidation row to missed.jsonl
   */
  writeMissed(missed: MissedLiquidation): void {
    appendFileSync(this.missedPath, JSON.stringify(missed) + '\n');
  }
  
  /**
   * Record lead time for a detected liquidation (blocks between first detection and on-chain execution)
   */
  recordLeadTime(leadBlocks: number): void {
    this.leadBlocksSum += leadBlocks;
    this.leadBlocksCount++;
    this.leadBlocksList.push(leadBlocks);
  }
  
  /**
   * Write final summary row to summary.jsonl
   */
  writeSummary(): void {
    const coverageRatio = this.onChainCount > 0 ? this.detectedCount / this.onChainCount : 0;
    const avgLeadBlocks = this.leadBlocksCount > 0 ? this.leadBlocksSum / this.leadBlocksCount : 0;
    const avgProfitUSD = this.profitCount > 0 ? this.profitSum / this.profitCount : 0;
    const avgScanLatencyMs = this.blockCount > 0 ? this.scanLatencySum / this.blockCount : 0;
    
    // Calculate median lead blocks
    let medianLeadBlocks = 0;
    let minLeadBlocks = 0;
    let maxLeadBlocks = 0;
    
    if (this.leadBlocksList.length > 0) {
      const sorted = [...this.leadBlocksList].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      medianLeadBlocks = sorted.length % 2 === 0 
        ? (sorted[mid - 1] + sorted[mid]) / 2 
        : sorted[mid];
      minLeadBlocks = sorted[0];
      maxLeadBlocks = sorted[sorted.length - 1];
    }
    
    const summary: SummaryMetrics = {
      type: 'summary',
      blocks: this.blockCount,
      candidates: this.candidateCount,
      onChainLiquidations: this.onChainCount,
      detected: this.detectedCount,
      missed: this.missedCount,
      falsePositives: this.falsePositiveCount,
      coverageRatio: parseFloat(coverageRatio.toFixed(4)),
      avgLeadBlocks: parseFloat(avgLeadBlocks.toFixed(2)),
      medianLeadBlocks: parseFloat(medianLeadBlocks.toFixed(2)),
      minLeadBlocks,
      maxLeadBlocks,
      avgProfitUSD: parseFloat(avgProfitUSD.toFixed(2)),
      totalScanLatencyMs: this.scanLatencySum,
      avgScanLatencyMs: parseFloat(avgScanLatencyMs.toFixed(2)),
    };
    
    appendFileSync(this.summaryPath, JSON.stringify(summary) + '\n');
  }
  
  /**
   * Get current statistics without writing summary
   */
  getStats() {
    return {
      blocks: this.blockCount,
      candidates: this.candidateCount,
      onChainLiquidations: this.onChainCount,
      detected: this.detectedCount,
      missed: this.missedCount,
      falsePositives: this.falsePositiveCount,
    };
  }
}
