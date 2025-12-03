/**
 * TokenMetadataRegistry: Central service for resolving token metadata (symbol, decimals)
 * 
 * Resolution strategy:
 * 1. Check existing base metadata map (authoritative, never modified)
 * 2. Check base overrides map (only used if address not in base metadata)
 * 3. Lazy on-chain fetch via ERC20 symbol() and decimals()
 * 
 * Features:
 * - Address normalization (lowercase)
 * - Redis or in-memory cache with TTL
 * - Warn-once logging for unresolved addresses
 * - Negative cache for failed lookups (short TTL)
 * - Concurrent fetch limiting and backoff
 */

import { Contract, JsonRpcProvider } from 'ethers';
import type { Redis } from 'ioredis';

import type { AaveMetadata } from '../aave/AaveMetadata.js';

export interface TokenMetadata {
  address: string;
  symbol: string;
  decimals: number;
  source: 'base' | 'override' | 'onchain' | 'unknown';
}

interface CacheEntry {
  symbol: string;
  decimals: number;
  source: 'base' | 'override' | 'onchain';
  timestamp: number;
}

interface NegativeCacheEntry {
  timestamp: number;
}

// Base overrides map - only used when address is not in base metadata
// Addresses normalized to lowercase
const BASE_OVERRIDES: Record<string, { symbol: string; decimals: number }> = {
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
  '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18 },
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { symbol: 'cbBTC', decimals: 8 },
  '0x9506a02b003d7a7eaf86579863a29601528ca0be': { symbol: 'USDbC', decimals: 6 },
  '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': { symbol: 'cbETH', decimals: 18 },
  '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': { symbol: 'wstETH', decimals: 18 },
  '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a': { symbol: 'weETH', decimals: 18 },
  '0x63706e401c06ac8513145b7687a14804d17f814b': { symbol: 'AAVE', decimals: 18 },
  '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42': { symbol: 'EURC', decimals: 6 },
  '0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee': { symbol: 'GHO', decimals: 18 },
};

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
];

// Cache TTLs
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes for successful lookups
const NEGATIVE_CACHE_TTL_MS = 60 * 1000; // 60 seconds for failed lookups
const MAX_CONCURRENT_FETCHES = 8;

/**
 * TokenMetadataRegistry provides centralized token metadata resolution
 * with proper fallback chain and caching.
 */
export class TokenMetadataRegistry {
  private provider: JsonRpcProvider | null = null;
  private aaveMetadata: AaveMetadata | null = null;
  private redis: Redis | null = null;
  
  // In-memory caches
  private memoryCache = new Map<string, CacheEntry>();
  private negativeCache = new Map<string, NegativeCacheEntry>();
  private warnedAddresses = new Set<string>();
  
  // Concurrency control
  private activeFetches = 0;
  private fetchQueue: Array<() => void> = [];

  constructor(options?: {
    provider?: JsonRpcProvider;
    aaveMetadata?: AaveMetadata;
    redis?: Redis;
  }) {
    this.provider = options?.provider || null;
    this.aaveMetadata = options?.aaveMetadata || null;
    this.redis = options?.redis || null;
  }

  /**
   * Set the provider for on-chain lookups
   */
  setProvider(provider: JsonRpcProvider): void {
    this.provider = provider;
  }

  /**
   * Set the AaveMetadata instance for base metadata resolution
   */
  setAaveMetadata(aaveMetadata: AaveMetadata): void {
    this.aaveMetadata = aaveMetadata;
  }

  /**
   * Set the Redis client for distributed caching
   */
  setRedis(redis: Redis): void {
    this.redis = redis;
  }

  /**
   * Check if an address has resolved metadata
   */
  async has(address: string): Promise<boolean> {
    const normalized = address.toLowerCase();
    
    // Check base metadata
    if (this.aaveMetadata) {
      const reserve = this.aaveMetadata.getReserve(normalized);
      if (reserve && reserve.symbol && reserve.symbol !== 'UNKNOWN') {
        return true;
      }
    }
    
    // Check overrides
    if (BASE_OVERRIDES[normalized]) {
      return true;
    }
    
    // Check caches
    if (this.memoryCache.has(normalized)) {
      return true;
    }
    
    if (this.redis) {
      try {
        const exists = await this.redis.exists(`token:${normalized}`);
        if (exists) {
          return true;
        }
      } catch (err) {
        // Continue if Redis fails
      }
    }
    
    return false;
  }

  /**
   * Get metadata for a token address
   * 
   * Resolution order:
   * 1. Base metadata (from AaveMetadata)
   * 2. Base overrides (only if not in base metadata)
   * 3. On-chain fetch (cached)
   */
  async get(address: string): Promise<TokenMetadata> {
    const normalized = address.toLowerCase();
    
    // 1. Check base metadata (authoritative - never overwrite)
    if (this.aaveMetadata) {
      const reserve = this.aaveMetadata.getReserve(normalized);
      if (reserve && reserve.symbol && reserve.symbol !== 'UNKNOWN') {
        // Log resolution once per address
        if (!this.warnedAddresses.has(normalized)) {
          // eslint-disable-next-line no-console
          console.log(`[token-registry] symbol_resolved via base: ${normalized} -> ${reserve.symbol}`);
          this.warnedAddresses.add(normalized);
        }
        
        return {
          address: normalized,
          symbol: reserve.symbol,
          decimals: reserve.decimals,
          source: 'base'
        };
      }
    }
    
    // 2. Check base overrides (only used if not in base metadata)
    const override = BASE_OVERRIDES[normalized];
    if (override) {
      // Cache the override result
      this.cacheResult(normalized, override.symbol, override.decimals, 'override');
      
      // Log resolution
      if (!this.warnedAddresses.has(normalized)) {
        // eslint-disable-next-line no-console
        console.log(`[token-registry] symbol_resolved via override: ${normalized} -> ${override.symbol}`);
        this.warnedAddresses.add(normalized);
      }
      
      return {
        address: normalized,
        symbol: override.symbol,
        decimals: override.decimals,
        source: 'override'
      };
    }
    
    // 3. Check memory cache
    const cached = this.memoryCache.get(normalized);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return {
        address: normalized,
        symbol: cached.symbol,
        decimals: cached.decimals,
        source: cached.source
      };
    }
    
    // 4. Check Redis cache
    if (this.redis) {
      try {
        const redisKey = `token:${normalized}`;
        const cachedData = await this.redis.get(redisKey);
        if (cachedData) {
          const parsed = JSON.parse(cachedData);
          // Update memory cache
          this.memoryCache.set(normalized, {
            symbol: parsed.symbol,
            decimals: parsed.decimals,
            source: parsed.source || 'onchain',
            timestamp: Date.now()
          });
          return {
            address: normalized,
            symbol: parsed.symbol,
            decimals: parsed.decimals,
            source: parsed.source || 'onchain'
          };
        }
      } catch (err) {
        // Continue to on-chain fetch if Redis fails
      }
    }
    
    // 5. Check negative cache (failed lookups)
    const negativeCached = this.negativeCache.get(normalized);
    if (negativeCached && Date.now() - negativeCached.timestamp < NEGATIVE_CACHE_TTL_MS) {
      // Still in negative cache, don't retry yet
      return {
        address: normalized,
        symbol: 'UNKNOWN',
        decimals: 18, // Safe default
        source: 'unknown'
      };
    }
    
    // 6. Fetch from on-chain (with concurrency control)
    return await this.fetchFromOnChain(normalized);
  }

  /**
   * Fetch metadata from on-chain with concurrency control
   */
  private async fetchFromOnChain(address: string): Promise<TokenMetadata> {
    // Wait if too many concurrent fetches
    if (this.activeFetches >= MAX_CONCURRENT_FETCHES) {
      await new Promise<void>((resolve) => {
        this.fetchQueue.push(resolve);
      });
    }
    
    this.activeFetches++;
    
    try {
      if (!this.provider) {
        throw new Error('No provider configured for on-chain fetch');
      }
      
      const contract = new Contract(address, ERC20_ABI, this.provider);
      const [symbol, decimals] = await Promise.all([
        contract.symbol(),
        contract.decimals()
      ]);
      
      const symbolStr = String(symbol);
      const decimalsNum = Number(decimals);
      
      // Cache the result
      this.cacheResult(address, symbolStr, decimalsNum, 'onchain');
      
      // Log resolution
      if (!this.warnedAddresses.has(address)) {
        // eslint-disable-next-line no-console
        console.log(`[token-registry] symbol_resolved via on-chain: ${address} -> ${symbolStr}`);
        this.warnedAddresses.add(address);
      }
      
      return {
        address,
        symbol: symbolStr,
        decimals: decimalsNum,
        source: 'onchain'
      };
    } catch (err) {
      // On-chain fetch failed - add to negative cache
      this.negativeCache.set(address, { timestamp: Date.now() });
      
      // Warn once per address
      if (!this.warnedAddresses.has(address)) {
        // eslint-disable-next-line no-console
        console.warn(`[token-registry] symbol_missing: ${address} - on-chain fetch failed, will retry after TTL`);
        this.warnedAddresses.add(address);
      }
      
      return {
        address,
        symbol: 'UNKNOWN',
        decimals: 18, // Safe default
        source: 'unknown'
      };
    } finally {
      this.activeFetches--;
      
      // Process next queued fetch
      const next = this.fetchQueue.shift();
      if (next) {
        next();
      }
    }
  }

  /**
   * Cache a successful result
   */
  private cacheResult(
    address: string,
    symbol: string,
    decimals: number,
    source: 'base' | 'override' | 'onchain'
  ): void {
    // Update memory cache
    this.memoryCache.set(address, {
      symbol,
      decimals,
      source,
      timestamp: Date.now()
    });
    
    // Update Redis cache if available
    if (this.redis) {
      const redisKey = `token:${address}`;
      const data = JSON.stringify({ symbol, decimals, source });
      const setexPromise = this.redis.setex(redisKey, Math.floor(CACHE_TTL_MS / 1000), data);
      if (setexPromise && typeof setexPromise.catch === 'function') {
        setexPromise.catch((err) => {
          // eslint-disable-next-line no-console
          console.warn(`[token-registry] Failed to cache to Redis:`, err);
        });
      }
    }
  }

  /**
   * Clear expired cache entries (maintenance)
   */
  pruneCache(): void {
    const now = Date.now();
    
    // Prune memory cache
    for (const [addr, entry] of this.memoryCache.entries()) {
      if (now - entry.timestamp >= CACHE_TTL_MS) {
        this.memoryCache.delete(addr);
      }
    }
    
    // Prune negative cache
    for (const [addr, entry] of this.negativeCache.entries()) {
      if (now - entry.timestamp >= NEGATIVE_CACHE_TTL_MS) {
        this.negativeCache.delete(addr);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    memoryCacheSize: number;
    negativeCacheSize: number;
    warnedCount: number;
    activeFetches: number;
  } {
    return {
      memoryCacheSize: this.memoryCache.size,
      negativeCacheSize: this.negativeCache.size,
      warnedCount: this.warnedAddresses.size,
      activeFetches: this.activeFetches
    };
  }

  /**
   * Clear all caches (for testing)
   */
  clearCache(): void {
    this.memoryCache.clear();
    this.negativeCache.clear();
    this.warnedAddresses.clear();
  }
}
