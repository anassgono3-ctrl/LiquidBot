// SubgraphSeeder: Comprehensive user discovery via Aave V3 subgraph
// Enumerates all users with positions (debt or collateral) for complete coverage
// Used strictly for discovery and periodic refresh - NOT for triggering notifications

import { gql } from 'graphql-request';
import { z } from 'zod';

import { config } from '../config/index.js';

import type { SubgraphService } from './SubgraphService.js';

// Schema for user query results
const UserAddressSchema = z.object({
  id: z.string()
});

const SubgraphUsersResponseSchema = z.object({
  users: z.array(UserAddressSchema)
});

export interface SubgraphSeederOptions {
  subgraphService: SubgraphService;
  maxCandidates?: number;
  pageSize?: number;
  politenessDelayMs?: number;
}

export interface SeederMetrics {
  totalUsers: number;
  variableDebtors: number;
  stableDebtors: number;
  collateralHolders: number;
  pagesProcessed: number;
  durationMs: number;
  lastRunAt: number;
}

/**
 * SubgraphSeeder provides comprehensive user discovery from Aave V3 Base subgraph.
 * 
 * Responsibilities:
 * - Query all users with variable debt > 0
 * - Query all users with stable debt > 0  
 * - Query all users with aToken balance > 0
 * - Union and dedupe user IDs
 * - Respect pagination, rate limits, retries
 * - Log detailed coverage metrics
 * 
 * NOT responsible for:
 * - Triggering notifications or executions
 * - Processing liquidationCalls events
 */
export class SubgraphSeeder {
  private subgraphService: SubgraphService;
  private maxCandidates: number;
  private pageSize: number;
  private politenessDelayMs: number;
  private metrics: SeederMetrics | null = null;

  constructor(options: SubgraphSeederOptions) {
    this.subgraphService = options.subgraphService;
    this.maxCandidates = options.maxCandidates || config.candidateMax;
    this.pageSize = options.pageSize || config.subgraphPageSize;
    this.politenessDelayMs = options.politenessDelayMs || 100;
  }

  /**
   * Get latest seeding metrics
   */
  getMetrics(): SeederMetrics | null {
    return this.metrics;
  }

  /**
   * Perform a complete seeding cycle: fetch all users with positions
   * @returns Array of unique user addresses
   */
  async seed(): Promise<string[]> {
    const startTime = Date.now();
    const allUsers = new Set<string>();
    let pagesProcessed = 0;
    
    // eslint-disable-next-line no-console
    console.log('[subgraph-seeder] Starting comprehensive user discovery...');
    
    try {
      // 1. Fetch users with variable debt > 0
      // eslint-disable-next-line no-console
      console.log('[subgraph-seeder] Querying users with variable debt...');
      const variableDebtors = await this.fetchUsersWithVariableDebt();
      variableDebtors.forEach(addr => allUsers.add(addr));
      pagesProcessed += Math.ceil(variableDebtors.length / this.pageSize);
      
      // Politeness delay between queries
      await this.delay(this.politenessDelayMs);
      
      // 2. Fetch users with stable debt > 0
      // eslint-disable-next-line no-console
      console.log('[subgraph-seeder] Querying users with stable debt...');
      const stableDebtors = await this.fetchUsersWithStableDebt();
      stableDebtors.forEach(addr => allUsers.add(addr));
      pagesProcessed += Math.ceil(stableDebtors.length / this.pageSize);
      
      // Politeness delay between queries
      await this.delay(this.politenessDelayMs);
      
      // 3. Fetch users with aToken balance > 0 (collateral holders)
      // eslint-disable-next-line no-console
      console.log('[subgraph-seeder] Querying users with collateral...');
      const collateralHolders = await this.fetchUsersWithCollateral();
      collateralHolders.forEach(addr => allUsers.add(addr));
      pagesProcessed += Math.ceil(collateralHolders.length / this.pageSize);
      
      const uniqueUsers = Array.from(allUsers);
      const durationMs = Date.now() - startTime;
      
      // Update metrics
      this.metrics = {
        totalUsers: uniqueUsers.length,
        variableDebtors: variableDebtors.length,
        stableDebtors: stableDebtors.length,
        collateralHolders: collateralHolders.length,
        pagesProcessed,
        durationMs,
        lastRunAt: Date.now()
      };
      
      // Log comprehensive metrics
      // eslint-disable-next-line no-console
      console.log(
        `[subgraph-seeder] Discovery complete: ` +
        `total=${uniqueUsers.length} ` +
        `variable_debt=${variableDebtors.length} ` +
        `stable_debt=${stableDebtors.length} ` +
        `collateral=${collateralHolders.length} ` +
        `pages=${pagesProcessed} ` +
        `duration_ms=${durationMs} ` +
        `coverage=${((uniqueUsers.length / this.maxCandidates) * 100).toFixed(1)}%`
      );
      
      // Respect max candidates limit
      if (uniqueUsers.length > this.maxCandidates) {
        // eslint-disable-next-line no-console
        console.log(
          `[subgraph-seeder] Limiting to max candidates: ${this.maxCandidates} (found ${uniqueUsers.length})`
        );
        return uniqueUsers.slice(0, this.maxCandidates);
      }
      
      return uniqueUsers;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      // eslint-disable-next-line no-console
      console.error('[subgraph-seeder] Seeding failed:', err);
      
      // Return partial results if available
      const uniqueUsers = Array.from(allUsers);
      if (uniqueUsers.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[subgraph-seeder] Returning partial results: ${uniqueUsers.length} users`);
        this.metrics = {
          totalUsers: uniqueUsers.length,
          variableDebtors: 0,
          stableDebtors: 0,
          collateralHolders: 0,
          pagesProcessed,
          durationMs,
          lastRunAt: Date.now()
        };
        return uniqueUsers;
      }
      
      return [];
    }
  }

  /**
   * Fetch all users with variable debt > 0 (with pagination)
   */
  private async fetchUsersWithVariableDebt(): Promise<string[]> {
    return this.fetchUsersPaginated('variableDebt');
  }

  /**
   * Fetch all users with stable debt > 0 (with pagination)
   */
  private async fetchUsersWithStableDebt(): Promise<string[]> {
    return this.fetchUsersPaginated('stableDebt');
  }

  /**
   * Fetch all users with aToken balance > 0 (with pagination)
   */
  private async fetchUsersWithCollateral(): Promise<string[]> {
    return this.fetchUsersPaginated('collateral');
  }

  /**
   * Generic paginated user fetching for different position types
   * @param type Type of position to query
   */
  private async fetchUsersPaginated(type: 'variableDebt' | 'stableDebt' | 'collateral'): Promise<string[]> {
    const users: string[] = [];
    let skip = 0;
    let hasMore = true;
    
    while (hasMore && users.length < this.maxCandidates) {
      try {
        // Build query based on type - using predefined query templates
        const query = this.buildQueryForType(type);
        
        // Use the private perform method through reflection or make a public query
        // Since SubgraphService doesn't expose a generic query method, we'll use a workaround
        // by accessing the internal client through the service
        const result = await this.querySubgraph(query, { 
          first: this.pageSize, 
          skip 
        });
        
        const parsedResult = SubgraphUsersResponseSchema.parse(result);
        const pageUsers = parsedResult.users.map(u => u.id);
        
        if (pageUsers.length === 0) {
          hasMore = false;
          break;
        }
        
        users.push(...pageUsers);
        skip += pageUsers.length;
        
        // Check if we got a full page - if not, we've reached the end
        if (pageUsers.length < this.pageSize) {
          hasMore = false;
        }
        
        // Politeness delay between pages
        if (hasMore) {
          await this.delay(this.politenessDelayMs);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[subgraph-seeder] Failed to fetch ${type} page (skip=${skip}):`, err);
        hasMore = false;
      }
    }
    
    return users;
  }

  /**
   * Query the subgraph through the SubgraphService
   * Note: This accesses internal SubgraphService properties for rate limiting and retry logic.
   * Type assertion is used because SubgraphService doesn't expose these as public API.
   */
  private async querySubgraph(query: string, variables: Record<string, unknown>): Promise<unknown> {
    // Check if service is mocked or degraded
    // Type assertion needed to access internal properties
    interface SubgraphServiceInternal {
      mock?: boolean;
      degraded?: boolean;
      client?: { request: (query: string, variables?: Record<string, unknown>) => Promise<unknown> };
      consumeTokenOrDrop?: () => boolean;
      retry?: <T>(fn: () => Promise<T>) => Promise<T>;
    }
    
    const service = this.subgraphService as unknown as SubgraphServiceInternal;
    
    if (service.mock || service.degraded) {
      // Return empty results in mock/degraded mode
      return { users: [] };
    }
    
    // Access the internal client
    if (!service.client) {
      throw new Error('SubgraphService client not initialized');
    }
    
    // Check rate limiting
    if (service.consumeTokenOrDrop) {
      const allowed = service.consumeTokenOrDrop();
      if (!allowed) {
        throw new Error('SUBGRAPH_RATE_LIMITED');
      }
    }
    
    // Perform the query with retry logic
    if (service.retry) {
      return service.retry(async () => {
        return service.client!.request(query, variables);
      });
    }
    
    // Fallback: direct request if retry not available
    return service.client.request(query, variables);
  }

  /**
   * Build GraphQL query for specific position type
   */
  private buildQueryForType(type: 'variableDebt' | 'stableDebt' | 'collateral'): string {
    // Predefined query templates for each type to ensure consistent GraphQL syntax
    const queries = {
      variableDebt: gql`
        query GetUsers($first: Int!, $skip: Int!) {
          users(first: $first, skip: $skip, where: { reserves_: { currentVariableDebt_gt: "0" } }) {
            id
          }
        }
      `,
      stableDebt: gql`
        query GetUsers($first: Int!, $skip: Int!) {
          users(first: $first, skip: $skip, where: { reserves_: { currentStableDebt_gt: "0" } }) {
            id
          }
        }
      `,
      collateral: gql`
        query GetUsers($first: Int!, $skip: Int!) {
          users(first: $first, skip: $skip, where: { reserves_: { currentATokenBalance_gt: "0" } }) {
            id
          }
        }
      `
    };
    
    return queries[type];
  }

  /**
   * Delay helper for politeness
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
