/**
 * ReplayService: Orchestrates historical replay mode
 * Replays historical events to measure detection latency and configuration impact
 */

import { JsonRpcProvider } from 'ethers';
import { createLogger, format, transports } from 'winston';
import { createClient as createRedisClient, RedisClientType } from 'redis';

import { config } from '../config/index.js';
import { HistoricalEventFetcher } from './HistoricalEventFetcher.js';
import { ReplayMetricsCollector } from './ReplayMetricsCollector.js';
import { ReplayOutputWriter } from './ReplayOutputWriter.js';
import type { ReplayConfig, BlockMetrics, HistoricalEvent } from './types.js';
import { CandidateManager } from '../services/CandidateManager.js';
import { HotSetTracker } from '../services/HotSetTracker.js';
import { PrecomputeService } from '../services/PrecomputeService.js';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

export class ReplayService {
  private replayConfig: ReplayConfig;
  private eventFetcher: HistoricalEventFetcher;
  private metricsCollector: ReplayMetricsCollector;
  private outputWriter: ReplayOutputWriter;
  private redisClient: RedisClientType | null = null;

  // Replay state
  private provider: JsonRpcProvider;
  private candidateManager: CandidateManager | null = null;
  private hotSetTracker: HotSetTracker | null = null;
  private precomputeService: PrecomputeService | null = null;

  // User HF tracking for detection
  private userHealthFactors: Map<string, number> = new Map();

  constructor(replayConfig: ReplayConfig) {
    this.replayConfig = replayConfig;

    // Initialize provider
    this.provider = new JsonRpcProvider(replayConfig.rpcUrl);

    // Initialize event fetcher
    this.eventFetcher = new HistoricalEventFetcher({
      rpcUrl: replayConfig.rpcUrl,
      aavePoolAddress: config.aavePoolAddress
    });

    // Initialize metrics collector with config snapshot
    const configSnapshot = {
      hotlistMinHf: config.hotlistMinHf,
      hotlistMaxHf: config.hotlistMaxHf,
      hotlistMinDebtUsd: config.hotlistMinDebtUsd,
      minDebtUsd: config.minDebtUsd,
      profitMinUsd: config.profitMinUsd,
      fastSubsetEnabled: config.microVerifyEnabled,
      predictorEnabled: config.predictiveEnabled,
      microVerifyEnabled: config.microVerifyEnabled
    };
    this.metricsCollector = new ReplayMetricsCollector(configSnapshot);

    // Initialize output writer
    const outputDir = '/tmp/replay-output';
    this.outputWriter = new ReplayOutputWriter({
      outputDir,
      startBlock: replayConfig.startBlock,
      endBlock: replayConfig.endBlock
    });

    logger.info(`[replay] Initialized for blocks ${replayConfig.startBlock}-${replayConfig.endBlock}`);
  }

  /**
   * Initialize Redis with replay: prefix namespace
   */
  private async initializeRedis(): Promise<void> {
    if (config.redisUrl) {
      this.redisClient = createRedisClient({
        url: config.redisUrl,
        socket: {
          connectTimeout: 5000
        }
      }) as RedisClientType;

      await this.redisClient.connect();
      logger.info('[replay] Redis connected with replay: namespace');
    } else {
      logger.warn('[replay] Redis not configured, skipping');
    }
  }

  /**
   * Initialize replay modules (read-only mode)
   */
  private async initializeModules(): Promise<void> {
    // Initialize CandidateManager in read-only mode
    this.candidateManager = new CandidateManager({
      maxCandidates: config.candidateMax
    });
    
    // Initialize HotSetTracker if enabled
    if (config.hotlistEnabled) {
      this.hotSetTracker = new HotSetTracker({
        hotSetHfMax: config.hotSetHfMax,
        warmSetHfMax: config.warmSetHfMax,
        maxHotSize: config.maxHotSize,
        maxWarmSize: config.maxWarmSize
      });
      logger.info('[replay] HotSetTracker initialized');
    }

    // Initialize PrecomputeService if enabled
    if (config.precomputeEnabled) {
      this.precomputeService = new PrecomputeService({
        topK: config.precomputeTopK,
        enabled: config.precomputeEnabled,
        closeFactorPct: 50 // Default close factor
      });
      logger.info('[replay] PrecomputeService initialized');
    }
  }

  /**
   * Run the replay
   */
  async run(): Promise<void> {
    logger.info('[replay] Starting historical replay...');

    try {
      // Initialize
      await this.initializeRedis();
      await this.initializeModules();
      this.outputWriter.initBlockLog();

      // Fetch all events
      const events = await this.eventFetcher.fetchEventsInRange(
        this.replayConfig.startBlock,
        this.replayConfig.endBlock
      );

      // Populate timestamps
      await this.eventFetcher.populateTimestamps(events);

      // Process events block by block
      await this.processEvents(events);

      // Write summary
      const summary = this.metricsCollector.generateSummary(
        this.replayConfig.startBlock,
        this.replayConfig.endBlock
      );
      await this.outputWriter.writeSummary(summary);

      // Optionally write detection CSV
      const detections = this.metricsCollector.getDetections();
      await this.outputWriter.writeDetectionCSV(detections);

      logger.info('[replay] Replay completed successfully');
      logger.info(`[replay] Detection coverage: ${summary.detectionCoveragePct.toFixed(2)}%`);
      logger.info(`[replay] Median detection lag: ${summary.medianDetectionLag || 'N/A'} blocks`);
      logger.info(`[replay] Liquidation events: ${summary.totalLiquidationEvents}`);

    } catch (error) {
      logger.error('[replay] Replay failed:', error);
      throw error;
    } finally {
      // Cleanup
      await this.cleanup();
    }
  }

  /**
   * Process events block by block
   */
  private async processEvents(events: HistoricalEvent[]): Promise<void> {
    // Group events by block
    const eventsByBlock = new Map<number, HistoricalEvent[]>();
    for (const event of events) {
      if (!eventsByBlock.has(event.blockNumber)) {
        eventsByBlock.set(event.blockNumber, []);
      }
      eventsByBlock.get(event.blockNumber)!.push(event);
    }

    // Sort block numbers
    const blockNumbers = Array.from(eventsByBlock.keys()).sort((a, b) => a - b);

    logger.info(`[replay] Processing ${blockNumbers.length} blocks with events`);

    for (const blockNumber of blockNumbers) {
      const blockEvents = eventsByBlock.get(blockNumber)!;
      await this.processBlock(blockNumber, blockEvents);
    }
  }

  /**
   * Process a single block
   */
  private async processBlock(blockNumber: number, blockEvents: HistoricalEvent[]): Promise<void> {
    const startTime = Date.now();
    
    // Extract user addresses affected by this block
    const affectedUsers = new Set<string>();
    const liquidationCalls: Array<{ user: string; debtAsset: string; collateralAsset: string; debtToCover: string }> = [];
    
    for (const event of blockEvents) {
      // Extract user from event
      const user = this.extractUserFromEvent(event);
      if (user) {
        affectedUsers.add(user.toLowerCase());
      }

      // Track liquidation calls
      if (event.name === 'LiquidationCall') {
        const user = event.args.user?.toLowerCase() || '';
        liquidationCalls.push({
          user,
          debtAsset: event.args.debtAsset?.toLowerCase() || '',
          collateralAsset: event.args.collateralAsset?.toLowerCase() || '',
          debtToCover: event.args.debtToCover?.toString() || '0'
        });

        // Record liquidation for metrics
        this.metricsCollector.recordLiquidationCall(user, blockNumber);
      }
    }

    // Simulate health factor checks for affected users
    const newHFEntrants: string[] = [];
    let minHF: number | null = null;

    for (const userAddr of affectedUsers) {
      // In a real implementation, this would call getUserAccountData
      // For now, we simulate detection logic
      const hf = await this.simulateHealthFactorCheck(userAddr, blockNumber);
      
      if (hf !== null) {
        this.userHealthFactors.set(userAddr, hf);
        
        if (hf < 1.0) {
          // User is liquidatable
          this.metricsCollector.recordFirstDetection(userAddr, blockNumber);
          newHFEntrants.push(userAddr);
        }

        // Track min HF
        if (minHF === null || hf < minHF) {
          minHF = hf;
        }
      }
    }

    // Build block metrics
    const blockMetric: BlockMetrics = {
      block: blockNumber,
      timestamp: blockEvents[0]?.timestamp || 0,
      candidateCount: affectedUsers.size,
      hotsetCount: this.hotSetTracker ? 0 : 0, // Would query HotSetTracker
      nearThresholdCount: newHFEntrants.length,
      fastSubsetSize: 0, // Would track fast subset size
      predictorTriggers: 0, // Would track predictor triggers
      newHFEntrants,
      liquidationCalls,
      minHF,
      durationMs: Date.now() - startTime
    };

    // Write block metric
    this.metricsCollector.recordBlockMetrics(blockMetric);
    this.outputWriter.writeBlockMetric(blockMetric);

    // Log progress periodically
    if (blockNumber % 100 === 0) {
      logger.info(`[replay] Processed block ${blockNumber}`);
    }
  }

  /**
   * Extract user address from event
   */
  private extractUserFromEvent(event: HistoricalEvent): string | null {
    const eventName = event.name;
    
    if (eventName === 'Borrow' || eventName === 'Supply') {
      return event.args.onBehalfOf || event.args.user || null;
    } else if (eventName === 'Repay') {
      return event.args.user || null;
    } else if (eventName === 'Withdraw') {
      return event.args.user || null;
    } else if (eventName === 'LiquidationCall') {
      return event.args.user || null;
    }
    
    return null;
  }

  /**
   * Simulate health factor check (placeholder)
   * In a real implementation, this would call getUserAccountData from the contract
   */
  private async simulateHealthFactorCheck(userAddr: string, blockNumber: number): Promise<number | null> {
    // This is a placeholder. In a real implementation:
    // 1. Use eth_call with blockNumber override to getUserAccountData
    // 2. Parse the health factor
    // 3. Return the HF value
    
    // For now, return null to indicate we can't determine HF without proper implementation
    // The actual implementation would need to integrate with the Aave Pool contract
    return null;
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    await this.outputWriter.closeBlockLog();
    
    if (this.redisClient) {
      await this.redisClient.quit();
      logger.info('[replay] Redis disconnected');
    }
  }
}
