// HealthMonitor: Track user health factors and detect threshold breaches
import { config } from '../config/index.js';
import type { User, HealthSnapshot } from '../types/index.js';
import { HealthCalculator } from './HealthCalculator.js';
import { SubgraphService } from './SubgraphService.js';

export interface HealthBreachDetection {
  user: string;
  healthFactor: number;
  previousHealthFactor: number;
  threshold: number;
  timestamp: number;
}

/**
 * HealthMonitor tracks user health factors and detects threshold breaches.
 * Maintains in-memory state to detect transitions (crossing below threshold).
 */
export class HealthMonitor {
  private healthCalculator: HealthCalculator;
  private subgraphService: SubgraphService;
  private lastHealthFactors: Map<string, number> = new Map();
  private lastSnapshotTs = 0;

  constructor(subgraphService: SubgraphService) {
    this.healthCalculator = new HealthCalculator();
    this.subgraphService = subgraphService;
  }

  /**
   * Update health snapshot and detect breaches.
   * @returns Array of breach detections (users crossing below threshold)
   */
  async updateAndDetectBreaches(): Promise<HealthBreachDetection[]> {
    const threshold = config.healthAlertThreshold;
    const breaches: HealthBreachDetection[] = [];

    try {
      // Get current snapshot
      const users = await this.subgraphService.getUserHealthSnapshot(500);
      this.lastSnapshotTs = Date.now();

      // Calculate health factors
      for (const user of users) {
        const result = this.healthCalculator.calculateHealthFactor(user);
        const currentHF = result.healthFactor;
        const userId = user.id;

        // Check if we have previous HF
        const previousHF = this.lastHealthFactors.get(userId);

        // Detect breach: was >= threshold, now < threshold
        if (
          previousHF !== undefined &&
          previousHF >= threshold &&
          currentHF < threshold &&
          currentHF !== Infinity
        ) {
          breaches.push({
            user: userId,
            healthFactor: currentHF,
            previousHealthFactor: previousHF,
            threshold,
            timestamp: Math.floor(Date.now() / 1000)
          });
        }

        // Update stored health factor
        this.lastHealthFactors.set(userId, currentHF);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[health-monitor] Failed to update snapshot:', err);
    }

    return breaches;
  }

  /**
   * Get current health snapshot as a map
   */
  async getHealthSnapshotMap(): Promise<Map<string, HealthSnapshot>> {
    const map = new Map<string, HealthSnapshot>();

    try {
      const users = await this.subgraphService.getUserHealthSnapshot(500);

      for (const user of users) {
        const result = this.healthCalculator.calculateHealthFactor(user);
        
        map.set(user.id, {
          userId: user.id,
          healthFactor: result.healthFactor,
          totalCollateralETH: result.totalCollateralETH,
          totalDebtETH: result.totalDebtETH,
          timestamp: Date.now()
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[health-monitor] Failed to get health snapshot:', err);
    }

    return map;
  }

  /**
   * Get monitoring statistics
   */
  getStats() {
    return {
      trackedUsers: this.lastHealthFactors.size,
      lastSnapshotTs: this.lastSnapshotTs
    };
  }

  /**
   * Clear tracking state (useful for testing)
   */
  clearState(): void {
    this.lastHealthFactors.clear();
    this.lastSnapshotTs = 0;
  }
}
