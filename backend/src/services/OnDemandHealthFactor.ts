// OnDemandHealthFactor: Minimal per-user health factor resolution
import { GraphQLClient, gql } from 'graphql-request';
import { z } from 'zod';

import type { User } from '../types/index.js';
import { HealthCalculator } from './HealthCalculator.js';

/**
 * Single-user health factor query.
 * Accepts numeric fields as number|string for resilience.
 */
const SINGLE_USER_QUERY = gql`
  query SingleUserWithDebt($id: ID!) {
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
          price {
            priceInEth
          }
        }
      }
    }
  }
`;

// Helpers to normalize numeric strings
const numericString = z.string().regex(/^\d+$/).transform(v => Number(v));

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

export interface OnDemandHealthFactorOptions {
  client: GraphQLClient;
  debugErrors?: boolean;
}

/**
 * OnDemandHealthFactor provides single-user health factor resolution.
 * No caching, no batching - strictly on-demand per liquidation event.
 */
export class OnDemandHealthFactor {
  private client: GraphQLClient;
  private healthCalculator: HealthCalculator;
  private debugErrors: boolean;

  constructor(options: OnDemandHealthFactorOptions) {
    this.client = options.client;
    this.healthCalculator = new HealthCalculator();
    this.debugErrors = options.debugErrors ?? false;
  }

  /**
   * Get health factor for a single user.
   * Returns null if user not found or has zero debt.
   */
  async getHealthFactor(userId: string): Promise<number | null> {
    try {
      const data = await this.client.request<{ user: unknown }>(SINGLE_USER_QUERY, { id: userId });

      if (!data.user) {
        return null;
      }

      const user = UserSchema.parse(data.user) as User;
      const result = this.healthCalculator.calculateHealthFactor(user);

      // Return null for zero debt or invalid health factors
      if (result.totalDebtETH === 0 || !isFinite(result.healthFactor)) {
        return null;
      }

      return result.healthFactor;
    } catch (err) {
      this.logError('getHealthFactor', userId, err);
      return null;
    }
  }

  private logError(context: string, userId: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[on-demand-hf] ${context}(${userId}) error: ${message}`);

    if (this.debugErrors) {
      // eslint-disable-next-line no-console
      console.error('[on-demand-hf][debug] full error:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
    }
  }
}
