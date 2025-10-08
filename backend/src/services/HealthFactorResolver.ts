// HealthFactorResolver: On-demand health factor resolution with caching
import { GraphQLClient, gql } from 'graphql-request';
import { z } from 'zod';

import {
  userHealthQueriesTotal,
  userHealthCacheHitsTotal,
  userHealthCacheMissesTotal
} from '../metrics/index.js';
import type { User } from '../types/index.js';

import { HealthCalculator } from './HealthCalculator.js';

/**
 * IMPORTANT:
 * The subgraph returns several numeric fields as strings (e.g. reserveLiquidationThreshold, decimals).
 * We accept union(number|string) and normalize to number so downstream logic is stable.
 */

const SINGLE_USER_HF_QUERY = gql`
  query SingleUserHealthFactor($id: ID!) {
    user(id: $id) {
      id
      borrowedReservesCount
      reserves {
        currentATokenBalance
        currentVariableDebt
        currentStableDebt
        reserve {
          symbol
          decimals
          reserveLiquidationThreshold
          usageAsCollateralEnabled
          price {
            priceInEth
          }
        }
      }
    }
  }
`;

const BATCH_USER_HF_QUERY = gql`
  query BatchUserHealthFactors($ids: [String!]!) {
    users(where: { id_in: $ids }) {
      id
      borrowedReservesCount
      reserves {
        currentATokenBalance
        currentVariableDebt
        currentStableDebt
        reserve {
          symbol
          decimals
          reserveLiquidationThreshold
          usageAsCollateralEnabled
          price {
            priceInEth
          }
        }
      }
    }
  }
`;

// Helpers to coerce numeric strings
const numericString = z.string().regex(/^\d+$/).transform(v => Number(v));

const ReserveSchema = z.object({
  symbol: z.string(),
  decimals: z.union([z.number(), numericString]).transform(v => typeof v === 'number' ? v : Number(v)),
  reserveLiquidationThreshold: z.union([z.number(), numericString]).transform(v => typeof v === 'number' ? v : Number(v)),
  usageAsCollateralEnabled: z.boolean(),
  price: z.object({ priceInEth: z.string() }), // priceInEth remains string; HealthCalculator already handles parsing
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

interface CacheEntry {
  healthFactor: number | null;
  timestamp: number;
}

export interface HealthFactorResolverOptions {
  client: GraphQLClient;
  cacheTtlMs?: number;
  maxBatchSize?: number;
  debugErrors?: boolean;
}

/**
 * HealthFactorResolver provides on-demand health factor resolution with caching.
 * - Queries subgraph only for specific user addresses
 * - Caches results with configurable TTL
 * - Supports batching to reduce round trips
 * - Returns null for users with zero debt (instead of Infinity)
 */
export class HealthFactorResolver {
  private client: GraphQLClient;
  private healthCalculator: HealthCalculator;
  private cache: Map<string, CacheEntry>;
  private cacheTtlMs: number;
  private maxBatchSize: number;
  private debugErrors: boolean;

  constructor(options: HealthFactorResolverOptions) {
    this.client = options.client;
    this.healthCalculator = new HealthCalculator();
    this.cache = new Map();
    this.cacheTtlMs = options.cacheTtlMs ?? 60000; // Default 60s
    this.maxBatchSize = options.maxBatchSize ?? 25;
    this.debugErrors = options.debugErrors ?? false;
  }

  /**
   * Get health factors for multiple users.
   * Uses cache when available, batches queries for cache misses.
   * @param userIds Array of user addresses (lowercase recommended)
   * @returns Map of user ID to health factor (null if zero debt)
   */
  async getHealthFactorsForUsers(userIds: string[]): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>();
    const toFetch: string[] = [];
    const now = Date.now();

    for (const userId of userIds) {
      const entry = this.cache.get(userId);
      if (entry && (now - entry.timestamp) < this.cacheTtlMs) {
        result.set(userId, entry.healthFactor);
        userHealthCacheHitsTotal.inc();
      } else {
        toFetch.push(userId);
        userHealthCacheMissesTotal.inc();
      }
    }

    if (toFetch.length > 0) {
      const fetched = await this.fetchHealthFactors(toFetch);
      for (const [userId, hf] of fetched.entries()) {
        result.set(userId, hf);
        this.cache.set(userId, { healthFactor: hf, timestamp: now });
      }
    }

    return result;
  }

  /**
   * Fetch health factors from subgraph for given user IDs.
   * Batches queries when multiple users are requested.
   */
  private async fetchHealthFactors(userIds: string[]): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>();
    if (userIds.length === 0) return result;

    if (userIds.length === 1) {
      const userId = userIds[0];
      try {
        const data = await this.client.request<{ user: unknown }>(SINGLE_USER_HF_QUERY, { id: userId });
        userHealthQueriesTotal.inc({ mode: 'single', result: 'success' });

        if (data.user) {
          const user = UserSchema.parse(data.user) as User;
            const hf = this.calculateHealthFactor(user);
            result.set(userId, hf);
        } else {
          result.set(userId, null);
        }
      } catch (err) {
        userHealthQueriesTotal.inc({ mode: 'single', result: 'error' });
        this.logError('single user query', err);
        result.set(userId, null);
      }
    } else {
      const chunks = this.chunkArray(userIds, this.maxBatchSize);
      for (const chunk of chunks) {
        try {
          const data = await this.client.request<{ users: unknown[] }>(BATCH_USER_HF_QUERY, { ids: chunk });
          userHealthQueriesTotal.inc({ mode: 'batch', result: 'success' });

          // Parse with tolerant schema (handles string/number)
          const users = z.array(UserSchema).parse(data.users) as User[];

          for (const user of users) {
            const hf = this.calculateHealthFactor(user);
            result.set(user.id, hf);
          }

          for (const userId of chunk) {
            if (!result.has(userId)) {
              result.set(userId, null);
            }
          }
        } catch (err) {
          userHealthQueriesTotal.inc({ mode: 'batch', result: 'error' });
          this.logError('batch query', err);
          for (const userId of chunk) {
            if (!result.has(userId)) {
              result.set(userId, null);
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Calculate health factor for a user.
   * Returns null if user has zero debt or invalid data.
   */
  private calculateHealthFactor(user: User): number | null {
    try {
      const result = this.healthCalculator.calculateHealthFactor(user);
      if (result.totalDebtETH === 0 || !isFinite(result.healthFactor)) {
        return null;
      }
      return result.healthFactor;
    } catch (err) {
      this.logError('health factor calculation', err);
      return null;
    }
  }

  private logError(context: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[health-resolver] ${context} error: ${message}`);

    if (this.debugErrors) {
      // eslint-disable-next-line no-console
      console.error('[health-resolver][debug] full error:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  getCacheStats() {
    return {
      size: this.cache.size,
      ttlMs: this.cacheTtlMs,
      maxBatchSize: this.maxBatchSize
    };
  }

  clearCache(): void {
    this.cache.clear();
  }
}
