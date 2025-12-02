/**
 * RpcClient: Wrapped provider with 429 detection, backoff, retry, and provider pool
 * 
 * Features:
 * - HTTP 429 detection (Alchemy-specific payload parsing)
 * - Exponential backoff with jitter
 * - Rate-limited structured logging
 * - Provider pool with failover
 * - Integration with RpcBudget for throughput governance
 * 
 * Never silently swallows errors - always returns success or classified error.
 */

import { JsonRpcProvider, FetchRequest } from 'ethers';
import { getGlobalRpcBudget } from './RpcBudget.js';
import { config } from '../config/index.js';

export type RpcErrorType = 
  | '429_rate_limit'
  | 'timeout'
  | 'network'
  | 'provider_destroyed'
  | 'call_exception'
  | 'unknown';

export class RpcError extends Error {
  constructor(
    public readonly type: RpcErrorType,
    message: string,
    public readonly underlyingError?: unknown
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

interface ProviderWithCooldown {
  provider: JsonRpcProvider;
  url: string;
  cooldownUntil: number; // timestamp in ms
  consecutiveErrors: number;
}

interface RateLimitState {
  lastLogTime: Map<string, number>; // key: endpoint+method -> timestamp
  logIntervalMs: number;
}

export class RpcClient {
  private providers: ProviderWithCooldown[];
  private currentProviderIndex = 0;
  private readonly budget = getGlobalRpcBudget();
  private readonly rateLimitState: RateLimitState;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly cooldownMs: number;

  constructor(options?: {
    urls?: string[];
    maxRetries?: number;
    baseBackoffMs?: number;
    maxBackoffMs?: number;
    cooldownMs?: number;
    rateLimitLogIntervalMs?: number;
  }) {
    const urls = options?.urls ?? [config.wsRpcUrl ?? config.rpcUrl ?? 'http://localhost:8545'];
    
    // Add secondary RPC if configured
    if (config.secondaryHeadRpcUrl && !urls.includes(config.secondaryHeadRpcUrl)) {
      urls.push(config.secondaryHeadRpcUrl);
    }

    this.providers = urls.map(url => ({
      provider: new JsonRpcProvider(url),
      url,
      cooldownUntil: 0,
      consecutiveErrors: 0
    }));

    this.maxRetries = options?.maxRetries ?? 3;
    this.baseBackoffMs = options?.baseBackoffMs ?? 100;
    this.maxBackoffMs = options?.maxBackoffMs ?? 5000;
    this.cooldownMs = options?.cooldownMs ?? 30000; // 30 seconds default

    this.rateLimitState = {
      lastLogTime: new Map(),
      logIntervalMs: options?.rateLimitLogIntervalMs ?? 5000 // 5 seconds
    };

    // eslint-disable-next-line no-console
    console.log(
      `[rpc-client] Initialized with ${this.providers.length} provider(s): ` +
      urls.map(u => this.maskUrl(u)).join(', ')
    );
  }

  /**
   * Execute an RPC call with budget enforcement, retry, and failover
   * 
   * @param method RPC method name (e.g., 'eth_call', 'eth_getBlockByNumber')
   * @param params RPC parameters
   * @param options Call options
   * @returns Promise resolving to the RPC result
   */
  async call<T>(
    method: string,
    params: unknown[],
    options?: {
      skipBudget?: boolean;
      budgetTokens?: number;
      retries?: number;
    }
  ): Promise<T> {
    const budgetTokens = options?.budgetTokens ?? 1;
    const retries = options?.retries ?? this.maxRetries;

    // Acquire budget tokens unless skipped
    if (!options?.skipBudget) {
      await this.budget.acquire(budgetTokens);
    }

    // Try each provider with retries
    let lastError: RpcError | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const provider = this.getNextAvailableProvider();
      if (!provider) {
        throw new RpcError(
          'provider_destroyed',
          'All providers are in cooldown or unavailable'
        );
      }

      try {
        const result = await provider.provider.send(method, params);
        
        // Success - reset consecutive errors
        provider.consecutiveErrors = 0;
        
        return result as T;
      } catch (err) {
        lastError = this.classifyError(err, method, provider.url);
        
        // Handle rate limiting
        if (lastError.type === '429_rate_limit') {
          provider.consecutiveErrors++;
          
          // Put provider in cooldown
          provider.cooldownUntil = Date.now() + this.cooldownMs;
          
          // Log with rate limiting
          this.logRateLimited(
            method,
            provider.url,
            `RPC 429 rate limit hit (attempt ${attempt + 1}/${retries + 1}), ` +
            `provider in cooldown for ${this.cooldownMs}ms`
          );

          // Apply exponential backoff before retry
          if (attempt < retries) {
            const backoffMs = this.calculateBackoff(attempt);
            await this.sleep(backoffMs);
          }
          continue;
        }

        // Handle other transient errors
        if (this.isTransientError(lastError.type)) {
          provider.consecutiveErrors++;
          
          // eslint-disable-next-line no-console
          console.warn(
            `[rpc-client] Transient error ${lastError.type} on ${this.maskUrl(provider.url)}, ` +
            `attempt ${attempt + 1}/${retries + 1}`
          );

          if (attempt < retries) {
            const backoffMs = this.calculateBackoff(attempt);
            await this.sleep(backoffMs);
          }
          continue;
        }

        // Non-transient error, throw immediately
        throw lastError;
      }
    }

    // All retries exhausted
    throw lastError ?? new RpcError('unknown', 'RPC call failed after all retries');
  }

  /**
   * Get the next available provider (not in cooldown)
   */
  private getNextAvailableProvider(): ProviderWithCooldown | null {
    const now = Date.now();
    const startIndex = this.currentProviderIndex;

    // Try each provider once
    for (let i = 0; i < this.providers.length; i++) {
      const index = (startIndex + i) % this.providers.length;
      const provider = this.providers[index];

      if (provider && now >= provider.cooldownUntil) {
        this.currentProviderIndex = (index + 1) % this.providers.length;
        return provider;
      }
    }

    // All providers in cooldown
    return null;
  }

  /**
   * Classify an error into a typed category
   */
  private classifyError(err: unknown, method: string, url: string): RpcError {
    const errString = String(err);
    const errMessage = err instanceof Error ? err.message : errString;

    // Check for 429 rate limit
    if (
      errString.includes('429') ||
      errString.includes('rate limit') ||
      errString.includes('compute units') ||
      errString.includes('exceeded its capacity')
    ) {
      return new RpcError('429_rate_limit', `Rate limit exceeded: ${errMessage}`, err);
    }

    // Check for provider destroyed
    if (
      errString.includes('provider destroyed') ||
      errString.includes('cancelled request')
    ) {
      return new RpcError('provider_destroyed', `Provider destroyed: ${errMessage}`, err);
    }

    // Check for missing revert data (often a symptom of rate limiting)
    if (
      errString.includes('missing revert data') ||
      errString.includes('CALL_EXCEPTION')
    ) {
      return new RpcError('call_exception', `Call exception: ${errMessage}`, err);
    }

    // Check for timeout
    if (
      errString.includes('timeout') ||
      errString.includes('timed out')
    ) {
      return new RpcError('timeout', `Request timeout: ${errMessage}`, err);
    }

    // Check for network errors
    if (
      errString.includes('ETIMEDOUT') ||
      errString.includes('ECONNREFUSED') ||
      errString.includes('network')
    ) {
      return new RpcError('network', `Network error: ${errMessage}`, err);
    }

    // Unknown error
    return new RpcError('unknown', `RPC error: ${errMessage}`, err);
  }

  /**
   * Check if an error type is transient and worth retrying
   */
  private isTransientError(type: RpcErrorType): boolean {
    return [
      '429_rate_limit',
      'timeout',
      'network',
      'call_exception' // May be due to rate limiting
    ].includes(type);
  }

  /**
   * Calculate exponential backoff with jitter
   */
  private calculateBackoff(attempt: number): number {
    const exponential = Math.min(
      this.baseBackoffMs * Math.pow(2, attempt),
      this.maxBackoffMs
    );
    const jitter = Math.random() * this.baseBackoffMs;
    return exponential + jitter;
  }

  /**
   * Log with rate limiting to prevent log spam
   */
  private logRateLimited(method: string, url: string, message: string): void {
    const key = `${url}:${method}`;
    const now = Date.now();
    const lastLog = this.rateLimitState.lastLogTime.get(key) ?? 0;

    if (now - lastLog >= this.rateLimitState.logIntervalMs) {
      // eslint-disable-next-line no-console
      console.warn(`[rpc-client] [${method}] ${this.maskUrl(url)}: ${message}`);
      this.rateLimitState.lastLogTime.set(key, now);
    }
  }

  /**
   * Mask sensitive parts of URL (API keys)
   */
  private maskUrl(url: string): string {
    return url.replace(/([a-zA-Z0-9]{20,})/g, '***');
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get provider metrics
   */
  getMetrics() {
    const now = Date.now();
    return {
      providers: this.providers.map(p => ({
        url: this.maskUrl(p.url),
        inCooldown: now < p.cooldownUntil,
        cooldownRemainingMs: Math.max(0, p.cooldownUntil - now),
        consecutiveErrors: p.consecutiveErrors
      })),
      budget: this.budget.getMetrics()
    };
  }
}
