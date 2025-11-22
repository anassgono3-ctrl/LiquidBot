# Stress & Performance Tests

This directory contains a comprehensive stress and performance testing suite for LiquidBot, designed to quantify and monitor:

- **RPC Performance**: HTTP JSON-RPC latency distributions, throughput, and error rates
- **WebSocket Reliability**: Connection latency, subscription acknowledgment time, and event delivery characteristics
- **Redis Health**: Key audit for size, type, TTL presence, and potential misconfigurations

## Directory Structure

```
stress_tests/
├── rpc/
│   ├── http_benchmark.ts          # HTTP JSON-RPC latency & throughput benchmark
│   ├── ws_benchmark.ts            # WebSocket subscription benchmark
│   ├── scenario_runner.ts         # Placeholder for multi-phase scenario orchestration
│   └── reporters/
│       ├── consoleReporter.ts     # Placeholder for formatted console output
│       ├── jsonReporter.ts        # Placeholder for structured JSON export
│       └── prometheusExporter.ts  # Placeholder for Prometheus metrics integration
├── redis/
│   └── redis_audit.ts             # Redis key audit tool
└── README.md
```

## Prerequisites

1. **Node.js**: Version 18.18.0 or higher
2. **Dependencies**: Run `npm install` in the `backend/` directory
3. **Build**: Run `npm run build` to compile TypeScript files

## Usage

### 1. HTTP RPC Benchmark

Benchmarks JSON-RPC HTTP endpoints with weighted method selection, concurrency ramping, and latency percentile aggregation.

**Environment Variables:**
- `RPC_URLS` (required): Comma-separated list of HTTP RPC endpoints
- `INITIAL_CONCURRENCY` (default: 1): Starting concurrency level
- `CONCURRENCY_STEP` (default: 5): Concurrency increase per step
- `CONCURRENCY_INTERVAL` (default: 10): Seconds between concurrency steps
- `MAX_CONCURRENCY` (default: 20): Maximum concurrency level
- `DURATION_PER_STEP` (default: 30): Duration in seconds for each concurrency level
- `OUTPUT_FILE` (default: rpc_http_results.json): Output file path

**Example:**
```bash
# Using compiled JavaScript
cd backend
npm run build
RPC_URLS="https://mainnet.base.org,https://base.llamarpc.com" \
  INITIAL_CONCURRENCY=1 \
  MAX_CONCURRENCY=20 \
  DURATION_PER_STEP=30 \
  node dist/stress_tests/rpc/http_benchmark.js --run

# Using tsx (development)
RPC_URLS="https://mainnet.base.org" \
  tsx stress_tests/rpc/http_benchmark.ts --run
```

**Output:**
- JSON file with raw call data and aggregated statistics
- Console summary showing latency percentiles (p50, p90, p95, p99, max) per provider and method
- Success/error counts and throughput metrics

**Benchmark Methods** (weighted to emulate production):
- `eth_blockNumber` (30% weight)
- `eth_getBlockByNumber` (25% weight)
- `eth_getLogs` (20% weight)
- `eth_call` (15% weight)
- `net_version` (10% weight)

### 2. WebSocket Benchmark

Benchmarks WebSocket subscription endpoints measuring connection latency, subscription acknowledgment time, and event inter-arrival gaps.

**Environment Variables:**
- `WS_URLS` (required): Comma-separated list of WebSocket endpoints
- `SUBSCRIPTION_DURATION` (default: 60): Duration in seconds to listen for events
- `OUTPUT_FILE` (default: rpc_ws_results.json): Output file path

**Example:**
```bash
# Using compiled JavaScript
WS_URLS="wss://base.llamarpc.com,wss://base-mainnet.g.alchemy.com/v2/your-key" \
  SUBSCRIPTION_DURATION=120 \
  node dist/stress_tests/rpc/ws_benchmark.js --run

# Using tsx (development)
WS_URLS="wss://base.llamarpc.com" \
  tsx stress_tests/rpc/ws_benchmark.ts --run
```

**Output:**
- JSON file with connection results and event gap statistics
- Console summary showing connection success, latency, event counts, and gap distributions (p50, p95, max)

**Subscription:**
- Subscribes to `eth_subscribe` with `newHeads` to monitor block events
- Measures time between consecutive block notifications

### 3. Redis Audit

Audits Redis keys to identify potential performance issues and misconfigurations.

**Environment Variables:**
- `REDIS_URL` (required): Redis connection URL (e.g., `redis://localhost:6379`)
- `SCAN_BATCH_SIZE` (default: 100): Keys scanned per SCAN operation
- `SAMPLE_LIMIT` (default: 5000): Maximum number of keys to audit
- `LARGE_SIZE_THRESHOLD` (default: 10000): Size threshold for flagging large keys
- `OUTPUT_FILE` (default: redis_audit.json): Output file path

**Example:**
```bash
# Using compiled JavaScript
REDIS_URL="redis://localhost:6379" \
  SAMPLE_LIMIT=5000 \
  LARGE_SIZE_THRESHOLD=10000 \
  node dist/stress_tests/redis/redis_audit.js --run

# Using tsx (development)
REDIS_URL="redis://localhost:6379" \
  tsx stress_tests/redis/redis_audit.ts --run
```

**Output:**
- JSON file with detailed key information (type, size, TTL)
- Console summary showing:
  - Type distribution (string, hash, list, set, zset, stream)
  - TTL distribution (no expiry, with expiry, expired)
  - Large keys exceeding threshold
  - Cache-like keys (`cache:*`, `temp:*`, `session:*`) missing TTL

**Audit Scope:**
- Key type (string, hash, list, set, zset, stream)
- Size metric appropriate to type (strlen, hlen, llen, scard, zcard, xlen)
- TTL status (seconds remaining or -1 for no expiry)
- Pattern matching for cache/temporary keys that should have TTL

## Interpreting Results

### HTTP Benchmark Results

**Key Metrics:**
- **p50, p90, p95, p99 latency**: Latency percentiles in milliseconds. p95 and p99 are critical for understanding tail latencies.
- **Throughput**: Requests per second. Compare across providers and concurrency levels.
- **Error rate**: `errorCount / count`. High error rates indicate provider instability or rate limiting.

**What to Look For:**
- Latency degradation at higher concurrency levels
- Providers with consistently better p95/p99 latencies
- Error spikes indicating rate limits or capacity issues
- Method-specific bottlenecks (e.g., `eth_getLogs` may be slower)

### WebSocket Benchmark Results

**Key Metrics:**
- **Connection latency**: Time to establish WebSocket connection
- **Subscription latency**: Time to receive subscription acknowledgment
- **Event gap p50, p95, max**: Time between consecutive block notifications

**What to Look For:**
- Connection failures or high connection latency
- Large event gaps indicating missed blocks or slow notifications
- p95 event gaps exceeding block time (2 seconds for Base)

### Redis Audit Results

**Key Findings:**
- **Large keys**: Keys with size exceeding threshold may slow down Redis operations
- **Missing TTL on cache keys**: Cache/temp/session keys without expiry can cause memory bloat
- **Type distribution**: Unexpected types may indicate data model issues

**What to Look For:**
- Keys matching `cache:*`, `temp:*`, `session:*` patterns without TTL
- Extremely large strings or hashes (>100KB)
- High proportion of keys without expiry

## Next Steps

### CI Integration

To integrate benchmarks into CI/CD pipelines:

1. **Reduced Load**: Use lower concurrency and shorter durations to avoid provider throttling
2. **Baseline Comparison**: Compare results against previous runs to detect regressions
3. **Failure Thresholds**: Fail builds if p95 latency exceeds SLA or error rate is too high

Example GitHub Actions workflow snippet:
```yaml
- name: Run HTTP RPC Benchmark
  env:
    RPC_URLS: ${{ secrets.RPC_URLS }}
    INITIAL_CONCURRENCY: 1
    MAX_CONCURRENCY: 5
    DURATION_PER_STEP: 10
  run: |
    cd backend
    npm run build
    node dist/stress_tests/rpc/http_benchmark.js --run
    # Parse rpc_http_results.json and fail if p95 > threshold
```

### Prometheus Integration

The `prometheusExporter.ts` placeholder provides a foundation for exporting metrics to Prometheus:

1. **Install prom-client**: `npm install prom-client`
2. **Implement histogram metrics**: Record latency distributions with provider/method labels
3. **Push to Pushgateway**: Use Prometheus Pushgateway for batch job metrics
4. **Set up Grafana dashboards**: Visualize latency trends, error rates, and throughput

Example metric:
```typescript
import { Histogram } from 'prom-client';

const rpcLatency = new Histogram({
  name: 'rpc_latency_seconds',
  help: 'RPC call latency in seconds',
  labelNames: ['provider', 'method'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
});
```

### Scenario-Based Testing

The `scenario_runner.ts` placeholder outlines orchestrated multi-phase scenarios:

1. **Baseline**: Low concurrency reference metrics
2. **Ramp**: Gradual load increase to identify breaking points
3. **Burst**: Sudden spike to test resilience
4. **Soak**: Sustained load to detect memory leaks

Implement by coordinating HTTP and WebSocket benchmarks with phase definitions in JSON/YAML.

## Safety & Best Practices

### Secrets Management

- **Never commit secrets**: RPC URLs with API keys should be provided via environment variables
- **Use `.env` files locally**: Add `.env` to `.gitignore`
- **CI secrets**: Store provider URLs in CI/CD secret management (GitHub Secrets, AWS Secrets Manager)

### Provider Throttling

- **Start with low concurrency**: Avoid overwhelming providers with high load
- **Respect rate limits**: Monitor error responses for HTTP 429 (Too Many Requests)
- **Use multiple providers**: Distribute load across providers to avoid single-provider throttling

### Resource Cleanup

- **Close connections**: WebSocket benchmark closes connections after subscription duration
- **Redis connection**: Audit tool calls `client.quit()` after completion
- **Output files**: Store results in a dedicated directory (e.g., `stress_tests/results/`) and add to `.gitignore`

## Troubleshooting

### Common Issues

**Error: RPC_URLS environment variable required**
- Ensure `RPC_URLS` is set before running the benchmark
- Check for typos in variable name

**Connection timeout errors**
- Verify RPC endpoints are accessible
- Check network connectivity and firewall rules
- Increase timeout in benchmark code if needed

**Redis connection refused**
- Ensure Redis is running: `redis-cli ping`
- Verify `REDIS_URL` format: `redis://host:port` or `redis://user:pass@host:port`

**High error rates in results**
- Check provider status and rate limits
- Reduce concurrency or duration
- Verify API keys are valid and not expired

## Output Artifacts

All benchmark scripts generate JSON output files:

- `rpc_http_results.json`: HTTP benchmark results
- `rpc_ws_results.json`: WebSocket benchmark results
- `redis_audit.json`: Redis audit results

**Add to `.gitignore`:**
```gitignore
# Stress test results
stress_tests/rpc/*.json
stress_tests/redis/*.json
*_results.json
*_audit.json
```

## Contributing

When extending the stress testing suite:

1. Follow existing patterns for configuration and output
2. Add comprehensive error handling and graceful degradation
3. Update this README with new features and usage instructions
4. Test with multiple providers and edge cases
5. Consider CI/CD integration from the start

## Future Enhancements

- [ ] Implement `scenario_runner.ts` for multi-phase orchestration
- [ ] Add `prometheusExporter.ts` for metrics integration
- [ ] Enhance reporters with colored console output and progress bars
- [ ] Add failure injection proxy for chaos engineering
- [ ] Implement hot key frequency sampling in Redis audit
- [ ] Create Grafana dashboard templates for visualization
- [ ] Add GitHub Actions workflow for nightly benchmarks
- [ ] Support custom method weights and parameter generation
- [ ] Implement distributed load testing across multiple workers

## License

MIT
