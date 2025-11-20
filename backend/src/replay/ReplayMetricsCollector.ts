/**
 * ReplayMetricsCollector: Tracks detection metrics for replay mode
 */

import type { LiquidationDetection, BlockMetrics, ReplaySummary } from './types.js';

export class ReplayMetricsCollector {
  // Detection tracking
  private detections: Map<string, LiquidationDetection> = new Map();
  private userFirstDetectionBlock: Map<string, number> = new Map();
  
  // Per-block metrics
  private blockMetrics: BlockMetrics[] = [];
  
  // Overall stats
  private evaluatedUsers: Set<string> = new Set();
  private liquidatableUsers: Set<string> = new Set();
  private configSnapshot: any; // eslint-disable-line @typescript-eslint/no-explicit-any

  constructor(configSnapshot: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    this.configSnapshot = configSnapshot;
  }

  /**
   * Record when a user is first detected as liquidatable
   */
  recordFirstDetection(userAddress: string, blockNumber: number): void {
    const normalized = userAddress.toLowerCase();
    if (!this.userFirstDetectionBlock.has(normalized)) {
      this.userFirstDetectionBlock.set(normalized, blockNumber);
    }
  }

  /**
   * Record a liquidation call event
   */
  recordLiquidationCall(
    userAddress: string,
    liquidationBlock: number,
    missReason?: 'watch_set_gap' | 'min_debt_filter' | 'profit_filter' | 'unknown'
  ): void {
    const normalized = userAddress.toLowerCase();
    this.liquidatableUsers.add(normalized);

    const firstDetectBlock = this.userFirstDetectionBlock.get(normalized) || null;
    const detectionLagBlocks = firstDetectBlock !== null 
      ? liquidationBlock - firstDetectBlock 
      : null;

    this.detections.set(normalized, {
      userAddress: normalized,
      firstDetectBlock,
      liquidationBlock,
      detectionLagBlocks,
      missReason: firstDetectBlock === null ? (missReason || 'unknown') : null
    });
  }

  /**
   * Record per-block metrics
   */
  recordBlockMetrics(metrics: BlockMetrics): void {
    this.blockMetrics.push(metrics);
    
    // Track evaluated users
    metrics.newHFEntrants.forEach(user => {
      this.evaluatedUsers.add(user.toLowerCase());
    });
  }

  /**
   * Get all block metrics
   */
  getBlockMetrics(): BlockMetrics[] {
    return this.blockMetrics;
  }

  /**
   * Generate summary report
   */
  generateSummary(startBlock: number, endBlock: number): ReplaySummary {
    const allDetections = Array.from(this.detections.values());
    const detectedCount = allDetections.filter(d => d.firstDetectBlock !== null).length;
    const missedCount = allDetections.filter(d => d.firstDetectBlock === null).length;
    
    // Calculate median detection lag (excluding misses)
    const lags = allDetections
      .filter(d => d.detectionLagBlocks !== null)
      .map(d => d.detectionLagBlocks!)
      .sort((a, b) => a - b);
    
    const medianDetectionLag = lags.length > 0
      ? lags[Math.floor(lags.length / 2)]
      : null;

    // Count miss reasons
    const missedCountByReason = {
      watch_set_gap: 0,
      min_debt_filter: 0,
      profit_filter: 0,
      unknown: 0
    };

    allDetections.forEach(d => {
      if (d.missReason) {
        missedCountByReason[d.missReason]++;
      }
    });

    // Find earliest liquidation block
    const earliestLiquidationBlock = allDetections.length > 0
      ? Math.min(...allDetections.map(d => d.liquidationBlock))
      : null;

    // Calculate detection coverage
    const detectionCoveragePct = allDetections.length > 0
      ? (detectedCount / allDetections.length) * 100
      : 0;

    return {
      range: {
        start: startBlock,
        end: endBlock
      },
      totalBlocks: endBlock - startBlock + 1,
      totalUsersEvaluated: this.evaluatedUsers.size,
      totalUniqueLiquidatableUsers: this.liquidatableUsers.size,
      totalLiquidationEvents: allDetections.length,
      detectionCoveragePct,
      medianDetectionLag,
      missedCountByReason,
      earliestLiquidationBlock,
      configSnapshot: this.configSnapshot
    };
  }

  /**
   * Get all detection records
   */
  getDetections(): LiquidationDetection[] {
    return Array.from(this.detections.values());
  }
}
