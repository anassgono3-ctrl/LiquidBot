/**
 * ReplayRunner: Core historical replay loop
 */

import { ethers } from 'ethers';

import { config } from '../config/index.js';

import { fetchLiquidationEvents, enrichLiquidationEvents } from './groundTruth.js';
import { ReplayRangeParser } from './ReplayRangeParser.js';
import { writeLiquidationsCSV, writeSummaryJSON, generateSummary, printSummaryTable } from './report.js';
import type { ReplayBlockRange, LiquidationEvent, UserReplayState, LiquidationAnalysis, MissReason } from './types.js';

const AAVE_POOL_ABI = [
  'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
];

export class ReplayRunner {
  private provider: ethers.JsonRpcProvider;
  private poolAddress: string;
  private oracleAddress: string;
  private range: ReplayBlockRange;
  private userStates: Map<string, UserReplayState> = new Map();
  private candidateSetByBlock: Map<number, Set<string>> = new Map();

  constructor(
    provider: ethers.JsonRpcProvider,
    poolAddress: string,
    oracleAddress: string,
    range: ReplayBlockRange
  ) {
    this.provider = provider;
    this.poolAddress = poolAddress;
    this.oracleAddress = oracleAddress;
    this.range = range;
  }

  /**
   * Run the full replay analysis
   */
  async run(): Promise<void> {
    console.log(`[replay] Starting replay for blocks ${this.range.start} to ${this.range.end}`);
    console.log(`[replay] Total blocks to process: ${ReplayRangeParser.getBlockCount(this.range)}`);

    // Step 1: Fetch ground truth liquidation events
    const events = await fetchLiquidationEvents(this.provider, this.poolAddress, this.range);

    if (events.length === 0) {
      console.log('[replay] No liquidation events found in range. Writing empty results.');
      writeLiquidationsCSV([]);
      const summary = generateSummary([]);
      writeSummaryJSON(summary);
      printSummaryTable(summary, []);
      return;
    }

    // Step 2: Enrich with USD values
    const enrichedEvents = await enrichLiquidationEvents(this.provider, this.oracleAddress, events);

    // Step 3: Initialize user states
    const uniqueUsers = new Set(enrichedEvents.map(e => e.user));
    for (const user of uniqueUsers) {
      this.userStates.set(user, {
        user,
        firstLiquidatableBlock: null,
        earliestWouldExecuteBlock: null,
        everInCandidateSet: false
      });
    }

    // Step 4: Sequential block-by-block replay
    await this.replayBlocks();

    // Step 5: Generate analyses
    const analyses = this.generateAnalyses(enrichedEvents);

    // Step 6: Write outputs
    writeLiquidationsCSV(analyses);
    const summary = generateSummary(analyses);
    writeSummaryJSON(summary);
    printSummaryTable(summary, analyses);

    console.log('[replay] Replay complete!');
  }

  /**
   * Replay blocks sequentially
   */
  private async replayBlocks(): Promise<void> {
    const totalBlocks = ReplayRangeParser.getBlockCount(this.range);
    let processed = 0;

    console.log(`[replay] Processing ${totalBlocks} blocks...`);

    for (let block = this.range.start; block <= this.range.end; block++) {
      await this.processBlock(block);

      processed++;
      if (processed % 100 === 0 || processed === totalBlocks) {
        const pct = ((processed / totalBlocks) * 100).toFixed(1);
        console.log(`[replay] Progress: ${processed}/${totalBlocks} blocks (${pct}%)`);
      }
    }
  }

  /**
   * Process a single block: check HF for all tracked users
   */
  private async processBlock(blockNumber: number): Promise<void> {
    const pool = new ethers.Contract(this.poolAddress, AAVE_POOL_ABI, this.provider);
    const candidatesThisBlock = new Set<string>();

    // For simplicity, we check all users we're tracking
    // In a real implementation, you'd use candidate generation logic
    const usersToCheck = Array.from(this.userStates.keys()).sort(); // Sort for determinism

    for (const user of usersToCheck) {
      try {
        const accountData = await pool.getUserAccountData(user, { blockTag: blockNumber });
        const hf = Number(accountData.healthFactor) / 1e18;
        const totalDebtBase = Number(accountData.totalDebtBase);
        const debtUSD = totalDebtBase / 1e8; // Assuming base is USD with 8 decimals

        candidatesThisBlock.add(user);

        const state = this.userStates.get(user)!;
        state.everInCandidateSet = true;

        // Check if liquidatable (HF < 1.0)
        if (hf < 1.0 && state.firstLiquidatableBlock === null) {
          state.firstLiquidatableBlock = blockNumber;
        }

        // Check if would execute (HF < 1.0 AND passes MIN_DEBT_USD filter)
        if (hf < 1.0 && debtUSD >= config.minDebtUsd) {
          if (state.earliestWouldExecuteBlock === null) {
            // Simplified profit check - in real implementation, do full simulation
            const wouldExecute = await this.simulateLiquidation(user, blockNumber, debtUSD);
            if (wouldExecute) {
              state.earliestWouldExecuteBlock = blockNumber;
            }
          }
        }
      } catch (error) {
        // Likely user doesn't exist at this block yet, skip silently
      }
    }

    this.candidateSetByBlock.set(blockNumber, candidatesThisBlock);
  }

  /**
   * Simulate liquidation execution (simplified)
   * In full implementation, this would build calldata and do eth_call
   */
  private async simulateLiquidation(user: string, blockNumber: number, debtUSD: number): Promise<boolean> {
    // Simplified: assume liquidation succeeds if HF < 1.0 and debt meets minimum
    // Real implementation would:
    // 1. Build liquidation calldata using existing builder
    // 2. Perform eth_call at blockNumber
    // 3. Estimate gas from block header (baseFee + 1 gwei priority)
    // 4. Check profit filter

    // For now, we'll use a heuristic: if debt is high enough, assume it would execute
    const minProfitAfterGasUsd = config.minProfitAfterGasUsd || 10;
    const estimatedProfit = debtUSD * 0.05; // Rough 5% liquidation bonus
    const gasCostUsd = config.gasCostUsd || 0.5;

    return estimatedProfit - gasCostUsd >= minProfitAfterGasUsd;
  }

  /**
   * Generate analyses for each liquidation event
   */
  private generateAnalyses(events: Array<LiquidationEvent & { debtUSD: number; seizedUSD: number }>): LiquidationAnalysis[] {
    return events.map(event => {
      const state = this.userStates.get(event.user);

      if (!state) {
        // User not tracked - shouldn't happen but handle gracefully
        return {
          user: event.user,
          txHash: event.txHash,
          txBlock: event.txBlock,
          seizedUSD: event.seizedUSD,
          debtUSD: event.debtUSD,
          firstLiquidatableBlock: null,
          earliestWouldExecuteBlock: null,
          detectionLag: null,
          executionLag: null,
          missReason: 'unknown' as MissReason
        };
      }

      const detectionLag = state.firstLiquidatableBlock !== null 
        ? event.txBlock - state.firstLiquidatableBlock 
        : null;

      const executionLag = state.earliestWouldExecuteBlock !== null 
        ? event.txBlock - state.earliestWouldExecuteBlock 
        : null;

      // Classify miss reason
      let missReason: MissReason = 'unknown';

      if (state.earliestWouldExecuteBlock !== null && state.earliestWouldExecuteBlock <= event.txBlock) {
        missReason = 'success';
      } else if (!state.everInCandidateSet) {
        missReason = 'watch_set_gap';
      } else if (event.debtUSD < config.minDebtUsd) {
        missReason = 'below_min_debt';
      } else if (state.firstLiquidatableBlock !== null) {
        // Was detected but didn't pass execution filters
        missReason = 'profit_filter';
      }

      return {
        user: event.user,
        txHash: event.txHash,
        txBlock: event.txBlock,
        seizedUSD: event.seizedUSD,
        debtUSD: event.debtUSD,
        firstLiquidatableBlock: state.firstLiquidatableBlock,
        earliestWouldExecuteBlock: state.earliestWouldExecuteBlock,
        detectionLag,
        executionLag,
        missReason
      };
    });
  }
}
