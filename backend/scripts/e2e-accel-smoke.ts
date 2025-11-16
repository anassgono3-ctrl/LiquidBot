#!/usr/bin/env tsx
// e2e-accel-smoke.ts: Smoke test for Execution Path Acceleration features
// Validates pre-sim cache, decision latency, and hedge behavior

// Set required env vars for config loading
if (!process.env.API_KEY) process.env.API_KEY = 'smoke-test-key';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'smoke-test-secret';
if (!process.env.USE_MOCK_SUBGRAPH) process.env.USE_MOCK_SUBGRAPH = 'true';

import { JsonRpcProvider } from 'ethers';

import { config } from '../src/config/index.js';
import { PreSimCache } from '../src/services/PreSimCache.js';
import { GasLadder } from '../src/services/GasLadder.js';
import { HedgedProvider } from '../src/execution/HedgedProvider.js';
import { PriceService } from '../src/services/PriceService.js';
import { registry } from '../src/metrics/index.js';

interface SmokeTestResult {
  success: boolean;
  preSimCacheHitRate: number;
  avgDecisionLatencyMs: number;
  errors: string[];
}

/**
 * Smoke test for execution path acceleration features
 */
async function runSmokeTest(borrowers: string[]): Promise<SmokeTestResult> {
  const errors: string[] = [];
  const latencies: number[] = [];

  console.log('[smoke] Starting execution path acceleration smoke test...');
  console.log(`[smoke] Config: PRE_SIM_ENABLED=${config.preSimEnabled} GAS_LADDER_ENABLED=${config.gasLadderEnabled}`);
  console.log(`[smoke] Testing with ${borrowers.length} borrower addresses`);

  try {
    // 1. Test PreSimCache
    console.log('\n[smoke] Testing PreSimCache...');
    const preSimCache = new PreSimCache(1000, config.preSimCacheTtlBlocks);
    
    // Simulate pre-computing plans for hot users
    const currentBlock = 12345678;
    for (const user of borrowers) {
      const plan = {
        user,
        debtAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
        collateralAsset: '0x4200000000000000000000000000000000000006', // WETH
        blockTag: currentBlock,
        repayAmount: BigInt(1000e6), // 1000 USDC
        expectedCollateral: BigInt('500000000000000000'), // 0.5 WETH
        estimatedProfit: 50.0, // $50
        timestamp: Date.now()
      };
      preSimCache.set(plan);
    }

    // Test cache hits
    let hits = 0;
    let misses = 0;
    for (const user of borrowers) {
      const start = Date.now();
      const cached = preSimCache.get(
        user,
        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        '0x4200000000000000000000000000000000000006',
        currentBlock,
        currentBlock
      );
      const latency = Date.now() - start;
      latencies.push(latency);

      if (cached) {
        hits++;
        console.log(`[pre-sim] cache hit user=${user.slice(0, 10)}... hf=0.98 dt=${latency}ms`);
      } else {
        misses++;
        console.log(`[pre-sim] cache miss user=${user.slice(0, 10)}... hf=0.98 dt=${latency}ms`);
      }
    }

    const hitRate = hits / (hits + misses);
    console.log(`[smoke] PreSimCache hit rate: ${(hitRate * 100).toFixed(1)}% (${hits}/${hits + misses})`);

    if (hitRate < 0.6) {
      errors.push(`Pre-sim cache hit rate ${(hitRate * 100).toFixed(1)}% below target 60%`);
    }

    // 2. Test GasLadder
    const rpcUrl = process.env.RPC_URL;
    if (config.gasLadderEnabled && rpcUrl) {
      console.log('\n[smoke] Testing GasLadder...');
      const provider = new JsonRpcProvider(rpcUrl);
      const gasLadder = new GasLadder({ provider });
      
      await gasLadder.initialize();
      
      const fastPlan = gasLadder.getGasPlan('fast');
      const midPlan = gasLadder.getGasPlan('mid');
      const safePlan = gasLadder.getGasPlan('safe');
      
      console.log(`[smoke] Gas plans: fast=${Number(fastPlan.maxPriorityFeePerGas) / 1e9} mid=${Number(midPlan.maxPriorityFeePerGas) / 1e9} safe=${Number(safePlan.maxPriorityFeePerGas) / 1e9} Gwei`);
      
      if (fastPlan.maxPriorityFeePerGas <= midPlan.maxPriorityFeePerGas) {
        errors.push('Fast gas tip should be higher than mid');
      }
      if (midPlan.maxPriorityFeePerGas <= safePlan.maxPriorityFeePerGas) {
        errors.push('Mid gas tip should be higher than safe');
      }
    } else {
      console.log('[smoke] GasLadder test skipped (disabled or no RPC_URL)');
    }

    // 3. Test HedgedProvider
    if (config.secondaryHeadRpcUrl && rpcUrl) {
      console.log('\n[smoke] Testing HedgedProvider...');
      const hedgedProvider = new HedgedProvider({
        primaryRpcUrl: rpcUrl,
        secondaryRpcUrl: config.secondaryHeadRpcUrl,
        hedgeDelayMs: config.headCheckHedgeMs
      });

      const start = Date.now();
      try {
        await hedgedProvider.hedgedCall('test_block', async (provider) => {
          return await provider.getBlockNumber();
        });
        const hedgeLatency = Date.now() - start;
        console.log(`[smoke] Hedged call completed in ${hedgeLatency}ms`);
        latencies.push(hedgeLatency);
      } catch (err) {
        errors.push(`Hedged call failed: ${err}`);
      }
    } else {
      console.log('[smoke] HedgedProvider test skipped (no secondary RPC configured)');
    }

    // 4. Test PriceService per-block coalescing
    console.log('\n[smoke] Testing PriceService per-block coalescing...');
    const priceService = new PriceService();
    
    const testBlock = 12345678;
    const testSymbols = ['USDC', 'WETH', 'cbETH'];
    
    for (const symbol of testSymbols) {
      const start = Date.now();
      const price1 = await priceService.getPriceAtBlock(symbol, testBlock);
      const latency1 = Date.now() - start;
      
      const start2 = Date.now();
      const price2 = await priceService.getPriceAtBlock(symbol, testBlock);
      const latency2 = Date.now() - start2;
      
      console.log(`[smoke] ${symbol} at block ${testBlock}: $${price1.toFixed(2)} (first: ${latency1}ms, cached: ${latency2}ms)`);
      
      if (price1 !== price2) {
        errors.push(`Per-block price mismatch for ${symbol}: ${price1} vs ${price2}`);
      }
      
      // Second call should be faster (cached)
      if (latency2 > latency1) {
        console.warn(`[smoke] Warning: cached call slower than first call for ${symbol}`);
      }
      
      latencies.push(latency1);
    }

    // 5. Calculate average decision latency
    const avgLatency = latencies.length > 0 
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length 
      : 0;
    
    console.log(`\n[smoke] Average decision latency: ${avgLatency.toFixed(2)}ms (target: <450ms)`);
    
    if (avgLatency >= 450) {
      errors.push(`Average latency ${avgLatency.toFixed(2)}ms exceeds target 450ms`);
    }

    // 6. Check metrics
    console.log('\n[smoke] Checking metrics...');
    const metrics = await registry.metrics();
    const hasPreSimMetrics = metrics.includes('liquidbot_pre_sim_cache_hit_total');
    const hasPriceCoalesceMetrics = metrics.includes('liquidbot_price_per_block_coalesced_total');
    
    if (!hasPreSimMetrics) {
      errors.push('Pre-sim cache metrics not found');
    }
    if (!hasPriceCoalesceMetrics) {
      errors.push('Price coalesce metrics not found');
    }
    
    console.log(`[smoke] Metrics: pre_sim=${hasPreSimMetrics} price_coalesce=${hasPriceCoalesceMetrics}`);

    // 7. Print queue size (simulated)
    console.log(`\n[smoke] Pre-sim queue size: ${borrowers.length}`);
    const cacheStats = preSimCache.getStats();
    console.log(`[smoke] Cache stats: size=${cacheStats.size} maxSize=${cacheStats.maxSize} ttl=${cacheStats.ttlBlocks} blocks`);

    return {
      success: errors.length === 0,
      preSimCacheHitRate: hitRate,
      avgDecisionLatencyMs: avgLatency,
      errors
    };

  } catch (err) {
    errors.push(`Smoke test exception: ${err}`);
    return {
      success: false,
      preSimCacheHitRate: 0,
      avgDecisionLatencyMs: 0,
      errors
    };
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  console.log('[smoke] Execution Path Acceleration Smoke Test');
  console.log(`[smoke] Mode: ${isDryRun ? 'DRY-RUN' : 'LIVE'}`);

  // Use test borrower addresses or from env
  const borrowersEnv = process.env.SMOKE_TEST_BORROWERS || '';
  const defaultBorrowers = [
    '0x0000000000000000000000000000000000000001',
    '0x0000000000000000000000000000000000000002',
    '0x0000000000000000000000000000000000000003',
    '0x0000000000000000000000000000000000000004',
    '0x0000000000000000000000000000000000000005'
  ];

  const borrowers = borrowersEnv
    ? borrowersEnv.split(',').map(a => a.trim())
    : defaultBorrowers;

  const result = await runSmokeTest(borrowers);

  console.log('\n' + '='.repeat(80));
  console.log('SMOKE TEST RESULTS');
  console.log('='.repeat(80));
  console.log(`Status: ${result.success ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Pre-sim cache hit rate: ${(result.preSimCacheHitRate * 100).toFixed(1)}% (target: ≥60%)`);
  console.log(`Average decision latency: ${result.avgDecisionLatencyMs.toFixed(2)}ms (target: <450ms)`);
  
  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const error of result.errors) {
      console.log(`  - ${error}`);
    }
  }
  
  console.log('='.repeat(80));

  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke] Fatal error:', err);
  process.exit(1);
});
