// EventGroundTruthLoader: Fetch and index historical liquidation events for comparison
import { JsonRpcProvider } from 'ethers';
import { gql, GraphQLClient } from 'graphql-request';

export interface LiquidationEvent {
  id: string;
  blockNumber: number;
  txHash: string;
  user: string;
  liquidator: string;
  collateralAsset: string;
  debtAsset: string;
  collateralAmount: string;
  debtAmount: string;
  timestamp: number;
}

/**
 * EventGroundTruthLoader fetches all liquidation events in a block range
 * and indexes them by block number for efficient comparison during replay.
 */
export class EventGroundTruthLoader {
  private provider: JsonRpcProvider;
  private subgraphUrl?: string;
  private aavePoolAddress: string;
  
  constructor(
    provider: JsonRpcProvider,
    aavePoolAddress: string,
    subgraphUrl?: string
  ) {
    this.provider = provider;
    this.aavePoolAddress = aavePoolAddress;
    this.subgraphUrl = subgraphUrl;
  }
  
  /**
   * Load liquidation events from subgraph (preferred method if available)
   */
  private async loadFromSubgraph(
    startBlock: number,
    endBlock: number
  ): Promise<LiquidationEvent[]> {
    if (!this.subgraphUrl) {
      throw new Error('Subgraph URL not configured');
    }
    
    const client = new GraphQLClient(this.subgraphUrl);
    const events: LiquidationEvent[] = [];
    let skip = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const query = gql`
        query GetLiquidations($startBlock: Int!, $endBlock: Int!, $skip: Int!, $first: Int!) {
          liquidationCalls(
            where: { 
              blockNumber_gte: $startBlock, 
              blockNumber_lte: $endBlock 
            }
            orderBy: blockNumber
            orderDirection: asc
            skip: $skip
            first: $first
          ) {
            id
            blockNumber
            txHash
            user
            liquidator
            collateralReserve {
              id
              symbol
            }
            principalReserve {
              id
              symbol
            }
            collateralAmount
            principalAmount
            timestamp
          }
        }
      `;
      
      const result: any = await client.request(query, {
        startBlock,
        endBlock,
        skip,
        first: pageSize,
      });
      
      const calls = result.liquidationCalls || [];
      
      for (const call of calls) {
        events.push({
          id: call.id,
          blockNumber: call.blockNumber,
          txHash: call.txHash || '',
          user: call.user,
          liquidator: call.liquidator,
          collateralAsset: call.collateralReserve?.id || '',
          debtAsset: call.principalReserve?.id || '',
          collateralAmount: call.collateralAmount || '0',
          debtAmount: call.principalAmount || '0',
          timestamp: call.timestamp || 0,
        });
      }
      
      if (calls.length < pageSize) {
        hasMore = false;
      } else {
        skip += pageSize;
      }
    }
    
    return events;
  }
  
  /**
   * Load liquidation events from on-chain logs (fallback method)
   */
  private async loadFromLogs(
    startBlock: number,
    endBlock: number
  ): Promise<LiquidationEvent[]> {
    const events: LiquidationEvent[] = [];
    
    // LiquidationCall event signature
    // event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)
    const liquidationCallTopic = '0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286';
    
    // Fetch in chunks to avoid RPC limits
    const chunkSize = 2000;
    for (let from = startBlock; from <= endBlock; from += chunkSize) {
      const to = Math.min(from + chunkSize - 1, endBlock);
      
      const logs = await this.provider.getLogs({
        address: this.aavePoolAddress,
        topics: [liquidationCallTopic],
        fromBlock: from,
        toBlock: to,
      });
      
      for (const log of logs) {
        // Parse the event data
        // Topics: [signature, collateralAsset, debtAsset, user]
        // Data: [debtToCover, liquidatedCollateralAmount, liquidator, receiveAToken]
        
        const collateralAsset = '0x' + log.topics[1].slice(26);
        const debtAsset = '0x' + log.topics[2].slice(26);
        const user = '0x' + log.topics[3].slice(26);
        
        // For simplicity, we'll create a basic event structure
        // Full parsing would require ABI decoding of the data field
        events.push({
          id: `${log.transactionHash}-${log.index}`,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash || '',
          user,
          liquidator: '', // Would need to decode from data
          collateralAsset,
          debtAsset,
          collateralAmount: '0', // Would need to decode from data
          debtAmount: '0', // Would need to decode from data
          timestamp: 0, // Would need to fetch block timestamp
        });
      }
    }
    
    return events;
  }
  
  /**
   * Load all liquidation events in the specified block range.
   * Prefers subgraph if available, falls back to on-chain logs.
   */
  async load(startBlock: number, endBlock: number): Promise<Map<number, LiquidationEvent[]>> {
    console.log(`[replay] Loading liquidation events from block ${startBlock} to ${endBlock}...`);
    
    let events: LiquidationEvent[];
    
    try {
      if (this.subgraphUrl) {
        events = await this.loadFromSubgraph(startBlock, endBlock);
        console.log(`[replay] Loaded ${events.length} events from subgraph`);
      } else {
        events = await this.loadFromLogs(startBlock, endBlock);
        console.log(`[replay] Loaded ${events.length} events from on-chain logs`);
      }
    } catch (error) {
      console.error('[replay] Failed to load liquidation events:', error);
      throw error;
    }
    
    // Index by block number
    const indexed = new Map<number, LiquidationEvent[]>();
    for (const event of events) {
      const blockEvents = indexed.get(event.blockNumber) || [];
      blockEvents.push(event);
      indexed.set(event.blockNumber, blockEvents);
    }
    
    console.log(`[replay] Indexed events across ${indexed.size} blocks`);
    return indexed;
  }
}
