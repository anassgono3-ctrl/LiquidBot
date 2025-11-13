// BorrowersIndexService: Per-reserve borrower tracking via variableDebt Transfer events
// Maintains persistent sets of borrowers for each reserve with on-chain discovery and live updates
// Supports three modes: memory (in-memory), redis (Redis-backed), postgres (Postgres-backed)

import { EventLog, JsonRpcProvider, Interface } from 'ethers';
import { createClient, RedisClientType } from 'redis';
import { Pool as PgPool } from 'pg';

import { config } from '../config/index.js';

const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

export type BorrowersIndexMode = 'memory' | 'redis' | 'postgres';

export interface BorrowersIndexOptions {
  mode?: BorrowersIndexMode;
  redisUrl?: string;
  postgresUrl?: string;
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
 * variableDebt token Transfer events. Supports multiple storage backends:
 * - memory: In-memory storage (no persistence, no external services)
 * - redis: Redis-backed storage (requires Redis)
 * - postgres: Postgres-backed storage (uses existing DATABASE_URL)
 */
export class BorrowersIndexService {
  private provider: JsonRpcProvider;
  private mode: BorrowersIndexMode;
  private redis: RedisClientType | null = null;
  private pg: PgPool | null = null;
  private reserves: Map<string, ReserveInfo> = new Map();
  private borrowersByReserve: Map<string, Set<string>> = new Map();
  private isBackfilled = false;
  private backfillBlocks: number;
  private chunkSize: number;
  private maxUsersPerReserve: number;
  private eventListeners: Map<string, (log: EventLog) => void> = new Map();

  constructor(provider: JsonRpcProvider, options: BorrowersIndexOptions = {}) {
    this.provider = provider;
    this.mode = options.mode || 'memory';
    this.backfillBlocks = options.backfillBlocks || config.borrowersIndex.backfillBlocks;
    this.chunkSize = options.chunkSize || config.borrowersIndex.chunkBlocks;
    this.maxUsersPerReserve = options.maxUsersPerReserve || config.borrowersIndex.maxUsersPerReserve;

    // eslint-disable-next-line no-console
    console.log(`[borrowers-index] Initializing in ${this.mode} mode`);

    // Initialize storage backend based on mode
    if (this.mode === 'redis') {
      const redisUrl = options.redisUrl || config.borrowersIndex.redisUrl || config.redisUrl;
      if (redisUrl) {
        this.initRedis(redisUrl);
      } else {
        // eslint-disable-next-line no-console
        console.warn('[borrowers-index] Redis mode selected but no Redis URL configured, falling back to memory');
        this.mode = 'memory';
      }
    } else if (this.mode === 'postgres') {
      const postgresUrl = options.postgresUrl || config.databaseUrl;
      if (postgresUrl) {
        this.initPostgres(postgresUrl);
      } else {
        // eslint-disable-next-line no-console
        console.warn('[borrowers-index] Postgres mode selected but no DATABASE_URL configured, falling back to memory');
        this.mode = 'memory';
      }
    }
    // memory mode requires no initialization
  }

  /**
   * Initialize Redis client for persistence
   */
  private async initRedis(redisUrl: string): Promise<void> {
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
      console.warn('[borrowers-index] Failed to connect to Redis, falling back to memory:', err);
      this.redis = null;
      this.mode = 'memory';
    }
  }

  /**
   * Initialize Postgres client for persistence
   */
  private async initPostgres(postgresUrl: string): Promise<void> {
    try {
      this.pg = new PgPool({ connectionString: postgresUrl });
      
      // Test connection
      const client = await this.pg.connect();
      
      // Check if borrowers_index table exists
      const tableCheck = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'borrowers_index'
        );
      `);
      
      const tableExists = tableCheck.rows[0].exists;
      client.release();
      
      if (!tableExists) {
        // eslint-disable-next-line no-console
        console.warn(
          '[borrowers-index] Postgres table "borrowers_index" does not exist. ' +
          'Please run the migration: backend/migrations/20251113_add_borrowers_index.sql'
        );
        // eslint-disable-next-line no-console
        console.warn('[borrowers-index] Falling back to memory mode');
        await this.pg.end();
        this.pg = null;
        this.mode = 'memory';
        return;
      }
      
      // eslint-disable-next-line no-console
      console.log('[borrowers-index] Postgres connected');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[borrowers-index] Failed to connect to Postgres, falling back to memory:', err);
      if (this.pg) {
        try {
          await this.pg.end();
        } catch {
          // Ignore cleanup errors
        }
      }
      this.pg = null;
      this.mode = 'memory';
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

    // Try loading from persistence first (Redis or Postgres)
    const loaded = await this.loadFromPersistence();
    
    if (!loaded) {
      // Perform backfill if not loaded from persistence
      await this.performBackfill();
    }

    // Start live event subscriptions
    await this.startLiveUpdates();

    // eslint-disable-next-line no-console
    console.log('[borrowers-index] Initialization complete');
  }

  /**
   * Load borrower sets from persistence (Redis or Postgres)
   */
  private async loadFromPersistence(): Promise<boolean> {
    if (this.mode === 'memory') {
      return false; // No persistence in memory mode
    }

    if (this.mode === 'redis') {
      return await this.loadFromRedis();
    }

    if (this.mode === 'postgres') {
      return await this.loadFromPostgres();
    }

    return false;
  }

  /**
   * Load borrower sets from Redis
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
   * Load borrower sets from Postgres
   */
  private async loadFromPostgres(): Promise<boolean> {
    if (!this.pg) return false;

    try {
      let totalLoaded = 0;
      
      for (const [asset] of this.reserves) {
        const result = await this.pg.query(
          'SELECT DISTINCT user_address FROM borrowers_index WHERE reserve_address = $1',
          [asset]
        );
        
        if (result.rows.length > 0) {
          const borrowerSet = this.borrowersByReserve.get(asset);
          if (borrowerSet) {
            result.rows.forEach(row => {
              borrowerSet.add(row.user_address.toLowerCase());
              totalLoaded++;
            });
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
   * Save borrower sets to persistence
   */
  private async saveToPersistence(): Promise<void> {
    if (this.mode === 'memory') {
      return; // No persistence in memory mode
    }

    if (this.mode === 'redis') {
      await this.saveToRedis();
    } else if (this.mode === 'postgres') {
      await this.saveToPostgres();
    }
  }

  /**
   * Save borrower sets to Redis
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
   * Save borrower sets to Postgres
   */
  private async saveToPostgres(): Promise<void> {
    if (!this.pg) return;

    try {
      const client = await this.pg.connect();
      
      try {
        await client.query('BEGIN');
        
        for (const [asset, borrowerSet] of this.borrowersByReserve) {
          const reserve = this.reserves.get(asset);
          if (!reserve || borrowerSet.size === 0) continue;

          const borrowers = Array.from(borrowerSet);
          
          // Upsert all borrowers for this reserve
          for (const userAddress of borrowers) {
            await client.query(`
              INSERT INTO borrowers_index (reserve_address, debt_token_address, user_address, updated_at)
              VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
              ON CONFLICT (reserve_address, user_address)
              DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            `, [asset, reserve.variableDebtToken, userAddress]);
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

      let added: string[] = [];
      let removed: string[] = [];

      // Mint (from zero address): add borrower
      if (from === BorrowersIndexService.ZERO_ADDRESS && to !== BorrowersIndexService.ZERO_ADDRESS) {
        borrowers.add(to);
        added.push(to);
      }
      // Burn (to zero address): remove borrower (full repayment)
      // Note: This is conservative - user is removed when debt token is burned (transferred to zero)
      // which indicates full debt repayment. Users with partial repayment remain in the set.
      else if (to === BorrowersIndexService.ZERO_ADDRESS && from !== BorrowersIndexService.ZERO_ADDRESS) {
        borrowers.delete(from);
        removed.push(from);
      }
      // Transfer between users: add recipient (debt reassignment)
      else if (from !== BorrowersIndexService.ZERO_ADDRESS && to !== BorrowersIndexService.ZERO_ADDRESS) {
        borrowers.add(to);
        added.push(to);
        // Keep 'from' in set as well (they may still have debt after partial transfer)
      }

      // Update persistence in real-time for Postgres mode
      if (this.mode === 'postgres' && (added.length > 0 || removed.length > 0)) {
        this.updatePostgresTransfer(asset, added, removed).catch(err => {
          // eslint-disable-next-line no-console
          console.warn('[borrowers-index] Failed to update Postgres in real-time:', err);
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[borrowers-index] Failed to process Transfer log:', err);
    }
  }

  /**
   * Update Postgres for a transfer event (real-time updates)
   */
  private async updatePostgresTransfer(asset: string, added: string[], removed: string[]): Promise<void> {
    if (!this.pg) return;

    const reserve = this.reserves.get(asset);
    if (!reserve) return;

    try {
      const client = await this.pg.connect();
      
      try {
        // Add new borrowers
        for (const userAddress of added) {
          await client.query(`
            INSERT INTO borrowers_index (reserve_address, debt_token_address, user_address, updated_at)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT (reserve_address, user_address)
            DO UPDATE SET updated_at = CURRENT_TIMESTAMP
          `, [asset, reserve.variableDebtToken, userAddress]);
        }

        // Remove borrowers who fully repaid
        for (const userAddress of removed) {
          await client.query(
            'DELETE FROM borrowers_index WHERE reserve_address = $1 AND user_address = $2',
            [asset, userAddress]
          );
        }
      } finally {
        client.release();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[borrowers-index] Postgres real-time update failed:', err);
    }
  }

  /**
   * Get borrowers for a specific reserve
   * @param asset Reserve asset address
   * @param limit Optional limit on number of borrowers returned
   */
  async getBorrowers(asset: string, limit?: number): Promise<string[]> {
    const assetLower = asset.toLowerCase();
    
    // For Postgres mode with large datasets, query directly from DB
    if (this.mode === 'postgres' && this.pg && limit) {
      try {
        const result = await this.pg.query(
          'SELECT user_address FROM borrowers_index WHERE reserve_address = $1 ORDER BY updated_at DESC LIMIT $2',
          [assetLower, limit]
        );
        return result.rows.map(row => row.user_address.toLowerCase());
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[borrowers-index] Failed to query Postgres, falling back to memory:', err);
      }
    }
    
    // Memory/Redis mode or Postgres fallback
    const borrowers = this.borrowersByReserve.get(assetLower);
    if (!borrowers) return [];
    
    const borrowerArray = Array.from(borrowers);
    return limit ? borrowerArray.slice(0, limit) : borrowerArray;
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
    if (this.pg) {
      try {
        await this.pg.end();
      } catch (err) {
        // Ignore cleanup errors
      }
      this.pg = null;
    }

    // eslint-disable-next-line no-console
    console.log('[borrowers-index] Service stopped');
  }
}
