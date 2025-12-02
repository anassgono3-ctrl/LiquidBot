/**
 * TokenRegistry Service
 * 
 * Centralized token metadata resolution with:
 * - Address normalization (lowercase per ADDRESS_NORMALIZE_LOWERCASE config)
 * - Static config lookup for known tokens
 * - On-chain ERC20 fallback for symbol/decimals
 * - Redis caching with in-memory fallback
 * - TTL-based cache expiration
 * 
 * Purpose: Eliminate missing symbol/decimal issues in price/oracle and execution flows.
 */

import { ethers } from 'ethers';
import type { Redis as IORedis } from 'ioredis';

import { config } from '../config/index.js';

// ERC20 ABI for on-chain fallback
const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)'
];

export interface TokenMetadata {
  address: string;      // Normalized address
  symbol: string;       // Token symbol
  decimals: number;     // Token decimals
}

interface CachedMetadata extends TokenMetadata {
  timestamp: number;    // Cache timestamp for TTL
}

/**
 * Known Base mainnet tokens (static config)
 * Keyed by lowercase address for fast lookup
 */
const KNOWN_TOKENS: Record<string, Omit<TokenMetadata, 'address'>> = {
  // Stablecoins
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': { symbol: 'USDbC', decimals: 6 },
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { symbol: 'DAI', decimals: 18 },
  
  // Wrapped assets
  '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18 },
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { symbol: 'cbBTC', decimals: 8 },
  '0x236aa50979d5f3de3bd1eeb40e81137f22ab794b': { symbol: 'tBTC', decimals: 18 },
  
  // LST tokens
  '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': { symbol: 'wstETH', decimals: 18 },
  '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': { symbol: 'cbETH', decimals: 18 },
  '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a': { symbol: 'weETH', decimals: 18 },
  
  // Other
  '0x940181a94a35a4569e4529a3cdfb74e38fd98631': { symbol: 'AERO', decimals: 18 },
};

/**
 * TokenRegistry provides centralized token metadata resolution
 */
export class TokenRegistry {
  private provider?: ethers.JsonRpcProvider;
  private redisClient?: IORedis;
  private memoryCache = new Map<string, CachedMetadata>();
  private readonly cacheTtlMs: number;
  private readonly redisPrefix = 'token:meta:';
  
  constructor(options?: {
    provider?: ethers.JsonRpcProvider;
    redisClient?: IORedis;
    cacheTtlMs?: number;
  }) {
    this.provider = options?.provider;
    this.redisClient = options?.redisClient;
    this.cacheTtlMs = options?.cacheTtlMs ?? 3600000; // 1 hour default
  }
  
  /**
   * Get token metadata for a given address
   * 
   * Resolution order:
   * 1. Memory cache (if fresh)
   * 2. Redis cache (if available and fresh)
   * 3. Known tokens static config
   * 4. On-chain ERC20 query (if provider available)
   * 
   * @param address - Token address (any case)
   * @returns Token metadata
   * @throws Error if unable to resolve metadata
   */
  async getTokenMeta(address: string): Promise<TokenMetadata> {
    const normalized = this.normalizeAddress(address);
    
    // 1. Check memory cache
    const memCached = this.memoryCache.get(normalized);
    if (memCached && this.isCacheFresh(memCached.timestamp)) {
      return { address: normalized, symbol: memCached.symbol, decimals: memCached.decimals };
    }
    
    // 2. Check Redis cache (if available)
    if (this.redisClient) {
      try {
        const redisCached = await this.getFromRedis(normalized);
        if (redisCached) {
          // Update memory cache
          this.cacheInMemory(normalized, redisCached);
          return redisCached;
        }
      } catch (err) {
        // Log but don't fail - continue to fallback
        console.warn(`[token-registry] Redis read failed for ${normalized}:`, err);
      }
    }
    
    // 3. Check known tokens
    const known = KNOWN_TOKENS[normalized];
    if (known) {
      const metadata = { address: normalized, ...known };
      await this.cacheMetadata(normalized, metadata);
      return metadata;
    }
    
    // 4. Fallback to on-chain ERC20 query
    if (this.provider) {
      try {
        const metadata = await this.fetchFromChain(normalized);
        await this.cacheMetadata(normalized, metadata);
        return metadata;
      } catch (err) {
        console.error(`[token-registry] On-chain query failed for ${normalized}:`, err);
        throw new Error(`Unable to resolve metadata for token ${address}`);
      }
    }
    
    // No provider available
    throw new Error(`Unable to resolve metadata for token ${address} (no provider configured)`);
  }
  
  /**
   * Batch get metadata for multiple addresses
   * Optimized with parallel queries
   */
  async getTokenMetaBatch(addresses: string[]): Promise<Map<string, TokenMetadata>> {
    const results = await Promise.allSettled(
      addresses.map(async (addr) => ({
        address: this.normalizeAddress(addr),
        metadata: await this.getTokenMeta(addr)
      }))
    );
    
    const map = new Map<string, TokenMetadata>();
    for (const result of results) {
      if (result.status === 'fulfilled') {
        map.set(result.value.address, result.value.metadata);
      }
    }
    
    return map;
  }
  
  /**
   * Preload known tokens into cache
   * Call during initialization to warm cache
   */
  async preloadKnownTokens(): Promise<void> {
    for (const [address, metadata] of Object.entries(KNOWN_TOKENS)) {
      const fullMeta = { address, ...metadata };
      await this.cacheMetadata(address, fullMeta);
    }
  }
  
  /**
   * Clear expired cache entries from memory
   */
  pruneMemoryCache(): void {
    const now = Date.now();
    for (const [addr, cached] of this.memoryCache.entries()) {
      if (!this.isCacheFresh(cached.timestamp, now)) {
        this.memoryCache.delete(addr);
      }
    }
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats(): { memorySize: number; ttlMs: number } {
    return {
      memorySize: this.memoryCache.size,
      ttlMs: this.cacheTtlMs
    };
  }
  
  /**
   * Normalize address to lowercase if ADDRESS_NORMALIZE_LOWERCASE=true
   */
  private normalizeAddress(address: string): string {
    return config.addressNormalizeLowercase ? address.toLowerCase() : address;
  }
  
  /**
   * Check if cache entry is still fresh
   */
  private isCacheFresh(timestamp: number, now: number = Date.now()): boolean {
    return (now - timestamp) < this.cacheTtlMs;
  }
  
  /**
   * Fetch token metadata from on-chain via ERC20 contract
   */
  private async fetchFromChain(address: string): Promise<TokenMetadata> {
    if (!this.provider) {
      throw new Error('Provider not configured');
    }
    
    const contract = new ethers.Contract(address, ERC20_ABI, this.provider);
    
    try {
      const [symbol, decimals] = await Promise.all([
        contract.symbol(),
        contract.decimals()
      ]);
      
      return {
        address,
        symbol: String(symbol),
        decimals: Number(decimals)
      };
    } catch (err) {
      throw new Error(`Failed to query ERC20 contract at ${address}: ${err}`);
    }
  }
  
  /**
   * Cache metadata in both memory and Redis (if available)
   */
  private async cacheMetadata(address: string, metadata: TokenMetadata): Promise<void> {
    // Cache in memory
    this.cacheInMemory(address, metadata);
    
    // Cache in Redis if available
    if (this.redisClient) {
      try {
        await this.cacheInRedis(address, metadata);
      } catch (err) {
        console.warn(`[token-registry] Redis write failed for ${address}:`, err);
      }
    }
  }
  
  /**
   * Cache metadata in memory
   */
  private cacheInMemory(address: string, metadata: TokenMetadata): void {
    this.memoryCache.set(address, {
      ...metadata,
      timestamp: Date.now()
    });
  }
  
  /**
   * Cache metadata in Redis with TTL
   */
  private async cacheInRedis(address: string, metadata: TokenMetadata): Promise<void> {
    if (!this.redisClient) return;
    
    const key = this.redisPrefix + address;
    const value = JSON.stringify({
      symbol: metadata.symbol,
      decimals: metadata.decimals,
      timestamp: Date.now()
    });
    
    const ttlSeconds = Math.ceil(this.cacheTtlMs / 1000);
    await this.redisClient.setex(key, ttlSeconds, value);
  }
  
  /**
   * Get metadata from Redis cache
   */
  private async getFromRedis(address: string): Promise<TokenMetadata | null> {
    if (!this.redisClient) return null;
    
    const key = this.redisPrefix + address;
    const value = await this.redisClient.get(key);
    
    if (!value) return null;
    
    try {
      const parsed = JSON.parse(value);
      
      // Check if still fresh
      if (!this.isCacheFresh(parsed.timestamp)) {
        return null;
      }
      
      return {
        address,
        symbol: parsed.symbol,
        decimals: parsed.decimals
      };
    } catch (err) {
      console.warn(`[token-registry] Failed to parse Redis value for ${address}:`, err);
      return null;
    }
  }
}
