/**
 * Redis Client Factory
 * 
 * Shared Redis client creation with pipeline helpers for Critical Lane.
 * Supports both ioredis and redis packages based on existing usage.
 */

import { Redis as IORedis } from 'ioredis';

import { config } from '../config/index.js';

export interface RedisConfig {
  url?: string;
  host?: string;
  port?: number;
  maxRetriesPerRequest?: number;
  enableReadyCheck?: boolean;
  lazyConnect?: boolean;
}

/**
 * Create a Redis client with standard configuration
 */
export function createRedisClient(customConfig?: RedisConfig): IORedis {
  const redisUrl = customConfig?.url ?? config.redisUrl;
  
  if (redisUrl) {
    return new IORedis(redisUrl, {
      maxRetriesPerRequest: customConfig?.maxRetriesPerRequest ?? 3,
      enableReadyCheck: customConfig?.enableReadyCheck ?? true,
      lazyConnect: customConfig?.lazyConnect ?? false,
      retryStrategy(times: number) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    });
  }
  
  // Fallback to host/port
  const host = customConfig?.host ?? config.redisHost ?? '127.0.0.1';
  const port = customConfig?.port ?? config.redisPort ?? 6379;
  
  return new IORedis({
    host,
    port,
    maxRetriesPerRequest: customConfig?.maxRetriesPerRequest ?? 3,
    enableReadyCheck: customConfig?.enableReadyCheck ?? true,
    lazyConnect: customConfig?.lazyConnect ?? false,
    retryStrategy(times: number) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    }
  });
}

/**
 * Pipeline helper for batched Redis operations
 * Automatically executes pipeline and returns results
 */
export async function executePipeline<T = unknown>(
  client: IORedis,
  operations: (pipeline: ReturnType<IORedis['pipeline']>) => void
): Promise<T[]> {
  const pipeline = client.pipeline();
  operations(pipeline);
  
  const results = await pipeline.exec();
  
  if (!results) {
    throw new Error('Pipeline execution returned null');
  }
  
  // Check for errors in results
  const errors = results.filter(([err]: [Error | null, unknown]) => err !== null);
  if (errors.length > 0) {
    console.error('[redis-pipeline] Errors in pipeline execution:', errors);
    throw new Error(`Pipeline had ${errors.length} error(s)`);
  }
  
  // Extract values
  return results.map(([, value]: [Error | null, unknown]) => value as T);
}

/**
 * Pipeline builder with typed result extraction
 */
export class RedisPipelineBuilder {
  private pipeline: ReturnType<IORedis['pipeline']>;
  
  constructor(client: IORedis) {
    this.pipeline = client.pipeline();
  }
  
  /**
   * Get hash field
   */
  hget(key: string, field: string): this {
    this.pipeline.hget(key, field);
    return this;
  }
  
  /**
   * Get all hash fields
   */
  hgetall(key: string): this {
    this.pipeline.hgetall(key);
    return this;
  }
  
  /**
   * Get string value
   */
  get(key: string): this {
    this.pipeline.get(key);
    return this;
  }
  
  /**
   * Check if key exists
   */
  exists(key: string): this {
    this.pipeline.exists(key);
    return this;
  }
  
  /**
   * Set string value with optional expiry
   */
  set(key: string, value: string | number, expiryMs?: number): this {
    if (expiryMs) {
      this.pipeline.set(key, String(value), 'PX', expiryMs);
    } else {
      this.pipeline.set(key, String(value));
    }
    return this;
  }
  
  /**
   * Set hash field
   */
  hset(key: string, field: string, value: string | number): this {
    this.pipeline.hset(key, field, String(value));
    return this;
  }
  
  /**
   * Set hash multiple fields
   */
  hmset(key: string, data: Record<string, string | number>): this {
    const flat: (string | number)[] = [];
    for (const [field, value] of Object.entries(data)) {
      flat.push(field, String(value));
    }
    this.pipeline.hmset(key, ...flat);
    return this;
  }
  
  /**
   * Execute pipeline and return results
   */
  async exec<T = unknown>(): Promise<T[]> {
    const results = await this.pipeline.exec();
    
    if (!results) {
      throw new Error('Pipeline execution returned null');
    }
    
    // Check for errors
    const errors = results.filter(([err]) => err !== null);
    if (errors.length > 0) {
      console.error('[redis-pipeline] Errors:', errors);
      throw new Error(`Pipeline had ${errors.length} error(s)`);
    }
    
    return results.map(([, value]) => value as T);
  }
}

/**
 * Create subscriber client for Pub/Sub
 * Separate client recommended for subscriptions
 */
export function createSubscriberClient(customConfig?: RedisConfig): IORedis {
  const client = createRedisClient({
    ...customConfig,
    maxRetriesPerRequest: undefined // No timeout for pub/sub
  });
  
  return client;
}
