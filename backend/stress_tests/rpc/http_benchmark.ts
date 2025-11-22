/**
 * HTTP RPC Benchmark
 * 
 * Benchmarks JSON-RPC HTTP endpoints with weighted method selection,
 * concurrency ramping, and latency percentile aggregation.
 * 
 * Usage:
 *   RPC_URLS="http://provider1,http://provider2" node dist/stress_tests/rpc/http_benchmark.js --run
 *   Or with ts-node/tsx:
 *   RPC_URLS="http://provider1" tsx stress_tests/rpc/http_benchmark.ts --run
 */

import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';

interface BenchmarkConfig {
  rpcUrls: string[];
  initialConcurrency: number;
  concurrencyStep: number;
  concurrencyInterval: number; // seconds between ramp steps
  maxConcurrency: number;
  durationPerStep: number; // seconds
  outputFile: string;
}

interface MethodWeight {
  method: string;
  weight: number;
  params: any[];
}

interface CallResult {
  url: string;
  method: string;
  latencyMs: number;
  success: boolean;
  httpStatus?: number;
  errorMessage?: string;
  timestamp: number;
}

interface AggregatedStats {
  provider: string;
  method: string;
  count: number;
  successCount: number;
  errorCount: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  throughput: number; // requests per second
}

interface BenchmarkResults {
  config: BenchmarkConfig;
  startTime: number;
  endTime: number;
  totalDuration: number;
  aggregatedStats: AggregatedStats[];
  rawEvents: CallResult[];
}

// Weighted method selection to emulate production mix
const METHOD_WEIGHTS: MethodWeight[] = [
  { method: 'eth_blockNumber', weight: 30, params: [] },
  { method: 'eth_getBlockByNumber', weight: 25, params: ['latest', false] },
  { method: 'eth_getLogs', weight: 20, params: [{ fromBlock: 'latest', toBlock: 'latest' }] },
  { method: 'eth_call', weight: 15, params: [{ to: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', data: '0x18160ddd' }, 'latest'] },
  { method: 'net_version', weight: 10, params: [] }
];

class HttpBenchmark {
  private config: BenchmarkConfig;
  private results: CallResult[] = [];
  private activeCalls = 0;
  private stopped = false;
  private methodWeightsCumulative: number[] = [];

  constructor(config: BenchmarkConfig) {
    this.config = config;
    this.buildCumulativeWeights();
  }

  private buildCumulativeWeights(): void {
    let sum = 0;
    this.methodWeightsCumulative = METHOD_WEIGHTS.map(mw => {
      sum += mw.weight;
      return sum;
    });
  }

  private selectMethod(): MethodWeight {
    const rand = Math.random() * this.methodWeightsCumulative[this.methodWeightsCumulative.length - 1];
    const idx = this.methodWeightsCumulative.findIndex(val => rand < val);
    return METHOD_WEIGHTS[idx >= 0 ? idx : METHOD_WEIGHTS.length - 1];
  }

  private async callRpc(url: string, method: string, params: any[]): Promise<CallResult> {
    const startTime = Date.now();
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params
    });

    return new Promise((resolve) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const lib = isHttps ? https : http;

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 30000
      };

      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const latencyMs = Date.now() - startTime;
          let success = false;
          let errorMessage: string | undefined;

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              success = !parsed.error;
              if (parsed.error) {
                errorMessage = parsed.error.message || JSON.stringify(parsed.error);
              }
            } catch (err) {
              errorMessage = 'Invalid JSON response';
            }
          } else {
            errorMessage = `HTTP ${res.statusCode}`;
          }

          resolve({
            url,
            method,
            latencyMs,
            success,
            httpStatus: res.statusCode,
            errorMessage,
            timestamp: startTime
          });
        });
      });

      req.on('error', (err) => {
        const latencyMs = Date.now() - startTime;
        resolve({
          url,
          method,
          latencyMs,
          success: false,
          errorMessage: err.message,
          timestamp: startTime
        });
      });

      req.on('timeout', () => {
        req.destroy();
        const latencyMs = Date.now() - startTime;
        resolve({
          url,
          method,
          latencyMs,
          success: false,
          errorMessage: 'Request timeout',
          timestamp: startTime
        });
      });

      req.write(payload);
      req.end();
    });
  }

  private async runCalls(concurrency: number, duration: number): Promise<void> {
    const endTime = Date.now() + duration * 1000;

    const workerLoop = async () => {
      while (Date.now() < endTime && !this.stopped) {
        const url = this.config.rpcUrls[Math.floor(Math.random() * this.config.rpcUrls.length)];
        const methodWeight = this.selectMethod();
        this.activeCalls++;
        const result = await this.callRpc(url, methodWeight.method, methodWeight.params);
        this.results.push(result);
        this.activeCalls--;
      }
    };

    const workers = Array(concurrency).fill(null).map(() => workerLoop());
    await Promise.all(workers);
  }

  private calculateStats(): AggregatedStats[] {
    const grouped = new Map<string, CallResult[]>();

    for (const result of this.results) {
      const key = `${result.url}::${result.method}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(result);
    }

    const stats: AggregatedStats[] = [];

    for (const [key, calls] of grouped.entries()) {
      const [provider, method] = key.split('::');
      const latencies = calls.map(c => c.latencyMs).sort((a, b) => a - b);
      const successCount = calls.filter(c => c.success).length;
      const count = calls.length;

      const p50 = this.percentile(latencies, 50);
      const p90 = this.percentile(latencies, 90);
      const p95 = this.percentile(latencies, 95);
      const p99 = this.percentile(latencies, 99);
      const max = latencies[latencies.length - 1] || 0;
      const mean = latencies.reduce((sum, v) => sum + v, 0) / (latencies.length || 1);

      // Calculate throughput based on total duration
      const minTime = Math.min(...calls.map(c => c.timestamp));
      const maxTime = Math.max(...calls.map(c => c.timestamp + c.latencyMs));
      const durationSec = (maxTime - minTime) / 1000;
      const throughput = durationSec > 0 ? count / durationSec : 0;

      stats.push({
        provider,
        method,
        count,
        successCount,
        errorCount: count - successCount,
        p50,
        p90,
        p95,
        p99,
        max,
        mean,
        throughput
      });
    }

    return stats;
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  public async run(): Promise<BenchmarkResults> {
    console.log('[HTTP Benchmark] Starting...');
    console.log(`Providers: ${this.config.rpcUrls.join(', ')}`);
    console.log(`Concurrency ramp: ${this.config.initialConcurrency} -> ${this.config.maxConcurrency} (step ${this.config.concurrencyStep}, interval ${this.config.concurrencyInterval}s)`);

    const startTime = Date.now();

    for (
      let concurrency = this.config.initialConcurrency;
      concurrency <= this.config.maxConcurrency;
      concurrency += this.config.concurrencyStep
    ) {
      console.log(`\n[HTTP Benchmark] Running with concurrency=${concurrency} for ${this.config.durationPerStep}s...`);
      await this.runCalls(concurrency, this.config.durationPerStep);
      console.log(`  Completed ${this.results.length} total calls so far`);
    }

    const endTime = Date.now();
    const totalDuration = (endTime - startTime) / 1000;

    console.log(`\n[HTTP Benchmark] Finished. Total calls: ${this.results.length}, Duration: ${totalDuration.toFixed(2)}s`);

    const aggregatedStats = this.calculateStats();

    return {
      config: this.config,
      startTime,
      endTime,
      totalDuration,
      aggregatedStats,
      rawEvents: this.results
    };
  }

  public stop(): void {
    this.stopped = true;
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--run')) {
    console.log('Usage: RPC_URLS="http://url1,http://url2" node http_benchmark.js --run');
    console.log('Optional env vars:');
    console.log('  INITIAL_CONCURRENCY (default: 1)');
    console.log('  CONCURRENCY_STEP (default: 5)');
    console.log('  CONCURRENCY_INTERVAL (default: 10)');
    console.log('  MAX_CONCURRENCY (default: 20)');
    console.log('  DURATION_PER_STEP (default: 30)');
    console.log('  OUTPUT_FILE (default: rpc_http_results.json)');
    process.exit(0);
  }

  const rpcUrlsEnv = process.env.RPC_URLS;
  if (!rpcUrlsEnv) {
    console.error('ERROR: RPC_URLS environment variable required');
    process.exit(1);
  }

  const rpcUrls = rpcUrlsEnv.split(',').map(u => u.trim()).filter(u => u.length > 0);
  if (rpcUrls.length === 0) {
    console.error('ERROR: No valid RPC URLs provided');
    process.exit(1);
  }

  const config: BenchmarkConfig = {
    rpcUrls,
    initialConcurrency: parseInt(process.env.INITIAL_CONCURRENCY || '1', 10),
    concurrencyStep: parseInt(process.env.CONCURRENCY_STEP || '5', 10),
    concurrencyInterval: parseInt(process.env.CONCURRENCY_INTERVAL || '10', 10),
    maxConcurrency: parseInt(process.env.MAX_CONCURRENCY || '20', 10),
    durationPerStep: parseInt(process.env.DURATION_PER_STEP || '30', 10),
    outputFile: process.env.OUTPUT_FILE || 'rpc_http_results.json'
  };

  const benchmark = new HttpBenchmark(config);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[HTTP Benchmark] Stopping...');
    benchmark.stop();
  });

  const results = await benchmark.run();

  // Write results to file
  fs.writeFileSync(config.outputFile, JSON.stringify(results, null, 2));
  console.log(`\n[HTTP Benchmark] Results written to ${config.outputFile}`);

  // Print summary
  console.log('\n========== SUMMARY ==========');
  for (const stat of results.aggregatedStats) {
    console.log(`\nProvider: ${stat.provider}`);
    console.log(`Method: ${stat.method}`);
    console.log(`  Total: ${stat.count}, Success: ${stat.successCount}, Errors: ${stat.errorCount}`);
    console.log(`  Throughput: ${stat.throughput.toFixed(2)} req/s`);
    console.log(`  Latency (ms) - p50: ${stat.p50.toFixed(2)}, p90: ${stat.p90.toFixed(2)}, p95: ${stat.p95.toFixed(2)}, p99: ${stat.p99.toFixed(2)}, max: ${stat.max.toFixed(2)}`);
  }
  console.log('=============================\n');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

export { HttpBenchmark };
export type { BenchmarkConfig, CallResult, AggregatedStats, BenchmarkResults };
