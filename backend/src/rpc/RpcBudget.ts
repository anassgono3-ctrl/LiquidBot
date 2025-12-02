/**
 * RpcBudget: Token bucket rate limiter for RPC calls
 * 
 * Implements process-wide throughput governance to prevent provider throttling.
 * Uses token bucket algorithm with configurable capacity, refill rate, and jitter.
 * 
 * Metrics exposed:
 * - Current tokens available
 * - Queue length
 * - Acquired tokens per second
 * - Wait time distribution
 */

import { config } from '../config/index.js';

export interface RpcBudgetMetrics {
  currentTokens: number;
  queueLength: number;
  acquiredTotal: number;
  rejectedTotal: number;
  avgWaitMs: number;
}

interface QueuedRequest {
  tokensNeeded: number;
  resolve: () => void;
  reject: (err: Error) => void;
  enqueuedAt: number;
}

export class RpcBudget {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per second
  private readonly minSpacingMs: number;
  private readonly jitterMs: number;
  private lastRefillTime: number;
  private lastAcquireTime: number = 0;
  private queue: QueuedRequest[] = [];
  private acquiredCount = 0;
  private rejectedCount = 0;
  private totalWaitMs = 0;
  private waitCount = 0;

  constructor(options?: {
    capacity?: number;
    refillRate?: number;
    minSpacingMs?: number;
    jitterMs?: number;
  }) {
    this.capacity = options?.capacity ?? config.rpcBudgetBurst ?? 100;
    this.refillRate = options?.refillRate ?? config.rpcBudgetCuPerSec ?? 50;
    this.minSpacingMs = options?.minSpacingMs ?? config.rpcBudgetMinSpacingMs ?? 10;
    this.jitterMs = options?.jitterMs ?? config.rpcJitterMs ?? 5;
    
    // Start with full capacity
    this.tokens = this.capacity;
    this.lastRefillTime = Date.now();

    // eslint-disable-next-line no-console
    console.log(
      `[rpc-budget] Initialized: capacity=${this.capacity}, ` +
      `refillRate=${this.refillRate}/sec, minSpacing=${this.minSpacingMs}ms, ` +
      `jitter=${this.jitterMs}ms`
    );
  }

  /**
   * Acquire tokens for an RPC call
   * Blocks until sufficient tokens are available
   * 
   * @param tokensNeeded Number of tokens to acquire (default 1)
   * @returns Promise that resolves when tokens are acquired
   */
  async acquire(tokensNeeded = 1): Promise<void> {
    const startTime = Date.now();
    
    // Refill tokens based on elapsed time
    this.refill();

    // Check if we have enough tokens immediately
    if (this.tokens >= tokensNeeded && this.queue.length === 0) {
      // Apply minimum spacing
      const now = Date.now();
      const timeSinceLastAcquire = now - this.lastAcquireTime;
      if (timeSinceLastAcquire < this.minSpacingMs) {
        const delayMs = this.minSpacingMs - timeSinceLastAcquire + this.getJitter();
        await this.sleep(delayMs);
      }

      this.tokens -= tokensNeeded;
      this.lastAcquireTime = Date.now();
      this.acquiredCount++;
      
      // Track wait time (even if 0)
      const waitMs = Date.now() - startTime;
      this.totalWaitMs += waitMs;
      this.waitCount++;
      
      return;
    }

    // Queue the request
    return new Promise<void>((resolve, reject) => {
      this.queue.push({
        tokensNeeded,
        resolve,
        reject,
        enqueuedAt: Date.now()
      });
      
      // Process queue asynchronously
      this.processQueue().catch(err => {
        // eslint-disable-next-line no-console
        console.error('[rpc-budget] Error processing queue:', err);
      });
    });
  }

  /**
   * Try to acquire tokens without blocking
   * 
   * @param tokensNeeded Number of tokens to acquire
   * @returns true if acquired, false if insufficient tokens
   */
  tryAcquire(tokensNeeded = 1): boolean {
    this.refill();
    
    if (this.tokens >= tokensNeeded && this.queue.length === 0) {
      const now = Date.now();
      const timeSinceLastAcquire = now - this.lastAcquireTime;
      if (timeSinceLastAcquire < this.minSpacingMs) {
        return false;
      }

      this.tokens -= tokensNeeded;
      this.lastAcquireTime = now;
      this.acquiredCount++;
      return true;
    }
    
    return false;
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillTime;
    const elapsedSec = elapsedMs / 1000;
    
    const tokensToAdd = elapsedSec * this.refillRate;
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }

  /**
   * Process queued requests
   */
  private async processQueue(): Promise<void> {
    while (this.queue.length > 0) {
      this.refill();
      
      const request = this.queue[0];
      if (!request) break;

      if (this.tokens >= request.tokensNeeded) {
        // Apply minimum spacing
        const now = Date.now();
        const timeSinceLastAcquire = now - this.lastAcquireTime;
        if (timeSinceLastAcquire < this.minSpacingMs) {
          const delayMs = this.minSpacingMs - timeSinceLastAcquire + this.getJitter();
          await this.sleep(delayMs);
        }

        this.tokens -= request.tokensNeeded;
        this.lastAcquireTime = Date.now();
        this.acquiredCount++;
        
        // Track wait time
        const waitMs = Date.now() - request.enqueuedAt;
        this.totalWaitMs += waitMs;
        this.waitCount++;
        
        // Remove from queue and resolve
        this.queue.shift();
        request.resolve();
      } else {
        // Not enough tokens, wait for refill
        const msToWait = ((request.tokensNeeded - this.tokens) / this.refillRate) * 1000;
        await this.sleep(Math.max(50, Math.min(msToWait + this.getJitter(), 1000)));
      }
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): RpcBudgetMetrics {
    this.refill();
    return {
      currentTokens: this.tokens,
      queueLength: this.queue.length,
      acquiredTotal: this.acquiredCount,
      rejectedTotal: this.rejectedCount,
      avgWaitMs: this.waitCount > 0 ? this.totalWaitMs / this.waitCount : 0
    };
  }

  /**
   * Add random jitter to prevent thundering herd
   */
  private getJitter(): number {
    return Math.random() * this.jitterMs;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Reset metrics (for testing)
   */
  resetMetrics(): void {
    this.acquiredCount = 0;
    this.rejectedCount = 0;
    this.totalWaitMs = 0;
    this.waitCount = 0;
  }
}

// Global singleton instance
let globalBudget: RpcBudget | null = null;

/**
 * Get or create the global RPC budget instance
 */
export function getGlobalRpcBudget(): RpcBudget {
  if (!globalBudget) {
    globalBudget = new RpcBudget();
  }
  return globalBudget;
}

/**
 * Reset global budget (for testing)
 */
export function resetGlobalRpcBudget(): void {
  globalBudget = null;
}
