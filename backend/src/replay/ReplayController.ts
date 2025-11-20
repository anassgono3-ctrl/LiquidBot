// ReplayController: Orchestrate historical replay with fallback handling
import type { LiquidationCall } from '../types/index.js';

import type { EventGroundTruthLoader, LoadResult } from './EventGroundTruthLoader.js';
import { Reporter } from './Reporter.js';

export interface ReplayOptions {
  startBlock?: number;
  endBlock?: number;
  startTimestamp?: number;
  endTimestamp?: number;
  blockInterval?: number;
}

export interface ReplayContext {
  groundTruth: LiquidationCall[];
  groundTruthAvailable: boolean;
  groundTruthError?: string;
  groundTruthPartial?: boolean;
  startBlock?: number;
  endBlock?: number;
  startTimestamp?: number;
  endTimestamp?: number;
}

export class ReplayController {
  private loader: EventGroundTruthLoader;
  private reporter: Reporter;
  private context: ReplayContext | null = null;

  constructor(loader: EventGroundTruthLoader, reporter?: Reporter) {
    this.loader = loader;
    this.reporter = reporter || new Reporter();
  }

  /**
   * Initialize replay by loading ground truth events
   * Gracefully falls back if loading fails
   */
  async initialize(options: ReplayOptions): Promise<ReplayContext> {
    console.log('[ReplayController] Initializing replay...');
    
    const { startBlock, endBlock, startTimestamp, endTimestamp } = options;
    
    // Attempt to load ground truth
    let result: LoadResult;
    try {
      result = await this.loader.load();
    } catch (error) {
      console.error('[ReplayController] Unexpected error loading ground truth:', error);
      result = { 
        events: [], 
        error: error instanceof Error ? error.message : String(error) 
      };
    }

    // Determine if ground truth is available
    // Consider it available if we have any events, even with partial data
    const groundTruthAvailable = result.events.length > 0;
    
    if (!groundTruthAvailable) {
      console.warn('[ReplayController] Ground truth not available, proceeding in fallback mode');
      console.warn(`[ReplayController] Reason: ${result.error || 'No events loaded'}`);
    } else if (result.partial) {
      console.warn('[ReplayController] Ground truth partially available (some pages failed)');
    } else {
      console.log(`[ReplayController] Ground truth loaded: ${result.events.length} events`);
    }

    // Create context
    this.context = {
      groundTruth: result.events,
      groundTruthAvailable,
      groundTruthError: result.error,
      groundTruthPartial: result.partial,
      startBlock,
      endBlock,
      startTimestamp,
      endTimestamp
    };

    // Update reporter
    this.reporter.setGroundTruth(
      groundTruthAvailable,
      result.events.length,
      result.error,
      result.partial
    );

    if (startTimestamp && endTimestamp) {
      this.reporter.setTimeRange(startTimestamp, endTimestamp, startBlock, endBlock);
    }

    return this.context;
  }

  /**
   * Process a block range for replay
   * This is a placeholder - actual implementation would scan candidates
   * and compare with ground truth
   */
  async processBlockRange(startBlock: number, endBlock: number): Promise<void> {
    if (!this.context) {
      throw new Error('ReplayController not initialized');
    }

    console.log(`[ReplayController] Processing blocks ${startBlock} to ${endBlock}`);
    
    const blockCount = endBlock - startBlock + 1;
    this.reporter.setBlockCount(blockCount);

    // Placeholder: In real implementation, this would:
    // 1. Scan candidates block-by-block
    // 2. Detect opportunities using bot logic
    // 3. Compare detections with ground truth
    // 4. Calculate coverage and latency metrics
    
    // For now, just simulate progress
    console.log('[ReplayController] Block scanning not yet implemented - placeholder mode');
    
    // Simulate some candidate scanning
    this.reporter.incrementCandidatesScanned(100);
    this.reporter.incrementOpportunitiesDetected(10);
  }

  /**
   * Finalize replay and generate report
   */
  finalize() {
    console.log('[ReplayController] Finalizing replay...');
    this.reporter.printSummary();
    return this.reporter.finalize();
  }

  getContext(): ReplayContext | null {
    return this.context;
  }
}
