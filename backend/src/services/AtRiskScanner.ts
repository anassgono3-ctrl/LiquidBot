// AtRiskScanner: Proactive detection of accounts at risk of liquidation
import type { User } from '../types/index.js';

import type { SubgraphService } from './SubgraphService.js';
import type { HealthCalculator } from './HealthCalculator.js';
import type { NotificationService } from './NotificationService.js';

export type RiskClassification = 'NO_DEBT' | 'DUST' | 'OK' | 'WARN' | 'CRITICAL';

export interface AtRiskUser {
  userId: string;
  healthFactor: number | null;
  classification: RiskClassification;
  totalDebtETH: number;
  totalCollateralETH: number;
}

export interface AtRiskScanConfig {
  warnThreshold: number;
  liqThreshold: number;
  dustEpsilon: number;
  notifyWarn: boolean;
  notifyCritical?: boolean; // Optional, defaults to true
}

export interface AtRiskScanResult {
  scannedCount: number;
  criticalCount: number;
  warnCount: number;
  noDebtCount: number;
  users: AtRiskUser[];
}

/**
 * AtRiskScanner performs limited bulk scanning to detect users approaching liquidation.
 * - Queries a configurable number of users with debt from the subgraph
 * - Computes health factors locally (no dependency on subgraph healthFactor field)
 * - Classifies users into risk tiers: NO_DEBT, DUST, OK, WARN, CRITICAL
 * - Optionally sends Telegram notifications for at-risk users
 */
export class AtRiskScanner {
  constructor(
    private readonly subgraphService: SubgraphService,
    private readonly healthCalculator: HealthCalculator,
    private readonly config: AtRiskScanConfig,
    private readonly notificationService?: NotificationService
  ) {}

  /**
   * Scan users and classify them by risk level.
   * @param limit Maximum number of users to scan
   * @returns Scan results with user classifications
   */
  async scanAndClassify(limit: number): Promise<AtRiskScanResult> {
    if (limit <= 0) {
      return {
        scannedCount: 0,
        criticalCount: 0,
        warnCount: 0,
        noDebtCount: 0,
        users: []
      };
    }

    // Fetch users with debt from subgraph (with pagination support)
    let users: User[];
    try {
      users = await this.subgraphService.getUsersWithBorrowing(limit, true);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[at-risk-scanner] Failed to fetch users:', err);
      return {
        scannedCount: 0,
        criticalCount: 0,
        warnCount: 0,
        noDebtCount: 0,
        users: []
      };
    }

    // Classify each user
    const atRiskUsers: AtRiskUser[] = [];
    let criticalCount = 0;
    let warnCount = 0;
    let noDebtCount = 0;

    for (const user of users) {
      const hfResult = this.healthCalculator.calculateHealthFactor(user);
      const classification = this.classifyUser(hfResult.totalDebtETH, hfResult.healthFactor);

      const atRiskUser: AtRiskUser = {
        userId: user.id,
        healthFactor: hfResult.healthFactor === Infinity ? null : hfResult.healthFactor,
        classification,
        totalDebtETH: hfResult.totalDebtETH,
        totalCollateralETH: hfResult.totalCollateralETH
      };

      // Track by classification
      if (classification === 'NO_DEBT' || classification === 'DUST') {
        noDebtCount++;
      } else if (classification === 'CRITICAL') {
        criticalCount++;
        atRiskUsers.push(atRiskUser);
      } else if (classification === 'WARN') {
        warnCount++;
        atRiskUsers.push(atRiskUser);
      }
      // OK users are not included in the result
    }

    return {
      scannedCount: users.length,
      criticalCount,
      warnCount,
      noDebtCount,
      users: atRiskUsers
    };
  }

  /**
   * Classify a user based on their debt and health factor.
   */
  private classifyUser(totalDebtETH: number, healthFactor: number): RiskClassification {
    // Check for no debt or dust
    if (totalDebtETH === 0 || totalDebtETH < this.config.dustEpsilon) {
      return totalDebtETH < this.config.dustEpsilon ? 'DUST' : 'NO_DEBT';
    }

    // Classify based on health factor thresholds
    if (healthFactor < this.config.liqThreshold) {
      return 'CRITICAL';
    } else if (healthFactor < this.config.warnThreshold) {
      return 'WARN';
    } else {
      return 'OK';
    }
  }

  /**
   * Send notifications for at-risk users.
   * Notifies CRITICAL users if config.notifyCritical is true (default).
   * Notifies WARN users only if config.notifyWarn is true.
   */
  async notifyAtRiskUsers(users: AtRiskUser[]): Promise<void> {
    if (!this.notificationService) {
      return;
    }

    const notifyCritical = this.config.notifyCritical !== false; // Default to true

    for (const user of users) {
      const shouldNotify = 
        (user.classification === 'CRITICAL' && notifyCritical) || 
        (user.classification === 'WARN' && this.config.notifyWarn);

      if (shouldNotify && user.healthFactor !== null) {
        await this.notifyAtRisk(user.userId, user.healthFactor, user.classification);
      }
    }
  }

  /**
   * Send a single at-risk notification via NotificationService.
   */
  private async notifyAtRisk(userId: string, healthFactor: number, classification: RiskClassification): Promise<void> {
    if (!this.notificationService || !this.notificationService.isEnabled()) {
      return;
    }

    try {
      // Use the existing notifyHealthBreach method with appropriate threshold
      const threshold = classification === 'CRITICAL' 
        ? this.config.liqThreshold 
        : this.config.warnThreshold;

      await this.notificationService.notifyHealthBreach({
        user: userId,
        healthFactor,
        threshold,
        timestamp: Math.floor(Date.now() / 1000)
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[at-risk-scanner] Failed to send notification:', err);
    }
  }
}
