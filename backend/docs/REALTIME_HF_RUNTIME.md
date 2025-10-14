# Real-time Health Factor Detection - Runtime Integration

## Overview

The Real-time Health Factor (HF) Detection system provides low-latency liquidation monitoring via WebSocket subscriptions to on-chain events. This replaces subgraph-triggered execution with a faster pipeline using:

- **WebSocket blocks/events** for immediate notifications
- **Multicall3 batching** for efficient health factor checks
- **Event-driven rechecks** when users interact with Aave Pool
- **Optional Flashblocks** for sub-block updates (provider-specific)

The subgraph continues to serve as a **seeding source only**, populating the initial candidate set.

**Status:** Feature-flagged, opt-in, default disabled for safety.

---

## Architecture

### Components

1. **RealTimeHFService** (`backend/src/services/RealTimeHFService.ts`)
   - Manages WebSocket connection to RPC provider
   - Subscribes to:
     - `newHeads` - canonical block notifications for batch rechecks
     - Aave Pool logs (`Borrow`, `Repay`, `Supply`, `Withdraw`) - targeted user rechecks
     - Chainlink `AnswerUpdated` (optional) - price-triggered selective rechecks
   - Performs Multicall3 batch `getUserAccountData()` calls
   - Emits `liquidatable` events when HF < threshold

2. **CandidateManager** (`backend/src/services/CandidateManager.ts`)
   - Bounded in-memory set of candidate addresses (max `CANDIDATE_MAX`)
   - Eviction strategy: LRU + priority (healthy users HF > 1.1 evicted first)
   - Tracks last HF, last check timestamp, last touched timestamp
   - Seeded via SubgraphService every `REALTIME_SEED_INTERVAL_SEC` with jitter

3. **Execution Integration** (opt-in when `USE_REALTIME_HF=true`)
   - RealTimeHFService emits `liquidatable` events
   - ExecutionService consumes events and creates synthetic Opportunity objects
   - Pre-execution safety check: re-query HF at latest block
   - Skip reasons: `hf_not_below_threshold`, `stale_head`, `debt_zero`

### Flow Diagram

```
┌─────────────┐     WebSocket      ┌──────────────────┐
│   RPC Node  │ <───────────────── │ RealTimeHFService│
└─────────────┘                    └──────────────────┘
       │                                    │
       │ newHeads                           │
       │ Aave Pool logs                     │
       │ (Borrow/Repay/Supply/Withdraw)     │
       │                                    ▼
       │                           ┌──────────────────┐
       │                           │ CandidateManager │ ◄─── Subgraph (seed)
       │                           └──────────────────┘
       │                                    │
       ▼                                    │
   Trigger                                  │
   (event/head/price)                       │
       │                                    │
       │                                    ▼
       │                           Multicall3 Batch
       │                           getUserAccountData()
       │                                    │
       │                                    ▼
       │                              HF < 0.98?
       │                                    │
       │                                    ├─ NO ──► skip
       │                                    │
       │                                    └─ YES ─► emit('liquidatable')
       │                                                      │
       │                                                      ▼
       │                                             ExecutionService
       │                                             (if EXECUTION_ENABLED)
       │                                                      │
       │                                                      ▼
       │                                              Pre-flight HF recheck
       │                                                      │
       │                                                      └─► execute()
```

---

## Configuration

### Environment Variables

Add these to your `.env` file:

#### Master Switch

```bash
# Enable real-time HF detection (default: false)
USE_REALTIME_HF=false
```

#### WebSocket Configuration

```bash
# Standard WebSocket RPC URL (required when USE_REALTIME_HF=true)
WS_RPC_URL=wss://mainnet.base.org

# Optional: Enable Flashblocks mode for faster detection (default: false)
USE_FLASHBLOCKS=false
# FLASHBLOCKS_WS_URL=wss://your-flashblocks-provider.com

# Flashblocks polling interval in milliseconds (default: 250)
FLASHBLOCKS_TICK_MS=250
```

#### Contract Addresses

```bash
# Multicall3 on Base (default: 0xca11bde05977b3631167028862be2a173976ca11)
MULTICALL3_ADDRESS=0xca11bde05977b3631167028862be2a173976ca11

# Aave V3 Pool on Base (default: 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5)
AAVE_POOL=0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
```

#### Thresholds & Limits

```bash
# Health factor threshold in basis points (9800 = 0.98, below which liquidatable)
EXECUTION_HF_THRESHOLD_BPS=9800

# Subgraph candidate refresh interval in seconds (default: 45)
REALTIME_SEED_INTERVAL_SEC=45

# Maximum candidates to maintain in memory (default: 300)
CANDIDATE_MAX=300
```

#### Optional: Chainlink Price Feeds

```bash
# Comma-separated TOKEN:FEED_ADDRESS pairs
# CHAINLINK_FEEDS=ETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,USDC:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B
```

### Defaults

When `USE_REALTIME_HF=false` (default):
- RealTimeHFService does not start
- Current subgraph-based polling continues unchanged
- Zero overhead, no breaking changes

---

## Provider Notes

### Flashblocks (Optional)

**Flashblocks** provides sub-block updates for faster liquidation detection. The service implements Flashblocks via **pending block polling** (compatible with ethers v6):

1. Set `USE_FLASHBLOCKS=true`
2. Optionally provide `FLASHBLOCKS_WS_URL` (or uses `WS_RPC_URL`)
3. Configure `FLASHBLOCKS_TICK_MS` (default: 250ms) - polling interval
4. RealTimeHFService polls `eth_getBlockByNumber('pending', false)` at the configured interval
5. When the pending block hash changes, triggers a Flashblock tick for faster HF checks
6. Falls back to standard `WS_RPC_URL` if Flashblocks WebSocket fails to connect

**Implementation Notes:**
- Uses JSON-RPC polling instead of unsupported WebSocket events (ethers v6 compatible)
- Non-blocking: polling errors are logged but don't crash the service
- Provides a "hint" for faster detection; canonical validation still happens on `newHeads`

**Note:** Flashblocks is a **hint** for faster triggers. The service **always** performs a canonical recheck on `newHeads` before signaling execution.

### Canonical Recheck

Before emitting a `liquidatable` event, the service:
1. Detects potential liquidation (HF < 0.98) via event or price trigger
2. Waits for next `newHeads` block
3. Re-queries HF at latest block height
4. Only emits if HF still < threshold

This ensures no stale or speculative data reaches execution.

---

## How to Enable

### Step 1: Configure Environment

```bash
# Required
USE_REALTIME_HF=true
WS_RPC_URL=wss://mainnet.base.org

# Optional
USE_FLASHBLOCKS=false
EXECUTION_HF_THRESHOLD_BPS=9800
REALTIME_SEED_INTERVAL_SEC=45
CANDIDATE_MAX=300
```

### Step 2: Verify Subgraph Configuration

Ensure subgraph is configured for candidate seeding:

```bash
GRAPH_API_KEY=your_gateway_key
SUBGRAPH_DEPLOYMENT_ID=GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF
```

### Step 3: Start Backend

```bash
cd backend
npm start
```

You should see:
```
[realtime-hf] Starting real-time HF detection service
[realtime-hf] Using standard WebSocket
[realtime-hf] WebSocket provider connected
[realtime-hf] Contracts verified
[realtime-hf] Subscribed to newHeads (block events)
[realtime-hf] Subscribed to Aave Pool logs
[realtime-hf] Service started successfully
```

With Flashblocks enabled (`USE_FLASHBLOCKS=true`):
```
[realtime-hf] Starting real-time HF detection service
[realtime-hf] Attempting Flashblocks WebSocket connection
[realtime-hf] Flashblocks WebSocket connected
[realtime-hf] Contracts verified
[realtime-hf] Subscribed to newHeads (block events)
[realtime-hf] Subscribed to Aave Pool logs
[realtime-hf] Starting Flashblocks pending polling (interval=250ms)
[realtime-hf] Service started successfully
```

### Step 4: Monitor Logs

Watch for real-time triggers:
```
[realtime-hf] New block 12345678
[realtime-hf] Batch check complete: 150 candidates, minHF=1.0234, trigger=head
[realtime-hf] Aave event detected for user 0x123...
[realtime-hf] User 0x123... liquidatable: HF=0.9750 (trigger=event)
```

---

## How to Disable (Rollback)

To revert to subgraph-only mode:

1. Set `USE_REALTIME_HF=false` in `.env`
2. Restart backend

No code changes required. The service will not start, and all existing behavior is preserved.

---

## Metrics

The service exposes metrics via `getMetrics()`:

- `blocksReceived` - Number of `newHeads` blocks processed
- `aaveLogsReceived` - Number of Aave Pool logs received
- `priceUpdatesReceived` - Number of Chainlink price updates (if configured)
- `healthChecksPerformed` - Total Multicall3 HF checks
- `triggersProcessed` - Number of liquidatable events emitted
- `reconnects` - Number of WebSocket reconnection attempts
- `candidateCount` - Current candidate set size
- `minHF` - Lowest HF observed across all checks
- `lowestHFCandidate` - Candidate with lowest HF

These can be integrated into Prometheus/Grafana dashboards.

---

## Execution Integration

When `USE_REALTIME_HF=true` **and** `EXECUTION_ENABLED=true`:

1. RealTimeHFService emits `liquidatable` event
2. ExecutionService listens for event
3. Creates synthetic `Opportunity` object with:
   - `user` - liquidatable user address
   - `healthFactor` - current HF from event
   - `triggerType` - 'event', 'head', or 'price'
   - `timestamp` - detection timestamp
4. Queries Aave Protocol Data Provider for debt details
5. Computes `debtToCover` using close factor (fixed 50% for now)
6. Performs pre-flight HF recheck at latest block
7. Calls `ExecutionService.execute(opportunity)` if still liquidatable

### Safety Checks

Before sending transaction:
- Re-read HF at latest `blockTag`
- If HF >= 1.0, skip with reason `user_not_liquidatable`
- If debt is zero, skip with reason `debt_zero`
- If head is stale, skip with reason `stale_head`

### Close Factor

Current implementation: **Fixed 50%** (safe default, matches Aave v3 default for most assets).

Future: `CLOSE_FACTOR_MODE=auto` will dynamically compute based on asset type and user state.

---

## Telegram Notifications

Real-time opportunities include enriched context:

```
🔴 Liquidation Opportunity (Real-time)
User: 0x123...
Health Factor: 0.9750
Trigger: event (Aave Borrow)
Block: 12345678
Debt to Cover: 1000 USDC
Collateral: 1050 WETH
Profit Estimate: ~50 USD
```

Tag format: `(Real-time)` or `(Subgraph)` to distinguish sources.

---

## Troubleshooting

### WebSocket Connection Fails

**Symptoms:**
```
[realtime-hf] Provider error: WebSocket connection failed
[realtime-hf] Attempting reconnect in 2000ms (attempt 1)
```

**Solutions:**
1. Verify `WS_RPC_URL` is correct and accessible
2. Check RPC provider supports WebSocket (not all do)
3. If WebSocket unavailable, set `RPC_URL` for HTTP fallback (polling mode, higher latency)
4. Check firewall/network allows outbound WebSocket connections

### No Candidates

**Symptoms:**
```
[realtime-hf] Batch check complete: 0 candidates, minHF=N/A, trigger=head
```

**Solutions:**
1. Verify subgraph configuration (`GRAPH_API_KEY`, `SUBGRAPH_DEPLOYMENT_ID`)
2. Check if any users have active borrows on Base Aave V3
3. Increase `CANDIDATE_MAX` if eviction is too aggressive
4. Manually seed candidates via code (for testing)

### High Memory Usage

**Symptoms:**
Backend memory grows over time.

**Solutions:**
1. Reduce `CANDIDATE_MAX` (default 300)
2. Reduce `REALTIME_SEED_INTERVAL_SEC` to prune stale candidates faster
3. Monitor metrics to identify candidate churn

### False Positives

**Symptoms:**
`liquidatable` events emitted but HF > 1.0 on execution.

**Solutions:**
1. This is expected during price volatility
2. Pre-flight HF recheck in ExecutionService handles this
3. Adjust `EXECUTION_HF_THRESHOLD_BPS` lower (e.g., 9700 = 0.97) for more conservative triggering
4. Ensure WebSocket provider is low-latency and reliable

---

## Performance Considerations

### WebSocket vs HTTP

- **WebSocket:** Real-time event notifications, minimal latency (~100-500ms)
- **HTTP Polling:** Fallback mode, 10-second intervals, higher latency

### Multicall3 Batching

- Single RPC call for all candidates (efficient)
- Typical batch size: 50-300 candidates
- Latency: ~200-500ms depending on RPC provider

### Event-Driven Checks

- Targeted rechecks only for users involved in events (optimal)
- Avoids unnecessary checks on inactive users
- Prioritizes low HF candidates on price updates

---

## Testing

### Unit Tests

```bash
cd backend
npm test -- CandidateManager.test.ts
npm test -- RealTimeHFService.test.ts
```

### Integration Test (Harness)

The existing `hf-realtime-harness.ts` script can be used to validate real-time detection before enabling in production:

```bash
cd backend
npm run hf:harness
```

See `backend/docs/HF_REALTIME_HARNESS.md` for details.

---

## Rollout Plan

### Phase 1: Monitoring Only (Recommended)

1. Enable `USE_REALTIME_HF=true`
2. Keep `EXECUTION_ENABLED=false`
3. Monitor logs and metrics for 24-48 hours
4. Validate candidate seeding, HF checks, and trigger accuracy

### Phase 2: Dry Run Execution

1. Enable `EXECUTION_ENABLED=true`
2. Keep `DRY_RUN_EXECUTION=true`
3. Monitor simulated executions for 24 hours
4. Validate opportunity synthesis and safety checks

### Phase 3: Live Execution

1. Set `DRY_RUN_EXECUTION=false`
2. Start with conservative limits:
   - `MAX_POSITION_SIZE_USD=1000`
   - `MIN_PROFIT_AFTER_GAS_USD=50`
3. Monitor for 24 hours
4. Gradually increase limits as confidence builds

### Rollback at Any Phase

Set `USE_REALTIME_HF=false` and restart. No data loss, no state corruption.

---

## Future Enhancements

- **Auto Close Factor:** Dynamic computation based on asset type
- **MEV Protection:** Integrate with Flashbots/private RPCs
- **Multi-Chain Support:** Extend to other Aave V3 deployments
- **Advanced Eviction:** ML-based candidate prioritization
- **Sub-Block Execution:** Full Flashblocks integration for mempool visibility

---

## Support

For issues or questions:
1. Check logs for error messages
2. Review metrics via `getMetrics()`
3. Consult existing harness documentation (`HF_REALTIME_HARNESS.md`)
4. Open GitHub issue with logs and configuration

---

## Summary

The Real-time HF Detection system provides a **low-latency, opt-in** liquidation monitoring pipeline. It is:
- **Non-breaking:** Default disabled, existing behavior unchanged
- **Feature-flagged:** Easy rollback via environment variable
- **Production-ready:** Includes reconnect logic, metrics, and safety checks
- **Efficient:** Multicall3 batching + event-driven checks
- **Extensible:** Supports Flashblocks, Chainlink feeds, and future enhancements

Enable with confidence, monitor actively, rollback instantly if needed.
