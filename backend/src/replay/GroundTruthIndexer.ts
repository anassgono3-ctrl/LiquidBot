/**
 * GroundTruthIndexer - Scans blockchain for LiquidationCall events
 * 
 * Builds a comprehensive index of all liquidation events within a block range
 * to establish ground truth for replay classification.
 */

import { ethers } from 'ethers';
import type { ReplayContext } from './ReplayContext.js';

const LIQUIDATION_CALL_EVENT = 'event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)';

export interface GroundTruthEvent {
  user: string;
  block: number;
  txHash: string;
  collateralAsset: string;
  debtAsset: string;
  debtToCover: bigint;
  liquidatedCollateralAmount: bigint;
  liquidator: string;
  receiveAToken: boolean;
}

export class GroundTruthIndexer {
  private readonly liquidationInterface: ethers.Interface;
  
  constructor(
    private readonly provider: ethers.JsonRpcProvider,
    private readonly aavePoolAddress: string
  ) {
    this.liquidationInterface = new ethers.Interface([LIQUIDATION_CALL_EVENT]);
  }
  
  /**
   * Scan block range for LiquidationCall events
   */
  async scanRange(
    startBlock: number,
    endBlock: number,
    onProgress?: (current: number, total: number) => void
  ): Promise<GroundTruthEvent[]> {
    const events: GroundTruthEvent[] = [];
    const chunkSize = 2000; // Safe chunk size for most RPC providers
    const totalBlocks = endBlock - startBlock + 1;
    let processed = 0;
    
    console.log(`[ground-truth] Scanning ${totalBlocks} blocks for liquidation events...`);
    
    for (let fromBlock = startBlock; fromBlock <= endBlock; fromBlock += chunkSize) {
      const toBlock = Math.min(fromBlock + chunkSize - 1, endBlock);
      
      try {
        const filter = {
          address: this.aavePoolAddress,
          topics: [this.liquidationInterface.getEvent('LiquidationCall')!.topicHash],
          fromBlock,
          toBlock
        };
        
        const logs = await this.provider.getLogs(filter);
        
        for (const log of logs) {
          try {
            const parsed = this.liquidationInterface.parseLog({
              topics: log.topics as string[],
              data: log.data
            });
            
            if (parsed) {
              events.push({
                user: (parsed.args.user as string).toLowerCase(),
                block: log.blockNumber,
                txHash: log.transactionHash,
                collateralAsset: (parsed.args.collateralAsset as string).toLowerCase(),
                debtAsset: (parsed.args.debtAsset as string).toLowerCase(),
                debtToCover: parsed.args.debtToCover as bigint,
                liquidatedCollateralAmount: parsed.args.liquidatedCollateralAmount as bigint,
                liquidator: (parsed.args.liquidator as string).toLowerCase(),
                receiveAToken: parsed.args.receiveAToken as boolean
              });
            }
          } catch (parseErr) {
            console.warn(`[ground-truth] Failed to parse log at block ${log.blockNumber}:`, parseErr);
          }
        }
        
        processed += (toBlock - fromBlock + 1);
        if (onProgress) {
          onProgress(processed, totalBlocks);
        }
      } catch (err) {
        console.error(`[ground-truth] Failed to fetch logs for blocks ${fromBlock}-${toBlock}:`, err);
        throw err;
      }
    }
    
    console.log(`[ground-truth] Found ${events.length} liquidation events`);
    return events;
  }
  
  /**
   * Index ground truth events into ReplayContext
   */
  async indexIntoContext(
    context: ReplayContext,
    startBlock: number,
    endBlock: number
  ): Promise<number> {
    const events = await this.scanRange(startBlock, endBlock, (current, total) => {
      if (current % 10000 === 0 || current === total) {
        console.log(`[ground-truth] Progress: ${current}/${total} blocks (${Math.round(current / total * 100)}%)`);
      }
    });
    
    // Record events in context
    for (const event of events) {
      context.recordLiquidationEvent(
        event.user,
        event.block,
        event.txHash,
        event.debtAsset,
        event.collateralAsset,
        event.debtToCover,
        event.liquidatedCollateralAmount,
        event.liquidator
      );
      
      // Also add to active universe to ensure coverage
      context.addUser(event.user);
    }
    
    return events.length;
  }
  
  /**
   * Get unique liquidated users from events
   */
  static getUniqueUsers(events: GroundTruthEvent[]): Set<string> {
    return new Set(events.map(e => e.user));
  }
  
  /**
   * Group events by block
   */
  static groupByBlock(events: GroundTruthEvent[]): Map<number, GroundTruthEvent[]> {
    const grouped = new Map<number, GroundTruthEvent[]>();
    
    for (const event of events) {
      const existing = grouped.get(event.block) || [];
      existing.push(event);
      grouped.set(event.block, existing);
    }
    
    return grouped;
  }
}
