// HealthMonitor: DISABLED - No longer performs bulk health monitoring
// This is now a no-op stub to maintain compatibility with existing code.
// Health factors are resolved on-demand per liquidation event instead.

import type { HealthSnapshot } from '../types/index.js';
import { SubgraphService } from './SubgraphService.js';

export interface HealthBreachDetection {
  user: string;
  healthFactor: number;
  previousHealthFactor: number;
  threshold: number;
  timestamp: number;
}

/**
 * HealthMonitor - DISABLED STUB
 * Bulk health monitoring has been replaced with on-demand health factor resolution.
 * This class is kept for compatibility but all methods are no-ops.
 */
export class HealthMonitor {
  constructor(_subgraphService: SubgraphService) {
    // No-op: bulk monitoring disabled
  }

  /**
   * @deprecated DISABLED - No longer performs bulk health monitoring
   */
  async updateAndDetectBreaches(): Promise<HealthBreachDetection[]> {
    return [];
  }

  /**
   * @deprecated DISABLED - No longer performs bulk health snapshots
   */
  async getHealthSnapshotMap(): Promise<Map<string, HealthSnapshot>> {
    return new Map();
  }

  /**
   * Returns stub statistics indicating monitoring is disabled
   */
  getStats() {
    return {
      mode: 'disabled' as const,
      message: 'Bulk health monitoring disabled - using on-demand resolution'
    };
  }

  /**
   * No-op for compatibility
   */
  clearState(): void {
    // No-op
  }
}
