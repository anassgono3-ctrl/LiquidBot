// EventGroundTruthLoader: Load ground truth liquidation events from The Graph with auth & pagination
import { GraphQLClient, gql } from 'graphql-request';
import { z } from 'zod';

import type { LiquidationCall } from '../types/index.js';

// Reuse existing liquidation schemas from SubgraphService pattern
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

function extractAddress(value: string): string {
  if (!value) return value;
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return value;
  const match = value.match(/0x[0-9a-fA-F]{40}/);
  if (match) return match[0];
  return value;
}

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

export interface EventGroundTruthLoaderOptions {
  endpoint: string;
  apiKey?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  pageSize?: number;
  maxPages?: number;
  requestIntervalMs?: number;
  abortOnAuthError?: boolean;
}

export interface LoadResult {
  events: LiquidationCall[];
  error?: string;
  partial?: boolean;
}

export class EventGroundTruthLoader {
  private client: GraphQLClient;
  private startTimestamp?: number;
  private endTimestamp?: number;
  private pageSize: number;
  private maxPages: number;
  private requestIntervalMs: number;
  private abortOnAuthError: boolean;

  constructor(options: EventGroundTruthLoaderOptions) {
    const { endpoint, apiKey, startTimestamp, endTimestamp, pageSize = 1000, maxPages = 500, requestIntervalMs = 350, abortOnAuthError = true } = options;
    
    // Build headers with auth if key provided
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
      headers['x-api-key'] = apiKey;
    }
    
    this.client = new GraphQLClient(endpoint, { headers });
    this.startTimestamp = startTimestamp;
    this.endTimestamp = endTimestamp;
    this.pageSize = Math.min(pageSize, 1000); // Respect The Graph's limit
    this.maxPages = maxPages;
    this.requestIntervalMs = requestIntervalMs;
    this.abortOnAuthError = abortOnAuthError;
  }

  /**
   * Load all liquidation events with pagination
   * @returns LoadResult with events array, error message, and partial flag
   */
  async load(): Promise<LoadResult> {
    const allEvents: LiquidationCall[] = [];
    let skip = 0;
    let page = 0;
    let lastError: string | undefined;

    console.log(`[EventGroundTruthLoader] Starting load: pageSize=${this.pageSize} maxPages=${this.maxPages}`);

    while (page < this.maxPages) {
      try {
        const query = gql`
          query LiquidationCalls($first: Int!, $skip: Int!, $startTs: Int, $endTs: Int) {
            liquidationCalls(
              first: $first,
              skip: $skip,
              orderBy: timestamp,
              orderDirection: asc,
              where: { 
                ${this.startTimestamp ? 'timestamp_gte: $startTs,' : ''}
                ${this.endTimestamp ? 'timestamp_lte: $endTs' : ''}
              }
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

        const variables: Record<string, number> = { 
          first: this.pageSize, 
          skip 
        };
        if (this.startTimestamp) variables.startTs = this.startTimestamp;
        if (this.endTimestamp) variables.endTs = this.endTimestamp;

        const data = await this.client.request<{ liquidationCalls: unknown[] }>(query, variables);
        const events = z.array(LiquidationCallSchema).parse(data.liquidationCalls) as unknown as LiquidationCall[];

        if (events.length === 0) {
          console.log(`[EventGroundTruthLoader] No more events at page ${page + 1}`);
          break;
        }

        allEvents.push(...events);
        page += 1;
        skip += events.length;

        console.log(`[EventGroundTruthLoader] Page ${page}: loaded ${events.length} events (total: ${allEvents.length})`);

        // Break if we got fewer events than requested (last page)
        if (events.length < this.pageSize) {
          console.log(`[EventGroundTruthLoader] Short page detected, finished loading`);
          break;
        }

        // Politeness delay between requests
        if (page < this.maxPages && this.requestIntervalMs > 0) {
          await new Promise(resolve => setTimeout(resolve, this.requestIntervalMs));
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        
        // Check for auth errors
        const isAuthError = /auth.*error|missing.*authorization|unauthorized|forbidden/i.test(errMsg);
        
        if (isAuthError) {
          console.warn(`[EventGroundTruthLoader] Authentication error: ${errMsg}`);
          lastError = `Auth error: ${errMsg}`;
          
          if (this.abortOnAuthError) {
            // Return null to signal fallback mode
            if (allEvents.length === 0) {
              return { events: [], error: lastError };
            }
            // Return partial data collected so far
            return { events: allEvents, error: lastError, partial: true };
          }
          
          // If abortOnAuthError=false, return partial data and continue
          break;
        }
        
        // Non-auth error: log and return partial data if any
        console.error(`[EventGroundTruthLoader] Error on page ${page + 1}:`, error);
        lastError = `Request failed: ${errMsg}`;
        
        // If we have some data, return it as partial
        if (allEvents.length > 0) {
          console.log(`[EventGroundTruthLoader] Returning partial data: ${allEvents.length} events`);
          return { events: allEvents, error: lastError, partial: true };
        }
        
        // No data collected, return error
        return { events: [], error: lastError };
      }
    }

    if (page >= this.maxPages) {
      console.warn(`[EventGroundTruthLoader] Reached maxPages limit (${this.maxPages}), may have more events`);
    }

    console.log(`[EventGroundTruthLoader] Finished loading: ${allEvents.length} total events across ${page} pages`);
    return { events: allEvents, error: lastError };
  }
}
