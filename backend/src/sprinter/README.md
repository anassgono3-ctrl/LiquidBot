# Sprinter: High-Priority Execution Path

## Overview

Sprinter is an ultra-low-latency execution path designed to win liquidation races on Base by pre-staging data and eliminating post-event computation overhead. Since Base's mempool is private and pending Chainlink transmit visibility is unreliable, Sprinter treats the mempool fast path as opportunistic while maximizing race-winning potential.

## Key Principles

1. **Pre-computation**: Win races by precomputing everything before the price/log lands
   - Candidate selection
   - Repay amount estimation
   - Calldata template preparation
   - Nonce & gas strategy

2. **Minimal Verification**: Use micro-multicall (≤ 25 accounts) to quickly verify HF after events

3. **Parallel Broadcasting**: Simultaneously broadcast transactions across multiple write RPC endpoints

4. **Opportunistic Optimistic Mode**: Allow execution when HF is slightly above threshold but projected to cross

## Architecture

### Components

#### 1. SprinterEngine (`SprinterEngine.ts`)
Pre-stages liquidation candidates that are near the liquidation threshold.

**Key Features:**
- Identifies near-threshold accounts (HF < PRESTAGE_HF_BPS, e.g., 1.02)
- Forecasts next-block HF using interest accrual and cached prices
- Creates PreStagedCandidate objects with:
  - User address and asset pair
  - Debt and collateral amounts
  - Projected health factor
  - Estimated repay amount
  - Pre-built calldata template reference
- Enforces limits (SPRINTER_MAX_PRESTAGED) and evicts stale entries
- Provides optimistic execution decision logic

**Configuration:**
```typescript
{
  prestageHfBps: 10200,           // 1.02 - prestage threshold
  executionHfThresholdBps: 9800,  // 0.98 - execution threshold
  optimisticEpsilonBps: 20,       // 0.20% - optimistic tolerance
  maxPrestaged: 1000,             // Maximum candidates
  staleBlocks: 10,                // Eviction threshold
  verifyBatch: 25,                // Verification batch size
  closeFactorMode: 'fixed50',     // Close factor strategy
  minDebtUsd: 50                  // Minimum debt filter
}
```

#### 2. TemplateCache (`TemplateCache.ts`)
Caches minimal liquidation calldata skeletons for fast patching.

**Key Features:**
- Builds calldata templates per (debtToken, collateralToken) pair
- Stores repay amount slot offset for O(1) patching
- LRU eviction when cache is full
- Periodic refresh based on block intervals
- Fast patching: `patchRepayAmount(template, repayWei)` → Buffer

**Template Structure:**
```
liquidationCall(collateralAsset, debtAsset, user, debtToCover, receiveAToken)
│
├─ Function selector: 4 bytes
├─ collateralAsset: 32 bytes (offset 4)
├─ debtAsset:       32 bytes (offset 36)
├─ user:            32 bytes (offset 68)
├─ debtToCover:     32 bytes (offset 100) ← Patch point
└─ receiveAToken:   32 bytes (offset 132)
```

**Configuration:**
```typescript
{
  aavePoolAddress: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  refreshIndexBps: 10000,  // Refresh after 100 blocks
  maxEntries: 50           // Maximum cache size
}
```

## Execution Flow

### Phase 1: Pre-Staging (Each Block)
```
Block N arrives
    ↓
Identify accounts with HF < PRESTAGE_HF_BPS
    ↓
For each candidate:
    - Forecast next-block HF (interest accrual)
    - If projected HF < THRESHOLD + EPSILON:
        → Get/create calldata template
        → Estimate repay amount
        → Store PreStagedCandidate
    ↓
Evict stale entries (> SPRINTER_STALE_BLOCKS old)
```

### Phase 2: Event-Triggered Execution
```
Price/Log Event (AnswerUpdated, NewTransmission, etc.)
    ↓
Collect pre-staged candidates for affected reserve
    ↓
Micro-multicall: Batch verify HF (≤ SPRINTER_VERIFY_BATCH)
    ↓
For each candidate with HF < threshold:
    - Compute final repay amount (respect CLOSE_FACTOR_MODE)
    - Patch template with actual repay amount
    - Sign transaction with selected key
    - Broadcast concurrently to all WRITE_RPCS
    ↓
Track results: won/raced/failed
```

### Phase 3: Optimistic Execution (Optional)
```
If OPTIMISTIC_ENABLED && actual HF slightly above threshold:
    ↓
Check: actual HF < threshold + OPTIMISTIC_EPSILON_BPS?
    AND
    projected HF < threshold?
    ↓
If yes: Execute anyway (optimistic)
    ↓
Track success/revert for budget management
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SPRINTER_ENABLED` | false | Enable Sprinter execution path |
| `PRESTAGE_HF_BPS` | 10200 | Pre-staging HF threshold (1.02) |
| `SPRINTER_MAX_PRESTAGED` | 1000 | Max pre-staged candidates |
| `SPRINTER_STALE_BLOCKS` | 10 | Stale candidate eviction threshold |
| `SPRINTER_VERIFY_BATCH` | 25 | Micro-verification batch size |
| `WRITE_RPCS` | - | Comma-separated write RPC URLs |
| `WRITE_RACE_TIMEOUT_MS` | 2000 | Write race timeout |
| `OPTIMISTIC_ENABLED` | false | Enable optimistic execution |
| `OPTIMISTIC_EPSILON_BPS` | 20 | Optimistic epsilon (0.20%) |
| `EXECUTION_PRIVATE_KEYS` | - | Multi-key execution (comma-separated) |
| `TEMPLATE_REFRESH_INDEX_BPS` | 10000 | Template refresh interval (blocks) |

### Example Configuration

```bash
# Enable Sprinter with aggressive settings
SPRINTER_ENABLED=true
PRESTAGE_HF_BPS=10300
SPRINTER_MAX_PRESTAGED=2000
SPRINTER_VERIFY_BATCH=50
WRITE_RPCS=https://base-mainnet.g.alchemy.com/v2/KEY1,https://mainnet.base.org,https://base.blockpi.network/v1/rpc/KEY2
WRITE_RACE_TIMEOUT_MS=1500

# Enable optimistic execution
OPTIMISTIC_ENABLED=true
OPTIMISTIC_EPSILON_BPS=30

# Multi-key execution for nonce parallelism
EXECUTION_PRIVATE_KEYS=0xkey1,0xkey2,0xkey3
```

## Metrics

Sprinter exposes comprehensive Prometheus metrics:

### Gauges
- `liquidbot_sprinter_prestaged_total` - Total pre-staged candidates
- `liquidbot_sprinter_prestaged_active` - Active (non-stale) candidates

### Counters
- `liquidbot_sprinter_attempts_total{result}` - Execution attempts
- `liquidbot_sprinter_sent_total` - Transactions sent
- `liquidbot_sprinter_won_total` - Race wins (our tx first)
- `liquidbot_sprinter_raced_total` - Race losses (competitor beat us)

### Histograms
- `liquidbot_sprinter_verify_latency_ms` - Micro-multicall latency
- `liquidbot_sprinter_event_to_send_ms` - Event → broadcast latency
- `liquidbot_sprinter_template_patch_ms` - Template patching latency
- `liquidbot_sprinter_publish_fanout_ms` - Parallel publish fanout time

### Example Queries

```promql
# Average event-to-send latency
rate(liquidbot_sprinter_event_to_send_ms_sum[5m]) / 
rate(liquidbot_sprinter_event_to_send_ms_count[5m])

# Win rate
rate(liquidbot_sprinter_won_total[5m]) / 
(rate(liquidbot_sprinter_won_total[5m]) + rate(liquidbot_sprinter_raced_total[5m]))

# Pre-staged candidate utilization
liquidbot_sprinter_prestaged_active / 1000 * 100  # Assuming max 1000
```

## Usage

### Basic Setup

```typescript
import { SprinterEngine, TemplateCache } from './sprinter';
import { config } from './config';

// Initialize template cache
const templateCache = new TemplateCache({
  aavePoolAddress: config.aavePoolAddress,
  refreshIndexBps: config.templateRefreshIndexBps,
  maxEntries: 100
});

// Initialize Sprinter engine
const sprinterEngine = new SprinterEngine({
  prestageHfBps: config.prestageHfBps,
  executionHfThresholdBps: config.executionHfThresholdBps,
  optimisticEpsilonBps: config.optimisticEpsilonBps,
  maxPrestaged: config.sprinterMaxPrestaged,
  staleBlocks: config.sprinterStaleBlocks,
  verifyBatch: config.sprinterVerifyBatch,
  closeFactorMode: config.closeFactorMode,
  minDebtUsd: config.minDebtUsd
}, templateCache);
```

### Pre-Stage Candidates

```typescript
// Each block, identify and pre-stage near-threshold accounts
async function prestageBlock(blockNumber: number) {
  const candidates = await identifyNearThresholdAccounts(blockNumber);
  
  for (const candidate of candidates) {
    const success = sprinterEngine.prestage(
      candidate.user,
      candidate.debtToken,
      candidate.collateralToken,
      candidate.debtWei,
      candidate.collateralWei,
      candidate.projectedHF,
      blockNumber,
      candidate.debtPriceUsd
    );
    
    if (success) {
      metrics.sprinterPrestagedTotal.inc();
    }
  }
  
  // Evict stale candidates
  const evicted = sprinterEngine.evictStale(blockNumber);
  metrics.sprinterPrestagedTotal.dec(evicted);
}
```

### Execute on Event

```typescript
// On price/log event
async function handlePriceEvent(event: PriceEvent) {
  const startTime = Date.now();
  
  // Get pre-staged candidates for this reserve
  const candidates = sprinterEngine.getCandidatesForReserve(event.debtToken);
  
  // Micro-verification
  const verifyStart = Date.now();
  const verified = await microVerifyBatch(candidates);
  metrics.sprinterVerifyLatencyMs.observe(Date.now() - verifyStart);
  
  // Execute
  for (const candidate of verified) {
    const template = templateCache.getTemplate(
      candidate.debtToken,
      candidate.collateralToken,
      event.blockNumber
    );
    
    const patchStart = Date.now();
    const calldata = templateCache.patchUserAndRepay(
      template,
      candidate.user,
      candidate.repayWeiEstimate
    );
    metrics.sprinterTemplatePatchMs.observe(Date.now() - patchStart);
    
    // Broadcast to all write RPCs in parallel
    await parallelBroadcast(calldata, config.writeRpcs);
  }
  
  // Track end-to-end latency
  metrics.sprinterEventToSendMs.observe(Date.now() - startTime);
}
```

## Performance Characteristics

### Latency Targets
- **Pre-staging**: < 10ms per candidate
- **Template patching**: < 1ms per template
- **Micro-verification**: < 50ms for 25 accounts
- **Event-to-send**: < 100ms total

### Memory Usage
- **Per candidate**: ~200 bytes
- **1000 candidates**: ~200KB
- **Template cache (50 entries)**: ~50KB

### Throughput
- **Pre-staging**: 1000+ candidates/block
- **Verification**: 25-50 accounts per batch
- **Parallel broadcasts**: 3-5 RPCs simultaneously

## Troubleshooting

### High Pre-Staged Count
```bash
# Check if stale eviction is working
curl http://localhost:3000/metrics | grep sprinter_prestaged

# Reduce prestage threshold or increase stale blocks
PRESTAGE_HF_BPS=10100
SPRINTER_STALE_BLOCKS=5
```

### Low Win Rate
```bash
# Increase RPC parallelism
WRITE_RPCS=https://rpc1,https://rpc2,https://rpc3,https://rpc4

# Reduce race timeout for faster abandonment
WRITE_RACE_TIMEOUT_MS=1000

# Enable optimistic mode
OPTIMISTIC_ENABLED=true
OPTIMISTIC_EPSILON_BPS=50
```

### High Verification Latency
```bash
# Reduce verification batch size
SPRINTER_VERIFY_BATCH=10

# Use faster RPC endpoint for verification
# Check RPC pool metrics: liquidbot_rpc_pool_healthy_endpoints
```

## Best Practices

1. **Multi-RPC Setup**: Always configure at least 3 write RPCs for redundancy
2. **Key Distribution**: Use 3-5 execution keys to distribute nonce contention
3. **Monitoring**: Set up alerts on `sprinter_event_to_send_ms` > 150ms
4. **Capacity Planning**: Monitor `sprinter_prestaged_active` vs `SPRINTER_MAX_PRESTAGED`
5. **Optimistic Budget**: Track revert rate and adjust `OPTIMISTIC_EPSILON_BPS` accordingly

## Future Enhancements

- [ ] Gas price prediction for optimal bidding
- [ ] MEV-aware execution ordering
- [ ] Cross-reserve candidate correlation
- [ ] Adaptive prestage threshold based on win rate
- [ ] Machine learning for HF projection
