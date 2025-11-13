/**
 * LiquidationMissClassifier: Advanced miss classification with structured diagnostics
 * 
 * Classifies why liquidations were missed or raced, capturing:
 * - Timing information (blocks since first seen)
 * - Health factor snapshots and transience detection
 * - Guard decisions and execution filters
 * - Profit estimates and gas outbid detection
 * 
 * Integrates with:
 * - RealTimeHFService (firstSeenBlock tracking)
 * - ExecutionService (execution decision recorder)
 * - AssetMetadataCache (profit estimation)
 * - Health factor utilities
 */

import type { ExecutionDecisionsStore } from './executionDecisions.js';
import type { AssetMetadataCache } from '../aave/AssetMetadataCache.js';
import { ProfitEstimator } from './ProfitEstimator.js';

export type MissReason =
  | 'not_in_watch_set'
  | 'raced'
  | 'hf_transient'
  | 'insufficient_profit'
  | 'execution_filtered'
  | 'revert'
  | 'gas_outbid'
  | 'oracle_jitter'
  | 'unknown';

export interface MissClassification {
  reason: MissReason;
  blocksSinceFirstSeen?: number;
  profitEstimateUsd?: number;
  gasPriceGweiAtDecision?: number;
  notes: string[];
}

export interface ClassifierConfig {
  enabled: boolean;
  transientBlocks: number; // Threshold for HF transience detection
  minProfitUsd: number; // Minimum profit threshold
  gasThresholdGwei: number; // Gas price threshold for gas_outbid
  enableProfitCheck: boolean; // Whether to estimate profit
}

/**
 * LiquidationMissClassifier provides advanced miss analysis
 */
export class LiquidationMissClassifier {
  private config: ClassifierConfig;
  private executionDecisions: ExecutionDecisionsStore;
  private profitEstimator: ProfitEstimator | null = null;
  private firstSeenMap = new Map<string, { blockNumber: number; hf: number }>();

  constructor(
    config: ClassifierConfig,
    executionDecisions: ExecutionDecisionsStore,
    assetCache?: AssetMetadataCache
  ) {
    this.config = config;
    this.executionDecisions = executionDecisions;
    
    if (assetCache) {
      this.profitEstimator = new ProfitEstimator(assetCache);
    }
  }

  /**
   * Record when a user is first seen as liquidatable
   * @param user User address
   * @param blockNumber Block number when first seen
   * @param healthFactor Health factor at first seen
   */
  recordFirstSeen(user: string, blockNumber: number, healthFactor: number): void {
    const key = user.toLowerCase();
    
    // Only record if not already tracked or if this is earlier
    if (!this.firstSeenMap.has(key) || this.firstSeenMap.get(key)!.blockNumber > blockNumber) {
      this.firstSeenMap.set(key, { blockNumber, hf: healthFactor });
    }
  }

  /**
   * Clear first seen record for a user (e.g., when they're no longer liquidatable)
   * @param user User address
   */
  clearFirstSeen(user: string): void {
    this.firstSeenMap.delete(user.toLowerCase());
  }

  /**
   * Get first seen info for a user
   * @param user User address
   * @returns First seen info or null
   */
  getFirstSeen(user: string): { blockNumber: number; hf: number } | null {
    return this.firstSeenMap.get(user.toLowerCase()) || null;
  }

  /**
   * Classify a missed liquidation
   * @param user User address
   * @param liquidator Address that executed the liquidation
   * @param eventTimestamp Timestamp when liquidation event was seen (ms)
   * @param eventBlockNumber Block number of liquidation event
   * @param wasInWatchSet Whether user was in our watch set
   * @param debtAsset Debt asset address (optional)
   * @param debtAmount Debt amount in raw units (optional)
   * @param collateralAsset Collateral asset address (optional)
   * @param collateralAmount Collateral amount in raw units (optional)
   * @param liquidationBonusPct Liquidation bonus (optional)
   * @param ourBotAddress Our bot's address (optional)
   * @returns Miss classification
   */
  classify(
    user: string,
    liquidator: string,
    eventTimestamp: number,
    eventBlockNumber: number,
    wasInWatchSet: boolean,
    debtAsset?: string,
    debtAmount?: bigint,
    collateralAsset?: string,
    collateralAmount?: bigint,
    liquidationBonusPct?: number,
    ourBotAddress?: string
  ): MissClassification {
    if (!this.config.enabled) {
      return {
        reason: 'unknown',
        notes: ['Classifier disabled']
      };
    }

    const notes: string[] = [];
    const userLower = user.toLowerCase();

    // Calculate blocks since first seen
    const firstSeen = this.firstSeenMap.get(userLower);
    const blocksSinceFirstSeen = firstSeen 
      ? eventBlockNumber - firstSeen.blockNumber 
      : undefined;

    if (blocksSinceFirstSeen !== undefined) {
      notes.push(`First seen ${blocksSinceFirstSeen} blocks ago (block ${firstSeen!.blockNumber}, HF=${firstSeen!.hf.toFixed(4)})`);
    }

    // Check if liquidator is our bot
    if (ourBotAddress && liquidator.toLowerCase() === ourBotAddress.toLowerCase()) {
      notes.push('Liquidation executed by our bot (not a miss)');
      // Clean up first seen record
      this.clearFirstSeen(user);
      return {
        reason: 'raced', // Actually "ours" but using raced for compatibility
        blocksSinceFirstSeen,
        notes
      };
    }

    // Check if user was not in watch set
    if (!wasInWatchSet) {
      notes.push('User was not in our watch set when liquidation occurred');
      this.clearFirstSeen(user);
      return {
        reason: 'not_in_watch_set',
        blocksSinceFirstSeen,
        notes
      };
    }

    // Find execution decision
    const decision = this.executionDecisions.findDecision(userLower, eventTimestamp);

    if (!decision) {
      notes.push('No execution decision found - likely raced by competitor');
      
      // Check for HF transience
      if (blocksSinceFirstSeen !== undefined && blocksSinceFirstSeen <= this.config.transientBlocks) {
        notes.push(`Liquidatable for only ${blocksSinceFirstSeen} blocks (threshold: ${this.config.transientBlocks})`);
        this.clearFirstSeen(user);
        return {
          reason: 'hf_transient',
          blocksSinceFirstSeen,
          notes
        };
      }

      this.clearFirstSeen(user);
      return {
        reason: 'raced',
        blocksSinceFirstSeen,
        notes
      };
    }

    // We have a decision - classify based on type and reason
    const gasPriceGwei = decision.gasPriceGwei;
    
    if (decision.type === 'revert') {
      notes.push(`Attempt reverted: ${decision.reason || 'unknown'}`);
      if (decision.txHash) {
        notes.push(`TX: ${decision.txHash.substring(0, 10)}...`);
      }
      if (gasPriceGwei) {
        notes.push(`Gas price: ${gasPriceGwei.toFixed(2)} Gwei`);
      }
      
      this.clearFirstSeen(user);
      return {
        reason: 'revert',
        blocksSinceFirstSeen,
        gasPriceGweiAtDecision: gasPriceGwei,
        notes
      };
    }

    if (decision.type === 'skip') {
      const skipReason = decision.reason || 'unknown';
      notes.push(`Execution skipped: ${skipReason}`);
      
      // Map skip reasons to classification reasons
      if (skipReason.includes('gas_price') || skipReason.includes('gas')) {
        // Check if gas price was below threshold
        if (gasPriceGwei && gasPriceGwei < this.config.gasThresholdGwei) {
          notes.push(`Gas price ${gasPriceGwei.toFixed(2)} Gwei < threshold ${this.config.gasThresholdGwei} Gwei`);
          this.clearFirstSeen(user);
          return {
            reason: 'gas_outbid',
            blocksSinceFirstSeen,
            gasPriceGweiAtDecision: gasPriceGwei,
            notes
          };
        }
      }
      
      if (skipReason.includes('profit') || skipReason.includes('unprofitable')) {
        const profitUsd = decision.profitEstimateUsd;
        if (profitUsd !== undefined) {
          notes.push(`Estimated profit: $${profitUsd.toFixed(2)} < threshold $${this.config.minProfitUsd}`);
        }
        
        this.clearFirstSeen(user);
        return {
          reason: 'insufficient_profit',
          blocksSinceFirstSeen,
          profitEstimateUsd: profitUsd,
          gasPriceGweiAtDecision: gasPriceGwei,
          notes
        };
      }
      
      // Other skip reasons are execution_filtered
      notes.push('Filtered by execution guard');
      this.clearFirstSeen(user);
      return {
        reason: 'execution_filtered',
        blocksSinceFirstSeen,
        gasPriceGweiAtDecision: gasPriceGwei,
        notes
      };
    }

    if (decision.type === 'attempt') {
      notes.push('We attempted liquidation but were raced');
      if (decision.txHash) {
        notes.push(`TX: ${decision.txHash.substring(0, 10)}...`);
      }
      if (gasPriceGwei) {
        notes.push(`Gas price: ${gasPriceGwei.toFixed(2)} Gwei`);
        
        // Check if we were outbid on gas
        if (gasPriceGwei < this.config.gasThresholdGwei) {
          notes.push(`Possibly gas outbid (${gasPriceGwei.toFixed(2)} < ${this.config.gasThresholdGwei} Gwei)`);
          this.clearFirstSeen(user);
          return {
            reason: 'gas_outbid',
            blocksSinceFirstSeen,
            gasPriceGweiAtDecision: gasPriceGwei,
            notes
          };
        }
      }
      
      this.clearFirstSeen(user);
      return {
        reason: 'raced',
        blocksSinceFirstSeen,
        gasPriceGweiAtDecision: gasPriceGwei,
        notes
      };
    }

    // Unknown decision type
    this.clearFirstSeen(user);
    return {
      reason: 'unknown',
      blocksSinceFirstSeen,
      notes: ['Unknown decision type', ...notes]
    };
  }

  /**
   * Estimate profit for a liquidation (if profit estimation is enabled)
   * @returns Profit estimate or null
   */
  async estimateProfit(
    debtAsset: string,
    debtAmount: bigint,
    collateralAsset: string,
    collateralAmount: bigint,
    liquidationBonusPct: number
  ): Promise<number | null> {
    if (!this.config.enableProfitCheck || !this.profitEstimator) {
      return null;
    }

    const estimate = await this.profitEstimator.estimateProfit(
      debtAsset,
      debtAmount,
      collateralAsset,
      collateralAmount,
      liquidationBonusPct
    );

    return estimate?.grossProfitUsd || null;
  }

  /**
   * Clean up expired first seen records (called periodically)
   * @param currentBlockNumber Current block number
   * @param maxBlockAge Maximum age in blocks to keep records
   */
  cleanup(currentBlockNumber: number, maxBlockAge = 1000): void {
    const cutoff = currentBlockNumber - maxBlockAge;
    
    for (const [user, info] of this.firstSeenMap.entries()) {
      if (info.blockNumber < cutoff) {
        this.firstSeenMap.delete(user);
      }
    }
  }

  /**
   * Get current size of first seen map
   */
  getFirstSeenCount(): number {
    return this.firstSeenMap.size;
  }
}
