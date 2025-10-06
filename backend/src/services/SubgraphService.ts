// SubgraphService: Fetch data from Aave V3 Base subgraph
import { GraphQLClient, gql } from 'graphql-request';
import { z } from 'zod';

import { config } from '../config/index.js';
import type { LiquidationCall, Reserve, User } from '../types/index.js';

// Zod schemas for validation
const ReserveSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number(),
  reserveLiquidationThreshold: z.number(),
  usageAsCollateralEnabled: z.boolean(),
  price: z.object({
    priceInEth: z.string(),
  }),
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

const LiquidationCallSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  liquidator: z.string(),
  user: z.string(),
  principalAmount: z.string(),
  collateralAmount: z.string(),
});

export class SubgraphService {
  private client: GraphQLClient;

  constructor(subgraphUrl?: string) {
    this.client = new GraphQLClient(subgraphUrl || config.subgraphUrl);
  }

  /**
   * Fetch recent liquidation calls
   * @param first Number of liquidations to fetch
   */
  async getLiquidationCalls(first = 100): Promise<LiquidationCall[]> {
    const query = gql`
      query GetLiquidationCalls($first: Int!) {
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

    const data = await this.client.request<{ liquidationCalls: unknown[] }>(query, { first });
    return z.array(LiquidationCallSchema).parse(data.liquidationCalls);
  }

  /**
   * Fetch reserves information
   */
  async getReserves(): Promise<Reserve[]> {
    const query = gql`
      query GetReserves {
        reserves(first: 100) {
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
    `;

    const data = await this.client.request<{ reserves: unknown[] }>(query);
    return z.array(ReserveSchema).parse(data.reserves);
  }

  /**
   * Fetch users with debt (for at-risk analysis)
   * @param first Number of users to fetch
   */
  async getUsersWithDebt(first = 100): Promise<User[]> {
    const query = gql`
      query GetUsersWithDebt($first: Int!) {
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
              price {
                priceInEth
              }
            }
          }
        }
      }
    `;

    const data = await this.client.request<{ users: unknown[] }>(query, { first });
    return z.array(UserSchema).parse(data.users);
  }
}
