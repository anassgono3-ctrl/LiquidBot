// OnChainBackfillService: Startup on-chain backfill for candidate discovery
// Scans Aave Pool logs to seed initial candidate set without relying on subgraph

import { JsonRpcProvider, Interface } from 'ethers';

import { eventRegistry, extractUserFromAaveEvent } from '../abi/aaveV3PoolEvents.js';
import { config } from '../config/index.js';

const AAVE_POOL_ABI = [
  'event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)',
  'event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)',
  'event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)',
  'event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)'
];

export interface BackfillResult {
  logsScanned: number;
  uniqueUsers: number;
  durationMs: number;
  users: string[];
}

/**
 * OnChainBackfillService provides startup candidate seeding via on-chain log scanning.
 * Scans Aave Pool events (Borrow, Repay, Supply, Withdraw) to discover active users.
 */
export class OnChainBackfillService {
  private provider: JsonRpcProvider | null = null;
  private aavePoolInterface: Interface;

  constructor() {
    this.aavePoolInterface = new Interface(AAVE_POOL_ABI);
  }

  /**
   * Initialize the service with a provider
   */
  async initialize(rpcUrl: string): Promise<void> {
    this.provider = new JsonRpcProvider(rpcUrl);
    
    // Verify provider connection
    try {
      await this.provider.getBlockNumber();
    } catch (err) {
      throw new Error(`Failed to connect to RPC: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Perform backfill scan to discover candidate users
   * @returns BackfillResult with discovered users and stats
   */
  async backfill(): Promise<BackfillResult> {
    if (!this.provider) {
      throw new Error('OnChainBackfillService not initialized');
    }

    if (!config.realtimeInitialBackfillEnabled) {
      return { logsScanned: 0, uniqueUsers: 0, durationMs: 0, users: [] };
    }

    const startTime = Date.now();
    const userSet = new Set<string>();
    let totalLogs = 0;

    try {
      // Get current block
      const currentBlock = await this.provider.getBlockNumber();
      const backfillBlocks = config.realtimeInitialBackfillBlocks;
      const startBlock = Math.max(0, currentBlock - backfillBlocks);
      const chunkBlocks = config.realtimeInitialBackfillChunkBlocks;
      const maxLogs = config.realtimeInitialBackfillMaxLogs;

      // eslint-disable-next-line no-console
      console.log(`[backfill] Scanning blocks ${startBlock} to ${currentBlock} (${backfillBlocks} blocks) in chunks of ${chunkBlocks}`);

      // Get event topics from EventRegistry for Aave events
      const aaveTopics = eventRegistry.getAllTopics().filter(topic => {
        const entry = eventRegistry.get(topic);
        // Filter to only Aave events (exclude Chainlink)
        return entry && entry.name !== 'AnswerUpdated';
      });

      // Scan in chunks
      for (let fromBlock = startBlock; fromBlock <= currentBlock; fromBlock += chunkBlocks) {
        const toBlock = Math.min(fromBlock + chunkBlocks - 1, currentBlock);
        
        // Check if we've hit max logs limit
        if (totalLogs >= maxLogs) {
          // eslint-disable-next-line no-console
          console.log(`[backfill] Reached max logs limit (${maxLogs}), stopping scan`);
          break;
        }

        try {
          // Query logs with retry on rate limit
          const logs = await this.getLogsWithRetry(
            config.aavePool,
            aaveTopics.length > 0 ? aaveTopics : [
              this.aavePoolInterface.getEvent('Borrow')?.topicHash || '',
              this.aavePoolInterface.getEvent('Repay')?.topicHash || '',
              this.aavePoolInterface.getEvent('Supply')?.topicHash || '',
              this.aavePoolInterface.getEvent('Withdraw')?.topicHash || ''
            ],
            fromBlock,
            toBlock
          );

          totalLogs += logs.length;

          // Decode and extract users
          for (const log of logs) {
            try {
              // Try EventRegistry first
              const decoded = eventRegistry.decode(log.topics as string[], log.data);
              if (decoded) {
                const users = extractUserFromAaveEvent(decoded);
                users.forEach(user => userSet.add(user.toLowerCase()));
              } else {
                // Fallback to legacy extraction
                const parsed = this.aavePoolInterface.parseLog({ topics: log.topics as string[], data: log.data });
                if (parsed) {
                  const user = this.extractUserFromParsedLog(parsed);
                  if (user) {
                    userSet.add(user.toLowerCase());
                  }
                }
              }
            } catch (err) {
              // Skip logs that fail to decode
              continue;
            }
          }

          // Log progress periodically
          const progress = Math.round(((toBlock - startBlock) / backfillBlocks) * 100);
          if (progress % 20 === 0 && logs.length > 0) {
            // eslint-disable-next-line no-console
            console.log(`[backfill] Progress: ${progress}%, scanned ${totalLogs} logs, found ${userSet.size} unique users`);
          }
        } catch (err) {
          // Log error but continue with next chunk
          // eslint-disable-next-line no-console
          console.warn(`[backfill] Failed to scan blocks ${fromBlock}-${toBlock}:`, err instanceof Error ? err.message : String(err));
        }
      }

      const durationMs = Date.now() - startTime;
      const users = Array.from(userSet);

      // eslint-disable-next-line no-console
      console.log(`[backfill] Complete: logs_scanned=${totalLogs} unique_users=${users.length} duration_ms=${durationMs}`);

      return {
        logsScanned: totalLogs,
        uniqueUsers: users.length,
        durationMs,
        users
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      // eslint-disable-next-line no-console
      console.error('[backfill] Failed:', err instanceof Error ? err.message : String(err));
      
      return {
        logsScanned: totalLogs,
        uniqueUsers: userSet.size,
        durationMs,
        users: Array.from(userSet)
      };
    }
  }

  /**
   * Get logs with retry on rate limit errors
   */
  private async getLogsWithRetry(
    address: string,
    topics: string[],
    fromBlock: number,
    toBlock: number,
    maxRetries = 3
  ): Promise<Array<{ topics: string[]; data: string }>> {
    if (!this.provider) {
      throw new Error('Provider not initialized');
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const logs = await this.provider.getLogs({
          address,
          topics: [topics],
          fromBlock,
          toBlock
        });
        
        return logs.map(log => ({
          topics: [...log.topics],
          data: log.data
        }));
      } catch (err) {
        const errStr = String(err).toLowerCase();
        const isRateLimit = errStr.includes('-32005') || 
                           errStr.includes('rate limit') || 
                           errStr.includes('too many requests');
        
        if (isRateLimit && attempt < maxRetries - 1) {
          // Exponential backoff with jitter
          const baseDelay = 1000 * Math.pow(2, attempt);
          const jitter = Math.random() * baseDelay * 0.3;
          const delayMs = Math.floor(baseDelay + jitter);
          
          // eslint-disable-next-line no-console
          console.log(`[backfill] Rate limit (attempt ${attempt + 1}/${maxRetries}), retrying in ${delayMs}ms`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        
        throw err;
      }
    }

    return [];
  }

  /**
   * Extract user address from parsed log
   */
  private extractUserFromParsedLog(parsed: { name: string; args: unknown }): string | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args = parsed.args as any;
    
    switch (parsed.name) {
      case 'Borrow':
        return args.user || args.onBehalfOf || null;
      case 'Repay':
        return args.user || null;
      case 'Supply':
        return args.user || args.onBehalfOf || null;
      case 'Withdraw':
        return args.user || null;
      default:
        return null;
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.provider) {
      try {
        this.provider.destroy();
      } catch (err) {
        // Ignore cleanup errors
      }
      this.provider = null;
    }
  }
}
