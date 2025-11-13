// BorrowersIndexService: Per-reserve borrower tracking via variableDebt Transfer events
// Maintains persistent sets of borrowers for each reserve with on-chain discovery and live updates
// Supports multiple storage modes: memory, redis, postgres

import { EventLog, JsonRpcProvider, Interface } from 'ethers';
import { createClient, RedisClientType } from 'redis';
import pkg from 'pg';
const { Pool } = pkg;

import { config } from '../config/index.js';

const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

export type BorrowersIndexMode = 'memory' | 'redis' | 'postgres';

export interface BorrowersIndexOptions {
  mode?: BorrowersIndexMode;
  redisUrl?: string;
  databaseUrl?: string;
  backfillBlocks?: number;
  chunkSize?: number;
  maxUsersPerReserve?: number;
}

interface ReserveInfo {
  asset: string;
  symbol: string;
  variableDebtToken: string;
}

/**
 * BorrowersIndexService maintains a per-reserve borrower set by indexing
 * variableDebt token Transfer events. Supports multiple storage modes:
 * - memory: in-memory storage (no persistence)
 * - redis: persistent storage via Redis
 * - postgres: persistent storage via PostgreSQL
 */
export class BorrowersIndexService {
  private provider: JsonRpcProvider;
  private mode: BorrowersIndexMode;
  private redis: RedisClientType | null = null;
  private pgPool: typeof Pool.prototype | null = null;
  private reserves: Map<string, ReserveInfo> = new Map();
  private borrowersByReserve: Map<string, Set<string>> = new Map();
  private isBackfilled = false;
  private backfillBlocks: number;
  private chunkSize: number;
  private maxUsersPerReserve: number;
  private eventListeners: Map<string, (log: EventLog) => void> = new Map();
  private hasLoggedFallback = false;

  constructor(provider: JsonRpcProvider, options: BorrowersIndexOptions = {}) {
    this.provider = provider;
    this.mode = options.mode || 'memory';
    this.backfillBlocks = options.backfillBlocks || 50000;
    this.chunkSize = options.chunkSize || 2000;
    this.maxUsersPerReserve = options.maxUsersPerReserve || 3000;

    // Initialize persistence layer based on mode
    if (this.mode === 'redis') {
      const redisUrl = options.redisUrl || config.borrowersIndexRedisUrl;
      this.initRedis(redisUrl).catch(() => {
        if (!this.hasLoggedFallback) {
          // eslint-disable-next-line no-console
          console.warn('[borrowers-index] Redis connection failed, falling back to memory mode');
          this.hasLoggedFallback = true;
        }
        this.mode = 'memory';
      });
    } else if (this.mode === 'postgres') {
      const dbUrl = options.databaseUrl || config.databaseUrl;
      this.initPostgres(dbUrl).catch(() => {
        if (!this.hasLoggedFallback) {
          // eslint-disable-next-line no-console
          console.warn('[borrowers-index] Postgres connection failed, falling back to memory mode');
          this.hasLoggedFallback = true;
        }
        this.mode = 'memory';
      });
    }

    // eslint-disable-next-line no-console
    console.log(`[borrowers-index] Using ${this.mode} mode`);
  }

  /**
   * Initialize Redis client for persistence
   */
  private async initRedis(redisUrl: string | undefined): Promise<void> {
    if (!redisUrl) {
      throw new Error('Redis URL not configured');
    }

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
      throw err;
    }
  }

  /**
   * Initialize Postgres connection for persistence
   */
  private async initPostgres(databaseUrl: string | undefined): Promise<void> {
    if (!databaseUrl) {
      throw new Error('Database URL not configured');
    }

    try {
      this.pgPool = new Pool({ connectionString: databaseUrl });

      // Check if borrowers_index table exists
      const tableCheck = await this.pgPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'borrowers_index'
        )
      `);

      if (!tableCheck.rows[0].exists) {
        if (!this.hasLoggedFallback) {
          // eslint-disable-next-line no-console
          console.warn('[borrowers-index] Table borrowers_index does not exist. Please run migration: backend/migrations/20251113_add_borrowers_index.sql');
          this.hasLoggedFallback = true;
        }
        throw new Error('borrowers_index table does not exist');
      }

      // eslint-disable-next-line no-console
      console.log('[borrowers-index] Postgres connected');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[borrowers-index] Failed to connect to Postgres:', err);
      this.pgPool = null;
      throw err;
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

    // Try loading from persistence first
    const loaded = await this.loadFromPersistence();
    
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
   * Load borrower sets from persistence layer
   */
  private async loadFromPersistence(): Promise<boolean> {
    if (this.mode === 'redis' && this.redis) {
      return this.loadFromRedis();
    } else if (this.mode === 'postgres' && this.pgPool) {
      return this.loadFromPostgres();
    }
    return false;
  }

  /**
   * Load borrower sets from Redis persistence
   */
  private async loadFromRedis(): Promise<boolean> {
    if (!this.redis) return false;

    try {
      let totalLoaded = 0;
      
      for (const [asset] of this.reserves) {
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
   * Load borrower sets from Postgres persistence
   */
  private async loadFromPostgres(): Promise<boolean> {
    if (!this.pgPool) return false;

    try {
      let totalLoaded = 0;
      
      for (const [asset] of this.reserves) {
        const result = await this.pgPool.query(
          'SELECT borrower_address FROM borrowers_index WHERE reserve_asset = $1',
          [asset]
        );
        
        if (result.rows.length > 0) {
          const borrowerSet = this.borrowersByReserve.get(asset);
          if (borrowerSet) {
            result.rows.forEach(row => borrowerSet.add(row.borrower_address.toLowerCase()));
            totalLoaded += result.rows.length;
          }
        }
      }

      if (totalLoaded > 0) {
        // eslint-disable-next-line no-console
        console.log(`[borrowers-index] Loaded ${totalLoaded} borrowers from Postgres`);
        this.isBackfilled = true;
        return true;
      }

      return false;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[borrowers-index] Failed to load from Postgres:', err);
      return false;
    }
  }

  /**
   * Save borrower sets to persistence layer
   */
  private async saveToPersistence(): Promise<void> {
    if (this.mode === 'redis' && this.redis) {
      await this.saveToRedis();
    } else if (this.mode === 'postgres' && this.pgPool) {
      await this.saveToPostgres();
    }
    // Memory mode: no-op
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
   * Save borrower sets to Postgres persistence
   */
  private async saveToPostgres(): Promise<void> {
    if (!this.pgPool) return;

    try {
      // Use a transaction to update all reserves atomically
      const client = await this.pgPool.connect();
      try {
        await client.query('BEGIN');

        for (const [asset, borrowerSet] of this.borrowersByReserve) {
          // Delete existing entries for this reserve
          await client.query('DELETE FROM borrowers_index WHERE reserve_asset = $1', [asset]);

          // Insert new entries (batch insert for efficiency)
          if (borrowerSet.size > 0) {
            const borrowers = Array.from(borrowerSet);
            const values = borrowers.map((addr, i) => `($1, $${i + 2})`).join(',');
            const params = [asset, ...borrowers];
            
            await client.query(
              `INSERT INTO borrowers_index (reserve_asset, borrower_address) VALUES ${values}`,
              params
            );
          }
        }

        await client.query('COMMIT');
        // eslint-disable-next-line no-console
        console.log('[borrowers-index] Saved to Postgres');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[borrowers-index] Failed to save to Postgres:', err);
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

    for (const [, reserve] of this.reserves) {
      try {
        await this.backfillReserve(reserve, fromBlock, currentBlock);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[borrowers-index] Backfill failed for ${reserve.symbol}:`, err);
      }
    }

    this.isBackfilled = true;
    
    // Save to persistence after backfill
    await this.saveToPersistence();

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
  // Zero address constant for Transfer event logic
  private static readonly ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  private processTransferLog(log: EventLog, asset: string): void {
    try {
      const iface = new Interface(ERC20_ABI);
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (!parsed) return;

      const from = parsed.args.from.toLowerCase();
      const to = parsed.args.to.toLowerCase();

      const borrowers = this.borrowersByReserve.get(asset);
      if (!borrowers) return;

      // Mint (from zero address): add borrower
      if (from === BorrowersIndexService.ZERO_ADDRESS && to !== BorrowersIndexService.ZERO_ADDRESS) {
        borrowers.add(to);
      }
      // Burn (to zero address): remove borrower (full repayment)
      // Note: This is conservative - user is removed when debt token is burned (transferred to zero)
      // which indicates full debt repayment. Users with partial repayment remain in the set.
      else if (to === BorrowersIndexService.ZERO_ADDRESS && from !== BorrowersIndexService.ZERO_ADDRESS) {
        borrowers.delete(from);
      }
      // Transfer between users: add recipient (debt reassignment)
      else if (from !== BorrowersIndexService.ZERO_ADDRESS && to !== BorrowersIndexService.ZERO_ADDRESS) {
        borrowers.add(to);
        // Keep 'from' in set as well (they may still have debt after partial transfer)
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

    // Save final state to persistence
    await this.saveToPersistence();

    // Disconnect Redis
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch (err) {
        // Ignore cleanup errors
      }
      this.redis = null;
    }

    // Disconnect Postgres
    if (this.pgPool) {
      try {
        await this.pgPool.end();
      } catch (err) {
        // Ignore cleanup errors
      }
      this.pgPool = null;
    }

    // eslint-disable-next-line no-console
    console.log('[borrowers-index] Service stopped');
  }
}
