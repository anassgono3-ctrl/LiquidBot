/**
 * CalldataTemplateCache: Precomputed calldata templates for fast transaction construction
 * 
 * Maintains a cache of encoded calldata templates keyed by (user, debtAsset, collateralAsset, mode).
 * Templates are refreshed when reserve config changes or variable debt index shifts significantly.
 */

import {
  calldataTemplateHitsTotal,
  calldataTemplateMissesTotal
} from '../../metrics/index.js';

import { calldataTemplateConfig } from './config.js';
import type { CalldataTemplate } from './types.js';

export class CalldataTemplateCache {
  private enabled: boolean;
  private refreshIndexBps: number;
  private cache: Map<string, CalldataTemplate> = new Map();

  constructor(
    enabled: boolean = calldataTemplateConfig.enabled,
    refreshIndexBps: number = calldataTemplateConfig.refreshIndexBps
  ) {
    this.enabled = enabled;
    this.refreshIndexBps = refreshIndexBps;
  }

  /**
   * Generate cache key from liquidation parameters
   */
  private getCacheKey(
    user: string,
    debtAsset: string,
    collateralAsset: string,
    mode: number
  ): string {
    return `${user.toLowerCase()}_${debtAsset.toLowerCase()}_${collateralAsset.toLowerCase()}_${mode}`;
  }

  /**
   * Check if template needs refresh based on debt index change
   */
  private needsRefresh(template: CalldataTemplate, currentDebtIndex: bigint): boolean {
    if (!this.enabled) return true;

    // Calculate index change in basis points
    const oldIndex = template.debtIndex;
    const indexChange = Number(((currentDebtIndex - oldIndex) * 10000n) / oldIndex);

    return Math.abs(indexChange) > this.refreshIndexBps;
  }

  /**
   * Store a calldata template
   */
  set(
    user: string,
    debtAsset: string,
    collateralAsset: string,
    mode: number,
    template: string,
    debtIndex: bigint
  ): void {
    if (!this.enabled) return;

    const key = this.getCacheKey(user, debtAsset, collateralAsset, mode);
    this.cache.set(key, {
      user,
      debtAsset,
      collateralAsset,
      mode,
      template,
      debtIndex,
      createdAt: Date.now()
    });
  }

  /**
   * Retrieve a calldata template if valid
   */
  get(
    user: string,
    debtAsset: string,
    collateralAsset: string,
    mode: number,
    currentDebtIndex: bigint
  ): string | null {
    if (!this.enabled) {
      calldataTemplateMissesTotal.inc();
      return null;
    }

    const key = this.getCacheKey(user, debtAsset, collateralAsset, mode);
    const template = this.cache.get(key);

    if (!template) {
      calldataTemplateMissesTotal.inc();
      return null;
    }

    // Check if template needs refresh
    if (this.needsRefresh(template, currentDebtIndex)) {
      this.cache.delete(key);
      calldataTemplateMissesTotal.inc();
      return null;
    }

    calldataTemplateHitsTotal.inc();
    return template.template;
  }

  /**
   * Invalidate all templates for a specific user
   */
  invalidateUser(user: string): void {
    const userLower = user.toLowerCase();
    const keysToDelete: string[] = [];

    for (const [key, template] of this.cache.entries()) {
      if (template.user.toLowerCase() === userLower) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Invalidate all templates for a specific asset (debt or collateral)
   */
  invalidateAsset(asset: string): void {
    const assetLower = asset.toLowerCase();
    const keysToDelete: string[] = [];

    for (const [key, template] of this.cache.entries()) {
      if (
        template.debtAsset.toLowerCase() === assetLower ||
        template.collateralAsset.toLowerCase() === assetLower
      ) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    enabled: boolean;
    refreshIndexBps: number;
  } {
    return {
      size: this.cache.size,
      enabled: this.enabled,
      refreshIndexBps: this.refreshIndexBps
    };
  }

  /**
   * Get all cached templates (for debugging)
   */
  getAll(): CalldataTemplate[] {
    return Array.from(this.cache.values());
  }

  /**
   * Check if cache is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
export const calldataTemplateCache = new CalldataTemplateCache();
