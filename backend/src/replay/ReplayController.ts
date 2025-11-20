// ReplayController: Main loop driving block-by-block replay execution
import { setTimeout as sleep } from 'timers/promises';

import { JsonRpcProvider } from 'ethers';

import type { ReplayConfigType } from './ReplayConfig.js';
import { getSleepDuration } from './ReplayConfig.js';
import { HistoricalStateProvider } from './HistoricalStateProvider.js';
import { EventGroundTruthLoader, type LiquidationEvent } from './EventGroundTruthLoader.js';
import { Comparator, type Candidate, type GroundTruthEvent } from './Comparator.js';
import { Reporter, type BlockMetrics, type CandidateMetrics, type MissedLiquidation } from './Reporter.js';

export interface ReplayCandidateDetector {
  detectCandidates(block: number, stateProvider: HistoricalStateProvider): Promise<Candidate[]>;
}

/**
 * ReplayController orchestrates the historical replay execution.
 * Iterates block-by-block, detects candidates, compares with ground truth,
 * and generates detailed JSONL artifacts.
 */
export class ReplayController {
  private config: ReplayConfigType;
  private provider: JsonRpcProvider;
  private stateProvider: HistoricalStateProvider;
  private reporter: Reporter;
  private comparator?: Comparator;
  private groundTruthEvents?: Map<number, LiquidationEvent[]>;
  private candidateDetector: ReplayCandidateDetector;
  private errorCount = 0;
  private processedBlocks = 0;
  
  constructor(
    config: ReplayConfigType,
    provider: JsonRpcProvider,
    candidateDetector: ReplayCandidateDetector,
    aavePoolAddress: string,
    subgraphUrl?: string
  ) {
    if (!config.enabled) {
      throw new Error('ReplayController requires REPLAY_ENABLED=true');
    }
    
    this.config = config;
    this.provider = provider;
    this.stateProvider = new HistoricalStateProvider(provider);
    this.reporter = new Reporter(config.exportDir);
    this.candidateDetector = candidateDetector;
    
    // Initialize event loader if comparison is enabled
    if (config.compareWithOnchain) {
      const loader = new EventGroundTruthLoader(provider, aavePoolAddress, subgraphUrl);
      
      // Preload events (will be done in start())
      this.loadGroundTruth = async () => {
        if (!config.startBlock || !config.endBlock) return;
        this.groundTruthEvents = await loader.load(config.startBlock, config.endBlock);
        
        // Convert to format expected by Comparator
        const allEvents: GroundTruthEvent[] = [];
        for (const [, events] of this.groundTruthEvents.entries()) {
          for (const event of events) {
            allEvents.push({
              user: event.user,
              block: event.blockNumber,
              txHash: event.txHash,
            });
          }
        }
        
        this.comparator = new Comparator(allEvents);
      };
    } else {
      this.loadGroundTruth = async () => {
        // No-op if comparison is disabled
        console.log('[replay] Ground truth comparison disabled');
      };
    }
  }
  
  private loadGroundTruth: () => Promise<void>;
  
  /**
   * Start the replay execution.
   */
  async start(): Promise<void> {
    console.log('[replay] Starting replay controller');
    console.log(`[replay] Mode: ${this.config.mode}`);
    console.log(`[replay] Block range: ${this.config.startBlock} - ${this.config.endBlock}`);
    console.log(`[replay] Speed: ${this.config.speed}`);
    console.log(`[replay] Export dir: ${this.config.exportDir}`);
    
    // Preload ground truth events
    if (this.config.compareWithOnchain) {
      await this.loadGroundTruth();
    }
    
    // Main replay loop
    const startBlock = this.config.startBlock!;
    const endBlock = this.config.endBlock!;
    const blockStep = this.config.blockStep;
    
    for (let block = startBlock; block <= endBlock; block += blockStep) {
      try {
        await this.processBlock(block);
        this.processedBlocks++;
        
        // Sleep between blocks based on speed setting
        const sleepMs = getSleepDuration(this.config);
        if (sleepMs > 0) {
          await sleep(sleepMs);
        }
      } catch (error) {
        this.errorCount++;
        console.error(`[replay] Error processing block ${block}:`, error);
        
        if (this.config.pauseOnError && this.errorCount >= this.config.maxBlockErrors) {
          console.error('[replay] Max block errors exceeded, stopping replay');
          break;
        }
      }
    }
    
    // Write final summary
    this.reporter.writeSummary();
    
    const stats = this.reporter.getStats();
    console.log('[replay] Replay complete');
    console.log(`[replay] Processed ${this.processedBlocks} blocks`);
    console.log(`[replay] Total candidates: ${stats.candidates}`);
    console.log(`[replay] On-chain liquidations: ${stats.onChainLiquidations}`);
    console.log(`[replay] Detected: ${stats.detected}`);
    console.log(`[replay] Missed: ${stats.missed}`);
    console.log(`[replay] False positives: ${stats.falsePositives}`);
    
    if (stats.onChainLiquidations > 0) {
      const coverage = (stats.detected / stats.onChainLiquidations * 100).toFixed(2);
      console.log(`[replay] Coverage ratio: ${coverage}%`);
    }
  }
  
  /**
   * Process a single block.
   */
  private async processBlock(blockNumber: number): Promise<void> {
    const startTime = Date.now();
    
    // Set current block in state provider
    this.stateProvider.setBlock(blockNumber);
    
    // Get block header for metrics
    const header = await this.stateProvider.getBlockHeader(blockNumber);
    
    // Detect candidates using the provided detector
    const candidates = await this.candidateDetector.detectCandidates(blockNumber, this.stateProvider);
    
    // Get ground truth events for this block
    const groundTruthEvents = this.groundTruthEvents?.get(blockNumber) || [];
    
    // Classify candidates
    const missed: string[] = [];
    const falsePositives: string[] = [];
    
    for (const candidate of candidates) {
      // Record detection in comparator
      if (this.comparator) {
        this.comparator.recordDetection(candidate);
        
        // Classify candidate
        const classification = this.comparator.classifyCandidate(candidate);
        
        // Write candidate metrics
        const candidateMetrics: CandidateMetrics = {
          type: 'candidate',
          block: blockNumber,
          user: candidate.user,
          hf: candidate.healthFactor,
          debtUSD: candidate.debtUSD,
          collateralUSD: candidate.collateralUSD,
          profitEstUSD: candidate.profitEstUSD,
          wouldSend: candidate.profitEstUSD > 0, // Simplified logic
          simulation: this.config.mode === 'simulate' ? 'ok' : 'skipped',
          onChainLiquidated: classification.onChainLiquidated,
          classification: classification.classification,
        };
        
        this.reporter.writeCandidate(candidateMetrics);
        
        // Track false positives
        if (classification.classification === 'false-positive') {
          falsePositives.push(candidate.user);
        }
      } else {
        // No comparator, write candidate without classification
        const candidateMetrics: CandidateMetrics = {
          type: 'candidate',
          block: blockNumber,
          user: candidate.user,
          hf: candidate.healthFactor,
          debtUSD: candidate.debtUSD,
          collateralUSD: candidate.collateralUSD,
          profitEstUSD: candidate.profitEstUSD,
          wouldSend: candidate.profitEstUSD > 0,
          simulation: this.config.mode === 'simulate' ? 'ok' : 'skipped',
          onChainLiquidated: false,
          classification: 'false-positive',
        };
        
        this.reporter.writeCandidate(candidateMetrics);
      }
    }
    
    // Check for missed liquidations in this block
    if (this.comparator) {
      for (const event of groundTruthEvents) {
        const detection = this.comparator.checkDetection({
          user: event.user,
          block: event.blockNumber,
          txHash: event.txHash,
        });
        
        if (!detection.detected) {
          missed.push(event.user);
          
          // Write missed liquidation
          if (this.config.logMissed) {
            const missedEntry: MissedLiquidation = {
              type: 'missed',
              block: blockNumber,
              user: event.user,
              txHash: event.txHash,
              reason: 'not-detected',
            };
            this.reporter.writeMissed(missedEntry);
          }
        } else if (detection.leadBlocks !== undefined) {
          // Record lead time
          this.reporter.recordLeadTime(detection.leadBlocks);
        }
      }
    }
    
    // Write block metrics
    const scanLatencyMs = Date.now() - startTime;
    const blockMetrics: BlockMetrics = {
      type: 'block',
      block: blockNumber,
      timestamp: header.timestamp,
      scanLatencyMs,
      candidates: candidates.length,
      onChainLiquidations: groundTruthEvents.length,
      missed,
      falsePositives,
    };
    
    this.reporter.writeBlock(blockMetrics);
    
    // Log progress periodically
    if (blockNumber % 100 === 0) {
      console.log(`[replay] Processed block ${blockNumber} (${candidates.length} candidates, ${groundTruthEvents.length} on-chain liquidations)`);
    }
  }
  
  /**
   * Get current statistics without stopping.
   */
  getStats() {
    return {
      processedBlocks: this.processedBlocks,
      errorCount: this.errorCount,
      ...this.reporter.getStats(),
    };
  }
}
