/**
 * WatchSet: Thin wrapper to check if a user is in the watched set
 * 
 * Proxies to existing Hotlist/LowHF trackers without requiring new env variables.
 * Watched users get priority fast-path treatment with immediate single-user HF checks.
 */

import { normalizeAddress } from '../utils/Address.js';
import type { HotSetTracker } from '../services/HotSetTracker.js';
import type { LowHFTracker } from '../services/LowHFTracker.js';

export interface WatchSetOptions {
  hotSetTracker?: HotSetTracker;
  lowHFTracker?: LowHFTracker;
}

/**
 * WatchSet determines if a user should receive priority fast-path treatment
 */
export class WatchSet {
  private hotSetTracker?: HotSetTracker;
  private lowHFTracker?: LowHFTracker;
  
  constructor(options: WatchSetOptions = {}) {
    this.hotSetTracker = options.hotSetTracker;
    this.lowHFTracker = options.lowHFTracker;
  }
  
  /**
   * Check if a user is in the watched set
   * A user is watched if they are in the hot set (HF near 1.0) or low HF tracker
   */
  isWatched(userAddress: string): boolean {
    const normalized = normalizeAddress(userAddress);
    
    // Check hot set (high priority users near liquidation)
    if (this.hotSetTracker) {
      const category = this.hotSetTracker.getCategory(normalized);
      if (category === 'hot') {
        return true;
      }
    }
    
    // Check low HF tracker (users with historically low HF)
    if (this.lowHFTracker) {
      const allEntries = this.lowHFTracker.getAll();
      const entry = allEntries.find(e => normalizeAddress(e.address) === normalized);
      if (entry && entry.lastHF <= 1.03) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Get list of all watched users
   */
  getWatchedUsers(): string[] {
    const watched = new Set<string>();
    
    // Add hot set users (normalize addresses)
    if (this.hotSetTracker) {
      const hotUsers = this.hotSetTracker.getHotSet();
      hotUsers.forEach(entry => watched.add(normalizeAddress(entry.address)));
    }
    
    // Add low HF tracked users with HF <= 1.03
    if (this.lowHFTracker) {
      const lowHfUsers = this.lowHFTracker.getAll();
      lowHfUsers.forEach(entry => {
        if (entry.lastHF <= 1.03) {
          watched.add(normalizeAddress(entry.address));
        }
      });
    }
    
    return Array.from(watched);
  }
  
  /**
   * Get count of watched users
   */
  getWatchedCount(): number {
    return this.getWatchedUsers().length;
  }
}
