// SubgraphService: Fetch data from Aave V3 Base subgraph via The Graph Gateway
import { GraphQLClient, gql } from 'graphql-request';
import { z } from 'zod';
import { config } from '../config/index.js';
import type { LiquidationCall, Reserve, User } from '../types/index.js';

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

const LiquidationCallSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  liquidator: z.string(),
  user: z.string(),
  principalAmount: z.string(),
  collateralAmount: z.string(),
});

export interface SubgraphServiceOptions {
  mock?: boolean;
  client?: Pick<GraphQLClient, 'request'>;
  endpointOverride?: string;
}

export class SubgraphService {
  private client: Pick<GraphQLClient, 'request'> | null;
  private mock: boolean;

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
  }

  static createMock(): SubgraphService {
    return new SubgraphService({ mock: true });
  }

  private ensureLive() {
    if (this.mock) throw new Error('MOCK_MODE_ACTIVE');
    if (!this.client) throw new Error('CLIENT_NOT_INITIALIZED');
  }

  async getLiquidationCalls(first = 100): Promise<LiquidationCall[]> {
    if (this.mock) return [];
    this.ensureLive();
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
    try {
      const data = await this.client!.request<{ liquidationCalls: unknown[] }>(query, { first });
      return z.array(LiquidationCallSchema).parse(data.liquidationCalls);
    } catch (e: any) {
      throw new Error(`SUBGRAPH_LIQUIDATIONS_FAILED: ${e.message}`);
    }
  }

  async getReserves(): Promise<Reserve[]> {
    if (this.mock) {
      return [
        {
          id: 'mock-asset-1',
            symbol: 'MCK',
            name: 'Mock Asset',
            decimals: 18,
            reserveLiquidationThreshold: 8000,
            usageAsCollateralEnabled: true,
            price: { priceInEth: '1' },
        },
      ] as any;
    }
    this.ensureLive();
    const query = gql`
      query GetReserves {
        reserves(first: 100, where: { usageAsCollateralEnabled: true }) {
          id
          symbol
          name
          decimals
          reserveLiquidationThreshold
          usageAsCollateralEnabled
          price { priceInEth }
        }
      }
    `;
    try {
      const data = await this.client!.request<{ reserves: unknown[] }>(query);
      return z.array(ReserveSchema).parse(data.reserves);
    } catch (e: any) {
      throw new Error(`SUBGRAPH_RESERVES_FAILED: ${e.message}`);
    }
  }

  async getUsersWithDebt(first = 100): Promise<User[]> {
    if (this.mock) {
      return [
        { id: '0xMockUser1', borrowedReservesCount: 2, reserves: [] },
        { id: '0xMockUser2', borrowedReservesCount: 1, reserves: [] },
      ] as any;
    }
    this.ensureLive();
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
              price { priceInEth }
            }
          }
        }
      }
    `;
    try {
      const data = await this.client!.request<{ users: unknown[] }>(query, { first });
      return z.array(UserSchema).parse(data.users);
    } catch (e: any) {
      throw new Error(`SUBGRAPH_USERS_FAILED: ${e.message}`);
    }
  }
}
