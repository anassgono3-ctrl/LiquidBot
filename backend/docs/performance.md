# Performance Guide

This guide covers key performance indicators (KPIs), tuning recommendations, and monitoring for the high-speed Aave V3 liquidation bot.

## Performance Targets

### Latency KPIs

| Metric | Target | Description |
|--------|--------|-------------|
| Block Detection | < 100ms | Time from new block to detection |
| Opportunity Detection | < 200ms | Block detection to liquidation candidate identified |
| HF Calculation | < 50ms per 100 users | Batch health factor calculation |
| Predictive Evaluation | < 100ms per 800 users | Predictive scenario analysis |
| Precompute Generation | < 150ms | Calldata template creation |
| Fast-Path Execution | < 250ms | Decision to transaction sent |
| **End-to-End** | **< 500ms** | **Block to tx sent for hot candidates** |

### Throughput KPIs

| Metric | Target | Description |
|--------|--------|-------------|
| HF Calculations | > 2000 users/sec | Sustained calculation throughput |
| Predictive Evaluations | > 800 users/tick | Per-tick predictive analysis |
| Redis Pipeline Ops | > 1000 ops/sec | Batch Redis operations |
| Candidate Tracking | 100K+ users | Total universe size |

### Accuracy KPIs

| Metric | Target | Description |
|--------|--------|-------------|
| Predictive Accuracy | > 70% | Confirmed crossings / total candidates |
| False Positive Rate | < 30% | Candidates that don't materialize |
| Miss Rate | < 10% | Missed vs competitor liquidations |
| Cache Hit Ratio | > 80% | Redis cache effectiveness |

## Monitoring & Metrics

### Prometheus Metrics

Access metrics at `http://localhost:3000/metrics`:

```promql
# Predictive candidates by scenario
rate(predictive_candidates_total[5m])

# Prediction accuracy
rate(predictive_crossings_confirmed_total[5m]) / 
rate(predictive_candidates_total[5m])

# HF calculation performance
histogram_quantile(0.95, 
  rate(hf_calc_batch_ms_bucket[5m])
)

# Average users calculated per second
hf_calc_users_per_sec

# Redis hit ratio
redis_hit_ratio

# Opportunity latency (p95)
histogram_quantile(0.95, 
  rate(opportunity_latency_ms_bucket[5m])
)

# Fast-path execution latency (p50, p95, p99)
histogram_quantile(0.50, rate(execution_fastpath_latency_ms_bucket[5m]))
histogram_quantile(0.95, rate(execution_fastpath_latency_ms_bucket[5m]))
histogram_quantile(0.99, rate(execution_fastpath_latency_ms_bucket[5m]))

# Liquidation miss rate
liquidation_miss_rate
```

### Dashboard Queries

**Predictive Performance**
```promql
# Candidates per minute
rate(predictive_candidates_total[1m]) * 60

# Accuracy by scenario
rate(predictive_crossings_confirmed_total{scenario="adverse"}[5m]) /
rate(predictive_candidates_total{scenario="adverse"}[5m])
```

**System Performance**
```promql
# End-to-end latency distribution
histogram_quantile(0.50, rate(opportunity_latency_ms_bucket[5m])) +
histogram_quantile(0.50, rate(execution_fastpath_latency_ms_bucket[5m]))
```

## Tuning Guide

### Predictive Engine Tuning

#### Scenario Selection

**For High Accuracy (Low False Positives)**
```env
PREDICTIVE_SCENARIOS=extreme
PREDICTIVE_HF_BUFFER_BPS=80
PREDICTIVE_HORIZON_SEC=120
```
- Use: When CPU is limited or false positives are costly
- Trade-off: May miss some early liquidations

**For High Coverage (Aggressive)**
```env
PREDICTIVE_SCENARIOS=baseline,adverse,extreme
PREDICTIVE_HF_BUFFER_BPS=20
PREDICTIVE_HORIZON_SEC=240
```
- Use: When you want maximum early warning
- Trade-off: Higher false positive rate, more CPU usage

**Balanced (Recommended)**
```env
PREDICTIVE_SCENARIOS=baseline,adverse
PREDICTIVE_HF_BUFFER_BPS=40
PREDICTIVE_HORIZON_SEC=180
```

#### User Throughput

```env
# Low-power mode (Raspberry Pi, limited CPU)
PREDICTIVE_MAX_USERS_PER_TICK=200
HEAD_CHECK_PAGE_SIZE=150

# Standard mode (Cloud VM, 4 cores)
PREDICTIVE_MAX_USERS_PER_TICK=800
HEAD_CHECK_PAGE_SIZE=250

# High-performance mode (Dedicated server, 8+ cores)
PREDICTIVE_MAX_USERS_PER_TICK=2000
HEAD_CHECK_PAGE_SIZE=500
```

### Redis Tuning

#### Connection Pooling

```env
# Conservative (low connection overhead)
REDIS_ENABLE_PIPELINING=true
REDIS_MAX_PIPELINE=200

# Balanced (recommended)
REDIS_ENABLE_PIPELINING=true
REDIS_MAX_PIPELINE=500

# Aggressive (high throughput)
REDIS_ENABLE_PIPELINING=true
REDIS_MAX_PIPELINE=1000
```

#### Memory Management

```conf
# redis.conf

# For 1GB available memory
maxmemory 800mb
maxmemory-policy allkeys-lru

# For 2GB available memory
maxmemory 1800mb
maxmemory-policy allkeys-lru

# For 4GB+ available memory
maxmemory 3800mb
maxmemory-policy allkeys-lru
```

#### TTL Configuration

```env
# Borrower state cache
# Lower = fresher data, higher = less recomputation
BORROWER_STATE_TTL_SEC=20  # Balanced
# BORROWER_STATE_TTL_SEC=10  # Fresh
# BORROWER_STATE_TTL_SEC=40  # Conservative

# Calldata precompute cache
# Lower = more current, higher = more reuse
CALLDATA_CACHE_TTL_SEC=30  # Balanced
```

### RPC Optimization

#### Provider Selection

```env
# Single RPC (simplest)
WS_RPC_URL=wss://base-mainnet.g.alchemy.com/v2/YOUR-API-KEY

# With failover
WS_RPC_URL=wss://base-mainnet.g.alchemy.com/v2/YOUR-API-KEY
SECONDARY_HEAD_RPC_URL=https://mainnet.base.org

# Multi-write race (fastest)
WS_RPC_URL=wss://base-mainnet.g.alchemy.com/v2/YOUR-API-KEY
WRITE_RPCS=https://rpc1.base.org,https://rpc2.base.org,https://rpc3.base.org
```

#### Batch Sizing

```env
# Conservative (rate-limited RPC)
MULTICALL_BATCH_SIZE=80
HEAD_CHECK_PAGE_SIZE=150

# Balanced (Alchemy free tier)
MULTICALL_BATCH_SIZE=120
HEAD_CHECK_PAGE_SIZE=250

# Aggressive (Alchemy Growth plan)
MULTICALL_BATCH_SIZE=200
HEAD_CHECK_PAGE_SIZE=400
```

## Performance Troubleshooting

### High Latency

**Symptoms**: End-to-end latency > 1000ms

**Diagnosis**:
```bash
# Check Prometheus metrics
curl localhost:3000/metrics | grep latency

# Check logs for bottlenecks
grep "ms]" logs/app.log | tail -100
```

**Solutions**:
1. Reduce batch sizes (`MULTICALL_BATCH_SIZE`, `HEAD_CHECK_PAGE_SIZE`)
2. Enable RPC hedging (`HEAD_CHECK_HEDGE_MS=300`)
3. Increase RPC rate limits (upgrade Alchemy plan)
4. Optimize Redis connection (check `REDIS_MAX_PIPELINE`)

### High CPU Usage

**Symptoms**: CPU > 80%, slow HF calculations

**Diagnosis**:
```bash
# Monitor CPU
top -bn1 | grep node

# Check calculation metrics
curl localhost:3000/metrics | grep hf_calc
```

**Solutions**:
1. Reduce `PREDICTIVE_MAX_USERS_PER_TICK`
2. Decrease `HEAD_CHECK_PAGE_SIZE`
3. Limit scenarios: `PREDICTIVE_SCENARIOS=baseline,adverse`
4. Increase evaluation interval
5. Use adaptive page sizing: `HEAD_PAGE_ADAPTIVE=true`

### High Memory Usage

**Symptoms**: Memory > 2GB, OOM errors

**Diagnosis**:
```bash
# Check Node.js memory
node --expose-gc --max-old-space-size=4096 dist/index.js

# Check Redis memory
redis-cli INFO memory
```

**Solutions**:
1. Lower Redis `maxmemory` and enable eviction
2. Reduce candidate universe: `CANDIDATE_MAX=200`
3. Decrease hotlist size: `HOTLIST_MAX=1000`
4. Increase Node.js heap: `--max-old-space-size=4096`
5. Clear stale Redis keys

### High False Positive Rate

**Symptoms**: Predictive accuracy < 50%

**Diagnosis**:
```bash
# Check Prometheus
curl localhost:3000/metrics | grep predictive_false_positive
```

**Solutions**:
1. Increase `PREDICTIVE_HF_BUFFER_BPS` (40 → 60)
2. Remove `extreme` scenario
3. Reduce `PREDICTIVE_HORIZON_SEC` (180 → 120)
4. Filter low-debt positions: `MIN_DEBT_USD=100`

### Missing Liquidations

**Symptoms**: Competitors liquidating before us

**Diagnosis**:
```bash
# Check miss rate
curl localhost:3000/metrics | grep liquidation_miss_rate

# Review logs
grep "MISSED" logs/app.log
```

**Solutions**:
1. Enable predictive: `PREDICTIVE_ENABLED=true`
2. Lower HF buffer: `PREDICTIVE_HF_BUFFER_BPS=30`
3. Enable fast-path: `OPTIMISTIC_ENABLED=true`
4. Use write RPC racing: `WRITE_RPCS=...`
5. Increase page size: `HEAD_CHECK_PAGE_SIZE=400`
6. Enable price fast-path: `PRICE_FASTPATH_ENABLED=true`

## Optimization Checklist

**Initial Setup**
- [ ] Redis installed and configured
- [ ] Alchemy RPC with adequate CU/s (10,000+ recommended)
- [ ] Prometheus metrics endpoint accessible
- [ ] Logs configured with appropriate level

**Performance Tuning**
- [ ] Batch sizes optimized for RPC tier
- [ ] Redis pipelining enabled
- [ ] Predictive engine configured and tested
- [ ] Fast-path execution enabled
- [ ] Write RPC racing configured (if available)

**Monitoring**
- [ ] Grafana dashboard for key metrics
- [ ] Alerting for high latency (> 1000ms)
- [ ] Alerting for high miss rate (> 20%)
- [ ] Log aggregation for troubleshooting

**Testing**
- [ ] Dev harness validates predictive engine
- [ ] Load tested with full candidate universe
- [ ] Failover tested with RPC outages
- [ ] Latency profiled under peak load

## Benchmarks

### Reference Configuration

**Hardware**: 4 vCPU, 8GB RAM, SSD
**RPC**: Alchemy Growth (10,000 CU/s)
**Redis**: Local, 2GB maxmemory

### Performance Results

| Metric | Result |
|--------|--------|
| Avg Block Detection | 85ms |
| Avg HF Calc (500 users) | 32ms |
| Avg Predictive Eval (800 users) | 78ms |
| P95 End-to-End Latency | 420ms |
| Throughput | 2,400 users/sec |
| Redis Hit Ratio | 84% |
| Predictive Accuracy | 73% |
| Miss Rate | 8% |

### Comparison

| Mode | E2E Latency (P95) | Miss Rate | Comments |
|------|-------------------|-----------|----------|
| **Baseline (no predictive)** | 680ms | 15% | Reactive only |
| **Predictive (conservative)** | 520ms | 11% | Some early detection |
| **Predictive (balanced)** | 420ms | 8% | **Recommended** |
| **Predictive + Fast-Path** | 280ms | 4% | Aggressive, high CPU |

## Best Practices

1. **Start Conservative**: Use recommended settings, tune gradually
2. **Monitor Continuously**: Track latency, accuracy, miss rate
3. **Test Changes**: Use harness and dry-run mode
4. **Log Decisions**: Keep structured logs for analysis
5. **Benchmark Regularly**: Re-test after config changes
6. **Scale Horizontally**: Run multiple instances for redundancy
7. **Optimize for Your Goals**: Balance latency vs accuracy vs cost
