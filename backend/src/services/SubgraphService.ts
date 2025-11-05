// SubgraphService: Fetch data from Aave V3 Base subgraph via The Graph Gateway
import { GraphQLClient, gql } from 'graphql-request';
import { z } from 'zod';

import { config } from '../config/index.js';
import type { LiquidationCall, Reserve, User } from '../types/index.js';
import {
  subgraphRequestsTotal,
  subgraphRequestDuration,
  subgraphConsecutiveFailures,
  subgraphLastSuccessTs,
  subgraphFallbackActivations,
  subgraphRateLimitDropped
} from '../metrics/index.js';

// Helper for numeric fields that may come as strings
const numericString = z.string().regex(/^\d+$/).transform(v => Number(v));

/**
 * Extract a valid Ethereum address from a potentially composite ID.
 * Aave subgraph reserve.id may be composite (underlyingAsset + PoolAddressesProvider).
 * This extracts the first valid 0x[a-fA-F0-9]{40} substring.
 * @param value The value to extract address from
 * @returns The extracted address or original value if no valid address found
 */
function extractAddress(value: string): string {
  if (!value) return value;
  
  // If it's already a valid address (0x + 40 hex chars), return as-is
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return value;
  }
  
  // Try to extract first valid address from composite string
  const match = value.match(/0x[0-9a-fA-F]{40}/);
  if (match) {
    return match[0];
  }
  
  // Return original value if no valid address found
  return value;
}

const ReserveSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.union([z.number(), numericString]).transform(v => typeof v === 'number' ? v : Number(v)),
  reserveLiquidationThreshold: z.union([z.number(), numericString]).transform(v => typeof v === 'number' ? v : Number(v)),
  usageAsCollateralEnabled: z.boolean(),
  price: z.object({ priceInEth: z.string() }),
});

const UserReserveSchema = z.object({
  currentATokenBalance: z.string(),
  currentVariableDebt: z.string(),
  currentStableDebt: z.string(),
  reserve: ReserveSchema,
});

const UserSchema = z.object({
  id: z.string(),
  borrowedReservesCount: z.union([z.number(), numericString]).transform(v => typeof v === 'number' ? v : Number(v)),
  reserves: z.array(UserReserveSchema),
});

// --- Updated liquidation schemas ---

const LiquidationReserveSchema = z.object({
  id: z.string(),
  underlyingAsset: z.string().optional(),
  symbol: z.string().optional(),
  decimals: z.union([
    z.number(),
    z.string().regex(/^\d+$/).transform(v => Number(v))
  ]).optional()
});

const LiquidationCallRawSchema = z.object({
  id: z.string(),
  timestamp: z.union([z.number(), z.string().regex(/^\d+$/)]),
  user: z.union([z.string(), z.object({ id: z.string() })]),
  liquidator: z.string(),
  collateralReserve: LiquidationReserveSchema.optional(),
  principalReserve: LiquidationReserveSchema.optional(),
  collateralAmount: z.string(),
  principalAmount: z.string(),
  txHash: z.string().optional()
});

const LiquidationCallSchema = LiquidationCallRawSchema.transform(raw => {
  const tsNum = typeof raw.timestamp === 'number' ? raw.timestamp : Number(raw.timestamp);
  return {
    id: raw.id,
    timestamp: tsNum,
    user: typeof raw.user === 'string' ? raw.user : raw.user.id,
    liquidator: raw.liquidator,
    principalAmount: raw.principalAmount,
    collateralAmount: raw.collateralAmount,
    txHash: raw.txHash || null,
    principalReserve: raw.principalReserve ? {
      id: raw.principalReserve.underlyingAsset 
        ? raw.principalReserve.underlyingAsset 
        : extractAddress(raw.principalReserve.id),
      symbol: raw.principalReserve.symbol || null,
      decimals: raw.principalReserve.decimals !== undefined
        ? (typeof raw.principalReserve.decimals === 'number'
            ? raw.principalReserve.decimals
            : Number(raw.principalReserve.decimals))
        : null
    } : null,
    collateralReserve: raw.collateralReserve ? {
      id: raw.collateralReserve.underlyingAsset 
        ? raw.collateralReserve.underlyingAsset 
        : extractAddress(raw.collateralReserve.id),
      symbol: raw.collateralReserve.symbol || null,
      decimals: raw.collateralReserve.decimals !== undefined
        ? (typeof raw.collateralReserve.decimals === 'number'
            ? raw.collateralReserve.decimals
            : Number(raw.collateralReserve.decimals))
        : null
    } : null
  };
});

export interface SubgraphServiceOptions {
  mock?: boolean;
  client?: Pick<GraphQLClient, 'request'>;
  endpointOverride?: string;
}

export class SubgraphService {
  private static _instanceCount = 0;

  private client: Pick<GraphQLClient, 'request'> | null;
  private mock: boolean;
  private consecutiveFailures = 0;
  private degraded = false;

  // Rate limiting
  private tokens: number;
  private readonly capacity: number;
  private readonly refillIntervalMs: number;
  private lastRefill: number;

  constructor(opts: SubgraphServiceOptions = {}) {
    // Increment instance counter
    SubgraphService._instanceCount += 1;

    // Hard guard: throw in non-development/test if more than one instance
    const allowMultiple = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    if (!allowMultiple && SubgraphService._instanceCount > 1) {
      throw new Error(
        `[subgraph] FATAL: Multiple SubgraphService instances detected (count=${SubgraphService._instanceCount}). ` +
        `This indicates stale dist artifacts or duplicate imports. Clean build required.`
      );
    }

    this.mock = typeof opts.mock === 'boolean' ? opts.mock : config.useMockSubgraph;

    if (this.mock) {
      this.client = null;
    } else {
      if (opts.client) {
        this.client = opts.client;
      } else {
        const { endpoint, mode, needsHeader } = config.resolveSubgraphEndpoint();
        let headers: Record<string, string> | undefined;
        if (needsHeader) {
          if (!config.graphApiKey) {
            console.warn('[subgraph] WARNING: header auth required but GRAPH_API_KEY missing.');
          } else {
            headers = { Authorization: `Bearer ${config.graphApiKey}` };
          }
        }

        // Check for dual auth configuration
        if (needsHeader && config.graphApiKey && endpoint.includes(`/${config.graphApiKey}/subgraphs/`)) {
          console.warn(
            '[subgraph] WARNING: dual auth configuration (path+header). ' +
            'Remove key from SUBGRAPH_URL when using header mode.'
          );
        }

        const redacted = config.graphApiKey
          ? endpoint.replaceAll(config.graphApiKey, '****')
          : endpoint;
        // eslint-disable-next-line no-console
        console.log(
          `[subgraph] Using gateway URL: ${redacted} ` +
          `(auth-mode=${mode}, header=${needsHeader ? 'yes' : 'no'}, instance=${SubgraphService._instanceCount})`
        );
        this.client = new GraphQLClient(endpoint, { headers });
      }
    }

    this.capacity = config.subgraphRateLimitCapacity;
    this.refillIntervalMs = config.subgraphRateLimitIntervalMs;
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  static createMock(): SubgraphService {
    return new SubgraphService({ mock: true });
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  private ensureLive() {
    if (this.mock || this.degraded) throw new Error('MOCK_OR_DEGRADED');
    if (!this.client) throw new Error('CLIENT_NOT_INITIALIZED');
  }

  private refillTokens() {
    const now = Date.now();
    if (now - this.lastRefill >= this.refillIntervalMs) {
      this.tokens = this.capacity;
      this.lastRefill = now;
    }
  }

  private consumeTokenOrDrop(): boolean {
    this.refillTokens();
    if (this.tokens > 0) {
      this.tokens -= 1;
      return true;
    }
    subgraphRateLimitDropped.inc();
    return false;
  }

  private isParseError(err: unknown): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return !!(err && typeof err === 'object' && (err as any).name === 'ZodError');
  }

  private async perform<T>(op: string, fn: () => Promise<T>): Promise<T> {
    if (this.mock || this.degraded) {
      subgraphRequestsTotal.inc({ status: 'fallback' });
      return fn();
    }

    if (!this.consumeTokenOrDrop()) {
      throw new Error('SUBGRAPH_RATE_LIMITED');
    }

    const endTimer = subgraphRequestDuration.startTimer({ operation: op });
    try {
      const result = await this.retry(fn);
      this.consecutiveFailures = 0;
      subgraphConsecutiveFailures.set(0);
      subgraphLastSuccessTs.set(Date.now() / 1000);
      subgraphRequestsTotal.inc({ status: 'success' });
      endTimer();
      return result;
    } catch (e) {
      subgraphRequestsTotal.inc({ status: 'error' });
      endTimer();
      // Only network / logical failures (not parse) affect degradation
      if (!this.isParseError(e)) {
        this.consecutiveFailures += 1;
        subgraphConsecutiveFailures.set(this.consecutiveFailures);
        if (this.consecutiveFailures >= config.subgraphFailureThreshold) {
          this.degraded = true;
          subgraphFallbackActivations.inc();
          // eslint-disable-next-line no-console
          console.warn(
            `[subgraph] Failure threshold reached (${this.consecutiveFailures}) – switching to degraded fallback mode`
          );
        }
      }
      if (config.subgraphDebugErrors) {
        // eslint-disable-next-line no-console
        console.error('[subgraph][debug] op failure original error:', e);
        try {
          // eslint-disable-next-line no-console
          console.error('[subgraph][debug] serialized:', JSON.stringify(e, Object.getOwnPropertyNames(e), 2));
        // eslint-disable-next-line no-empty
        } catch {}
      }

      const msg = e instanceof Error ? e.message : String(e);
      const wrapped = new Error(`${op} failed: ${msg}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (wrapped as any).original = e;
      throw wrapped;
    }
  }

  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    const attempts = config.subgraphRetryAttempts;
    const base = config.subgraphRetryBaseMs;
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const backoff = base * Math.pow(2, i) + Math.floor(Math.random() * 25);
        await new Promise(r => setTimeout(r, backoff));
      }
    }
    throw lastErr;
  }

  // Public degraded health snapshot
  healthStatus() {
    return {
      mode: this.mock ? 'mock' : (this.degraded ? 'degraded' : 'live'),
      consecutiveFailures: this.consecutiveFailures,
      fallbackActivated: this.degraded,
      tokensRemaining: this.tokens,
      capacity: this.capacity,
      refillIntervalMs: this.refillIntervalMs,
      instanceCount: SubgraphService._instanceCount
    };
  }

  async getLiquidationCalls(first = 100): Promise<LiquidationCall[]> {
    if (this.mock || this.degraded) {
      return [];
    }
    this.ensureLive();
    return this.perform('liquidationCalls', async () => {
      const query = gql`
        query LiquidationCalls($first: Int!) {
          liquidationCalls(
            first: $first,
            orderBy: timestamp,
            orderDirection: desc
          ) {
            id
            timestamp
            user { id }
            liquidator
            collateralReserve { id underlyingAsset symbol decimals }
            principalReserve { id underlyingAsset symbol decimals }
            collateralAmount
            principalAmount
            txHash
          }
        }
      `;
      const data = await this.client!.request<{ liquidationCalls: unknown[] }>(query, { first });
      return z.array(LiquidationCallSchema).parse(data.liquidationCalls) as unknown as LiquidationCall[];
    });
  }

  async getReserves(): Promise<Reserve[]> {
    if (this.mock) {
      return [{
        id: 'mock-asset-1',
        symbol: 'MCK',
        name: 'Mock Asset',
        decimals: 18,
        reserveLiquidationThreshold: 8000,
        usageAsCollateralEnabled: true,
        price: { priceInEth: '1' }
      }] as Reserve[];
    }
    if (this.degraded) return []; // degrade to empty safely
    this.ensureLive();
    return this.perform('reserves', async () => {
      const query = gql`
        query GetReserves {
          reserves(first: 100, where: { usageAsCollateralEnabled: true }) {
            id symbol name decimals reserveLiquidationThreshold usageAsCollateralEnabled price { priceInEth }
          }
        }
      `;
      const data = await this.client!.request<{ reserves: unknown[] }>(query);
      return z.array(ReserveSchema).parse(data.reserves);
    });
  }

  /**
   * @deprecated DISABLED - Bulk user queries are no longer supported.
   * Use getSingleUserWithDebt(userId) for on-demand single-user queries only.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getUsersWithDebt(_first = 100): Promise<User[]> {
    throw new Error('getUsersWithDebt is DISABLED - use getSingleUserWithDebt(userId) for on-demand queries');
  }

  /**
   * @deprecated DISABLED - Bulk health snapshots are no longer supported.
   * Use OnDemandHealthFactor service for per-user health factor queries.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getUserHealthSnapshot(_limit = 500): Promise<User[]> {
    throw new Error('getUserHealthSnapshot is DISABLED - use OnDemandHealthFactor service for on-demand queries');
  }

  /**
   * Get a single user with debt information for health factor calculation.
   * This is the ONLY supported method for user health queries (on-demand, per liquidation).
   * @param userId The user address to query
   * @returns User data or null if not found
   */
  async getSingleUserWithDebt(userId: string): Promise<User | null> {
    if (this.mock) {
      return { id: userId, borrowedReservesCount: 1, reserves: [] } as User;
    }
    if (this.degraded) return null;
    this.ensureLive();
    return this.perform('singleUserWithDebt', async () => {
      const query = gql`
        query SingleUser($id: ID!) {
          user(id: $id) {
            id
            borrowedReservesCount
            reserves {
              currentATokenBalance
              currentVariableDebt
              currentStableDebt
              reserve {
                id
                symbol
                name
                decimals
                reserveLiquidationThreshold
                usageAsCollateralEnabled
                price { priceInEth }
              }
            }
          }
        }
      `;
      const data = await this.client!.request<{ user: unknown }>(query, { id: userId });
      if (!data.user) return null;
      return UserSchema.parse(data.user);
    });
  }

  /**
   * Get users with borrowing activity for real-time candidate seeding.
   * Supports paging up to candidateMax when USE_SUBGRAPH=true.
   * @param limit Maximum number of users to fetch (respects candidateMax)
   * @param enablePaging When true, fetches multiple pages up to limit
   * @returns Array of user data with reserve information
   */
  async getUsersWithBorrowing(limit: number, enablePaging = true): Promise<User[]> {
    if (!enablePaging) {
      // Legacy behavior: single page, clamped to page size (max 1000)
      return this.getUsersPage(limit);
    }

    // Paging support: fetch multiple pages up to limit
    // Respect The Graph's max 1000 limit per page
    const pageSize = Math.min(config.subgraphPageSize, 1000);
    const totalToFetch = Math.min(limit, config.candidateMax);
    
    if (this.mock || this.degraded) {
      return [];
    }
    this.ensureLive();

    const allUsers: User[] = [];
    let pagesFetched = 0;
    let skip = 0;

    // eslint-disable-next-line no-console
    console.log(`[subgraph] Fetching users with paging: total=${totalToFetch} pageSize=${pageSize}`);

    while (allUsers.length < totalToFetch) {
      const remaining = totalToFetch - allUsers.length;
      const currentPageSize = Math.min(pageSize, remaining);

      try {
        const users = await this.perform('usersPageWithSkip', async () => {
          const query = gql`
            query UsersPageWithSkip($first: Int!, $skip: Int!) {
              users(first: $first, skip: $skip, where: { borrowedReservesCount_gt: 0 }) {
                id
                borrowedReservesCount
                reserves {
                  currentATokenBalance
                  currentVariableDebt
                  currentStableDebt
                  reserve {
                    id
                    symbol
                    name
                    decimals
                    reserveLiquidationThreshold
                    usageAsCollateralEnabled
                    price { priceInEth }
                  }
                }
              }
            }
          `;
          const data = await this.client!.request<{ users: unknown[] }>(query, { 
            first: currentPageSize, 
            skip 
          });

          return z.array(UserSchema).parse(data.users);
        });

        if (users.length === 0) {
          // No more users available
          break;
        }

        allUsers.push(...users);
        pagesFetched++;
        skip += users.length;

        // If we got fewer users than requested, we've exhausted the subgraph
        if (users.length < currentPageSize) {
          break;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[subgraph] getUsersWithBorrowing page ${pagesFetched + 1} failed:`, err);
        break;
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[subgraph] seed_source=subgraph pages_fetched=${pagesFetched} total_candidates=${allUsers.length}`);

    return allUsers;
  }

  /**
   * Get a page of users with debt for at-risk scanning.
   * This performs a lightweight bulk query for proactive health monitoring.
   * @param limit Maximum number of users to fetch (clamped to configured page size, max 1000)
   * @returns Array of user data with reserve information
   */
  async getUsersPage(limit: number): Promise<User[]> {
    // Respect The Graph's max 1000 limit and configured page size
    const pageSize = Math.min(config.subgraphPageSize || 1000, 1000);
    const clampedLimit = Math.min(limit, pageSize);
    if (clampedLimit !== limit && limit > pageSize) {
      // eslint-disable-next-line no-console
      console.warn(`[subgraph] getUsersPage: limit ${limit} clamped to ${clampedLimit} (pageSize=${pageSize})`);
    }

    if (this.mock) {
      return [];
    }
    if (this.degraded) return [];
    this.ensureLive();
    
    return this.perform('usersPage', async () => {
      const query = gql`
        query UsersPage($first: Int!) {
          users(first: $first, where: { borrowedReservesCount_gt: 0 }) {
            id
            borrowedReservesCount
            reserves {
              currentATokenBalance
              currentVariableDebt
              currentStableDebt
              reserve {
                id
                symbol
                name
                decimals
                reserveLiquidationThreshold
                usageAsCollateralEnabled
                price { priceInEth }
              }
            }
          }
        }
      `;
      const data = await this.client!.request<{ users: unknown[] }>(query, { first: clampedLimit });
      
      // Defensive validation: check for missing reserve fields before parsing
      if (Array.isArray(data.users)) {
        for (const user of data.users) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (typeof user === 'object' && user !== null && 'reserves' in user && Array.isArray((user as any).reserves)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const ur of (user as any).reserves) {
              const reserve = ur?.reserve;
              if (reserve && typeof reserve === 'object') {
                const missingFields: string[] = [];
                if (!reserve.id) missingFields.push('id');
                if (!reserve.symbol) missingFields.push('symbol');
                if (!reserve.name) missingFields.push('name');
                if (reserve.decimals === undefined) missingFields.push('decimals');
                if (reserve.reserveLiquidationThreshold === undefined) missingFields.push('reserveLiquidationThreshold');
                if (reserve.usageAsCollateralEnabled === undefined) missingFields.push('usageAsCollateralEnabled');
                if (!reserve.price?.priceInEth) missingFields.push('price.priceInEth');
                
                if (missingFields.length > 0) {
                  // eslint-disable-next-line no-console
                  console.warn(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    `[subgraph] getUsersPage: missing reserve fields for user ${(user as any).id}, reserve ${reserve.id || 'unknown'}: ${missingFields.join(', ')}`
                  );
                }
              }
            }
          }
        }
      }
      
      return z.array(UserSchema).parse(data.users);
    });
  }
}
