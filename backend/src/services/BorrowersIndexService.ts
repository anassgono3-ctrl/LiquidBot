// BorrowersIndexService: Per-reserve borrower tracking via variableDebt Transfer events
// Maintains persistent sets of borrowers for each reserve with on-chain discovery and live updates

import { EventLog, JsonRpcProvider, Contract, Interface } from 'ethers';
import { createClient, RedisClientType } from 'redis';

import { config } from '../config/index.js';

const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

export interface BorrowersIndexOptions {
  redisUrl?: string;
  backfillBlocks?: number;
  chunkSize?: number;
}

interface ReserveInfo {
  asset: string;
  symbol: string;
  variableDebtToken: string;
}

/**
 * BorrowersIndexService maintains a per-reserve borrower set by indexing
 * variableDebt token Transfer events. Provides persistent storage via Redis
 * and live updates via event subscriptions.
 */
export class BorrowersIndexService {
  private provider: JsonRpcProvider;
  private redis: RedisClientType | null = null;
  private reserves: Map<string, ReserveInfo> = new Map();
  private borrowersByReserve: Map<string, Set<string>> = new Map();
  private isBackfilled = false;
  private backfillBlocks: number;
  private chunkSize: number;
  private eventListeners: Map<string, (log: EventLog) => void> = new Map();

  constructor(provider: JsonRpcProvider, options: BorrowersIndexOptions = {}) {
    this.provider = provider;
    this.backfillBlocks = options.backfillBlocks || 50000;
    this.chunkSize = options.chunkSize || 2000;

    // Initialize Redis if configured
    if (options.redisUrl || config.redisUrl) {
      this.initRedis(options.redisUrl || config.redisUrl);
    }
  }

  /**
   * Initialize Redis client for persistence
   */
  private async initRedis(redisUrl: string | undefined): Promise<void> {
    if (!redisUrl) return;

    try {
      this.redis = createClient({ url: redisUrl });
      this.redis.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error('[borrowers-index] Redis error:', err);
      });
      await this.redis.connect();
      // eslint-disable-next-line no-console
      console.log('[borrowers-index] Redis connected');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[borrowers-index] Failed to connect to Redis:', err);
      this.redis = null;
    }
  }

  /**
   * Initialize the service with reserve metadata
   */
  async initialize(reserves: ReserveInfo[]): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[borrowers-index] Initializing with ${reserves.length} reserves`);

    // Store reserve info
    for (const reserve of reserves) {
      this.reserves.set(reserve.asset.toLowerCase(), reserve);
      this.borrowersByReserve.set(reserve.asset.toLowerCase(), new Set());
    }

    // Try loading from Redis first
    const loaded = await this.loadFromRedis();
    
    if (!loaded) {
      // Perform backfill if not loaded from Redis
      await this.performBackfill();
    }

    // Start live event subscriptions
    await this.startLiveUpdates();

    // eslint-disable-next-line no-console
    console.log('[borrowers-index] Initialization complete');
  }

  /**
   * Load borrower sets from Redis persistence
   */
  private async loadFromRedis(): Promise<boolean> {
    if (!this.redis) return false;

    try {
      let totalLoaded = 0;
      
      for (const [asset, reserve] of this.reserves) {
        const key = `borrowers:${asset}`;
        const members = await this.redis.sMembers(key);
        
        if (members.length > 0) {
          const borrowerSet = this.borrowersByReserve.get(asset);
          if (borrowerSet) {
            members.forEach(addr => borrowerSet.add(addr.toLowerCase()));
            totalLoaded += members.length;
          }
        }
      }

      if (totalLoaded > 0) {
        // eslint-disable-next-line no-console
        console.log(`[borrowers-index] Loaded ${totalLoaded} borrowers from Redis`);
        this.isBackfilled = true;
        return true;
      }

      return false;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[borrowers-index] Failed to load from Redis:', err);
      return false;
    }
  }

  /**
   * Save borrower sets to Redis persistence
   */
  private async saveToRedis(): Promise<void> {
    if (!this.redis) return;

    try {
      for (const [asset, borrowerSet] of this.borrowersByReserve) {
        if (borrowerSet.size === 0) continue;

        const key = `borrowers:${asset}`;
        const members = Array.from(borrowerSet);
        
        // Clear existing set and add all members
        await this.redis.del(key);
        if (members.length > 0) {
          await this.redis.sAdd(key, members);
        }
      }
      
      // eslint-disable-next-line no-console
      console.log('[borrowers-index] Saved to Redis');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[borrowers-index] Failed to save to Redis:', err);
    }
  }

  /**
   * Perform historical backfill of Transfer events
   */
  private async performBackfill(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[borrowers-index] Starting backfill (${this.backfillBlocks} blocks, chunk=${this.chunkSize})`);

    const currentBlock = await this.provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - this.backfillBlocks);

    // eslint-disable-next-line no-console
    console.log(`[borrowers-index] Backfill range: ${fromBlock} to ${currentBlock}`);

    for (const [asset, reserve] of this.reserves) {
      try {
        await this.backfillReserve(reserve, fromBlock, currentBlock);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[borrowers-index] Backfill failed for ${reserve.symbol}:`, err);
      }
    }

    this.isBackfilled = true;
    
    // Save to Redis after backfill
    await this.saveToRedis();

    // eslint-disable-next-line no-console
    console.log('[borrowers-index] Backfill complete');
  }

  /**
   * Backfill Transfer events for a specific reserve's variableDebt token
   */
  private async backfillReserve(reserve: ReserveInfo, fromBlock: number, toBlock: number): Promise<void> {
    const iface = new Interface(ERC20_ABI);
    const transferTopic = iface.getEvent('Transfer')?.topicHash;
    if (!transferTopic) return;

    let totalLogs = 0;
    const borrowers = this.borrowersByReserve.get(reserve.asset.toLowerCase());
    if (!borrowers) return;

    // Process in chunks
    for (let start = fromBlock; start <= toBlock; start += this.chunkSize) {
      const end = Math.min(start + this.chunkSize - 1, toBlock);

      try {
        const logs = await this.provider.getLogs({
          address: reserve.variableDebtToken,
          topics: [transferTopic],
          fromBlock: start,
          toBlock: end
        });

        for (const log of logs) {
          this.processTransferLog(log as EventLog, reserve.asset.toLowerCase());
          totalLogs++;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[borrowers-index] Chunk ${start}-${end} failed for ${reserve.symbol}:`, err);
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[borrowers-index] ${reserve.symbol}: processed ${totalLogs} Transfer events, ${borrowers.size} borrowers`);
  }

  /**
   * Start live event subscriptions for all reserves
   */
  private async startLiveUpdates(): Promise<void> {
    const iface = new Interface(ERC20_ABI);
    const transferTopic = iface.getEvent('Transfer')?.topicHash;
    if (!transferTopic) return;

    for (const [asset, reserve] of this.reserves) {
      try {
        const filter = {
          address: reserve.variableDebtToken,
          topics: [transferTopic]
        };

        const listener = (log: EventLog) => {
          this.processTransferLog(log, asset);
        };

        this.provider.on(filter, listener);
        this.eventListeners.set(asset, listener);

        // eslint-disable-next-line no-console
        console.log(`[borrowers-index] Subscribed to ${reserve.symbol} variableDebt transfers`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[borrowers-index] Failed to subscribe to ${reserve.symbol}:`, err);
      }
    }
  }

  /**
   * Process a Transfer event to update borrower set
   */
  private processTransferLog(log: EventLog, asset: string): void {
    try {
      const iface = new Interface(ERC20_ABI);
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (!parsed) return;

      const from = parsed.args.from.toLowerCase();
      const to = parsed.args.to.toLowerCase();
      const value = parsed.args.value;

      const borrowers = this.borrowersByReserve.get(asset);
      if (!borrowers) return;

      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

      // Mint (from zero address): add borrower
      if (from === ZERO_ADDRESS && to !== ZERO_ADDRESS) {
        borrowers.add(to);
      }
      // Burn (to zero address): may remove borrower if balance is zero
      else if (to === ZERO_ADDRESS && from !== ZERO_ADDRESS) {
        // We can't check balance here without additional calls, so keep in set
        // The balance will be verified when we check the user's HF
        // Optionally, we could schedule a balance check and remove if zero
      }
      // Transfer between users: add recipient
      else if (from !== ZERO_ADDRESS && to !== ZERO_ADDRESS) {
        borrowers.add(to);
        // Keep 'from' in set as well (they may still have debt)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[borrowers-index] Failed to process Transfer log:', err);
    }
  }

  /**
   * Get borrowers for a specific reserve
   */
  getBorrowers(asset: string): string[] {
    const borrowers = this.borrowersByReserve.get(asset.toLowerCase());
    return borrowers ? Array.from(borrowers) : [];
  }

  /**
   * Get all borrowers across all reserves
   */
  getAllBorrowers(): string[] {
    const allBorrowers = new Set<string>();
    for (const borrowers of this.borrowersByReserve.values()) {
      borrowers.forEach(b => allBorrowers.add(b));
    }
    return Array.from(allBorrowers);
  }

  /**
   * Get statistics
   */
  getStats(): { totalReserves: number; totalBorrowers: number; borrowersByReserve: Record<string, number> } {
    const borrowersByReserve: Record<string, number> = {};
    for (const [asset, borrowers] of this.borrowersByReserve) {
      const reserve = this.reserves.get(asset);
      const key = reserve ? reserve.symbol : asset;
      borrowersByReserve[key] = borrowers.size;
    }

    return {
      totalReserves: this.reserves.size,
      totalBorrowers: this.getAllBorrowers().length,
      borrowersByReserve
    };
  }

  /**
   * Clean up and disconnect
   */
  async stop(): Promise<void> {
    // Remove event listeners
    for (const [asset, listener] of this.eventListeners) {
      const reserve = this.reserves.get(asset);
      if (reserve) {
        try {
          this.provider.off({ address: reserve.variableDebtToken }, listener);
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    }
    this.eventListeners.clear();

    // Save final state to Redis
    await this.saveToRedis();

    // Disconnect Redis
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch (err) {
        // Ignore cleanup errors
      }
      this.redis = null;
    }

    // eslint-disable-next-line no-console
    console.log('[borrowers-index] Service stopped');
  }
}
