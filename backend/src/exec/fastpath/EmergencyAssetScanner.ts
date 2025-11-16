/**
 * EmergencyAssetScanner: Asset-scoped emergency scans optimization
 * 
 * Replaces full hot-set sweep with asset-filtered subset using inverted index.
 * Maintains asset → Set<user> mapping for efficient emergency scans.
 */

import { emergencyScanConfig } from './config.js';
import { emergencyAssetScanTotal } from '../../metrics/index.js';

export interface EmergencyScanResult {
  asset: string;
  usersScanned: number;
  candidatesFound: number;
  scanType: 'partial' | 'full';
  durationMs: number;
}

export class EmergencyAssetScanner {
  private maxUsers: number;
  private assetHfBandBps: number;
  // Inverted index: asset address → Set of user addresses
  private assetToUsers: Map<string, Set<string>> = new Map();

  constructor(
    maxUsers: number = emergencyScanConfig.maxUsers,
    assetHfBandBps: number = emergencyScanConfig.assetHfBandBps
  ) {
    this.maxUsers = maxUsers;
    this.assetHfBandBps = assetHfBandBps;
  }

  /**
   * Add user-asset mapping
   */
  addUserAsset(user: string, asset: string): void {
    const assetLower = asset.toLowerCase();
    const userLower = user.toLowerCase();

    if (!this.assetToUsers.has(assetLower)) {
      this.assetToUsers.set(assetLower, new Set());
    }

    this.assetToUsers.get(assetLower)!.add(userLower);
  }

  /**
   * Remove user-asset mapping
   */
  removeUserAsset(user: string, asset: string): void {
    const assetLower = asset.toLowerCase();
    const userLower = user.toLowerCase();

    const users = this.assetToUsers.get(assetLower);
    if (users) {
      users.delete(userLower);
      if (users.size === 0) {
        this.assetToUsers.delete(assetLower);
      }
    }
  }

  /**
   * Get users associated with an asset
   */
  getUsersForAsset(asset: string): Set<string> {
    const assetLower = asset.toLowerCase();
    return this.assetToUsers.get(assetLower) || new Set();
  }

  /**
   * Perform emergency scan for asset
   * 
   * @param asset Asset address that triggered emergency
   * @param healthFactorFn Function to get current HF for a user
   * @returns Scan result with candidates
   */
  async scanAsset(
    asset: string,
    healthFactorFn: (user: string) => Promise<number | null>
  ): Promise<EmergencyScanResult> {
    const startTime = Date.now();
    const users = this.getUsersForAsset(asset);
    const usersArray = Array.from(users);

    // Determine scan type
    const scanType: 'partial' | 'full' = usersArray.length > this.maxUsers ? 'partial' : 'full';
    const usersToScan = scanType === 'partial'
      ? usersArray.slice(0, this.maxUsers)
      : usersArray;

    const candidates: string[] = [];
    const hfThreshold = 1.0 + (this.assetHfBandBps / 10000);

    // Scan users
    for (const user of usersToScan) {
      const hf = await healthFactorFn(user);
      if (hf !== null && hf < hfThreshold) {
        candidates.push(user);
      }
    }

    const durationMs = Date.now() - startTime;

    // Record metric
    emergencyAssetScanTotal.inc({ asset, result: scanType });

    return {
      asset,
      usersScanned: usersToScan.length,
      candidatesFound: candidates.length,
      scanType,
      durationMs
    };
  }

  /**
   * Bulk add user-asset mappings
   */
  bulkAddMappings(mappings: Array<{ user: string; asset: string }>): void {
    for (const { user, asset } of mappings) {
      this.addUserAsset(user, asset);
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalAssets: number;
    totalMappings: number;
    maxUsers: number;
    assetHfBandBps: number;
  } {
    let totalMappings = 0;
    for (const users of this.assetToUsers.values()) {
      totalMappings += users.size;
    }

    return {
      totalAssets: this.assetToUsers.size,
      totalMappings,
      maxUsers: this.maxUsers,
      assetHfBandBps: this.assetHfBandBps
    };
  }

  /**
   * Clear all mappings
   */
  clear(): void {
    this.assetToUsers.clear();
  }

  /**
   * Get all assets being tracked
   */
  getTrackedAssets(): string[] {
    return Array.from(this.assetToUsers.keys());
  }
}

// Singleton instance
export const emergencyAssetScanner = new EmergencyAssetScanner();
