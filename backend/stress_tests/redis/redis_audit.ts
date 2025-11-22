/**
 * Redis Audit Tool
 * 
 * Audits Redis keys to identify:
 * - Key types and sizes
 * - Keys missing TTL (especially cache/temp/session keys)
 * - Large keys that may impact performance
 * 
 * Usage:
 *   REDIS_URL="redis://localhost:6379" node dist/stress_tests/redis/redis_audit.js --run
 *   Or with ts-node/tsx:
 *   REDIS_URL="redis://localhost:6379" tsx stress_tests/redis/redis_audit.ts --run
 */

import * as fs from 'fs';

import { Redis } from 'ioredis';

interface RedisAuditConfig {
  redisUrl: string;
  scanBatchSize: number;
  sampleLimit: number;
  largeSizeThreshold: number; // flag keys larger than this
  outputFile: string;
}

interface KeyInfo {
  key: string;
  type: string;
  size: number;
  ttl: number; // -1 for no expiry, -2 for key not found
  isLarge: boolean;
  missingTtl: boolean;
  isCacheLike: boolean; // matches cache/temp/session patterns
}

interface RedisAuditResults {
  config: RedisAuditConfig;
  startTime: number;
  endTime: number;
  totalDuration: number;
  totalKeysScanned: number;
  keysAudited: KeyInfo[];
  summary: {
    largeKeys: KeyInfo[];
    missingTtlCacheKeys: KeyInfo[];
    typeDistribution: Record<string, number>;
    ttlDistribution: {
      noExpiry: number;
      withExpiry: number;
      expired: number;
    };
  };
}

class RedisAudit {
  private config: RedisAuditConfig;
  private client: Redis;
  private keysInfo: KeyInfo[] = [];

  constructor(config: RedisAuditConfig) {
    this.config = config;
    this.client = new Redis(config.redisUrl);
  }

  // Cache-like key patterns
  private static readonly CACHE_PATTERNS = [
    /^cache:/i,
    /^temp:/i,
    /^session:/i,
    /^sess:/i,
    /:cache$/i,
    /:temp$/i,
    /_cache_/i,
    /_temp_/i,
    /^tmp:/i
  ];

  private isCacheLikeKey(key: string): boolean {
    return RedisAudit.CACHE_PATTERNS.some(pattern => pattern.test(key));
  }

  private async getKeySize(key: string, type: string): Promise<number> {
    try {
      switch (type) {
        case 'string':
          return await this.client.strlen(key);
        case 'list':
          return await this.client.llen(key);
        case 'set':
          return await this.client.scard(key);
        case 'zset':
          return await this.client.zcard(key);
        case 'hash':
          return await this.client.hlen(key);
        case 'stream':
          return await this.client.xlen(key);
        default:
          return 0;
      }
    } catch (err) {
      return 0;
    }
  }

  private async auditKey(key: string): Promise<KeyInfo | null> {
    try {
      const [type, ttl] = await Promise.all([
        this.client.type(key),
        this.client.ttl(key)
      ]);

      const size = await this.getKeySize(key, type);
      const isLarge = size > this.config.largeSizeThreshold;
      const isCacheLike = this.isCacheLikeKey(key);
      const missingTtl = ttl === -1 && isCacheLike;

      return {
        key,
        type,
        size,
        ttl,
        isLarge,
        missingTtl,
        isCacheLike
      };
    } catch (err) {
      console.error(`Error auditing key ${key}:`, err);
      return null;
    }
  }

  public async run(): Promise<RedisAuditResults> {
    console.log('[Redis Audit] Starting...');
    console.log(`Redis URL: ${this.config.redisUrl}`);
    console.log(`Scan batch size: ${this.config.scanBatchSize}`);
    console.log(`Sample limit: ${this.config.sampleLimit}`);
    console.log(`Large key threshold: ${this.config.largeSizeThreshold}\n`);

    const startTime = Date.now();
    let cursor = '0';
    let totalScanned = 0;

    do {
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        'COUNT',
        this.config.scanBatchSize
      );
      cursor = nextCursor;
      totalScanned += keys.length;

      console.log(`[Redis Audit] Scanned ${totalScanned} keys...`);

      // Audit each key
      for (const key of keys) {
        if (this.keysInfo.length >= this.config.sampleLimit) {
          console.log(`[Redis Audit] Reached sample limit of ${this.config.sampleLimit}`);
          cursor = '0'; // Force exit
          break;
        }

        const keyInfo = await this.auditKey(key);
        if (keyInfo) {
          this.keysInfo.push(keyInfo);
        }
      }
    } while (cursor !== '0' && this.keysInfo.length < this.config.sampleLimit);

    const endTime = Date.now();
    const totalDuration = (endTime - startTime) / 1000;

    console.log(`\n[Redis Audit] Finished. Keys audited: ${this.keysInfo.length}, Duration: ${totalDuration.toFixed(2)}s`);

    // Build summary
    const largeKeys = this.keysInfo.filter(k => k.isLarge);
    const missingTtlCacheKeys = this.keysInfo.filter(k => k.missingTtl);

    const typeDistribution: Record<string, number> = {};
    for (const keyInfo of this.keysInfo) {
      typeDistribution[keyInfo.type] = (typeDistribution[keyInfo.type] || 0) + 1;
    }

    const ttlDistribution = {
      noExpiry: this.keysInfo.filter(k => k.ttl === -1).length,
      withExpiry: this.keysInfo.filter(k => k.ttl > 0).length,
      expired: this.keysInfo.filter(k => k.ttl === -2).length
    };

    await this.client.quit();

    return {
      config: this.config,
      startTime,
      endTime,
      totalDuration,
      totalKeysScanned: totalScanned,
      keysAudited: this.keysInfo,
      summary: {
        largeKeys,
        missingTtlCacheKeys,
        typeDistribution,
        ttlDistribution
      }
    };
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--run')) {
    console.log('Usage: REDIS_URL="redis://localhost:6379" node redis_audit.js --run');
    console.log('Optional env vars:');
    console.log('  SCAN_BATCH_SIZE (default: 100)');
    console.log('  SAMPLE_LIMIT (default: 5000)');
    console.log('  LARGE_SIZE_THRESHOLD (default: 10000)');
    console.log('  OUTPUT_FILE (default: redis_audit.json)');
    process.exit(0);
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error('ERROR: REDIS_URL environment variable required');
    process.exit(1);
  }

  const config: RedisAuditConfig = {
    redisUrl,
    scanBatchSize: parseInt(process.env.SCAN_BATCH_SIZE || '100', 10),
    sampleLimit: parseInt(process.env.SAMPLE_LIMIT || '5000', 10),
    largeSizeThreshold: parseInt(process.env.LARGE_SIZE_THRESHOLD || '10000', 10),
    outputFile: process.env.OUTPUT_FILE || 'redis_audit.json'
  };

  const audit = new RedisAudit(config);
  const results = await audit.run();

  // Write results to file
  fs.writeFileSync(config.outputFile, JSON.stringify(results, null, 2));
  console.log(`\n[Redis Audit] Results written to ${config.outputFile}`);

  // Print summary
  console.log('\n========== SUMMARY ==========');
  console.log(`Total keys scanned: ${results.totalKeysScanned}`);
  console.log(`Keys audited: ${results.keysAudited.length}`);
  console.log('\nType Distribution:');
  for (const [type, count] of Object.entries(results.summary.typeDistribution)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log('\nTTL Distribution:');
  console.log(`  No expiry: ${results.summary.ttlDistribution.noExpiry}`);
  console.log(`  With expiry: ${results.summary.ttlDistribution.withExpiry}`);
  console.log(`  Expired: ${results.summary.ttlDistribution.expired}`);
  console.log(`\nLarge keys (>${config.largeSizeThreshold}): ${results.summary.largeKeys.length}`);
  if (results.summary.largeKeys.length > 0) {
    console.log('Top 10 large keys:');
    results.summary.largeKeys
      .sort((a, b) => b.size - a.size)
      .slice(0, 10)
      .forEach(k => {
        console.log(`  ${k.key} (${k.type}): ${k.size}`);
      });
  }
  console.log(`\nCache-like keys missing TTL: ${results.summary.missingTtlCacheKeys.length}`);
  if (results.summary.missingTtlCacheKeys.length > 0) {
    console.log('Sample keys missing TTL:');
    results.summary.missingTtlCacheKeys.slice(0, 10).forEach(k => {
      console.log(`  ${k.key} (${k.type}): size=${k.size}`);
    });
  }
  console.log('=============================\n');
}

// Check if running as main module (ES module style)
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('redis_audit.ts') || 
  process.argv[1].endsWith('redis_audit.js')
);
if (isMainModule) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

export { RedisAudit };
export type { RedisAuditConfig, KeyInfo, RedisAuditResults };
