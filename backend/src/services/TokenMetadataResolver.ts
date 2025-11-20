/**
 * Token Metadata Resolver
 * 
 * Central service for resolving token metadata (symbol, decimals).
 * Single source of truth to eliminate scattered ad-hoc decimal lookups.
 * 
 * Resolution strategy:
 * 1. Check known token mapping (Base mainnet common tokens)
 * 2. Query AssetMetadataCache if available
 * 3. Fallback to ERC20 contract queries
 * 4. Cache results with TTL
 */

import { Contract, JsonRpcProvider } from 'ethers';

import type { AssetMetadataCache } from './AssetMetadataCache.js';

export interface TokenMetadata {
  symbol: string;
  decimals: number;
}

interface CachedMetadata extends TokenMetadata {
  timestamp: number;
}

// Known Base mainnet tokens (fallback if cache miss)
const KNOWN_TOKENS: Record<string, TokenMetadata> = {
  // Stablecoins
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': { symbol: 'USDbC', decimals: 6 },
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { symbol: 'DAI', decimals: 18 },
  
  // Wrapped assets
  '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18 },
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { symbol: 'cbBTC', decimals: 8 },
  
  // Other
  '0x940181a94a35a4569e4529a3cdfb74e38fd98631': { symbol: 'AERO', decimals: 18 },
  '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': { symbol: 'cbETH', decimals: 18 },
};

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
];

/**
 * TokenMetadataResolver provides centralized token metadata resolution
 */
export class TokenMetadataResolver {
  private cache = new Map<string, CachedMetadata>();
  private cacheTtlMs: number;
  private provider?: JsonRpcProvider;
  private assetMetadataCache?: AssetMetadataCache;
  
  constructor(options?: {
    cacheTtlMs?: number;
    provider?: JsonRpcProvider;
    assetMetadataCache?: AssetMetadataCache;
  }) {
    this.cacheTtlMs = options?.cacheTtlMs ?? 3600000; // 1 hour default
    this.provider = options?.provider;
    this.assetMetadataCache = options?.assetMetadataCache;
  }
  
  /**
   * Get metadata for a token address
   * 
   * @param address - Token contract address (checksummed or lowercase)
   * @returns Token metadata
   * @throws Error if unable to resolve metadata
   */
  async getMetadata(address: string): Promise<TokenMetadata> {
    const normalized = address.toLowerCase();
    
    // 1. Check cache
    const cached = this.cache.get(normalized);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return { symbol: cached.symbol, decimals: cached.decimals };
    }
    
    // 2. Check known tokens
    const known = KNOWN_TOKENS[normalized];
    if (known) {
      this.cacheResult(normalized, known);
      return known;
    }
    
    // 3. Query AssetMetadataCache if available
    if (this.assetMetadataCache) {
      try {
        const metadata = await this.assetMetadataCache.getAssetMetadata(normalized);
        if (metadata?.symbol && metadata?.decimals !== undefined) {
          const result = { symbol: metadata.symbol, decimals: metadata.decimals };
          this.cacheResult(normalized, result);
          return result;
        }
      } catch (err) {
        // Continue to fallback
        console.warn(`[token-resolver] AssetMetadataCache query failed for ${normalized}:`, err);
      }
    }
    
    // 4. Fallback to ERC20 contract query
    if (this.provider) {
      try {
        const contract = new Contract(normalized, ERC20_ABI, this.provider);
        const [symbol, decimals] = await Promise.all([
          contract.symbol(),
          contract.decimals()
        ]);
        
        const result = { symbol: String(symbol), decimals: Number(decimals) };
        this.cacheResult(normalized, result);
        return result;
      } catch (err) {
        console.error(`[token-resolver] ERC20 query failed for ${normalized}:`, err);
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
  async getMetadataBatch(addresses: string[]): Promise<Map<string, TokenMetadata>> {
    const results = await Promise.allSettled(
      addresses.map(async (addr) => ({
        address: addr.toLowerCase(),
        metadata: await this.getMetadata(addr)
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
  preloadKnownTokens(): void {
    for (const [address, metadata] of Object.entries(KNOWN_TOKENS)) {
      this.cacheResult(address, metadata);
    }
  }
  
  /**
   * Clear expired cache entries
   */
  pruneCache(): void {
    const now = Date.now();
    for (const [addr, cached] of this.cache.entries()) {
      if (now - cached.timestamp >= this.cacheTtlMs) {
        this.cache.delete(addr);
      }
    }
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; ttlMs: number } {
    return {
      size: this.cache.size,
      ttlMs: this.cacheTtlMs
    };
  }
  
  private cacheResult(address: string, metadata: TokenMetadata): void {
    this.cache.set(address, {
      ...metadata,
      timestamp: Date.now()
    });
  }
}
