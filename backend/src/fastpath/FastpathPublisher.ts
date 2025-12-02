/**
 * FastpathPublisher: Helper for publishing HF<1 edge events to Redis
 * 
 * Publishes events to critical_lane.events channel for consumption by
 * CriticalLaneSubscriber and fast-path execution.
 */

import type { Redis as IORedis } from 'ioredis';

import { config } from '../config/index.js';

export interface FastpathEvent {
  user: string;
  block: number;
  hfRay: string;
  ts: number;
  triggerType?: string; // 'event', 'head', 'price', 'micro_*', etc.
}

/**
 * FastpathPublisher handles publishing critical events to Redis
 */
export class FastpathPublisher {
  private redis: IORedis;
  private channelName = 'critical_lane.events';
  private enabled: boolean;
  private publishMinHf: number;
  
  constructor(redis: IORedis) {
    this.redis = redis;
    this.enabled = config.fastpathEventPublish;
    this.publishMinHf = config.criticalLanePublishMinHf;
    
    if (this.enabled) {
      console.log(`[fastpath-publisher] Initialized (publishMinHf=${this.publishMinHf})`);
    } else {
      console.log('[fastpath-publisher] Disabled via FASTPATH_EVENT_PUBLISH=false');
    }
  }
  
  /**
   * Publish a critical event to Redis channel
   */
  async publish(event: FastpathEvent): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    
    // Check HF threshold (use BigInt for precision)
    const hfRay = BigInt(event.hfRay);
    const thresholdRay = BigInt(Math.floor(this.publishMinHf * 1e18));
    if (hfRay >= thresholdRay) {
      return false;
    }
    
    try {
      const payload = JSON.stringify(event);
      const receivers = await this.redis.publish(this.channelName, payload);
      
      if (config.fastpathLogDetail) {
        const hfDisplay = (Number(hfRay) / 1e18).toFixed(4);
        console.log(`[fastpath-publisher] Published event: user=${event.user} hf=${hfDisplay} receivers=${receivers}`);
      }
      
      return receivers > 0;
    } catch (err) {
      console.error('[fastpath-publisher] Error publishing event:', err);
      return false;
    }
  }
  
  /**
   * Check if publisher is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
  
  /**
   * Get channel name
   */
  getChannelName(): string {
    return this.channelName;
  }
}
