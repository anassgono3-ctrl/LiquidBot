/**
 * ReplayController - Main orchestrator for historical replay execution
 * 
 * Iterates block-by-block over the specified range, running the liquidation
 * detection pipeline with historical state at each block. Produces comprehensive
 * JSONL artifacts for analysis.
 */

import { ethers } from 'ethers';
import { config } from '../config/index.js';
import { ReplayContext } from './ReplayContext.js';
import { GroundTruthIndexer } from './GroundTruthIndexer.js';
import { UniverseBuilder } from './UniverseBuilder.js';
import { AccountFetcher } from './AccountFetcher.js';
import { Reporter, type BlockRow } from './Reporter.js';
import { LiquidationSimulator } from './LiquidationSimulator.js';

export interface ReplayConfig {
  startBlock: number;
  endBlock: number;
  rpcUrl: string;
  aavePoolAddress: string;
  multicall3Address: string;
  outputDir: string;
  nearHf: number;
  evictHf: number;
  evictConsecutive: number;
  maxAccountsPerBlock: number;
  simulateFirstDetection: boolean;
  simulateLiquidationBlock: boolean;
  executionHfThreshold: number;
  minProfitUSD: number;
  batchSize: number;
}

export class ReplayController {
  private provider: ethers.JsonRpcProvider;
  private context: ReplayContext;
  private groundTruthIndexer: GroundTruthIndexer;
  private universeBuilder: UniverseBuilder;
  private accountFetcher: AccountFetcher;
  private reporter: Reporter;
  private simulator: LiquidationSimulator;
  private blockTimestamps: Map<number, number>;
  
  constructor(private readonly replayConfig: ReplayConfig) {
    // Initialize provider
    this.provider = new ethers.JsonRpcProvider(replayConfig.rpcUrl);
    
    // Initialize context
    this.context = new ReplayContext(
      replayConfig.nearHf,
      replayConfig.evictHf,
      replayConfig.evictConsecutive
    );
    
    // Initialize indexer
    this.groundTruthIndexer = new GroundTruthIndexer(
      this.provider,
      replayConfig.aavePoolAddress
    );
    
    // Initialize universe builder
    this.universeBuilder = new UniverseBuilder({
      nearHf: replayConfig.nearHf,
      evictHf: replayConfig.evictHf,
      evictConsecutive: replayConfig.evictConsecutive,
      maxAccountsPerBlock: replayConfig.maxAccountsPerBlock
    });
    
    // Initialize account fetcher
    this.accountFetcher = new AccountFetcher(
      this.provider,
      replayConfig.multicall3Address,
      replayConfig.aavePoolAddress,
      replayConfig.batchSize
    );
    
    // Initialize reporter
    this.reporter = new Reporter(
      replayConfig.outputDir,
      replayConfig.startBlock,
      replayConfig.endBlock
    );
    
    // Initialize simulator
    this.simulator = new LiquidationSimulator(
      this.provider,
      replayConfig.aavePoolAddress
    );
    
    this.blockTimestamps = new Map();
  }
  
  /**
   * Execute full replay pipeline
   */
  async execute(): Promise<void> {
    const startTime = Date.now();
    
    console.log('=== REPLAY PIPELINE START ===');
    console.log(`Block Range: ${this.replayConfig.startBlock} - ${this.replayConfig.endBlock}`);
    console.log(`Output Dir: ${this.replayConfig.outputDir}`);
    console.log(`RPC: ${this.replayConfig.rpcUrl}`);
    console.log('');
    
    // Step 1: Index ground truth events
    console.log('[1/4] Indexing ground truth liquidation events...');
    const groundTruthCount = await this.groundTruthIndexer.indexIntoContext(
      this.context,
      this.replayConfig.startBlock,
      this.replayConfig.endBlock
    );
    console.log(`Found ${groundTruthCount} ground truth liquidations\n`);
    
    // Step 2: Initialize universe
    console.log('[2/4] Initializing candidate universe...');
    this.universeBuilder.initializeFromGroundTruth(this.context);
    const stats = this.universeBuilder.getStats(this.context);
    console.log(`Initial universe: ${stats.totalActive} users\n`);
    
    // Step 3: Block-by-block replay
    console.log('[3/4] Executing block-by-block replay...');
    await this.replayBlocks();
    console.log('');
    
    // Step 4: Generate artifacts
    console.log('[4/4] Generating replay artifacts...');
    
    // Generate candidate rows
    this.reporter.generateCandidates(
      this.context,
      this.blockTimestamps,
      this.replayConfig.executionHfThreshold,
      this.replayConfig.minProfitUSD
    );
    
    // Write all artifacts
    const durationMs = Date.now() - startTime;
    await this.reporter.writeArtifacts(this.context, durationMs);
    
    console.log('=== REPLAY PIPELINE COMPLETE ===\n');
  }
  
  /**
   * Replay blocks in the specified range
   */
  private async replayBlocks(): Promise<void> {
    const totalBlocks = this.replayConfig.endBlock - this.replayConfig.startBlock + 1;
    let processedBlocks = 0;
    
    for (
      let block = this.replayConfig.startBlock;
      block <= this.replayConfig.endBlock;
      block++
    ) {
      const blockStart = Date.now();
      
      // Get block header for timestamp
      let timestamp = 0;
      try {
        const blockHeader = await this.provider.getBlock(block);
        if (blockHeader) {
          timestamp = blockHeader.timestamp;
          this.blockTimestamps.set(block, timestamp);
        }
      } catch (err) {
        console.warn(`[replay] Failed to get block ${block} header:`, err);
      }
      
      // Get active users for this block
      const activeUsers = Array.from(this.context.getActiveUsers());
      
      if (activeUsers.length === 0) {
        // No users to check
        processedBlocks++;
        if (processedBlocks % 100 === 0) {
          console.log(`Progress: ${processedBlocks}/${totalBlocks} blocks (${Math.round(processedBlocks / totalBlocks * 100)}%)`);
        }
        continue;
      }
      
      // Fetch account data at this block
      let accountData: Map<string, import('./AccountFetcher.js').AccountData>;
      try {
        accountData = await this.accountFetcher.fetchAccounts(activeUsers, block);
      } catch (err) {
        console.error(`[replay] Failed to fetch accounts at block ${block}:`, err);
        processedBlocks++;
        continue;
      }
      
      // Update universe based on health factors
      const userHealthStates = new Map(
        Array.from(accountData.entries()).map(([user, data]) => [
          user,
          {
            hf: data.hf,
            debtUSD: data.debtUSD,
            collateralUSD: data.collateralUSD
          }
        ])
      );
      
      this.universeBuilder.updateUniverse(this.context, block, userHealthStates);
      
      // Detect liquidatable users
      const liquidatable = this.accountFetcher.getLiquidatable(accountData);
      let newDetections = 0;
      
      for (const [user, data] of liquidatable) {
        // Check if this is first detection
        const existing = this.context.getDetectionState(user);
        if (!existing) {
          // Record first detection
          this.context.recordFirstDetection(
            user,
            block,
            data.hf,
            data.debtUSD,
            data.collateralUSD
          );
          newDetections++;
          
          // Simulate if enabled
          if (this.replayConfig.simulateFirstDetection) {
            // For simplicity, assume simulation succeeds
            // In production, would call simulator.simulate()
            this.context.updateSimulation(user, 'skipped', '', null);
          }
        }
      }
      
      // Check for liquidation events at this block
      const eventsAtBlock = this.context.getGroundTruthUsers().filter(user => {
        const event = this.context.getLiquidationEvent(user);
        return event && event.block === block;
      });
      
      // Record block metrics
      const scanLatencyMs = Date.now() - blockStart;
      const blockRow: BlockRow = {
        type: 'block',
        block,
        timestamp,
        scanLatencyMs,
        candidates: activeUsers.length,
        newDetections,
        onChainLiquidations: eventsAtBlock.length,
        missed: 0, // Computed at end
        detected: 0, // Computed at end
        falsePositives: 0 // Computed at end
      };
      
      this.reporter.addBlockRow(blockRow);
      this.context.recordBlockMetrics(
        block,
        activeUsers.length,
        newDetections,
        eventsAtBlock.length,
        scanLatencyMs
      );
      
      processedBlocks++;
      
      // Progress reporting
      if (processedBlocks % 100 === 0 || processedBlocks === totalBlocks) {
        const pct = Math.round(processedBlocks / totalBlocks * 100);
        const stats = this.universeBuilder.getStats(this.context);
        console.log(
          `Progress: ${processedBlocks}/${totalBlocks} blocks (${pct}%) | ` +
          `Active: ${stats.totalActive} users | Detected: ${stats.detectedUsers} | ` +
          `Avg latency: ${scanLatencyMs.toFixed(0)}ms`
        );
      }
    }
  }
}

/**
 * Parse block range from string (e.g., "38393176-38395221")
 */
export function parseBlockRange(range: string): { startBlock: number; endBlock: number } {
  const parts = range.split('-');
  if (parts.length !== 2) {
    throw new Error(`Invalid block range format: ${range}. Expected format: START-END`);
  }
  
  const startBlock = parseInt(parts[0].trim(), 10);
  const endBlock = parseInt(parts[1].trim(), 10);
  
  if (isNaN(startBlock) || isNaN(endBlock)) {
    throw new Error(`Invalid block numbers in range: ${range}`);
  }
  
  if (startBlock > endBlock) {
    throw new Error(`Start block (${startBlock}) must be <= end block (${endBlock})`);
  }
  
  return { startBlock, endBlock };
}

/**
 * Create ReplayConfig from environment
 */
export function createReplayConfigFromEnv(): ReplayConfig {
  const { startBlock, endBlock } = parseBlockRange(config.replayBlockRange);
  
  return {
    startBlock,
    endBlock,
    rpcUrl: config.rpcUrl || '',
    aavePoolAddress: config.aavePool,
    multicall3Address: config.multicall3Address,
    outputDir: config.replayOutputDir,
    nearHf: config.replayNearHf,
    evictHf: config.replayEvictHf,
    evictConsecutive: config.replayEvictConsecutive,
    maxAccountsPerBlock: config.replayMaxAccountsPerBlock,
    simulateFirstDetection: config.replaySimulateFirstDetection,
    simulateLiquidationBlock: config.replaySimulateLiquidationBlock,
    executionHfThreshold: config.executionHfThresholdBps,
    minProfitUSD: config.profitMinUsd,
    batchSize: config.multicallBatchSize
  };
}
