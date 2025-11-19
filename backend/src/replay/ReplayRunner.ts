// ReplayRunner: Historical replay of liquidation detection over a fixed block range

import { JsonRpcProvider, Contract } from 'ethers';
import * as fs from 'fs/promises';
import * as path from 'path';
import { config } from '../config/index.js';
import type { ReplayBlockMetrics, ReplaySummary } from './types.js';

// ABIs for on-chain calls
const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) external payable returns (tuple(bool success, bytes returnData)[] returnData)'
];

const AAVE_POOL_ABI = [
  'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
];

/**
 * Run historical replay of liquidation detection over a block range
 * 
 * This function performs deterministic, read-only HF detection by:
 * 1. Iterating through each block in the range
 * 2. Loading block-pinned prices (via Aave oracle)
 * 3. Computing HF for candidate users
 * 4. Recording metrics without executing transactions
 * 
 * @param startBlock - Starting block number (inclusive)
 * @param endBlock - Ending block number (inclusive)
 */
export async function runReplay(startBlock: number, endBlock: number): Promise<void> {
  console.log(`[replay] Starting replay for blocks ${startBlock} to ${endBlock}`);
  
  // Validate RPC URL is configured
  if (!config.rpcUrl && !config.wsRpcUrl) {
    throw new Error('RPC_URL or WS_RPC_URL must be configured for replay mode');
  }

  const rpcUrl = config.rpcUrl || config.wsRpcUrl;
  if (!rpcUrl) {
    throw new Error('No RPC URL available for replay');
  }

  // Initialize provider and contracts
  const provider = new JsonRpcProvider(rpcUrl);
  const multicall3 = new Contract(
    config.multicall3Address,
    MULTICALL3_ABI,
    provider
  );
  const aavePool = new Contract(
    config.aavePool,
    AAVE_POOL_ABI,
    provider
  );

  // Output directory
  const outputDir = path.join(process.cwd(), 'replay');
  await fs.mkdir(outputDir, { recursive: true });

  const ndjsonPath = path.join(outputDir, `replay-${startBlock}-${endBlock}.ndjson`);
  const summaryPath = path.join(outputDir, `replay-${startBlock}-${endBlock}-summary.json`);

  // Initialize metrics tracking
  const blockMetrics: ReplayBlockMetrics[] = [];
  const uniqueLiquidatables = new Set<string>();
  let earliestLiquidationBlock: number | null = null;
  let totalDurationMs = 0;

  // For simplicity, we'll use a minimal candidate set
  // In a real implementation, this would be seeded from events or a subgraph
  // For now, we'll use an empty set and log a warning
  const candidates: string[] = [];
  
  console.log(`[replay] Warning: Candidate discovery not implemented. No users will be checked.`);
  console.log(`[replay] To enable candidate discovery, integrate with SubgraphSeeder or OnChainBackfillService.`);

  // Iterate through each block
  for (let blockNum = startBlock; blockNum <= endBlock; blockNum++) {
    const blockStartTime = Date.now();
    
    try {
      // For each block, we would:
      // 1. Get block header
      // 2. Build candidate set (from hotset, events, etc.)
      // 3. Compute HF for each candidate at this block
      // 4. Detect liquidatables (HF < 1.0)
      
      const newLiquidatables: string[] = [];
      let minHF = Infinity;

      // Stub: In real implementation, iterate through candidates and compute HF
      // For now, just record empty metrics
      if (candidates.length > 0) {
        // Build multicall batch for getUserAccountData
        const calls = candidates.map(user => ({
          target: config.aavePool,
          allowFailure: true,
          callData: aavePool.interface.encodeFunctionData('getUserAccountData', [user])
        }));

        // Execute multicall at this block
        const results = await multicall3.aggregate3.staticCall(calls, {
          blockTag: blockNum
        });

        // Decode results and compute HF
        for (let i = 0; i < results.length; i++) {
          const { success, returnData } = results[i];
          if (!success) continue;

          const decoded = aavePool.interface.decodeFunctionResult(
            'getUserAccountData',
            returnData
          );
          
          const [
            totalCollateralBase,
            totalDebtBase,
            ,
            ,
            ,
            healthFactor
          ] = decoded;

          // healthFactor is scaled by 1e18
          const hf = Number(healthFactor) / 1e18;
          
          if (hf < minHF) {
            minHF = hf;
          }

          // Detect liquidatable
          if (hf < 1.0 && totalDebtBase > 0n) {
            const userAddr = candidates[i];
            newLiquidatables.push(userAddr);
            uniqueLiquidatables.add(userAddr);
            
            if (earliestLiquidationBlock === null) {
              earliestLiquidationBlock = blockNum;
            }
          }
        }
      }

      const durationMs = Date.now() - blockStartTime;
      totalDurationMs += durationMs;

      const metrics: ReplayBlockMetrics = {
        block: blockNum,
        candidateCount: candidates.length,
        liquidatableCount: newLiquidatables.length,
        minHF: minHF === Infinity ? 0 : minHF,
        newLiquidatables,
        durationMs
      };

      blockMetrics.push(metrics);

      // Write NDJSON line
      await fs.appendFile(ndjsonPath, JSON.stringify(metrics) + '\n', 'utf-8');

      // Log progress every 100 blocks
      if ((blockNum - startBlock) % 100 === 0 || blockNum === endBlock) {
        console.log(
          `[replay] Progress: ${blockNum}/${endBlock} ` +
          `(${Math.round(((blockNum - startBlock + 1) / (endBlock - startBlock + 1)) * 100)}%) ` +
          `- candidates: ${candidates.length}, liq: ${newLiquidatables.length}, minHF: ${minHF.toFixed(4)}`
        );
      }
    } catch (error) {
      console.error(`[replay] Error processing block ${blockNum}:`, error);
      // Continue to next block
    }
  }

  // Generate summary
  const summary: ReplaySummary = {
    startBlock,
    endBlock,
    totalBlocks: endBlock - startBlock + 1,
    totalLiquidatables: uniqueLiquidatables.size,
    earliestLiquidationBlock,
    totalUniqueLiquidatableUsers: uniqueLiquidatables.size,
    averageDurationMs: totalDurationMs / (endBlock - startBlock + 1),
    totalDurationMs
  };

  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

  console.log(`[replay] Completed replay for blocks ${startBlock}-${endBlock}`);
  console.log(`[replay] NDJSON output: ${ndjsonPath}`);
  console.log(`[replay] Summary output: ${summaryPath}`);
  console.log(`[replay] Total liquidatable users found: ${uniqueLiquidatables.size}`);
  console.log(`[replay] Earliest liquidation at block: ${earliestLiquidationBlock ?? 'N/A'}`);
}
