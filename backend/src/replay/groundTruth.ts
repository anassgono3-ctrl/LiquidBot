/**
 * groundTruth: Fetch historical LiquidationCall events
 */

import { ethers } from 'ethers';

import type { ReplayBlockRange, LiquidationEvent } from './types.js';

/**
 * Fetch all LiquidationCall events in the given block range
 */
export async function fetchLiquidationEvents(
  provider: ethers.JsonRpcProvider,
  poolAddress: string,
  range: ReplayBlockRange
): Promise<LiquidationEvent[]> {
  console.log(`[replay] Fetching LiquidationCall events from block ${range.start} to ${range.end}...`);

  const iface = new ethers.Interface([
    'event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)'
  ]);

  const topic = iface.getEvent('LiquidationCall')!.topicHash;

  // Fetch logs in chunks to avoid RPC limits
  const chunkSize = 5000;
  const allLogs: ethers.Log[] = [];

  for (let fromBlock = range.start; fromBlock <= range.end; fromBlock += chunkSize) {
    const toBlock = Math.min(fromBlock + chunkSize - 1, range.end);
    
    try {
      const logs = await provider.getLogs({
        address: poolAddress,
        topics: [topic],
        fromBlock,
        toBlock
      });

      allLogs.push(...logs);
      
      if (logs.length > 0) {
        console.log(`[replay] Found ${logs.length} LiquidationCall events in blocks ${fromBlock}-${toBlock}`);
      }
    } catch (error) {
      console.error(`[replay] Error fetching logs for blocks ${fromBlock}-${toBlock}:`, error);
      throw new Error(`Failed to fetch liquidation events: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`[replay] Total LiquidationCall events found: ${allLogs.length}`);

  // Parse events
  const events: LiquidationEvent[] = [];

  for (const log of allLogs) {
    try {
      const parsed = iface.parseLog({
        topics: log.topics as string[],
        data: log.data
      });

      if (!parsed) continue;

      // Get transaction to extract timestamp
      const block = await provider.getBlock(log.blockNumber);
      if (!block) {
        console.warn(`[replay] Could not fetch block ${log.blockNumber} for tx ${log.transactionHash}`);
        continue;
      }

      events.push({
        user: parsed.args.user.toLowerCase(),
        txHash: log.transactionHash,
        txBlock: log.blockNumber,
        collateralAsset: parsed.args.collateralAsset.toLowerCase(),
        debtAsset: parsed.args.debtAsset.toLowerCase(),
        debtToCover: parsed.args.debtToCover,
        liquidatedCollateralAmount: parsed.args.liquidatedCollateralAmount,
        liquidator: parsed.args.liquidator.toLowerCase(),
        receiveAToken: parsed.args.receiveAToken,
        timestamp: block.timestamp
      });
    } catch (error) {
      console.error(`[replay] Failed to parse log ${log.transactionHash}:`, error);
    }
  }

  // Sort by block number, then by transaction hash for determinism
  events.sort((a, b) => {
    if (a.txBlock !== b.txBlock) return a.txBlock - b.txBlock;
    return a.txHash.localeCompare(b.txHash);
  });

  console.log(`[replay] Successfully parsed ${events.length} liquidation events`);
  
  return events;
}

/**
 * Add USD valuations to liquidation events
 */
export async function enrichLiquidationEvents(
  provider: ethers.JsonRpcProvider,
  oracleAddress: string,
  events: LiquidationEvent[]
): Promise<Array<LiquidationEvent & { debtUSD: number; seizedUSD: number }>> {
  console.log(`[replay] Enriching ${events.length} events with USD values...`);

  const oracleAbi = [
    'function getAssetPrice(address asset) external view returns (uint256)'
  ];

  const oracle = new ethers.Contract(oracleAddress, oracleAbi, provider);
  const enriched: Array<LiquidationEvent & { debtUSD: number; seizedUSD: number }> = [];

  for (const event of events) {
    try {
      // Fetch prices at the liquidation block
      const [debtPrice, collateralPrice] = await Promise.all([
        oracle.getAssetPrice(event.debtAsset, { blockTag: event.txBlock }),
        oracle.getAssetPrice(event.collateralAsset, { blockTag: event.txBlock })
      ]);

      // Prices from Aave oracle are in 8 decimals (base currency is USD with 8 decimals)
      const debtPriceUSD = Number(debtPrice) / 1e8;
      const collateralPriceUSD = Number(collateralPrice) / 1e8;

      // Assume 18 decimals for tokens (we'd need token metadata for exact decimals)
      // For now, use a simplified approach - we can enhance this later
      const debtUSD = (Number(event.debtToCover) / 1e18) * debtPriceUSD;
      const seizedUSD = (Number(event.liquidatedCollateralAmount) / 1e18) * collateralPriceUSD;

      enriched.push({
        ...event,
        debtUSD,
        seizedUSD
      });
    } catch (error) {
      console.error(`[replay] Failed to enrich event ${event.txHash}:`, error);
      // Add with zero values as fallback
      enriched.push({
        ...event,
        debtUSD: 0,
        seizedUSD: 0
      });
    }
  }

  console.log(`[replay] Enriched ${enriched.length} events with USD values`);
  return enriched;
}
