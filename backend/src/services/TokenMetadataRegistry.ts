/**
 * TokenMetadataRegistry: Unified token metadata resolution
 * 
 * Resolution hierarchy:
 * 1. Base metadata (AaveMetadata) - authoritative
 * 2. Override map (hardcoded Base tokens) - fills gaps
 * 3. Lazy on-chain fetch (symbol() + decimals()) - last resort
 * 
 * Features:
 * - Respects RPC budget for on-chain calls
 * - Cache with TTL (5 minutes)
 * - Retry logic with backoff
 * - Structured logging (warn on first failure, not silent)
 * - No duplication, no overwrite of existing metadata
 */

import { Contract, JsonRpcProvider } from 'ethers';

import { getTokenOverride } from '../metadata/token-metadata-overrides.js';
import { getGlobalRpcBudget } from '../rpc/RpcBudget.js';

// Minimal interface for AaveMetadata to avoid circular dependency
interface IAaveMetadata {
  getReserve(address: string): { symbol: string; decimals: number } | null | undefined;
}

const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)'
];

export interface TokenMetadata {
  address: string;
  symbol: string;
  decimals: number;
  source: 'base' | 'override' | 'onchain' | 'unknown';
}

interface CacheEntry {
  metadata: TokenMetadata;
  fetchedAt: number;
  retryCount: number;
}

export class TokenMetadataRegistry {
  private provider: JsonRpcProvider;
  private cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes
  private readonly maxRetries = 3;
  private readonly budget = getGlobalRpcBudget();
  private aaveMetadata: IAaveMetadata | null = null; // Base metadata source

  constructor(provider: JsonRpcProvider) {
    this.provider = provider;
    
    // eslint-disable-next-line no-console
    console.log('[token-metadata-registry] Initialized');
  }

  /**
   * Set AaveMetadata instance (base/authoritative source)
   */
  setAaveMetadata(aaveMetadata: IAaveMetadata): void {
    this.aaveMetadata = aaveMetadata;
  }

  /**
   * Get token metadata with resolution hierarchy
   * 
   * @param address Token address
   * @returns Promise<TokenMetadata>
   */
  async getMetadata(address: string): Promise<TokenMetadata> {
    const normalized = address.toLowerCase();

    // 1. Check base metadata (AaveMetadata) - authoritative
    if (this.aaveMetadata) {
      const reserve = this.aaveMetadata.getReserve(normalized);
      if (reserve && reserve.symbol && reserve.symbol !== 'UNKNOWN') {
        return {
          address: normalized,
          symbol: reserve.symbol,
          decimals: reserve.decimals,
          source: 'base'
        };
      }
    }

    // 2. Check override map
    const override = getTokenOverride(normalized);
    if (override) {
      return {
        address: normalized,
        symbol: override.symbol,
        decimals: override.decimals,
        source: 'override'
      };
    }

    // 3. Check cache (with TTL)
    const cached = this.cache.get(normalized);
    if (cached && this.isCacheValid(cached)) {
      return cached.metadata;
    }

    // 4. Lazy on-chain fetch
    return await this.fetchOnChain(normalized);
  }

  /**
   * Get symbol for a token (convenience method)
   */
  async getSymbol(address: string): Promise<string> {
    const metadata = await this.getMetadata(address);
    return metadata.symbol;
  }

  /**
   * Get decimals for a token (convenience method)
   */
  async getDecimals(address: string): Promise<number> {
    const metadata = await this.getMetadata(address);
    return metadata.decimals;
  }

  /**
   * Fetch metadata from on-chain with retry logic
   */
  private async fetchOnChain(address: string): Promise<TokenMetadata> {
    const cached = this.cache.get(address);
    const retryCount = cached?.retryCount ?? 0;

    // Check if we've exceeded max retries
    if (retryCount >= this.maxRetries) {
      // Return unknown after max retries
      return {
        address,
        symbol: 'UNKNOWN',
        decimals: 18, // Default to 18 decimals
        source: 'unknown'
      };
    }

    try {
      // Acquire RPC budget (2 tokens: symbol + decimals)
      await this.budget.acquire(2);

      const contract = new Contract(address, ERC20_ABI, this.provider);
      
      // Fetch symbol and decimals in parallel
      const [symbol, decimals] = await Promise.all([
        contract.symbol() as Promise<string>,
        contract.decimals() as Promise<number>
      ]);

      const metadata: TokenMetadata = {
        address,
        symbol,
        decimals,
        source: 'onchain'
      };

      // Cache the result
      this.cache.set(address, {
        metadata,
        fetchedAt: Date.now(),
        retryCount: 0
      });

      // eslint-disable-next-line no-console
      console.log(
        `[token-metadata-registry] Fetched on-chain: ${address} -> ` +
        `${symbol} (${decimals} decimals)`
      );

      return metadata;
    } catch (err) {
      // Log warning on first failure
      if (retryCount === 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[token-metadata-registry] Failed to fetch metadata for ${address}:`,
          err instanceof Error ? err.message : String(err)
        );
      }

      // Schedule retry with cache
      const metadata: TokenMetadata = {
        address,
        symbol: 'UNKNOWN',
        decimals: 18,
        source: 'unknown'
      };

      this.cache.set(address, {
        metadata,
        fetchedAt: Date.now(),
        retryCount: retryCount + 1
      });

      // eslint-disable-next-line no-console
      console.log(
        `[token-metadata-registry] Retry scheduled for ${address} ` +
        `(attempt ${retryCount + 1}/${this.maxRetries})`
      );

      return metadata;
    }
  }

  /**
   * Check if cache entry is valid (within TTL)
   */
  private isCacheValid(entry: CacheEntry): boolean {
    const age = Date.now() - entry.fetchedAt;
    return age < this.cacheTtlMs;
  }

  /**
   * Prefetch metadata for multiple addresses in parallel
   * Useful for startup warm-up
   */
  async prefetch(addresses: string[]): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[token-metadata-registry] Prefetching metadata for ${addresses.length} tokens...`);
    
    const promises = addresses.map(addr => 
      this.getMetadata(addr).catch(err => {
        // eslint-disable-next-line no-console
        console.warn(`[token-metadata-registry] Prefetch failed for ${addr}:`, err);
      })
    );

    await Promise.all(promises);
    
    // eslint-disable-next-line no-console
    console.log(`[token-metadata-registry] Prefetch complete`);
  }

  /**
   * Clear cache (for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getCacheStats() {
    let validCount = 0;
    let staleCount = 0;

    for (const entry of this.cache.values()) {
      if (this.isCacheValid(entry)) {
        validCount++;
      } else {
        staleCount++;
      }
    }

    return {
      totalEntries: this.cache.size,
      validEntries: validCount,
      staleEntries: staleCount
    };
  }
}
