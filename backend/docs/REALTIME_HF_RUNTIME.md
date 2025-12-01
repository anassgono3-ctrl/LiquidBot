# Real-time Health Factor Detection - Runtime Integration

## Overview

The Real-time Health Factor (HF) Detection system provides low-latency liquidation monitoring via WebSocket subscriptions to on-chain events. This replaces subgraph-triggered execution with a faster pipeline using:

- **WebSocket blocks/events** for immediate notifications (ethers v6 native listeners)
- **Multicall3 batching** for efficient health factor checks
- **Event-driven rechecks** when users interact with Aave Pool
- **Optional Flashblocks** for sub-block updates via pending block polling

The subgraph continues to serve as a **seeding source only**, populating the initial candidate set.

**Status:** Feature-flagged, opt-in, default disabled for safety.

**Note:** This service requires ethers v6 and uses native `provider.on(...)` event listeners. The legacy `provider.on('message')` subscription method is no longer supported.

---

## Architecture

### Components

1. **RealTimeHFService** (`backend/src/services/RealTimeHFService.ts`)
   - Manages WebSocket connection to RPC provider
   - Uses ethers v6 native event listeners:
     - `provider.on('block', handler)` - canonical block notifications for batch rechecks
     - `provider.on(aaveFilter, handler)` - Aave Pool logs (`Borrow`, `Repay`, `Supply`, `Withdraw`) for targeted user rechecks
     - `provider.on(chainlinkFilter, handler)` - Chainlink `AnswerUpdated` (optional) for price-triggered selective rechecks
   - Optional: Pending block polling when `USE_FLASHBLOCKS=true` (polls `eth_getBlockByNumber('pending')` at `FLASHBLOCKS_TICK_MS` interval)
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

## Predictive Orchestrator Wiring

The Predictive HF Orchestrator integrates with RealTimeHFService for pre-emptive liquidation detection:

1. **Price updates**: PriceService calls `predictiveOrchestrator.updatePrice()` on every Chainlink event, feeding price changes into projection engine
2. **Real reserve data**: UserSnapshotProvider fetches actual reserve data (collateralUsd, debtUsd, liquidationThreshold) from AaveDataService for accurate HF projections
3. **Targeted evaluation**: Evaluates three candidate slices: (a) head-start near-critical (HF < 1.02), (b) price-touched users, (c) reserve-targeted borrowers via BorrowersIndexService
4. **Micro-verification**: When `PREDICTIVE_MICRO_VERIFY_ENABLED=true` and projected HF < 1.0 + buffer, schedules immediate single-user HF check (respects per-block caps)
5. **Sprinter pre-staging**: When `SPRINTER_ENABLED=true` and projected HF ≤ `PRESTAGE_HF_BPS/10000`, calls sprinterEngine with real debt/collateral token addresses and amounts from user snapshots
6. **BorrowersIndex subsets**: On ReserveDataUpdated/price events, fetches impacted borrowers, intersects with near-critical cache, runs mini-multicall subset BEFORE broad sweep (latency ~50-100ms)
7. **Classification audit**: Distinguishes late_detection (no HF<1 sample) from late_send (sample existed but no attempt); only marks raced when we attempted and lost

Metrics: `predictive_micro_verify_scheduled_total`, `predictive_prestaged_total`, `subset_intersection_size`, `reserve_event_to_microverify_ms`

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

# Optional: Enable Flashblocks pending block polling (default: false)
USE_FLASHBLOCKS=false
# Flashblocks WebSocket URL (optional, defaults to WS_RPC_URL if not set)
# FLASHBLOCKS_WS_URL=wss://your-flashblocks-provider.com
# Flashblocks pending block polling interval in milliseconds (default: 250)
# FLASHBLOCKS_TICK_MS=250
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

When `USE_FLASHBLOCKS=true`, the service enables **pending block polling** for sub-block updates:

1. Set `USE_FLASHBLOCKS=true`
2. Optionally provide `FLASHBLOCKS_WS_URL` (defaults to `WS_RPC_URL`)
3. Optionally configure `FLASHBLOCKS_TICK_MS` (default: 250ms)
4. Service polls `eth_getBlockByNumber('pending', false)` at the configured interval
5. Triggers selective rechecks on low HF candidates when pending block changes

**Note:** Flashblocks polling is a **hint** for faster triggers. The service **always** performs a canonical recheck on block notifications before signaling execution. Pending block queries may fail silently on providers that don't support them.

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
[realtime-hf] Subscribed (ethers) to block listener
[realtime-hf] Subscribed (ethers) to Aave Pool logs
[realtime-hf] Service started successfully
```

If `USE_FLASHBLOCKS=true`, you'll also see:
```
[realtime-hf] Starting pending block polling (tick=250ms)
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

## Micro-Verification Fast Path

The Micro-Verification Fast Path reduces time-to-first sub-1.0 HF read for critical liquidation opportunities by performing immediate, single-user HF checks when specific conditions are met.

### Overview

Traditional batch checks may miss brief liquidation opportunities between sweeps. Micro-verification addresses this by:

1. **Immediate Single-User Checks**: Direct `getUserAccountData()` calls for critical candidates
2. **Near-Threshold Tracking**: Maintains a set of users with HF in near-threshold band and worsening
3. **Projection-Based Triggers**: Schedules checks when HF projection crosses below 1.0
4. **Reserve Fast-Subset**: Priority verification for near-threshold users on reserve events
5. **Head Critical Slice**: Early micro-verification for critical candidates in head-start slice

### Configuration

Add these to your `.env` file:

```bash
# Enable micro-verification fast path (default: true)
MICRO_VERIFY_ENABLED=true

# Maximum micro-verifications per block (default: 25)
MICRO_VERIFY_MAX_PER_BLOCK=25

# Minimum interval between micro-verify runs in milliseconds (default: 150)
MICRO_VERIFY_INTERVAL_MS=150

# Near-threshold band in basis points (default: 30 = 0.30%)
# Users with HF in [threshold, threshold + band] are tracked
NEAR_THRESHOLD_BAND_BPS=30

# Maximum users in reserve fast-subset recheck (default: 64)
RESERVE_FAST_SUBSET_MAX=64

# Head critical batch size for near-threshold segment (default: 120)
HEAD_CRITICAL_BATCH_SIZE=120
```

### Triggers

Micro-verification is scheduled when:

1. **Projection Cross**: User's projected HF < 1.0 based on HF delta tracking
2. **Near-Threshold Worsening**: User in [threshold, threshold + band] with negative HF delta
3. **Reserve Fast-Subset**: Near-threshold user affected by ReserveDataUpdated event
4. **Head Critical**: Critical candidate in head-start slice during batch check
5. **Sprinter**: Pre-staged candidate with projHF < 1.0 (when Sprinter enabled)

### How It Works

#### Near-Threshold Tracking
```typescript
// Users tracked when HF ∈ [1.0000, 1.0030] with worsening trend
const threshold = 1.0000;  // EXECUTION_HF_THRESHOLD_BPS / 10000
const nearBand = 0.0030;    // NEAR_THRESHOLD_BAND_BPS / 10000
const upperBound = threshold + nearBand;

if (hf >= threshold && hf <= upperBound && hfDelta < 0) {
  // Add to near-threshold set
  // Schedule micro-verification
}
```

#### Reserve Fast-Subset
```typescript
// On ReserveDataUpdated event:
// 1. Get borrowers of affected reserve
// 2. Build intersection with near-threshold users
// 3. Micro-verify up to RESERVE_FAST_SUBSET_MAX users
// 4. Run before large reserve batch sweep
```

#### Head Critical Slice
```typescript
// During head check:
// 1. Identify critical candidates in head-start slice
// 2. Use HEAD_CRITICAL_BATCH_SIZE for batch size
// 3. Micro-verify critical candidates immediately
// 4. Continue with normal batch check
```

### Performance Caps

To prevent overload, micro-verification enforces:

- **Per-Block Cap**: Maximum `MICRO_VERIFY_MAX_PER_BLOCK` checks per block
- **Interval Throttling**: Minimum `MICRO_VERIFY_INTERVAL_MS` between checks
- **De-duplication**: Each user checked at most once per block

### Metrics

Monitor micro-verification performance:

```typescript
// Prometheus metrics
liquidbot_micro_verify_total{result="hit|miss|cap|error", trigger="projection|reserve_fast|head_critical|sprinter"}
liquidbot_micro_verify_latency_ms  // Histogram
liquidbot_reserve_fast_subset_total{asset}
```

### Logs

Micro-verification events are logged:

```
[realtime-hf] micro-verify user=0x2DffF273... hf=0.9993 trigger=projection_cross latency=42ms
[realtime-hf] emit liquidatable user=0x2DffF273... hf=0.9993 reason=micro_verify_projection_cross block=38391436
[fast-lane] [reserve-fast-subset] asset=WETH size=12 via micro-verify (source=reserve)
[fast-lane] [reserve-fast-subset] asset=WETH verifiedMs=89
[realtime-hf] head-critical micro-verify starting: 8 candidates
[realtime-hf] head-critical hit user=0x5e1d65a8... hf=0.9987 latency=38ms
```

### Recommended Settings

For production on Base mainnet:

```bash
MICRO_VERIFY_ENABLED=true
MICRO_VERIFY_MAX_PER_BLOCK=25
MICRO_VERIFY_INTERVAL_MS=150
NEAR_THRESHOLD_BAND_BPS=30
RESERVE_FAST_SUBSET_MAX=64
HEAD_CRITICAL_BATCH_SIZE=120

# Related settings for optimal performance
EXECUTION_HF_THRESHOLD_BPS=10000        # 1.0000
RESERVE_RECHECK_TOP_N=400               # Reduced from 800
REALTIME_INITIAL_BACKFILL_ENABLED=false # Keep disabled
SPRINTER_ENABLED=true                   # Enable for prestaging
PRESTAGE_HF_BPS=10150                   # 1.0150
OPTIMISTIC_ENABLED=true                 # Enable optimistic dispatch
```

### Safety

- **No Heavy Background Work**: Only schedules checks when conditions are met
- **Respects Existing Guards**: Dust filters, profit thresholds, risk limits all apply
- **Non-Breaking**: Can be disabled with `MICRO_VERIFY_ENABLED=false`
- **Execution Unchanged**: Only reduces detection latency, doesn't modify execution flow

### Integration with Existing Features

Micro-verification works alongside:

- **RealTimeHFService**: Integrated into batch check flow
- **BorrowersIndexService**: Used for reserve fast-subset intersection
- **HotSetTracker**: Near-threshold users tracked separately
- **PrecomputeService**: Projection data used for triggers
- **Sprinter**: Integration hook for pre-staged candidates

### Troubleshooting

**High per-block cap hits:**
- Increase `MICRO_VERIFY_MAX_PER_BLOCK` if needed
- Review `NEAR_THRESHOLD_BAND_BPS` (wider band = more users tracked)
- Check logs for `micro-verify-skip (cap reached)` messages

**Missed liquidations still occurring:**
- Verify `MICRO_VERIFY_ENABLED=true`
- Check `MICRO_VERIFY_INTERVAL_MS` isn't too high
- Review `RESERVE_FAST_SUBSET_MAX` for reserve events
- Monitor `liquidbot_micro_verify_total{result="hit"}` for hit rate

**RPC pressure concerns:**
- Reduce `MICRO_VERIFY_MAX_PER_BLOCK` to lower cap
- Increase `MICRO_VERIFY_INTERVAL_MS` for throttling
- Reduce `RESERVE_FAST_SUBSET_MAX` for reserve events

---

## Predictive Engine, Borrowers Index, and Sprinter Integration

### Overview

The Real-time HF service integrates with three advanced components to provide predictive liquidation detection and ultra-low-latency execution paths:

1. **Predictive Orchestrator** - Projects future health factors based on price movements and interest accrual
2. **Borrowers Index** - Maintains per-reserve borrower sets for targeted rechecks
3. **Sprinter Engine** - Pre-stages liquidation calldata for immediate execution

### Predictive Orchestrator Wiring

The `PredictiveOrchestrator` evaluates near-critical user positions and generates predictive candidates when conditions indicate imminent liquidation risk.

**Data Flow:**
```
PriceService (price updates)
     │
     ├─> PredictiveOrchestrator.updatePrice()
     │
     └─> PredictiveOrchestrator.evaluate(users, block)
            │
            ├─> Generate PredictiveCandidate[]
            │
            └─> Fire predictive events to listeners
                   │
                   ├─> RealTimeHFService.ingestPredictiveCandidates()
                   ├─> RealTimeHFService.schedulePredictiveMicroVerify()
                   └─> RealTimeHFService.prestageFromPredictiveCandidate()
```

**Configuration:**
```bash
# Enable predictive engine
PREDICTIVE_ENABLED=true

# HF buffer for predictive candidates (basis points)
PREDICTIVE_HF_BUFFER_BPS=40  # 0.40%

# Max users evaluated per tick
PREDICTIVE_MAX_USERS_PER_TICK=800

# Prediction horizon (seconds)
PREDICTIVE_HORIZON_SEC=180  # 3 minutes

# Scenarios to evaluate (baseline, adverse, extreme)
PREDICTIVE_SCENARIOS=baseline,adverse,extreme

# Enable queueing of predictive candidates
PREDICTIVE_QUEUE_ENABLED=true

# Enable micro-verification for predictive candidates
PREDICTIVE_MICRO_VERIFY_ENABLED=true

# Enable fast-path flagging
PREDICTIVE_FASTPATH_ENABLED=false
```

**Integration Points:**

1. **Price Updates**: `PriceService` calls `onPriceUpdate` callback to feed price changes to the orchestrator
2. **User Snapshots**: Candidate manager provides near-threshold users for periodic evaluation
3. **Event Emission**: Orchestrator emits `PredictiveScenarioEvent` for each qualifying candidate
4. **Action Routing**: 
   - `shouldMicroVerify` → schedules single-user HF verification
   - `shouldPrestage` → calls Sprinter pre-staging for immediate execution readiness
   - Always → ingests into RealTimeHF queue for tracking

**Metrics:**
- `liquidbot_predictive_ingested_total{scenario}` - Candidates ingested per scenario
- `liquidbot_predictive_micro_verify_scheduled_total{scenario}` - Micro-verifications scheduled
- `liquidbot_predictive_prestaged_total{scenario}` - Pre-staged candidates

### Borrowers Index Service

The `BorrowersIndexService` maintains persistent per-reserve borrower sets by indexing variableDebt token Transfer events. This enables targeted rechecks when reserve data or prices change.

**Storage Modes:**
- `memory` - In-memory only (default, no persistence)
- `redis` - Persistent storage via Redis (recommended for production)
- `postgres` - Persistent storage via PostgreSQL

**Redis Mode Configuration:**
```bash
# Enable Borrowers Index
BORROWERS_INDEX_ENABLED=true

# Storage mode (memory, redis, postgres)
BORROWERS_INDEX_MODE=redis

# Redis URL for storage (optional, uses REDIS_URL if not specified)
BORROWERS_INDEX_REDIS_URL=redis://localhost:6379

# Max borrowers tracked per reserve
BORROWERS_INDEX_MAX_USERS_PER_RESERVE=3000

# Historical backfill range (blocks)
BORROWERS_INDEX_BACKFILL_BLOCKS=400000

# Backfill chunk size (blocks per batch)
BORROWERS_INDEX_CHUNK_BLOCKS=2000
```

**Targeted Reserve Rechecks:**

When a `ReserveDataUpdated` event or price change affects a reserve:

1. Fetch borrowers for that reserve from `BorrowersIndexService`
2. Intersect with near-critical cache (users with `lastHF < 1.02`)
3. Execute fast subset via micro-verify or mini-multicall (before broad sweeps)
4. Schedule broader sample of reserve borrowers for standard batch check

**Metrics:**
- `liquidbot_reserve_rechecks_total{asset,source}` - Reserve-targeted rechecks
- `liquidbot_subset_intersection_size{trigger}` - Near-critical ∩ reserve borrowers size
- `liquidbot_reserve_event_to_first_microverify_ms{reserve}` - Latency from event to first verification

**Fallback Behavior:**

If Redis connection fails during initialization, the service automatically falls back to memory mode and logs a warning. No intervention required.

### Sprinter Engine Integration

The `SprinterEngine` pre-stages liquidation candidates with HF < `PRESTAGE_HF_BPS` to minimize execution latency.

**Configuration:**
```bash
# Enable Sprinter pre-staging
SPRINTER_ENABLED=true

# Pre-staging HF threshold (basis points)
PRESTAGE_HF_BPS=10200  # 1.02

# Max pre-staged candidates
SPRINTER_MAX_PRESTAGED=1000

# Stale blocks threshold
SPRINTER_STALE_BLOCKS=10

# Minimum debt USD for pre-staging
MIN_DEBT_USD=50
```

**Pre-staging Flow:**

When a predictive candidate qualifies (`event.shouldPrestage`):
1. Extract user's debt and collateral token addresses
2. Fetch current debt/collateral amounts (wei)
3. Get debt token USD price
4. Call `SprinterEngine.prestageFromPredictive()` with actual values

**Current Implementation Status:**

The `prestageFromPredictiveCandidate()` method is wired but contains a placeholder implementation. Full integration requires:
- Fetching user position details from `AaveDataService`
- Extracting debt/collateral token addresses and amounts
- Calling actual `SprinterEngine.prestageFromPredictive()` method

**Metrics:**
- `liquidbot_predictive_prestaged_total{scenario}` - Pre-staged from predictive scenarios

### Wiring Summary

**Initialization Order:**
1. Create `PredictiveOrchestrator` (if `PREDICTIVE_ENABLED=true`)
2. Create `RealTimeHFService` with `predictiveOrchestrator` in options
3. Wire `PredictiveOrchestrator` listener to call RealTimeHF methods
4. Wire `PriceService.onPriceUpdate` to feed orchestrator
5. Set user provider from candidate manager
6. Start orchestrator fallback timer

**Runtime Flow:**

**On Price Update:**
```
PriceService.getPrice() 
  → PriceService.onPriceUpdate callback
  → PredictiveOrchestrator.updatePrice()
  → (triggers evaluation if conditions met)
```

**On ReserveDataUpdated Event:**
```
RealTimeHFService receives event
  → BorrowersIndexService.getBorrowers(reserve)
  → Intersect with nearThresholdUsers
  → Mini-multicall on fast subset
  → Standard batch on broader sample
  → Record reserve_rechecks_total metric
```

**On Predictive Evaluation:**
```
PredictiveOrchestrator.evaluate(users)
  → Generate PredictiveCandidate[]
  → Fire onPredictiveCandidate events
     ├─> ingestPredictiveCandidates()
     ├─> schedulePredictiveMicroVerify() (if shouldMicroVerify)
     └─> prestageFromPredictiveCandidate() (if shouldPrestage)
```

### Monitoring

**Key Logs to Watch:**
```
[predictive-orchestrator] run block=... reason=... usersEvaluated=... candidates=...
[predictive-listener] micro-verify scheduled user=... scenario=...
[predictive-listener] prestage called user=... scenario=... debtUsd=...
[fast-lane] [reserve-fast-subset] asset=... size=... via micro-verify
[reserve-recheck] Checking .../... borrowers for reserve ... (source=...)
[borrowers-index] Initialized with N reserves
[borrowers-index] Redis connection failed, falling back to memory mode
```

**Health Check:**
```bash
# Check predictive metrics
curl localhost:3000/metrics | grep predictive

# Check borrowers index status
curl localhost:3000/metrics | grep borrowers_index

# Check reserve recheck metrics
curl localhost:3000/metrics | grep reserve_rechecks
```

---

## Future Enhancements

- **Auto Close Factor:** Dynamic computation based on asset type
- **MEV Protection:** Integrate with Flashbots/private RPCs
- **Multi-Chain Support:** Extend to other Aave V3 deployments
- **Advanced Eviction:** ML-based candidate prioritization
- **Sub-Block Execution:** Full Flashblocks integration for mempool visibility
- **Full Sprinter Integration:** Complete user position fetching for prestaging

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
- **Predictive:** Integrates predictive HF projections for proactive detection
- **Targeted:** Uses per-reserve borrower indexing for efficient rechecks

Enable with confidence, monitor actively, rollback instantly if needed.
