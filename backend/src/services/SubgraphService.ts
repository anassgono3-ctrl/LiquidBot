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

const ReserveSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number(),
  reserveLiquidationThreshold: z.number(),
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
  borrowedReservesCount: z.number(),
  reserves: z.array(UserReserveSchema),
});

// Liquidation call fields may differ between gateway variants (string vs nested object).
const LiquidationCallRawSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  liquidator: z.union([z.string(), z.object({ id: z.string() })]),
  user: z.union([z.string(), z.object({ id: z.string() })]),
  principalAmount: z.string(),
  collateralAmount: z.string(),
});

const LiquidationCallSchema = LiquidationCallRawSchema.transform(raw => ({
  id: raw.id,
  timestamp: raw.timestamp,
  liquidator: typeof raw.liquidator === 'string' ? raw.liquidator : raw.liquidator.id,
  user: typeof raw.user === 'string' ? raw.user : raw.user.id,
  principalAmount: raw.principalAmount,
  collateralAmount: raw.collateralAmount
}));

export interface SubgraphServiceOptions {
  mock?: boolean;
  client?: Pick<GraphQLClient, 'request'>;
  endpointOverride?: string;
}

export class SubgraphService {
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
    this.mock = typeof opts.mock === 'boolean' ? opts.mock : config.useMockSubgraph;

    if (this.mock) {
      this.client = null;
    } else {
      if (opts.client) {
        this.client = opts.client;
      } else {
        const endpoint = opts.endpointOverride || config.subgraphUrl;
        const redacted =
          config.graphApiKey && endpoint.includes(config.graphApiKey)
            ? endpoint.replace(config.graphApiKey, '****')
            : endpoint;
        // eslint-disable-next-line no-console
        console.log(`[subgraph] Using gateway URL: ${redacted}`);
        this.client = new GraphQLClient(endpoint);
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
    return !!(err && typeof err === 'object' && 'name' in err && err.name === 'ZodError');
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
      const errMsg = e instanceof Error ? e.message : String(e);
      const wrapped = new Error(`${op} failed: ${errMsg}`);
      (wrapped as Error & { original: unknown }).original = e;
      if (config.subgraphDebugErrors) {
        // eslint-disable-next-line no-console
        console.error('[subgraph][debug] op failure original error:', e);
      }
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
      refillIntervalMs: this.refillIntervalMs
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
          liquidationCalls(first: $first, orderBy: timestamp, orderDirection: desc) {
            id
            timestamp
            liquidator
            user
            principalAmount
            collateralAmount
          }
        }
      `;
      const data = await this.client!.request<{ liquidationCalls: unknown[] }>(query, { first });
      // Transform & normalize
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

  async getUsersWithDebt(first = 100): Promise<User[]> {
    if (this.mock) {
      return [
        { id: '0xMockUser1', borrowedReservesCount: 2, reserves: [] },
        { id: '0xMockUser2', borrowedReservesCount: 1, reserves: [] },
      ] as User[];
    }
    if (this.degraded) return [];
    this.ensureLive();
    return this.perform('usersWithDebt', async () => {
      const query = gql`
        query Users($first: Int!) {
          users(first: $first, where: { borrowedReservesCount_gt: 0 }) {
            id borrowedReservesCount
            reserves {
              currentATokenBalance currentVariableDebt currentStableDebt
              reserve {
                id symbol name decimals reserveLiquidationThreshold usageAsCollateralEnabled price { priceInEth }
              }
            }
          }
        }
      `;
      const data = await this.client!.request<{ users: unknown[] }>(query, { first });
      return z.array(UserSchema).parse(data.users);
    });
  }
}
