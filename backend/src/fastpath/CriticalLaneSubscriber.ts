/**
 * Critical Lane Subscriber
 * 
 * Redis Pub/Sub subscriber listening to critical_lane.events channel.
 * Dispatches events to CriticalLaneExecutor for fast-path execution.
 */

import type { Redis as IORedis } from 'ioredis';

import { createSubscriberClient } from '../redis/RedisClientFactory.js';

import { CriticalLaneExecutor, type CriticalEvent } from './CriticalLaneExecutor.js';

/**
 * Critical Lane Subscriber manages Redis pub/sub for critical events
 */
export class CriticalLaneSubscriber {
  private subscriber: IORedis;
  private executor: CriticalLaneExecutor;
  private isRunning = false;
  private channelName = 'critical_lane.events';
  
  constructor(executor: CriticalLaneExecutor) {
    this.subscriber = createSubscriberClient();
    this.executor = executor;
    
    // Set up message handler
    this.subscriber.on('message', (channel, message) => {
      if (channel === this.channelName) {
        this.handleMessage(message).catch(err => {
          console.error('[critical-subscriber] Error handling message:', err);
        });
      }
    });
    
    // Set up error handler
    this.subscriber.on('error', (err) => {
      console.error('[critical-subscriber] Redis error:', err);
    });
    
    // Set up reconnect handler
    this.subscriber.on('reconnecting', () => {
      console.warn('[critical-subscriber] Reconnecting to Redis...');
    });
    
    // Set up ready handler
    this.subscriber.on('ready', () => {
      console.log('[critical-subscriber] Redis connection ready');
    });
  }
  
  /**
   * Start subscribing to critical events
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[critical-subscriber] Already running');
      return;
    }
    
    try {
      await this.subscriber.subscribe(this.channelName);
      this.isRunning = true;
      console.log(`[critical-subscriber] Subscribed to ${this.channelName}`);
    } catch (err) {
      console.error('[critical-subscriber] Failed to subscribe:', err);
      throw err;
    }
  }
  
  /**
   * Stop subscribing
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    
    try {
      await this.subscriber.unsubscribe(this.channelName);
      await this.subscriber.quit();
      this.isRunning = false;
      console.log('[critical-subscriber] Unsubscribed and disconnected');
    } catch (err) {
      console.error('[critical-subscriber] Error during stop:', err);
    }
  }
  
  /**
   * Handle incoming message
   */
  private async handleMessage(message: string): Promise<void> {
    try {
      const event = JSON.parse(message) as CriticalEvent;
      
      // Validate event structure
      if (!event.user || !event.block || !event.hfRay) {
        console.warn('[critical-subscriber] Invalid event structure:', message);
        return;
      }
      
      // Dispatch to executor
      const outcome = await this.executor.handleCriticalEvent(event);
      
      // Log outcome
      if (outcome.outcome === 'success') {
        console.log('[critical-subscriber] Success:', {
          user: outcome.user,
          latencyMs: outcome.latencyMs,
          txHash: outcome.txHash
        });
      } else {
        console.log('[critical-subscriber] Attempt failed:', {
          user: outcome.user,
          outcome: outcome.outcome,
          reason: outcome.reason,
          latencyMs: outcome.latencyMs
        });
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        console.error('[critical-subscriber] Invalid JSON:', message);
      } else {
        console.error('[critical-subscriber] Error processing event:', err);
      }
    }
  }
  
  /**
   * Get subscription status
   */
  getStatus(): { running: boolean; channel: string } {
    return {
      running: this.isRunning,
      channel: this.channelName
    };
  }
}
