// Reporter: Generate summary reports for replay mode with ground truth metadata
export interface ReplaySummary {
  startTimestamp: number;
  endTimestamp: number;
  startBlock?: number;
  endBlock?: number;
  totalBlocks: number;
  totalCandidatesScanned: number;
  totalOpportunitiesDetected: number;
  groundTruthAvailable: boolean;
  groundTruthCount: number;
  groundTruthErrorMessage?: string;
  groundTruthPartial?: boolean;
  coverageMetrics?: {
    truePositives: number;
    falseNegatives: number;
    coverage: number;
  };
  latencyMetrics?: {
    avgLeadTimeSeconds: number;
    medianLeadTimeSeconds: number;
    p95LeadTimeSeconds: number;
  };
  durationMs: number;
  timestamp: string;
}

export class Reporter {
  private startTime: number;
  private summary: Partial<ReplaySummary>;

  constructor() {
    this.startTime = Date.now();
    this.summary = {
      timestamp: new Date().toISOString(),
      totalBlocks: 0,
      totalCandidatesScanned: 0,
      totalOpportunitiesDetected: 0,
      groundTruthAvailable: false,
      groundTruthCount: 0
    };
  }

  setTimeRange(start: number, end: number, startBlock?: number, endBlock?: number) {
    this.summary.startTimestamp = start;
    this.summary.endTimestamp = end;
    this.summary.startBlock = startBlock;
    this.summary.endBlock = endBlock;
  }

  setBlockCount(count: number) {
    this.summary.totalBlocks = count;
  }

  incrementCandidatesScanned(count: number) {
    this.summary.totalCandidatesScanned = (this.summary.totalCandidatesScanned || 0) + count;
  }

  incrementOpportunitiesDetected(count: number) {
    this.summary.totalOpportunitiesDetected = (this.summary.totalOpportunitiesDetected || 0) + count;
  }

  setGroundTruth(available: boolean, count: number, error?: string, partial?: boolean) {
    this.summary.groundTruthAvailable = available;
    this.summary.groundTruthCount = count;
    if (error) {
      this.summary.groundTruthErrorMessage = error;
    }
    if (partial) {
      this.summary.groundTruthPartial = partial;
    }
  }

  setCoverageMetrics(truePositives: number, falseNegatives: number) {
    const total = truePositives + falseNegatives;
    this.summary.coverageMetrics = {
      truePositives,
      falseNegatives,
      coverage: total > 0 ? (truePositives / total) * 100 : 0
    };
  }

  setLatencyMetrics(avgSeconds: number, medianSeconds: number, p95Seconds: number) {
    this.summary.latencyMetrics = {
      avgLeadTimeSeconds: avgSeconds,
      medianLeadTimeSeconds: medianSeconds,
      p95LeadTimeSeconds: p95Seconds
    };
  }

  finalize(): ReplaySummary {
    const durationMs = Date.now() - this.startTime;
    return {
      ...this.summary,
      durationMs
    } as ReplaySummary;
  }

  printSummary() {
    const final = this.finalize();
    
    console.log('\n=== Replay Summary ===');
    console.log(JSON.stringify(final, null, 2));
    
    // Also log single-line JSON for easy parsing
    console.log('\n[REPLAY_SUMMARY]', JSON.stringify(final));
  }
}
