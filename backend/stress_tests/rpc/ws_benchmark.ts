/**
 * WebSocket RPC Benchmark
 * 
 * Benchmarks WebSocket subscription endpoints measuring connection latency,
 * subscription acknowledgment time, and event inter-arrival gap distributions.
 * 
 * Usage:
 *   WS_URLS="wss://provider1,wss://provider2" node dist/stress_tests/rpc/ws_benchmark.js --run
 *   Or with ts-node/tsx:
 *   WS_URLS="wss://provider1" tsx stress_tests/rpc/ws_benchmark.ts --run
 */

import * as fs from 'fs';
import WebSocket from 'ws';

interface WsBenchmarkConfig {
  wsUrls: string[];
  subscriptionDuration: number; // seconds to listen for events
  outputFile: string;
}

interface ConnectionResult {
  url: string;
  connectLatencyMs: number;
  subscribeLatencyMs?: number;
  success: boolean;
  errorMessage?: string;
  closeCode?: number;
  timestamp: number;
}

interface EventGap {
  url: string;
  gapMs: number;
  blockNumber?: string;
  timestamp: number;
}

interface WsStats {
  url: string;
  connectionSuccess: boolean;
  connectLatencyMs: number;
  subscribeLatencyMs?: number;
  totalEvents: number;
  eventGaps: number[];
  gapP50: number;
  gapP95: number;
  gapMax: number;
  errorMessage?: string;
  closeCode?: number;
}

interface WsBenchmarkResults {
  config: WsBenchmarkConfig;
  startTime: number;
  endTime: number;
  totalDuration: number;
  stats: WsStats[];
  rawConnections: ConnectionResult[];
  rawEventGaps: EventGap[];
}

class WsBenchmark {
  private config: WsBenchmarkConfig;
  private connections: ConnectionResult[] = [];
  private eventGaps: EventGap[] = [];

  constructor(config: WsBenchmarkConfig) {
    this.config = config;
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private async benchmarkEndpoint(url: string): Promise<WsStats> {
    return new Promise((resolve) => {
      const connectStartTime = Date.now();
      let subscribeStartTime: number | undefined;
      let subscribeLatencyMs: number | undefined;
      let lastEventTime: number | undefined;
      const gaps: number[] = [];
      let eventCount = 0;
      let errorMessage: string | undefined;
      let closeCode: number | undefined;

      const ws = new WebSocket(url);

      const timeout = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
          resolve({
            url,
            connectionSuccess: false,
            connectLatencyMs: Date.now() - connectStartTime,
            totalEvents: eventCount,
            eventGaps: gaps,
            gapP50: 0,
            gapP95: 0,
            gapMax: 0,
            errorMessage: 'Subscription duration timeout'
          });
        }
      }, (this.config.subscriptionDuration + 10) * 1000);

      ws.on('open', () => {
        const connectLatencyMs = Date.now() - connectStartTime;
        console.log(`  [${url}] Connected in ${connectLatencyMs}ms`);

        // Subscribe to newHeads
        subscribeStartTime = Date.now();
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_subscribe',
          params: ['newHeads']
        }));

        this.connections.push({
          url,
          connectLatencyMs,
          success: true,
          timestamp: connectStartTime
        });

        // Auto-close after subscription duration
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close();
          }
        }, this.config.subscriptionDuration * 1000);
      });

      ws.on('message', (data: WebSocket.Data) => {
        const now = Date.now();
        try {
          const msg = JSON.parse(data.toString());

          // Check if this is the subscription acknowledgment
          if (msg.id === 1 && msg.result && subscribeStartTime && subscribeLatencyMs === undefined) {
            subscribeLatencyMs = now - subscribeStartTime;
            console.log(`  [${url}] Subscription ack in ${subscribeLatencyMs}ms`);
          }

          // Check if this is a newHeads event
          if (msg.method === 'eth_subscription' && msg.params) {
            eventCount++;
            const blockNumber = msg.params.result?.number;

            if (lastEventTime !== undefined) {
              const gap = now - lastEventTime;
              gaps.push(gap);
              this.eventGaps.push({
                url,
                gapMs: gap,
                blockNumber,
                timestamp: now
              });
            }

            lastEventTime = now;
          }
        } catch (err) {
          // Ignore parse errors
        }
      });

      ws.on('error', (err: Error) => {
        errorMessage = err.message;
        console.error(`  [${url}] WebSocket error:`, err.message);
      });

      ws.on('close', (code: number, reason: Buffer) => {
        clearTimeout(timeout);
        closeCode = code;
        const connectLatencyMs = Date.now() - connectStartTime;

        if (!this.connections.find(c => c.url === url)) {
          this.connections.push({
            url,
            connectLatencyMs,
            success: false,
            errorMessage: errorMessage || reason.toString() || `Closed with code ${code}`,
            closeCode: code,
            timestamp: connectStartTime
          });
        }

        const sortedGaps = [...gaps].sort((a, b) => a - b);
        const stats: WsStats = {
          url,
          connectionSuccess: true,
          connectLatencyMs: this.connections.find(c => c.url === url)?.connectLatencyMs || connectLatencyMs,
          subscribeLatencyMs,
          totalEvents: eventCount,
          eventGaps: gaps,
          gapP50: this.percentile(sortedGaps, 50),
          gapP95: this.percentile(sortedGaps, 95),
          gapMax: sortedGaps[sortedGaps.length - 1] || 0,
          errorMessage,
          closeCode
        };

        console.log(`  [${url}] Closed. Events: ${eventCount}, Gaps p50: ${stats.gapP50.toFixed(2)}ms, p95: ${stats.gapP95.toFixed(2)}ms`);
        resolve(stats);
      });
    });
  }

  public async run(): Promise<WsBenchmarkResults> {
    console.log('[WebSocket Benchmark] Starting...');
    console.log(`Endpoints: ${this.config.wsUrls.join(', ')}`);
    console.log(`Subscription duration: ${this.config.subscriptionDuration}s\n`);

    const startTime = Date.now();
    const stats: WsStats[] = [];

    for (const url of this.config.wsUrls) {
      console.log(`[WebSocket Benchmark] Testing ${url}...`);
      const stat = await this.benchmarkEndpoint(url);
      stats.push(stat);
    }

    const endTime = Date.now();
    const totalDuration = (endTime - startTime) / 1000;

    console.log(`\n[WebSocket Benchmark] Finished. Duration: ${totalDuration.toFixed(2)}s`);

    return {
      config: this.config,
      startTime,
      endTime,
      totalDuration,
      stats,
      rawConnections: this.connections,
      rawEventGaps: this.eventGaps
    };
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--run')) {
    console.log('Usage: WS_URLS="wss://url1,wss://url2" node ws_benchmark.js --run');
    console.log('Optional env vars:');
    console.log('  SUBSCRIPTION_DURATION (default: 60 seconds)');
    console.log('  OUTPUT_FILE (default: rpc_ws_results.json)');
    process.exit(0);
  }

  const wsUrlsEnv = process.env.WS_URLS;
  if (!wsUrlsEnv) {
    console.error('ERROR: WS_URLS environment variable required');
    process.exit(1);
  }

  const wsUrls = wsUrlsEnv.split(',').map(u => u.trim()).filter(u => u.length > 0);
  if (wsUrls.length === 0) {
    console.error('ERROR: No valid WebSocket URLs provided');
    process.exit(1);
  }

  const config: WsBenchmarkConfig = {
    wsUrls,
    subscriptionDuration: parseInt(process.env.SUBSCRIPTION_DURATION || '60', 10),
    outputFile: process.env.OUTPUT_FILE || 'rpc_ws_results.json'
  };

  const benchmark = new WsBenchmark(config);
  const results = await benchmark.run();

  // Write results to file
  fs.writeFileSync(config.outputFile, JSON.stringify(results, null, 2));
  console.log(`\n[WebSocket Benchmark] Results written to ${config.outputFile}`);

  // Print summary
  console.log('\n========== SUMMARY ==========');
  for (const stat of results.stats) {
    console.log(`\nEndpoint: ${stat.url}`);
    console.log(`  Connection: ${stat.connectionSuccess ? 'SUCCESS' : 'FAILED'}`);
    console.log(`  Connect Latency: ${stat.connectLatencyMs.toFixed(2)}ms`);
    if (stat.subscribeLatencyMs) {
      console.log(`  Subscribe Latency: ${stat.subscribeLatencyMs.toFixed(2)}ms`);
    }
    console.log(`  Total Events: ${stat.totalEvents}`);
    if (stat.totalEvents > 1) {
      console.log(`  Event Gaps (ms) - p50: ${stat.gapP50.toFixed(2)}, p95: ${stat.gapP95.toFixed(2)}, max: ${stat.gapMax.toFixed(2)}`);
    }
    if (stat.errorMessage) {
      console.log(`  Error: ${stat.errorMessage}`);
    }
    if (stat.closeCode) {
      console.log(`  Close Code: ${stat.closeCode}`);
    }
  }
  console.log('=============================\n');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

export { WsBenchmark };
export type { WsBenchmarkConfig, WsStats, WsBenchmarkResults };
