/**
 * UniverseBuilder - Manages the active candidate user universe for replay
 * 
 * Implements eviction logic to remove users with persistently high health factors
 * and maintains near-threshold users for continuity across blocks.
 */

import type { ReplayContext } from './ReplayContext.js';

export interface UniverseBuilderConfig {
  nearHf: number;
  evictHf: number;
  evictConsecutive: number;
  maxAccountsPerBlock: number;
}

export interface UserHealthState {
  hf: number;
  debtUSD: number;
  collateralUSD: number;
}

/**
 * UniverseBuilder builds and maintains the active user universe across replay blocks
 */
export class UniverseBuilder {
  constructor(private readonly config: UniverseBuilderConfig) {}
  
  /**
   * Build initial universe from ground truth events
   */
  initializeFromGroundTruth(context: ReplayContext): Set<string> {
    const users = context.getGroundTruthUsers();
    const initialUniverse = new Set<string>(users);
    
    console.log(`[universe] Initialized with ${initialUniverse.size} ground truth users`);
    
    // Add users to context
    for (const user of users) {
      context.addUser(user);
    }
    
    return initialUniverse;
  }
  
  /**
   * Update universe for current block based on health factors
   * Returns users to keep in universe
   */
  updateUniverse(
    context: ReplayContext,
    currentBlock: number,
    userHealthStates: Map<string, UserHealthState>
  ): Set<string> {
    const activeUsers = context.getActiveUsers();
    const toKeep = new Set<string>();
    const toEvict: string[] = [];
    
    // Evaluate each active user
    for (const user of activeUsers) {
      const health = userHealthStates.get(user);
      
      if (!health) {
        // No health data, remove from universe
        toEvict.push(user);
        continue;
      }
      
      // Update eviction state based on current HF
      context.updateEvictionState(user, currentBlock, health.hf);
      
      // Check if should evict
      if (context.shouldEvict(user)) {
        toEvict.push(user);
      } else if (health.hf < this.config.nearHf) {
        // Keep near-threshold users
        toKeep.add(user);
      } else if (health.hf < this.config.evictHf) {
        // Keep users below eviction threshold
        toKeep.add(user);
      } else {
        // User above eviction threshold, but not yet eligible for eviction
        toKeep.add(user);
      }
    }
    
    // Perform evictions
    for (const user of toEvict) {
      context.removeUser(user);
    }
    
    if (toEvict.length > 0) {
      console.log(`[universe] Block ${currentBlock}: Evicted ${toEvict.length} users (${toKeep.size} remain)`);
    }
    
    // Safety cap
    if (toKeep.size > this.config.maxAccountsPerBlock) {
      console.warn(`[universe] Universe size ${toKeep.size} exceeds max ${this.config.maxAccountsPerBlock}, truncating`);
      return new Set(Array.from(toKeep).slice(0, this.config.maxAccountsPerBlock));
    }
    
    return toKeep;
  }
  
  /**
   * Add new users discovered during replay (optional extension)
   */
  addNewUser(context: ReplayContext, user: string): void {
    context.addUser(user);
  }
  
  /**
   * Get universe statistics
   */
  getStats(context: ReplayContext): {
    totalActive: number;
    groundTruthUsers: number;
    detectedUsers: number;
  } {
    return {
      totalActive: context.getActiveUsers().size,
      groundTruthUsers: context.getGroundTruthUsers().length,
      detectedUsers: context.getDetectedUsers().length
    };
  }
}
