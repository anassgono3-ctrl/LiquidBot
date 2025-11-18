/**
 * MissRateTracker: Track missed liquidation opportunities vs competitors
 */

import { updateLiquidationMissRate } from './LatencyMetrics.js';

export interface LiquidationEvent {
  user: string;
  block: number;
  timestamp: number;
  liquidator: string;
  isOurs: boolean;
}

export class MissRateTracker {
  private events: LiquidationEvent[] = [];
  private readonly maxEvents: number;
  private readonly windowBlocks: number;

  constructor(maxEvents = 1000, windowBlocks = 1000) {
    this.maxEvents = maxEvents;
    this.windowBlocks = windowBlocks;
  }

  /**
   * Record a liquidation event
   */
  public recordLiquidation(event: LiquidationEvent): void {
    this.events.push(event);

    // Trim old events
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    // Update metrics
    this.updateMetrics();
  }

  /**
   * Calculate and update miss rate metrics
   */
  private updateMetrics(): void {
    if (this.events.length === 0) {
      return;
    }

    // Get recent events within window
    const latestBlock = this.events[this.events.length - 1].block;
    const windowStart = latestBlock - this.windowBlocks;
    
    const recentEvents = this.events.filter(e => e.block >= windowStart);
    
    const ourLiquidations = recentEvents.filter(e => e.isOurs).length;
    const totalLiquidations = recentEvents.length;

    const missRate = totalLiquidations > 0 
      ? 1 - (ourLiquidations / totalLiquidations)
      : 0;

    updateLiquidationMissRate(missRate);
  }

  /**
   * Get statistics
   */
  public getStats(): {
    totalEvents: number;
    ourLiquidations: number;
    missedLiquidations: number;
    missRate: number;
  } {
    const ourLiquidations = this.events.filter(e => e.isOurs).length;
    const totalEvents = this.events.length;
    const missedLiquidations = totalEvents - ourLiquidations;
    const missRate = totalEvents > 0 ? missedLiquidations / totalEvents : 0;

    return {
      totalEvents,
      ourLiquidations,
      missedLiquidations,
      missRate
    };
  }
}
