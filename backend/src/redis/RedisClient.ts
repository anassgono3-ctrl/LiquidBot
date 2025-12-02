/**
 * RedisClient: Singleton wrapper around ioredis with pipelining support
 */

import { Redis } from 'ioredis';

import { config } from '../config/index.js';

export class RedisClient {
  private static instance: RedisClient | null = null;
  private client: Redis | null = null;
  private connected = false;

  private constructor() {}

  public static getInstance(): RedisClient {
    if (!RedisClient.instance) {
      RedisClient.instance = new RedisClient();
    }
    return RedisClient.instance;
  }

  public async connect(): Promise<void> {
    if (this.client) return;

    const redisUrl = config.redisUrl;
    if (!redisUrl) {
      throw new Error('REDIS_URL not configured');
    }

    this.client = new Redis(redisUrl, {
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3
    });

    this.client.on('connect', () => {
      console.log('[redis-client] Connected');
      this.connected = true;
    });

    this.client.on('error', (err: Error) => {
      console.error('[redis-client] Error:', err.message);
    });

    await this.client.ping();
  }

  public getClient(): Redis {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }
    return this.client;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.connected = false;
    }
  }

  public static resetInstance(): void {
    RedisClient.instance = null;
  }
}

export default RedisClient.getInstance;
