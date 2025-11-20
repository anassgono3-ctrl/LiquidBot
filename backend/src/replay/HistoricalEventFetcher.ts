/**
 * HistoricalEventFetcher: Fetches and decodes historical on-chain events
 */

import { JsonRpcProvider, EventLog, Log, Interface } from 'ethers';
import { createLogger, format, transports } from 'winston';

import { aaveV3Interface, chainlinkInterface } from '../abi/aaveV3PoolEvents.js';
import type { HistoricalEvent } from './types.js';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

export interface EventFetcherOptions {
  rpcUrl: string;
  aavePoolAddress: string;
  chainlinkFeeds?: string[]; // Array of Chainlink aggregator addresses
}

export class HistoricalEventFetcher {
  private provider: JsonRpcProvider;
  private aavePoolAddress: string;
  private chainlinkFeeds: string[];
  private aaveInterface: Interface;
  private chainlinkInterface: Interface;

  // Block timestamp cache
  private blockTimestamps: Map<number, number> = new Map();

  constructor(options: EventFetcherOptions) {
    this.provider = new JsonRpcProvider(options.rpcUrl);
    this.aavePoolAddress = options.aavePoolAddress.toLowerCase();
    this.chainlinkFeeds = (options.chainlinkFeeds || []).map(addr => addr.toLowerCase());
    this.aaveInterface = aaveV3Interface;
    this.chainlinkInterface = chainlinkInterface;
  }

  /**
   * Fetch all relevant events for a block range
   */
  async fetchEventsInRange(startBlock: number, endBlock: number): Promise<HistoricalEvent[]> {
    logger.info(`[replay-fetcher] Fetching events from block ${startBlock} to ${endBlock}`);

    const events: HistoricalEvent[] = [];

    // Fetch in chunks to avoid rate limits
    const chunkSize = 1000;
    for (let fromBlock = startBlock; fromBlock <= endBlock; fromBlock += chunkSize) {
      const toBlock = Math.min(fromBlock + chunkSize - 1, endBlock);
      
      // Fetch Aave Pool events
      const aaveEvents = await this.fetchAaveEvents(fromBlock, toBlock);
      events.push(...aaveEvents);

      // Fetch Chainlink price events if configured
      if (this.chainlinkFeeds.length > 0) {
        const priceEvents = await this.fetchChainlinkEvents(fromBlock, toBlock);
        events.push(...priceEvents);
      }

      logger.info(`[replay-fetcher] Fetched ${events.length} events up to block ${toBlock}`);
    }

    // Sort by block number, then log index
    events.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber - b.blockNumber;
      }
      return a.logIndex - b.logIndex;
    });

    logger.info(`[replay-fetcher] Total events fetched: ${events.length}`);
    return events;
  }

  /**
   * Fetch Aave Pool events (Borrow, Repay, Supply, Withdraw, LiquidationCall, ReserveDataUpdated)
   */
  private async fetchAaveEvents(fromBlock: number, toBlock: number): Promise<HistoricalEvent[]> {
    const filter = {
      address: this.aavePoolAddress,
      fromBlock,
      toBlock,
      topics: [] as (string | string[])[]
    };

    const logs = await this.provider.getLogs(filter);
    const events: HistoricalEvent[] = [];

    for (const log of logs) {
      const decoded = this.decodeAaveEvent(log);
      if (decoded) {
        events.push(decoded);
      }
    }

    return events;
  }

  /**
   * Fetch Chainlink price update events
   */
  private async fetchChainlinkEvents(fromBlock: number, toBlock: number): Promise<HistoricalEvent[]> {
    const events: HistoricalEvent[] = [];

    for (const feedAddress of this.chainlinkFeeds) {
      const filter = {
        address: feedAddress,
        fromBlock,
        toBlock,
        topics: [] as (string | string[])[]
      };

      const logs = await this.provider.getLogs(filter);

      for (const log of logs) {
        const decoded = this.decodeChainlinkEvent(log, feedAddress);
        if (decoded) {
          events.push(decoded);
        }
      }
    }

    return events;
  }

  /**
   * Decode an Aave Pool event log
   */
  private decodeAaveEvent(log: Log): HistoricalEvent | null {
    try {
      if (!('topics' in log) || !log.topics || log.topics.length === 0) {
        return null;
      }

      const eventLog = log as EventLog;
      const parsed = this.aaveInterface.parseLog({
        topics: eventLog.topics,
        data: eventLog.data
      });

      if (!parsed) {
        return null;
      }

      // Convert parsed args to plain object
      const args: { [key: string]: any } = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
      parsed.args.forEach((value, index) => {
        const paramName = parsed.fragment.inputs[index].name;
        if (paramName) {
          args[paramName] = value;
        }
      });

      return {
        blockNumber: eventLog.blockNumber,
        transactionHash: eventLog.transactionHash,
        logIndex: eventLog.index,
        address: eventLog.address.toLowerCase(),
        name: parsed.name,
        args,
        timestamp: 0 // Will be populated later
      };
    } catch (error) {
      // Ignore decode errors for unknown events
      return null;
    }
  }

  /**
   * Decode a Chainlink aggregator event log
   */
  private decodeChainlinkEvent(log: Log, feedAddress: string): HistoricalEvent | null {
    try {
      if (!('topics' in log) || !log.topics || log.topics.length === 0) {
        return null;
      }

      const eventLog = log as EventLog;
      const parsed = this.chainlinkInterface.parseLog({
        topics: eventLog.topics,
        data: eventLog.data
      });

      if (!parsed) {
        return null;
      }

      // Convert parsed args to plain object
      const args: { [key: string]: any } = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
      parsed.args.forEach((value, index) => {
        const paramName = parsed.fragment.inputs[index].name;
        if (paramName) {
          args[paramName] = value;
        }
      });

      // Add feed address to args
      args.feedAddress = feedAddress;

      return {
        blockNumber: eventLog.blockNumber,
        transactionHash: eventLog.transactionHash,
        logIndex: eventLog.index,
        address: eventLog.address.toLowerCase(),
        name: parsed.name,
        args,
        timestamp: 0 // Will be populated later
      };
    } catch (error) {
      // Ignore decode errors for unknown events
      return null;
    }
  }

  /**
   * Get block timestamp (with caching)
   */
  async getBlockTimestamp(blockNumber: number): Promise<number> {
    if (this.blockTimestamps.has(blockNumber)) {
      return this.blockTimestamps.get(blockNumber)!;
    }

    const block = await this.provider.getBlock(blockNumber);
    if (!block) {
      throw new Error(`Block ${blockNumber} not found`);
    }

    const timestamp = block.timestamp;
    this.blockTimestamps.set(blockNumber, timestamp);
    return timestamp;
  }

  /**
   * Populate timestamps for all events
   */
  async populateTimestamps(events: HistoricalEvent[]): Promise<void> {
    // Get unique block numbers
    const uniqueBlocks = [...new Set(events.map(e => e.blockNumber))];
    
    logger.info(`[replay-fetcher] Fetching timestamps for ${uniqueBlocks.length} blocks`);

    // Fetch timestamps in parallel (in batches to avoid overwhelming RPC)
    const batchSize = 50;
    for (let i = 0; i < uniqueBlocks.length; i += batchSize) {
      const batch = uniqueBlocks.slice(i, i + batchSize);
      await Promise.all(batch.map(blockNum => this.getBlockTimestamp(blockNum)));
    }

    // Populate event timestamps
    for (const event of events) {
      event.timestamp = this.blockTimestamps.get(event.blockNumber) || 0;
    }

    logger.info(`[replay-fetcher] Timestamps populated for all events`);
  }
}
