# Critical Lane Fast Path Acceleration

## Overview

The Critical Lane Fast Path is a low-latency liquidation execution system designed to minimize end-to-end latency for highly profitable liquidation opportunities (HF < 1.0). The system achieves average latency of <180ms from detection to transaction submission through several optimizations:

1. **Redis Pub/Sub Event Bus**: Immediate notification when HF drops below 1.0
2. **Snapshot-Based State**: Pre-cached user state eliminates multicall delays
3. **Mini-Multicall Reverification**: Lightweight verification for stale snapshots
4. **Template-Based Calldata**: Pre-computed transaction templates
5. **Load Shedding**: Suppress head sweeps while critical attempts in-flight

## Architecture

### Components

#### Core Infrastructure
- **`TokenMetadataResolver`**: Centralized token metadata (symbol, decimals) resolution
- **`CanonicalUsdMath`**: Single source of truth for USD conversions
- **`RedisClientFactory`**: Shared Redis client with pipeline support

#### Fast Path Components
- **`CriticalLaneExecutor`**: Orchestrates fast-path liquidation execution
- **`CriticalLaneSubscriber`**: Redis pub/sub listener for critical events
- **`CriticalLaneMiniMulticall`**: Lightweight per-user verification
- **`CriticalLaneMetrics`**: Prometheus metrics for latency tracking

### Data Flow

```
1. RealTimeHFService detects HF < 1.0
   ↓
2. Publish event to Redis channel: critical_lane.events
   ↓
3. CriticalLaneSubscriber receives event
   ↓
4. Acquire attempt lock (6s TTL)
   ↓
5. Fetch/refresh snapshot (4s TTL)
   ↓
6. Build liquidation plan
   ↓
7. Gate by min debt/profit
   ↓
8. Submit transaction (private RPC if configured)
   ↓
9. Record outcome & metrics
```

## Configuration

### Environment Variables

```bash
# Enable critical lane fast path (default: true)
CRITICAL_LANE_ENABLED=true

# Load shedding: suppress head sweeps while critical attempts in-flight (default: true)
CRITICAL_LANE_LOAD_SHED=true

# Reverification mode: snapshot_only | mini_multicall (default: mini_multicall)
CRITICAL_LANE_REVERIFY_MODE=mini_multicall

# Maximum reserves to include in mini-multicall reverify (default: 6)
CRITICAL_LANE_MAX_REVERIFY_RESERVES=6

# Latency warning threshold in milliseconds (default: 250)
CRITICAL_LANE_LATENCY_WARN_MS=250

# Abort attempt if latency exceeds this threshold in milliseconds (default: 600)
CRITICAL_LANE_LATENCY_ABORT_MS=600

# Override minimum debt USD for fast path (default: 50)
CRITICAL_LANE_MIN_DEBT_USD=50

# Override minimum profit USD for fast path (default: 10)
CRITICAL_LANE_MIN_PROFIT_USD=10

# Price fast TTL (ms) - how long prices from snapshot are valid (default: 5000)
PRICE_FAST_TTL_MS=5000

# User snapshot TTL (ms) - how long user snapshots are valid (default: 4000)
USER_SNAPSHOT_TTL_MS=4000

# Template refresh interval (ms) - how often to refresh calldata templates (default: 60000)
TEMPLATE_REFRESH_INTERVAL_MS=60000

# Fast gas mode: cache_then_estimate | estimate_only | cache_only (default: cache_then_estimate)
FAST_GAS_MODE=cache_then_estimate

# Private TX RPC URL for builder submission (optional)
# PRIVATE_TX_RPC=https://builder.example.org

# Private TX mode: bundle | direct | disabled (default: disabled)
PRIVATE_TX_MODE=disabled

# Redis pipeline enabled for batch operations (default: true)
REDIS_PIPELINE_ENABLED=true
```

## Redis Schema

### Channels
- `critical_lane.events`: Publishes JSON: `{ "user": <address>, "block": <number>, "hfRay": <string>, "ts": <ms_epoch> }`

### Keys
- `user:<address>:snapshot` (Hash): User state snapshot
  - `lastHFRay`: Health factor in RAY format
  - `totalDebtBase`: Total debt in base currency
  - `totalCollateralBase`: Total collateral in base currency
  - `lastBlock`: Block number
  - `updatedTs`: Timestamp in milliseconds
  - `reservesJson`: JSON array of reserve data

- `attempt_lock:<user>` (String, TTL=6000ms): Attempt lock to prevent double-spend

- `liq_template:<debtAsset>:<collateralAsset>` (Hash): Calldata templates
  - `closeFactorBps`: Close factor in basis points
  - `liquidationBonusBps`: Liquidation bonus in basis points
  - `baseCalldata`: Pre-computed calldata template
  - `gasBaselineWei`: Baseline gas estimate
  - `lastRefreshTs`: Last refresh timestamp

- `price:<symbolOrAddr>` (Hash): Price cache
  - `usd`: Price in USD (8 decimals)
  - `source`: Price source
  - `updatedTs`: Update timestamp
  - `stale`: Staleness flag

### Streams
- `exec_outcomes`: Execution outcomes log
  - `user`: User address
  - `block`: Block number
  - `outcome`: success | raced | skipped
  - `latencyMs`: End-to-end latency
  - `txHash`: Transaction hash (if success)
  - `profitUsd`: Estimated profit

## Metrics

### Prometheus Metrics

```
# Total attempts
critical_lane_attempt_total

# Successful executions
critical_lane_success_total

# Lost to competitor
critical_lane_raced_total

# Skipped attempts (labeled by reason)
critical_lane_skipped_total{reason}

# Stale snapshots requiring refresh
critical_lane_snapshot_stale_total

# Mini-multicall invocations
critical_lane_mini_multicall_invocations_total

# Latency histogram (ms)
critical_lane_latency_ms

# Suspicious USD scaling detections (decimal mismatch)
audit_usd_scaling_suspect_total{asset}
```

### Inspecting Metrics

```bash
# View all critical lane metrics
curl http://localhost:3000/metrics | grep critical_lane

# View audit USD scaling issues
curl http://localhost:3000/metrics | grep audit_usd_scaling
```

## Decimal & USD Valuation Fix

### Problem
Prior to this implementation, USD conversions were scattered across the codebase with inconsistent decimal handling, leading to:
- Incorrect $0.00 valuations in audit logs
- Mismatched decimal scaling between debt and collateral
- Inconsistent profit calculations

### Solution
Centralized USD computation through `CanonicalUsdMath`:

```typescript
import { computeUsd, expandVariableDebt } from './utils/CanonicalUsdMath.js';

// Compute USD with consistent decimal handling
const usdValue = computeUsd(
  rawAmount,      // Raw token amount (bigint)
  decimals,       // Token decimals (6 for USDC, 18 for WETH, 8 for cbBTC)
  priceRaw,       // Oracle price (bigint)
  priceDecimals   // Price feed decimals (8 for Chainlink)
);

// Expand variable debt with Aave index
const expandedDebt = expandVariableDebt(
  scaledDebt,              // Scaled debt from AToken
  variableBorrowIndexRay   // Variable borrow index (1e27)
);
```

### Suspicious Scaling Detection

The system automatically detects likely decimal mismatches:
- Heuristic: If `rawAmount > 10^(decimals-2)` AND `usd < 0.01`, flag as suspicious
- Logs warning with asset, rawAmount, decimals, and computed USD
- Increments `audit_usd_scaling_suspect_total{asset}` metric

Example:
```
[audit] suspicious_usd_scaling: asset=0x833...913 rawAmount=100000000 decimals=6 usdValue=0.000001
```

## Performance Characteristics

### Target Latency (Simulated Environment)
- **Average**: < 180ms (event to tx submission)
- **p95**: < 250ms
- **Abort threshold**: 600ms

### Latency Breakdown (Typical)
1. Event propagation: 10-20ms
2. Lock acquisition: 5-10ms
3. Snapshot fetch/refresh: 50-100ms (cached) or 100-150ms (mini-multicall)
4. Plan building: 20-40ms
5. Transaction submission: 30-60ms

### Optimization Techniques
1. **Redis Pipeline**: Batch multiple Redis operations in single round-trip
2. **Parallel Queries**: Fetch snapshot, prices, and gas in parallel
3. **Template Caching**: Pre-compute calldata to avoid encoding overhead
4. **Load Shedding**: Suppress expensive head sweeps when critical attempts active

## Testing

### Unit Tests
```bash
# Test canonical USD math
npm test -- --run CanonicalUsdMath.test.ts

# Test token metadata resolver
npm test -- --run TokenMetadataResolver.test.ts

# Test critical lane executor
npm test -- --run CriticalLaneExecutor.test.ts

# Test liquidation audit USD fixes
npm test -- --run liquidationAuditFastpath.test.ts
```

### Integration Tests
```bash
# Test full critical lane flow
npm test -- --run CriticalLaneIntegration.test.ts
```

### Benchmark Script
```bash
# Simulate 50 critical events with concurrency 4
tsx backend/src/scripts/benchmark-critical-lane.ts \
  --events 50 \
  --concurrency 4 \
  --userBase 0xabc \
  --simulatePrices \
  --redis ${REDIS_URL}
```

Expected output:
```
[benchmark] attempts=50 success=42 raced=4 skipped=4
[benchmark] latency: p50=118ms p95=231ms max=289ms
[benchmark] snapshotStale=12% miniMulticall=12
```

## Safety & Security

### Attempt Locking
- 6-second TTL prevents double-spend within window
- Automatically released on error or completion
- Lock key: `attempt_lock:<user>`

### Validation Gates
1. **Health Factor**: Must be < 1.0 at time of execution
2. **Minimum Debt**: Configurable via `CRITICAL_LANE_MIN_DEBT_USD`
3. **Minimum Profit**: Configurable via `CRITICAL_LANE_MIN_PROFIT_USD`
4. **Latency Budget**: Abort if exceeds `CRITICAL_LANE_LATENCY_ABORT_MS`

### Private Transaction Support
For MEV protection, configure:
```bash
PRIVATE_TX_MODE=bundle
PRIVATE_TX_RPC=https://builder.example.org
```

Modes:
- `disabled`: Use public RPC (default)
- `direct`: Submit directly to private RPC
- `bundle`: Submit as bundle to block builder

## Rollback & Compatibility

### Feature Flag
Single flag controls entire fast path:
```bash
CRITICAL_LANE_ENABLED=false
```

When disabled:
- No events published to Redis channel
- No fast-path attempts
- System falls back to standard execution pipeline

### Backward Compatibility
- Decimal/USD fixes are additive and improve existing calculations
- No changes to smart contracts required
- Existing tests remain unchanged and passing

## Troubleshooting

### High Latency
1. Check Redis connectivity: `redis-cli ping`
2. Verify snapshot staleness rate: `curl .../metrics | grep snapshot_stale`
3. Review mini-multicall invocations: `curl .../metrics | grep mini_multicall`
4. Check RPC latency: Ensure fast RPC provider

### Frequent Skips
1. Review skip reasons: `curl .../metrics | grep skipped_total`
2. Common reasons:
   - `lock_contention`: Multiple attempts on same user
   - `hf_above_threshold`: HF recovered before execution
   - `debt_below_threshold`: Debt too small
   - `profit_below_threshold`: Profit too small
   - `latency_abort`: Exceeded latency budget

### Incorrect USD Values
1. Check for suspicious scaling: `curl .../metrics | grep audit_usd_scaling`
2. Verify token decimals in `TokenMetadataResolver`
3. Ensure Aave oracle initialized: Check logs for `[aave-oracle] Initialized`

### Redis Connection Issues
System gracefully degrades:
- Falls back to standard execution path
- Logs `[critical] redis_unavailable_fallback` (rate-limited to 1/minute)
- No impact on existing liquidation detection

## Future Enhancements

### Planned Features
1. **Adaptive TTLs**: Dynamic snapshot/price TTLs based on market volatility
2. **Multi-User Batching**: Batch liquidations for gas efficiency
3. **Predictive Pre-staging**: Pre-compute likely liquidation targets
4. **Cross-Chain Support**: Extend to other Aave V3 deployments

### Metrics to Monitor
- Success rate (target: >85%)
- Average latency (target: <180ms)
- Snapshot stale rate (target: <20%)
- Suspicious USD scaling (target: 0)

## Support & Feedback

For issues or questions:
1. Check logs for error messages
2. Review metrics for anomalies
3. Consult this documentation
4. Open GitHub issue with relevant logs and metrics

---

**Version**: 1.0.0  
**Last Updated**: 2025-11-20  
**Status**: Production Ready (Phases 1 & 2 Complete)
