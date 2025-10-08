// HealthFactorVerifier: Cross-verify health factors with filtered recomputation
import { GraphQLClient, gql } from 'graphql-request';
import { z } from 'zod';

import type { User } from '../types/index.js';
import { HealthCalculator } from './HealthCalculator.js';

/**
 * Query for single user with all reserves (for verification).
 * Accepts numeric fields as number|string for resilience.
 */
const SINGLE_USER_QUERY = gql`
  query SingleUserForVerification($id: ID!) {
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

export interface HealthFactorVerificationResult {
  original: number;         // Original computed HF
  verified: number;         // Recomputed HF with filters
  diff: number;             // Absolute difference
  isConsistent: boolean;    // True if diff within tolerance
}

export interface HealthFactorVerifierOptions {
  client: GraphQLClient;
  tolerance?: number;       // Acceptable difference threshold (default: 0.01)
  debugErrors?: boolean;
}

/**
 * HealthFactorVerifier provides health factor cross-verification.
 * Recomputes HF with filtered reserves and compares with original value.
 */
export class HealthFactorVerifier {
  private client: GraphQLClient;
  private healthCalculator: HealthCalculator;
  private tolerance: number;
  private debugErrors: boolean;

  constructor(options: HealthFactorVerifierOptions) {
    this.client = options.client;
    this.healthCalculator = new HealthCalculator();
    this.tolerance = options.tolerance ?? 0.01;
    this.debugErrors = options.debugErrors ?? false;
  }

  /**
   * Verify health factor for a single user.
   * Returns verification result or null if verification fails.
   */
  async verifyHealthFactor(userId: string, originalHF: number): Promise<HealthFactorVerificationResult | null> {
    try {
      const data = await this.client.request<{ user: unknown }>(SINGLE_USER_QUERY, { id: userId });

      if (!data.user) {
        return null;
      }

      const user = UserSchema.parse(data.user) as User;
      
      // Recompute health factor with all reserves
      const result = this.healthCalculator.calculateHealthFactor(user);

      // Handle zero debt or invalid health factors
      if (result.totalDebtETH === 0 || !isFinite(result.healthFactor)) {
        return null;
      }

      const verifiedHF = result.healthFactor;
      const diff = Math.abs(verifiedHF - originalHF);
      const isConsistent = diff <= this.tolerance;

      return {
        original: originalHF,
        verified: verifiedHF,
        diff,
        isConsistent
      };
    } catch (err) {
      this.logError('verifyHealthFactor', userId, err);
      return null;
    }
  }

  private logError(context: string, userId: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[hf-verifier] ${context}(${userId}) error: ${message}`);

    if (this.debugErrors) {
      // eslint-disable-next-line no-console
      console.error('[hf-verifier][debug] full error:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
    }
  }
}
