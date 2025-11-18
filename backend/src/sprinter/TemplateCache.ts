/**
 * Calldata Template Cache
 * 
 * Pre-builds and caches minimal liquidation calldata skeletons per (debtToken, collateralToken) pair.
 * Stores the repay amount slot offset for fast patching without full ABI re-encoding.
 * 
 * Template structure:
 * - Aave Pool liquidationCall(collateralAsset, debtAsset, user, debtToCover, receiveAToken)
 * - We pre-encode with placeholder values and note the byte offset where debtToCover appears
 * - When executing, we patch the debtToCover value directly into the buffer
 */

import { ethers } from 'ethers';

export interface CalldataTemplate {
  // The full calldata with placeholder repay amount
  buffer: Buffer;
  // Byte offset where the repay amount (uint256) starts
  repayOffset: number;
  // Token addresses
  debtToken: string;
  collateralToken: string;
  // Template creation metadata
  createdBlock: number;
  lastUsed: number;
}

export interface TemplateCacheConfig {
  aavePoolAddress: string;
  // Refresh templates after this many blocks
  refreshIndexBps: number;
  // Maximum cache entries
  maxEntries: number;
}

/**
 * TemplateCache builds and caches liquidation calldata templates
 */
export class TemplateCache {
  private cache: Map<string, CalldataTemplate> = new Map();
  private config: TemplateCacheConfig;
  private poolInterface: ethers.Interface;

  // Aave Pool ABI (minimal, for liquidationCall)
  private static readonly POOL_ABI = [
    'function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken) external'
  ];

  // Placeholder values for template generation
  private static readonly PLACEHOLDER_USER = '0x0000000000000000000000000000000000000001';
  private static readonly PLACEHOLDER_REPAY_AMOUNT = ethers.parseEther('1000000'); // Large round number

  constructor(config: TemplateCacheConfig) {
    this.config = config;
    this.poolInterface = new ethers.Interface(TemplateCache.POOL_ABI);

    // eslint-disable-next-line no-console
    console.log(
      `[template-cache] Initialized: pool=${config.aavePoolAddress.slice(0, 8)}..., ` +
      `refreshIndex=${config.refreshIndexBps}, maxEntries=${config.maxEntries}`
    );
  }

  /**
   * Get or create a template for a given token pair
   */
  getTemplate(
    debtToken: string,
    collateralToken: string,
    currentBlock: number
  ): CalldataTemplate {
    const key = this.makeKey(debtToken, collateralToken);
    const existing = this.cache.get(key);

    // Check if existing template is still valid
    if (existing && !this.isStale(existing, currentBlock)) {
      existing.lastUsed = Date.now();
      return existing;
    }

    // Create new template
    const template = this.buildTemplate(debtToken, collateralToken, currentBlock);
    this.cache.set(key, template);

    // Enforce max cache size by evicting least recently used
    if (this.cache.size > this.config.maxEntries) {
      this.evictLRU();
    }

    return template;
  }

  /**
   * Patch the repay amount into a template buffer
   */
  patchRepayAmount(template: CalldataTemplate, repayWei: bigint): Buffer {
    const patched = Buffer.from(template.buffer);
    
    // Convert repay amount to 32-byte hex (uint256)
    const repayHex = repayWei.toString(16).padStart(64, '0');
    const repayBytes = Buffer.from(repayHex, 'hex');
    
    // Copy the repay amount bytes at the correct offset
    repayBytes.copy(patched, template.repayOffset);
    
    return patched;
  }

  /**
   * Patch both user address and repay amount into a template buffer
   */
  patchUserAndRepay(template: CalldataTemplate, user: string, repayWei: bigint): Buffer {
    // First, rebuild the calldata with the actual user address
    const calldata = this.poolInterface.encodeFunctionData('liquidationCall', [
      template.collateralToken,
      template.debtToken,
      user,
      TemplateCache.PLACEHOLDER_REPAY_AMOUNT,
      false // receiveAToken
    ]);

    const buffer = Buffer.from(calldata.slice(2), 'hex');
    
    // Now patch the repay amount at the known offset
    const repayHex = repayWei.toString(16).padStart(64, '0');
    const repayBytes = Buffer.from(repayHex, 'hex');
    repayBytes.copy(buffer, template.repayOffset);
    
    return buffer;
  }

  /**
   * Clear stale templates
   */
  refresh(currentBlock: number): number {
    let evicted = 0;
    for (const [key, template] of this.cache.entries()) {
      if (this.isStale(template, currentBlock)) {
        this.cache.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; entries: Array<{ key: string; age: number }> } {
    const entries = Array.from(this.cache.entries()).map(([key, template]) => ({
      key,
      age: Date.now() - template.lastUsed
    }));

    return {
      size: this.cache.size,
      entries
    };
  }

  /**
   * Build a new template for a token pair
   */
  private buildTemplate(
    debtToken: string,
    collateralToken: string,
    currentBlock: number
  ): CalldataTemplate {
    // Encode liquidationCall with placeholder values
    const calldata = this.poolInterface.encodeFunctionData('liquidationCall', [
      collateralToken,
      debtToken,
      TemplateCache.PLACEHOLDER_USER,
      TemplateCache.PLACEHOLDER_REPAY_AMOUNT,
      false // receiveAToken
    ]);

    // Convert to buffer (remove '0x' prefix)
    const buffer = Buffer.from(calldata.slice(2), 'hex');

    // Calculate offset of debtToCover parameter
    // liquidationCall signature: function selector (4 bytes) + 5 params (each 32 bytes)
    // Parameters: collateralAsset (32), debtAsset (32), user (32), debtToCover (32), receiveAToken (32)
    // debtToCover is the 4th parameter (0-indexed: param 3)
    const repayOffset = 4 + 32 * 3; // 4 bytes selector + 3 * 32 bytes for first 3 params

    return {
      buffer,
      repayOffset,
      debtToken: debtToken.toLowerCase(),
      collateralToken: collateralToken.toLowerCase(),
      createdBlock: currentBlock,
      lastUsed: Date.now()
    };
  }

  /**
   * Check if a template is stale
   */
  private isStale(template: CalldataTemplate, currentBlock: number): boolean {
    const blockAge = currentBlock - template.createdBlock;
    const refreshBlocks = this.config.refreshIndexBps / 100; // Convert BPS to blocks
    return blockAge >= refreshBlocks;
  }

  /**
   * Make cache key from token pair
   */
  private makeKey(debtToken: string, collateralToken: string): string {
    return `${debtToken.toLowerCase()}-${collateralToken.toLowerCase()}`;
  }

  /**
   * Evict least recently used template
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, template] of this.cache.entries()) {
      if (template.lastUsed < oldestTime) {
        oldestTime = template.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}
