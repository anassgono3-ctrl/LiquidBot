// Priority Sweep Runner
// Fetches users from Aave subgraph, scores them, and maintains a priority set

import { GraphQLClient, gql } from 'graphql-request';

import { config } from '../config/index.js';
import * as metrics from '../metrics/priority.js';

import { computeScore, shouldInclude, sortFinal, computeStats } from './scoring.js';
import type { UserData, ScoredUser, ScoringConfig } from './scoring.js';

// Min-heap implementation for efficient top-N selection
class MinHeap {
  private heap: ScoredUser[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get size(): number {
    return this.heap.length;
  }

  get items(): ScoredUser[] {
    return [...this.heap];
  }

  peek(): ScoredUser | undefined {
    return this.heap[0];
  }

  insert(user: ScoredUser): void {
    if (this.heap.length < this.maxSize) {
      this.heap.push(user);
      this.bubbleUp(this.heap.length - 1);
    } else if (user.score > this.heap[0].score) {
      // Replace minimum with new user
      this.heap[0] = user;
      this.bubbleDown(0);
    }
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.heap[index].score >= this.heap[parentIndex].score) break;
      [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]];
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let minIndex = index;
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;

      if (leftChild < this.heap.length && this.heap[leftChild].score < this.heap[minIndex].score) {
        minIndex = leftChild;
      }
      if (rightChild < this.heap.length && this.heap[rightChild].score < this.heap[minIndex].score) {
        minIndex = rightChild;
      }

      if (minIndex === index) break;

      [this.heap[index], this.heap[minIndex]] = [this.heap[minIndex], this.heap[index]];
      index = minIndex;
    }
  }
}

export interface PrioritySet {
  version: number;
  generatedAt: number;
  users: string[];
  stats: {
    usersSeen: number;
    usersFiltered: number;
    usersSelected: number;
    topScore: number;
    medianHf: number;
    avgDebt: number;
    avgCollateral: number;
    durationMs: number;
    heapPeakMb: number;
  };
}

interface SubgraphUserResponse {
  id: string;
  totalCollateralETH?: string;
  totalDebtETH?: string;
  healthFactor?: string;
}

const USER_QUERY = gql`
  query GetUsersForPrioritySweep($first: Int!, $skip: Int!) {
    users(
      first: $first
      skip: $skip
      where: { borrowedReservesCount_gt: 0 }
    ) {
      id
      totalCollateralETH
      totalDebtETH
      healthFactor
    }
  }
`;

export class PrioritySweepRunner {
  private client: GraphQLClient | null;
  private latestPrioritySet: PrioritySet | null = null;
  private version = 0;
  private scoringConfig: ScoringConfig;

  constructor() {
    // Initialize GraphQL client for subgraph queries
    const { endpoint, needsHeader } = config.resolveSubgraphEndpoint();
    const headers: Record<string, string> = {};
    if (needsHeader && config.graphApiKey) {
      headers.Authorization = `Bearer ${config.graphApiKey}`;
    }

    // Create client if not using mock mode
    this.client = config.useMockSubgraph ? null : new GraphQLClient(endpoint, { headers });

    this.scoringConfig = {
      debtWeight: config.priorityScoreDebtWeight,
      collateralWeight: config.priorityScoreCollateralWeight,
      hfPenalty: config.priorityScoreHfPenalty,
      hfCeiling: config.priorityScoreHfCeiling,
      lowHfBoost: config.priorityScoreLowHfBoost,
      minDebtUsd: config.priorityMinDebtUsd,
      minCollateralUsd: config.priorityMinCollateralUsd,
      hotlistMaxHf: config.hotlistMaxHf
    };
  }

  /**
   * Fetch a page of users from the subgraph
   */
  private async fetchUsersPage(
    first: number,
    skip: number
  ): Promise<{ users: SubgraphUserResponse[] }> {
    // If in mock mode, return empty
    if (!this.client) {
      return { users: [] };
    }

    return await this.client.request<{ users: SubgraphUserResponse[] }>(USER_QUERY, { first, skip });
  }

  /**
   * Get the latest priority set (may be null if sweep hasn't run yet)
   */
  getPrioritySet(): PrioritySet | null {
    return this.latestPrioritySet;
  }

  /**
   * Run a complete priority sweep cycle
   */
  async runSweep(signal?: AbortSignal): Promise<PrioritySet> {
    const startTime = Date.now();
    const heapStartMb = process.memoryUsage().heapUsed / 1024 / 1024;
    let heapPeakMb = heapStartMb;

    try {
      // eslint-disable-next-line no-console
      console.log('[priority-sweep] Starting priority sweep...');

      // Fetch and score users
      const { usersSeen, usersFiltered, scoredUsers } = await this.fetchAndScoreUsers(signal);

      // Track peak memory
      const currentHeapMb = process.memoryUsage().heapUsed / 1024 / 1024;
      heapPeakMb = Math.max(heapPeakMb, currentHeapMb);

      // Sort final selection
      const finalUsers = sortFinal(scoredUsers);
      const stats = computeStats(finalUsers);

      const durationMs = Date.now() - startTime;

      // Build priority set
      this.version++;
      const prioritySet: PrioritySet = {
        version: this.version,
        generatedAt: Date.now(),
        users: finalUsers.map(u => u.address),
        stats: {
          usersSeen,
          usersFiltered,
          usersSelected: finalUsers.length,
          topScore: stats.topScore,
          medianHf: stats.medianHf,
          avgDebt: stats.avgDebt,
          avgCollateral: stats.avgCollateral,
          durationMs,
          heapPeakMb
        }
      };

      this.latestPrioritySet = prioritySet;

      // Update metrics
      if (config.prioritySweepMetricsEnabled) {
        metrics.prioritySweepRunsTotal.inc({ status: 'success' });
        metrics.prioritySweepLastDurationMs.set(durationMs);
        metrics.prioritySweepSeen.set(usersSeen);
        metrics.prioritySweepFiltered.set(usersFiltered);
        metrics.prioritySweepSelected.set(finalUsers.length);
        metrics.prioritySweepTopScore.set(stats.topScore);
        metrics.prioritySweepMedianHf.set(stats.medianHf);
        metrics.prioritySweepLastErrorFlag.set(0);
        metrics.prioritySweepDurationHistogram.observe(durationMs / 1000);
        metrics.prioritySweepHeapPeakMb.set(heapPeakMb);
      }

      // Log summary
      if (config.prioritySweepLogSummary) {
        // eslint-disable-next-line no-console
        console.log(
          `[priority-sweep] usersSeen=${usersSeen} filtered=${usersFiltered} ` +
          `selected=${finalUsers.length} durationMs=${durationMs} ` +
          `topScore=${stats.topScore.toFixed(2)} medianHF=${stats.medianHf.toFixed(3)} ` +
          `heapPeak=${heapPeakMb.toFixed(1)}MB`
        );
      }

      return prioritySet;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorType = error instanceof Error ? error.name : 'unknown';

      // Update error metrics
      if (config.prioritySweepMetricsEnabled) {
        metrics.prioritySweepRunsTotal.inc({ status: 'error' });
        metrics.prioritySweepErrorsTotal.inc({ error_type: errorType });
        metrics.prioritySweepLastErrorFlag.set(1);
      }

      // eslint-disable-next-line no-console
      console.error(`[priority-sweep][error] Sweep failed after ${durationMs}ms: ${error}`);
      throw error;
    }
  }

  /**
   * Fetch users from subgraph with pagination and scoring
   */
  private async fetchAndScoreUsers(signal?: AbortSignal): Promise<{
    usersSeen: number;
    usersFiltered: number;
    scoredUsers: ScoredUser[];
  }> {
    const pageSize = config.prioritySweepPageSize;
    const maxScanUsers = config.priorityMaxScanUsers;
    const targetSize = config.priorityTargetSize;
    const interRequestMs = config.prioritySweepInterRequestMs;

    const minHeap = new MinHeap(targetSize);
    let skip = 0;
    let usersSeen = 0;
    let usersFiltered = 0;

    while (usersSeen < maxScanUsers) {
      // Check abort signal
      if (signal?.aborted) {
        throw new Error('Priority sweep aborted by timeout');
      }

      // Fetch page using the public method pattern
      const response = await this.fetchUsersPage(pageSize, skip);
      const users = response.users || [];

      // No more users
      if (users.length === 0) {
        break;
      }

      // Process users
      for (const rawUser of users) {
        usersSeen++;

        // Convert to UserData with USD approximation (ETH values from subgraph)
        // Note: For Phase A, we use ETH values as proxy for USD (can be enhanced later with price oracle)
        const userData: UserData = {
          address: rawUser.id,
          totalCollateralUSD: parseFloat(rawUser.totalCollateralETH || '0'),
          totalDebtUSD: parseFloat(rawUser.totalDebtETH || '0'),
          healthFactor: parseFloat(rawUser.healthFactor || '999')
        };

        // Apply filter
        if (!shouldInclude(userData, this.scoringConfig)) {
          continue;
        }

        usersFiltered++;

        // Compute score
        const score = computeScore(userData, this.scoringConfig);
        const scoredUser: ScoredUser = { ...userData, score };

        // Insert into min-heap
        minHeap.insert(scoredUser);

        // Check if we've scanned enough
        if (usersSeen >= maxScanUsers) {
          break;
        }
      }

      skip += users.length;

      // Politeness delay between requests
      if (users.length === pageSize && usersSeen < maxScanUsers) {
        await new Promise(resolve => setTimeout(resolve, interRequestMs));
      } else {
        break; // Last page
      }
    }

    return {
      usersSeen,
      usersFiltered,
      scoredUsers: minHeap.items
    };
  }
}
