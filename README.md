# LiquidBot - Aave V3 Base Liquidation Protection Service

A production-grade liquidation protection service for Aave V3 on the Base Network. This project focuses on providing value-added user protection through refinancing, rebalancing, and emergency intervention rather than competing for MEV.

## Overview

Liquidations are costly, stressful, and often preventable for leveraged DeFi users. LiquidBot provides an end-to-end service architecture to:

- Monitor positions in near real time
- Intervene before liquidation occurs
- Optimize collateral composition
- Offer tiered monetization options
- Provide enterprise reliability, observability, and security

## Key Features

### Protection Actions
1. **Refinance**: Flash loan debt restructure
2. **Collateral Swap**: Move to more stable assets
3. **Partial Deleverage**: Reduce position risk
4. **Emergency Close**: Graceful unwind
5. **Cross-Protocol Migration**: Evaluate alternatives (Compound, Morpho)

### Monitoring Logic
- **Alert Threshold**: Health Factor < 1.10
- **Critical Threshold**: Health Factor < 1.05 (trigger protection)
- Batch subgraph polling (1k positions per cycle)
- Live price deltas via oracles to reduce query load
- Adjustable risk models per subscription tier

### Observability & Diagnostics
- **Low HF Tracker**: Non-intrusive capture of detailed per-user snapshots for candidates below configurable HF threshold
  - Zero performance impact (reuses existing batch check results)
  - Graceful shutdown dumps to timestamped JSON files
  - HTTP endpoints (`/status`, `/lowhf`) for real-time inspection
  - Verification script to validate HF calculations
  - Prometheus metrics for monitoring
  - See [Low HF Tracker Documentation](./backend/LOW_HF_TRACKER_IMPLEMENTATION.md) for details

## Revenue Model

| Component | Details |
|-----------|---------|
| Subscription | Basic $10/mo, Premium $50/mo, Enterprise $200/mo |
| Refinancing Fee | 0.15% of position value per intervention |
| Emergency Fee | 0.5% (last-minute prevention) |
| Performance Bonus | 0.1% (if liquidation avoided within 30m window) |
| Gas Cost Sharing | User pays 50% (logged & itemized) |
| Exposure Limits | $500K per user / $50M system total |

## Key Performance Indicators (KPIs)

- 50+ paying subscribers in 3 months
- 98%+ liquidation prevention success
- <0.1% false positive risk triggers
- $500K ARR by month 18
- 15% MoM recurring revenue growth
- 85%+ annual retention

## Architecture

### Smart Contracts (✅ MVP Implemented)
```
contracts/src/
├── FlashLoanOrchestrator.sol   # Aave V3 Base integration (0xA238...98d1c5)
├── PositionManager.sol         # User enrollment & subscription tiers
├── CollateralOptimizer.sol     # Rebalancing strategy interface (stubs)
├── FeeCollector.sol            # Fee collection (15 bps / 50 bps)
├── EmergencyPause.sol          # Guardian-controlled circuit breaker
└── interfaces/                 # Separated for upgrade safety
```

All contracts include NatSpec documentation and event emission for off-chain indexing.

### Backend / Infrastructure (✅ MVP Implemented)
- Node.js 18+ (TypeScript), Express REST API with auth middleware
- GraphQL client for Aave V3 Base subgraph
- PostgreSQL (Prisma ORM for subscriptions & protection logs)
- Redis (BullMQ queues, rate limiting)
- Prometheus metrics endpoint + Grafana dashboard stubs
- Docker + Kubernetes deployment configurations
- WebSocket server for real-time risk alerts (HF < 1.1)
- Services: SubgraphService, HealthCalculator, FlashLoanService, SubscriptionService

## Performance Targets

- Risk detection latency: <3s
- Protection execution: <15s from trigger
- API p99 latency: <100ms (cached reads)
- Gas budget per intervention: <$3 (Base L2 assumptions)
- Uptime target: 99.9% (≤8.76h annual downtime)

## Execution Path Acceleration

The system includes advanced optimizations to reduce end-to-end decision latency from HF breach to transaction broadcast, designed specifically for Base network (no public mempool):

### Key Features

1. **Fast HF Delta Predictor**: Tracks rolling ΔHF/Δblock (4 observations) to predict users trending toward liquidation
2. **Pre-Simulation Cache**: LRU cache for liquidation plans with 2-block TTL (60%+ hit rate)
3. **Price Coalescing**: Per-block price memoization ensures consistent pricing across services
4. **Hedged Reads**: Parallel primary/secondary RPC calls after configurable delay
5. **Pre-Warmed Allowances**: Startup + periodic token approval checks with dry-run mode
6. **Gas Ladder**: Pre-computed fast/mid/safe gas tips updated each block

### Quick Start

Run the smoke test to validate all acceleration features:

```bash
cd backend
npm run accel:smoke
```

### Configuration

```bash
# Pre-simulation execution path acceleration (default: enabled)
PRE_SIM_ENABLED=true
PRE_SIM_HF_WINDOW=1.01
PRE_SIM_MIN_DEBT_USD=100

# Predictive Health Factor Engine (default: disabled)
# Scenario-based HF projection for proactive candidate detection
# NOTE: Predictive operates independently of PRE_SIM_ENABLED
PREDICTIVE_ENABLED=false
PREDICTIVE_HF_BUFFER_BPS=40
PREDICTIVE_HORIZON_SEC=180
PREDICTIVE_SCENARIOS=baseline,adverse,extreme
# Integration controls (only apply when PREDICTIVE_ENABLED=true)
PREDICTIVE_QUEUE_ENABLED=true           # Feed into hot/warm queues
PREDICTIVE_MICRO_VERIFY_ENABLED=true    # Schedule micro-verification
PREDICTIVE_FASTPATH_ENABLED=false       # Pre-mark for fast-path (use cautiously)

# Gas ladder (default: enabled)
GAS_LADDER_ENABLED=true
GAS_LADDER_FAST_TIP_GWEI=5

# Approvals (default: dry-run only)
APPROVALS_AUTO_SEND=false

# Multi-provider hedge
SECONDARY_HEAD_RPC_URL=https://your-secondary-rpc.com
HEAD_CHECK_HEDGE_MS=300

# File logging (optional - for longer-duration output inspection)
LOG_FILE_ENABLED=false             # Enable file logging with hourly rotation
LOG_FILE_RETENTION_HOURS=8         # Keep rotated logs for N hours
```

### Performance Metrics

- Average decision latency: **< 450ms** (smoke test: 0.13ms)
- Pre-sim cache hit rate: **≥ 60%** (smoke test: 100%)
- Hedge trigger rate: **< 20%** (primary should be fast)

For detailed documentation, see [EXECUTION_ACCELERATION.md](./backend/EXECUTION_ACCELERATION.md)

## High-Impact Speed Features (Liquidation Competitiveness)

Advanced performance optimizations designed to increase liquidation capture competitiveness on Aave V3 Base by eliminating latency bottlenecks while maintaining safety and stability.

### Features Overview

#### 1. **Optimistic Dispatch**
Immediate execution when cached Health Factor is sufficiently below 1.0, skipping synchronous pre-flight recheck for strong liquidation candidates.

- **Epsilon Margin**: Configurable threshold (default 5 bps = HF < 0.9995)
- **Safety Budget**: Daily revert limit (default 50) resets at UTC midnight
- **Metrics**: `liquidbot_optimistic_exec_total{result}`, `liquidbot_optimistic_latency_ms`

```bash
OPTIMISTIC_ENABLED=true
OPTIMISTIC_EPSILON_BPS=5
OPTIMISTIC_MAX_REVERTS=50
```

#### 2. **Multi-RPC Write Racing**
Parallel broadcast to multiple write RPC endpoints with first-success short-circuit and automatic health scoring.

- **Health Tracking**: Success rate & RTT exponential moving average
- **Hedge Timeout**: Fire secondary RPCs if first group delayed (default 120ms)
- **Metrics**: `liquidbot_write_rpc_rtt_ms{rpc}`, `liquidbot_write_rpc_success_total{rpc}`

```bash
WRITE_RPCS=https://rpc1.base.org,https://rpc2.base.org,https://rpc3.base.org
WRITE_RACE_TIMEOUT_MS=120
```

#### 3. **Multiple Executor Keys / Nonce Sharding**
Parallel execution capability using multiple private keys with round-robin or deterministic selection.

- **Selection Strategies**: Round-robin or per-user deterministic hashing
- **Security**: Keys never logged, only addresses
- **Metrics**: `liquidbot_executor_key_usage_total{keyIndex}`

```bash
# Comma-separated keys without 0x prefix
EXECUTION_PRIVATE_KEYS=key1,key2,key3
```

#### 4. **Timed Gas Bump / RBF Burst Strategy**
Automatic gas price replacement for pending transactions using timed multi-stage strategy.

- **Two-Stage Bumps**: First at 150ms (+25%), second at 300ms (+25%)
- **Max Bumps**: Configurable cap (default 2)
- **Metrics**: `liquidbot_gas_bump_total{stage}`, `liquidbot_gas_bump_skipped_total{reason}`

```bash
GAS_BURST_ENABLED=true
GAS_BURST_FIRST_MS=150
GAS_BURST_SECOND_MS=300
GAS_BURST_FIRST_PCT=25
GAS_BURST_SECOND_PCT=25
GAS_BURST_MAX_BUMPS=2
```

#### 5. **Precomputed Calldata Templates**
Cache of encoded transaction calldata templates for instant transaction construction.

- **Cache Key**: (user, debtAsset, collateralAsset, mode)
- **Auto-Refresh**: On reserve config change or debt index shift > 10 bps
- **Metrics**: `liquidbot_calldata_template_hits_total`, `liquidbot_calldata_template_misses_total`

```bash
CALLDATA_TEMPLATE_ENABLED=true
TEMPLATE_REFRESH_INDEX_BPS=10
```

#### 6. **Second-Order Liquidation Chaining**
Re-evaluate affected users and collateral borrowers after competitor liquidation events.

- **Trigger**: Competitor liquidation detected
- **Candidates**: Affected user + collateral borrowers with HF < 1.03
- **Metrics**: `liquidbot_second_order_chain_total{result}`

```bash
SECOND_ORDER_CHAIN_ENABLED=true
```

#### 7. **End-to-End Latency Instrumentation**
Detailed timestamp tracking at each execution pipeline stage with histogram metrics.

- **Stages**: Block received → Candidate detected → Plan ready → TX signed → Broadcast → Inclusion check
- **Metrics**: `liquidbot_exec_e2e_latency_ms`, breakdown gauges per stage

```bash
LATENCY_METRICS_ENABLED=true
```

#### 8. **Asset-Scoped Emergency Scans**
Optimized emergency scans using inverted index (asset → users) instead of full hot-set sweep.

- **Inverted Index**: O(1) asset-to-users lookup
- **Configurable Limits**: Max users (default 250), HF band (default 300 bps)
- **Metrics**: `liquidbot_emergency_asset_scan_total{asset,result}`

```bash
EMERGENCY_SCAN_MAX_USERS=250
EMERGENCY_SCAN_ASSET_HF_BAND_BPS=300
```

#### 9. **Dynamic Provider RTT Measurement**
Periodic RTT measurement for write RPCs using exponential moving average with automatic ordering.

- **Ping Interval**: Every 60 seconds (eth_blockNumber)
- **Auto-Ordering**: Broadcasts prioritize lowest-RTT endpoints
- **EMA Smoothing**: Alpha = 0.3 for stable measurements

#### 10. **Safety & Reversion Budget**
Daily revert tracking with automatic optimistic path disable when budget exceeded.

- **Budget Tracking**: Per-day counter with UTC midnight reset
- **Auto-Disable**: Prevents runaway optimistic executions
- **Metrics**: `liquidbot_optimistic_revert_budget_remaining`

### Quick Start

Run the comprehensive smoke test to validate all features:

```bash
cd backend
npm run build
npx tsx scripts/fast-path-smoke.ts
```

Expected output:
```
✅ All smoke tests PASSED
Total: 18
Passed: 18
Failed: 0
```

### Testing

All features include comprehensive unit tests:

```bash
cd backend
npm test -- tests/unit/fastpath
```

Test coverage:
- **77 unit tests** across 6 test suites
- **18 smoke tests** validating end-to-end behavior
- All tests pass with no regressions

### Performance Targets

- **Optimistic Latency**: < 50ms (eliminates pre-flight HF recheck)
- **Cache Hit Rate**: > 50% (smoke test achieves 83%)
- **E2E Latency**: < 150ms in mocked scenarios
- **Write Racing**: Fastest RPC selected by RTT
- **Gas Bumps**: 2-stage replacement within 300ms

### Safety Guarantees

- **Feature Flags**: All features default to disabled for safe rollout
- **Reversion Budget**: Prevents optimistic path abuse
- **Graceful Fallback**: Legacy path always available
- **Secure Keys**: Private keys never logged, only addresses
- **Budget Reset**: Automatic daily reset at UTC midnight

### Backward Compatibility

When features are disabled, the system operates identically to the previous version with zero performance impact. All new code is isolated in `backend/src/exec/fastpath/` module.

### Metrics & Observability

All features expose Prometheus metrics with consistent `liquidbot_` prefix:

- Optimistic execution: attempts, latency, budget
- Write RPC health: RTT, success/error counts
- Executor keys: usage per key index
- Gas bumps: attempts per stage, skip reasons
- Calldata templates: hit/miss rates
- Second-order chains: queued/executed/skipped
- End-to-end latency: histogram + stage breakdowns
- Emergency scans: per-asset scan results

View metrics at `http://localhost:3000/metrics` (when Prometheus endpoint enabled).

### Architecture

All fast path features are isolated in a dedicated module:

```
backend/src/exec/fastpath/
├── config.ts                    # Configuration loading
├── types.ts                     # Shared interfaces
├── OptimisticExecutor.ts        # Feature #1
├── WriteRacer.ts                # Feature #2
├── MultiKeyManager.ts           # Feature #3
├── GasBurstManager.ts           # Feature #4
├── CalldataTemplateCache.ts     # Feature #5
├── SecondOrderChainer.ts        # Feature #6
├── LatencyTracker.ts            # Feature #7
├── EmergencyAssetScanner.ts     # Feature #8
├── DynamicProviderRTT.ts        # Feature #9
├── ReversionBudget.ts           # Feature #10
└── index.ts                     # Public exports
```

## Ultra-Low-Latency Execution Path

Dedicated execution infrastructure for competitive one-block liquidation races on Base. This system introduces a separate hot path for critical liquidations with prebuilt intents, isolated RPC management, and block-boundary dispatch.

### Overview

Recent runtime analysis showed opportunities being lost to competitors who broadcast at the exact start of a new block. This feature addresses that gap by:

1. **Separating critical liquidations** from bulk scans into a dedicated hot path
2. **Prebuilding liquidation intents** with cached prices and calldata
3. **Dispatching at block boundaries** with sub-200ms latency from block event to tx broadcast
4. **Supporting private relays** and multi-RPC racing for maximum reach

### Key Components

#### 1. Execution RPC Pool (`ExecutionRpcPool`)
Dedicated RPC management isolated from classification/scan providers:
- **Public write endpoints**: From `WRITE_RPCS` (comma-separated) or fallback to `RPC_URL`
- **Private relay**: From `PRIVATE_TX_RPC_URL` (single endpoint)
- **Read endpoints**: From `EXECUTION_READ_RPC_URLS` or `RPC_URL`
- Health tracking and automatic failover

#### 2. Transaction Submitter (`TxSubmitter`)
Multi-mode transaction submission with four strategies:
- **public** (default): Send to fastest public write RPC
- **private**: Send to private relay only
- **race**: Concurrent broadcast to all endpoints, cancel others on first success
- **bundle**: Timed/bundled inclusion (scaffold for future)

Integrates with existing `GAS_LADDER`, `GAS_BURST`, and `GAS_BUMP_*` settings.

#### 3. Priority Queues (`HotCriticalQueue`, `WarmProjectedQueue`)
Separate queue system for liquidation candidates:
- **HotCriticalQueue**: Users with `HF <= HOT_HF_THRESHOLD_BPS` OR projected to cross <1.0 within 1-2 blocks
- **WarmProjectedQueue**: Users approaching liquidation but not immediate
- Preempts bulk head/price-trigger scans for ultra-low latency

#### 4. Intent Builder (`IntentBuilder`)
Prebuilt liquidation intents for hot accounts:
- Cached calldata, gas estimates, and priority fee suggestions
- Price resolution from `PriceHotCacheService`
- Revalidation when `intent_age > MAX_INTENT_AGE_MS`
- Respects `PRECOMPUTE_*` and `CALLDATA_TEMPLATE_ENABLED` flags

#### 5. Price Hot Cache (`PriceHotCacheService`)
Sub-second price cache (300-500ms refresh) for hot account assets:
- Eliminates price fallback delays on execution path
- Respects `PRICES_USE_AAVE_ORACLE` and `CHAINLINK_FEEDS`
- Only prefetches assets for users in `HotCriticalQueue`

#### 6. Block Boundary Controller (`BlockBoundaryController`)
Immediate liquidation dispatch on block events:
- Listens to block events via Flashblocks WS or standard WebSocket
- Dispatches prebuilt intents for users with `HF <= EXECUTION_HF_THRESHOLD_BPS`
- Optional timing window (`BLOCK_BOUNDARY_SEND_MS_BEFORE`) for predictable chains
- Limits concurrent dispatches per block

### Configuration

All features are **opt-in** and preserve existing defaults:

```bash
# Transaction Submit Mode (default: public)
TX_SUBMIT_MODE=public                    # public|private|race|bundle

# Write RPC endpoints (comma-separated, defaults to RPC_URL)
WRITE_RPCS=https://rpc1.base.org,https://rpc2.base.org

# Private relay endpoint (optional)
PRIVATE_TX_RPC_URL=https://relay.flashbots.net

# Execution read endpoints (optional, defaults to RPC_URL)
EXECUTION_READ_RPC_URLS=https://read.base.org

# Block Boundary Controller
BLOCK_BOUNDARY_ENABLED=false            # Enable block-boundary dispatch
BLOCK_BOUNDARY_SEND_MS_BEFORE=0         # Send N ms before expected block (0=immediate)
MAX_DISPATCHES_PER_BLOCK=5              # Limit concurrent dispatches

# Hot/Warm Queue Thresholds
HOT_HF_THRESHOLD_BPS=10012              # 1.0012 (fallback to FAST_LANE_HF_BUFFER_BPS)
WARM_SET_HF_MAX=1.03                    # Warm queue threshold
MIN_LIQ_EXEC_USD=50                     # Min USD for execution consideration

# Intent Builder
MAX_INTENT_AGE_MS=2000                  # Max age before revalidation (2s)
GAS_LIMIT_BUFFER=1.2                    # Gas estimate buffer multiplier

# Price Hot Cache
PRICE_HOT_CACHE_INTERVAL_MS=400         # Price refresh interval (400ms)
PRICE_HOT_STALE_MS=1000                 # Consider price stale after (1s)
PRICE_HOT_MAX_ASSETS=100                # Max assets to track
```

### Quick Start

#### Enable Public Mode (Default)
No configuration needed - uses existing `RPC_URL`:
```bash
TX_SUBMIT_MODE=public
```

#### Enable Private Relay Mode
```bash
TX_SUBMIT_MODE=private
PRIVATE_TX_RPC_URL=https://relay.flashbots.net
```

#### Enable Race Mode (Recommended for Competitiveness)
```bash
TX_SUBMIT_MODE=race
WRITE_RPCS=https://rpc1.base.org,https://rpc2.base.org,https://rpc3.base.org
PRIVATE_TX_RPC_URL=https://relay.flashbots.net
WRITE_RACE_TIMEOUT_MS=120               # Fire secondary RPCs after 120ms
```

#### Enable Block Boundary Dispatch
```bash
BLOCK_BOUNDARY_ENABLED=true
HOT_HF_THRESHOLD_BPS=10012
MAX_DISPATCHES_PER_BLOCK=5
```

### How We Win One-Block Races

This runbook explains how the ultra-low-latency path wins competitive liquidation races:

#### 1. Detection Phase (Ongoing)
- **Real-time HF service** monitors all candidates via WebSocket events
- **Price triggers** detect sharp collateral price drops
- **Reserve updates** catch debt index changes
- Users meeting criteria enter `HotCriticalQueue`

#### 2. Preparation Phase (Pre-Block)
- **Intent Builder** prebuilds liquidation calldata for hot queue users
- **Price Hot Cache** refreshes prices every 300-500ms
- **Gas estimates** and priority fees pre-calculated
- Intent cached with `MAX_INTENT_AGE_MS=2000` TTL

#### 3. Dispatch Phase (Block Boundary)
- **Block event** fires via WebSocket (sub-50ms from actual block time on Base)
- **Block Boundary Controller** immediately retrieves prebuilt intents
- **Price revalidation** (only if intent age > threshold)
- **TxSubmitter** broadcasts according to mode:
  - **public**: Fastest RPC (single endpoint)
  - **private**: Private relay only
  - **race**: All RPCs + relay concurrently, cancel others on first success

#### 4. Execution Phase
- Transaction propagates through network
- **Race mode** gives highest inclusion probability
- **Gas burst** triggers automatic bumps if pending too long
- **First success** cancels other pending broadcasts

#### Target Latency Budget:
- Block event → Intent retrieval: **5-10ms**
- Price revalidation (if needed): **20-50ms**
- Transaction signing: **5-10ms**
- Broadcast (race mode): **30-100ms**
- **Total: 60-170ms** from block event to broadcast

### Metrics

Monitor performance with Prometheus metrics:

```
# Intent Builder
liquidbot_intent_build_latency_ms         # Intent building time
liquidbot_intent_cache_hits_total         # Cache hit rate
liquidbot_intent_age_ms                   # Intent age when used

# Price Hot Cache
liquidbot_price_prewarm_age_ms            # Price age when used
liquidbot_price_hot_cache_size            # Assets in cache
liquidbot_price_hot_cache_stale_prices    # Stale prices count

# Transaction Submission
liquidbot_execution_latency_ms            # End-to-end execution latency
liquidbot_tx_submit_attempts_total        # Attempts by mode and result
liquidbot_relay_accept_ms                 # Relay acceptance time
liquidbot_race_winner_total               # Race winner by endpoint type

# Block Boundary
liquidbot_block_boundary_dispatches_total # Dispatch attempts
liquidbot_block_boundary_latency_ms       # Block event to tx submission

# Priority Queues
liquidbot_hot_queue_size                  # Hot queue size
liquidbot_hot_queue_min_hf                # Minimum HF in hot queue
liquidbot_queue_entry_reason_total        # Entry reason breakdown
```

### Testing

Run unit tests for execution modules:
```bash
cd backend
npm test -- tests/unit/execution
```

Expected output:
```
✓ ExecutionRpcPool (6 tests)
✓ PriorityQueues (8 tests)
Total: 14 tests passed
```

### Safety Guarantees

- **Non-breaking**: All features disabled by default
- **Backward compatible**: `TX_SUBMIT_MODE=public` preserves existing behavior
- **Graceful fallback**: Missing config falls back to `RPC_URL`
- **Health tracking**: Automatic endpoint failover on errors
- **No secrets logged**: URLs with credentials are masked

### Notes

- Block boundary dispatch requires WebSocket connection (`WS_RPC_URL`)
- Race mode requires multiple healthy endpoints for effectiveness
- Intent revalidation prevents stale price execution
- Hot queue entries auto-expire when HF improves
- Price hot cache only tracks assets for queued users (memory efficient)

## Wrapped ETH Ratio Feeds

The PriceService supports automatic composition of USD prices for wrapped/staked ETH assets (wstETH, weETH) using Chainlink ratio feeds. This ensures accurate pricing for positions that would otherwise report zero repay amounts.

### How It Works

1. **Ratio Feed Detection**: Feed symbols ending with `_ETH` are automatically detected as ratio feeds (e.g., `WSTETH_ETH`, `WEETH_ETH`)
2. **Price Composition**: Token USD price = (Token/ETH ratio) × (ETH/USD price)
3. **Fallback Chain**: Direct USD feed → Ratio composition → Aave oracle → Stub price
4. **Staleness Check**: Both ratio and ETH feeds are validated for freshness (configurable threshold, default 15 minutes)

### Configuration

Add ratio feeds to your `.env` file:

```bash
# Chainlink price feeds with ratio composition
CHAINLINK_FEEDS=WETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,WSTETH_ETH:0x43a5C292A453A3bF3606fa856197f09D7B74251a,WEETH_ETH:0xFC1415403EbB0c693f9a7844b92aD2Ff24775C65

# Price staleness threshold (seconds)
PRICE_STALENESS_SEC=900

# Enable ratio feed composition (default: true)
RATIO_PRICE_ENABLED=true
```

**Feed Addresses (Base Network)**:
- `WETH`: `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` (ETH/USD)
- `WSTETH_ETH`: `0x43a5C292A453A3bF3606fa856197f09D7B74251a` (wstETH/ETH ratio)
- `WEETH_ETH`: `0xFC1415403EbB0c693f9a7844b92aD2Ff24775C65` (weETH/ETH ratio)

### Validation Scripts

#### Audit Wrapped ETH Prices
Validates wrapped ETH pricing by comparing Chainlink composed prices to Aave oracle prices:

```bash
npm run audit:wrapped
```

Output includes:
- Ratio feed value (TOKEN/ETH)
- ETH/USD price
- Composed USD price
- Aave oracle price
- Mismatch percentage
- Pass/fail verdict (±1% threshold)

#### E2E Repay Sanity Test
Tests end-to-end repay calculation for a given debt position:

```bash
npm run test:repay -- --debtAsset=WSTETH --scaledDebt=1000000000000000000 \
                      --borrowIndex=1050000000000000000000000000 --decimals=18 \
                      --liquidationBonus=500 --closeFactor=5000
```

Or using environment variables:
```bash
DEBT_ASSET=WSTETH SCALED_DEBT=1e18 npm run test:repay
```

Validates:
- Price fetching (ratio composition if needed)
- Repay amount calculation
- USD value computation
- Expected profit calculation
- Ensures repayUsd > 0 (critical for skip reason logic)

### Metrics

Monitor ratio feed health with Prometheus:

- `liquidbot_price_ratio_composed_total{symbol, source}`: Successful ratio compositions
- `liquidbot_price_fallback_oracle_total{symbol}`: Fallback to Aave oracle
- `liquidbot_price_missing_total{symbol, stage}`: Missing price events
- `liquidbot_price_oracle_chainlink_stale_total{symbol}`: Stale feed detections

### Troubleshooting

**Zero repay amount for wstETH/weETH positions:**
1. Verify `CHAINLINK_FEEDS` includes both ratio feed and WETH feed
2. Check `RATIO_PRICE_ENABLED=true`
3. Run `npm run audit:wrapped` to diagnose pricing issues
4. Review logs for `ratio_resolution_failed` or `stale_feed` messages

**Price mismatch warnings:**
- Small deviations (<1%) are normal due to update timing differences
- Larger gaps may indicate stale feeds or oracle issues
- Check feed staleness threshold (`PRICE_STALENESS_SEC`)

## RPC-only Tuning and Stability

When operating in RPC-only mode (USE_SUBGRAPH=false), the real-time HF service relies on WebSocket events and periodic on-chain health checks. The following configuration options help optimize performance, reduce provider pressure, and improve stability under high load.

### Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `MULTICALL_BATCH_SIZE` | 120 | Number of calls per multicall sub-batch. Increase to 150-200 for paid Alchemy plans. |
| `HEAD_PAGE_ADAPTIVE` | true | Enable adaptive adjustment of page size based on latency/timeout rates. |
| `HEAD_PAGE_TARGET_MS` | 900 | Target maximum elapsed time per head page run (ms). Adaptive logic adjusts page size to stay within target. |
| `HEAD_PAGE_MIN` | 600 | Lower bound on dynamic page size (candidates per block). |
| `HEAD_PAGE_MAX` | HEAD_CHECK_PAGE_SIZE or 2400 | Upper bound for adaptive page size. |
| `HEAD_CHECK_HEDGE_MS` | 300 | Hedge window (ms) for early secondary provider race. Set to 0 to disable hedging. Requires SECONDARY_HEAD_RPC_URL. |
| `EVENT_BATCH_COALESCE_MS` | 120 | Debounce window (ms) to coalesce event triggers per block/reserve into a single batch. |
| `EVENT_BATCH_MAX_PER_BLOCK` | 2 | Cap on event-driven batch executions per block to avoid starvation. |
| `MAX_PARALLEL_EVENT_BATCHES` | 1 | Maximum concurrent event batches to avoid provider contention with head sweeps. |

### Quick-Start Tuning for Alchemy

| Alchemy Plan | MULTICALL_BATCH_SIZE | HEAD_PAGE_TARGET_MS | HEAD_CHECK_HEDGE_MS | Notes |
|--------------|----------------------|---------------------|---------------------|-------|
| Free Tier | 80 | 1200 | 0 (disabled) | Conservative settings to avoid rate limits |
| Growth | 120 | 900 | 300 | Default balanced settings |
| Scale | 150-180 | 700 | 250 | Aggressive settings for paid tier |

### How It Works

**Adaptive Page Sizing**: The service tracks the last 20 head runs (elapsed time, timeout count, avg latency). If runs consistently exceed `HEAD_PAGE_TARGET_MS` or timeout rate > 5%, it decreases the page size by 15%. If runs complete well under target (< 60%) with no timeouts, it increases page size by 12%. This keeps head sweeps fast and responsive.

**Early Hedging**: When `HEAD_CHECK_HEDGE_MS > 0` and a secondary RPC is configured, the service fires a hedge request to the secondary provider after the specified delay if the primary hasn't returned yet. Whichever resolves first is used, reducing timeout occurrences at full `CHUNK_TIMEOUT_MS` cost.

**Event Coalescing**: Multiple ReserveDataUpdated or user events in the same block are debounced and merged into a single batch check. This reduces contention with head sweeps and avoids redundant work. The `EVENT_BATCH_MAX_PER_BLOCK` cap ensures event-driven checks don't starve periodic head sweeps.

**Head-Run Catch-Up**: When a new block arrives while a head sweep is still running, the service doesn't queue another full run for each intermediate block. Instead, it coalesces requests and schedules a single run for the latest block once the current run completes, with explicit skip logging.

### Observability

Head sweep logs now include detailed metrics:
```
Batch check complete: 250 candidates, minHF=0.9823, trigger=head, subBatch=120, hedges=3, timeouts=0, primaryShare=85%
```

Adaptive adjustments are logged:
```
[head-adapt] adjusted page size 250 -> 213 (avg=985ms, timeouts=5.2%)
```

Catch-up skips are logged:
```
[head-catchup] skipped 2 stale blocks (latest=12345678)
```

Event coalescing logs:
```
[event-coalesce] executing batch (block=12345678, users=15, reserves=2)
```

### File Logging Configuration

For longer-duration output inspection without relying on Docker logs, enable file-based logging with automatic rotation:

```bash
# Enable file logging (default: false)
LOG_FILE_ENABLED=true

# Retention period in hours (default: 8)
LOG_FILE_RETENTION_HOURS=8
```

When enabled:
- Logs written to `./logs/bot-YYYY-MM-DD-HH.log` (hourly rotation)
- Max file size: 50MB per file
- Automatic pruning based on retention period
- Async writes to prevent blocking hot paths
- Console logging continues unchanged (additive, not replacing)

Typical use cases:
- Multi-hour test runs requiring full log history
- Debugging race conditions across block boundaries  
- Post-mortem analysis of missed liquidations
- Performance profiling over extended periods

## Low-Latency Detection Upgrades

The real-time HF service includes advanced detection features to catch liquidation opportunities earlier than competitors. These are **detection-only** enhancements that do not modify transaction execution.

### Auto-Discovery of Chainlink Feeds

Instead of manually configuring Chainlink price feeds, the service can automatically discover them from Aave reserves:

**Configuration:**
```bash
# Enable automatic feed discovery (default: true)
AUTO_DISCOVER_FEEDS=true

# Optional: Manual feeds still work and override/augment auto-discovered feeds
CHAINLINK_FEEDS=WETH:0x71041...
```

**How It Works:**
1. On startup, queries Aave UI Pool Data Provider for all active reserves
2. For each reserve, resolves the Chainlink aggregator address via Aave Oracle
3. Resolves variableDebtToken addresses for borrower tracking
4. Subscribes to AnswerUpdated and NewTransmission events for all discovered feeds
5. Manual configuration (if provided) overrides auto-discovered values

### Per-Asset Price Trigger Tuning

Fine-tune price drop thresholds and debounce windows per asset for optimal sensitivity:

**Configuration:**
```bash
# Global defaults (used when no per-asset override)
PRICE_TRIGGER_DROP_BPS=30          # 30 basis points = 0.3%
PRICE_TRIGGER_DEBOUNCE_SEC=60      # 60 seconds

# Per-asset overrides (tighter for major assets)
PRICE_TRIGGER_BPS_BY_ASSET=WETH:8,WBTC:10,USDC:20
PRICE_TRIGGER_DEBOUNCE_BY_ASSET=WETH:3,WBTC:3,USDC:5
```

**Example:** With the above config:
- WETH price drops trigger at 8 bps (0.08%) with 3-second debounce
- WBTC triggers at 10 bps with 3-second debounce
- USDC triggers at 20 bps with 5-second debounce
- Other assets use global defaults (30 bps, 60 seconds)

### Reserve-Targeted Borrower Rechecks

When a reserve is updated (ReserveDataUpdated event) or its price drops significantly, the service can instantly recheck borrowers of that specific reserve:

**Configuration:**
```bash
# Maximum borrowers to recheck per reserve event (default: 50)
RESERVE_RECHECK_TOP_N=50

# Hard cap on batch size to avoid provider overload (default: 100)
RESERVE_RECHECK_MAX_BATCH=100

# Borrowers Index configuration (disabled by default)
BORROWERS_INDEX_ENABLED=false                    # Enable borrower tracking
BORROWERS_INDEX_MODE=memory                      # memory|redis|postgres
BORROWERS_INDEX_REDIS_URL=redis://localhost:6379 # Redis URL (for redis mode)
BORROWERS_INDEX_MAX_USERS_PER_RESERVE=3000       # Max tracked borrowers per reserve
BORROWERS_INDEX_BACKFILL_BLOCKS=50000            # Historical blocks to scan
BORROWERS_INDEX_CHUNK_BLOCKS=2000                # Block chunk size for backfill
```

**Storage Modes:**
- **memory** (default): In-memory tracking, no external dependencies. Data is lost on restart.
- **redis**: Persistent tracking via Redis. Requires Redis server running.
- **postgres**: Persistent tracking via PostgreSQL using `DATABASE_URL`. Requires migration:
  ```bash
  psql $DATABASE_URL < backend/migrations/20251113_add_borrowers_index.sql
  ```
  If the `borrowers_index` table doesn't exist, the service logs a warning and falls back to memory mode.

**How It Works:**
1. BorrowersIndexService indexes variableDebt Transfer events for each reserve
2. Maintains a per-reserve set of borrower addresses (persisted based on mode)
3. On ReserveDataUpdated or price trigger, fetches borrowers for affected reserve
4. Selects up to RESERVE_RECHECK_TOP_N borrowers (randomized for fairness)
5. Performs immediate batch HF check with optional pending verification

**Quick Start (No Dependencies):**
```bash
# Default: disabled, no external services required
BORROWERS_INDEX_ENABLED=false

# Memory mode: enable tracking without Redis/Postgres
BORROWERS_INDEX_ENABLED=true
BORROWERS_INDEX_MODE=memory

# Postgres mode: enable with DATABASE_URL (after running migration)
BORROWERS_INDEX_ENABLED=true
BORROWERS_INDEX_MODE=postgres
DATABASE_URL=postgresql://user:pass@localhost:5432/liquidbot
```

### Pending-State Verification

For ultra-low latency, verify HF at `blockTag='pending'` before the block is mined:

**Configuration:**
```bash
# Enable pending-state verification (default: true)
PENDING_VERIFY_ENABLED=true
```

**How It Works:**
- Price and reserve triggers optionally check HF at `blockTag='pending'`
- Falls back to 'latest' if provider doesn't support pending blocks
- Provides ~1-2 second head start over competitors checking after block confirmation
- Errors are logged to `liquidbot_pending_verify_errors_total` metric

### New Metrics

Monitor detection performance with these Prometheus metrics:

```
# Price trigger events per asset
liquidbot_realtime_price_triggers_total{asset="WETH"}

# Reserve-targeted rechecks
liquidbot_reserve_rechecks_total{asset="WETH", source="price|reserve"}

# Pending verification failures (provider support issues)
liquidbot_pending_verify_errors_total
```

### Safety and Rollback

All detection upgrades are behind feature flags:

```bash
# Disable all new features to revert to previous behavior
AUTO_DISCOVER_FEEDS=false
PENDING_VERIFY_ENABLED=false

# Or selectively disable per-asset triggers
PRICE_TRIGGER_BPS_BY_ASSET=
PRICE_TRIGGER_DEBOUNCE_BY_ASSET=
```

**No Execution Changes:** These upgrades only affect **when** opportunities are detected, not how they are executed. Transaction submission, gas tuning, and profitability simulation are unchanged.

### Micro-Verification Fast Path

The Micro-Verification Fast Path reduces time-to-first sub-1.0 HF read for critical liquidation opportunities by performing immediate, single-user health factor checks when specific conditions are met.

**Key Features:**
- **Immediate Single-User Checks**: Direct `getUserAccountData()` calls for critical candidates
- **Near-Threshold Tracking**: Monitors users with HF in near-threshold band and worsening trend
- **Projection-Based Triggers**: Schedules checks when HF projection crosses below 1.0
- **Reserve Fast-Subset**: Priority verification for near-threshold users on reserve events
- **Head Critical Slice**: Early micro-verification for critical candidates in head-start slice

**Configuration:**
```bash
# Enable micro-verification fast path (default: true)
MICRO_VERIFY_ENABLED=true

# Maximum micro-verifications per block (default: 25)
MICRO_VERIFY_MAX_PER_BLOCK=25

# Minimum interval between micro-verify runs in milliseconds (default: 150)
MICRO_VERIFY_INTERVAL_MS=150

# Near-threshold band in basis points (default: 30 = 0.30%)
NEAR_THRESHOLD_BAND_BPS=30

# Maximum users in reserve fast-subset recheck (default: 64)
RESERVE_FAST_SUBSET_MAX=64

# Head critical batch size for near-threshold segment (default: 120)
HEAD_CRITICAL_BATCH_SIZE=120

# Recommended settings for Base mainnet
EXECUTION_HF_THRESHOLD_BPS=10000        # 1.0000
RESERVE_RECHECK_TOP_N=400               # Reduced from 800
SPRINTER_ENABLED=true                   # Enable for prestaging
PRESTAGE_HF_BPS=10150                   # 1.0150
OPTIMISTIC_ENABLED=true                 # Enable optimistic dispatch
```

**How It Works:**
1. Tracks users with HF in [threshold, threshold + band] range and worsening trend
2. Schedules immediate micro-verification when:
   - Projected HF < 1.0 based on HF delta tracking
   - User in near-threshold band with negative HF delta
   - Reserve event affects near-threshold users (fast-subset)
   - Critical candidates in head-start slice during batch check
   - Pre-staged Sprinter candidates with projHF < 1.0
3. Emits liquidatable event immediately if micro-verify returns HF < 1.0
4. Enforces per-block caps and interval throttling to prevent overload

**Metrics:**
```
liquidbot_micro_verify_total{result="hit|miss|cap|error", trigger="projection|reserve_fast|head_critical|sprinter"}
liquidbot_micro_verify_latency_ms  # Histogram
liquidbot_reserve_fast_subset_total{asset}
```

**Benefits:**
- Catches brief liquidation opportunities between batch sweeps
- Reduces time-to-first sub-1.0 HF read by 300-500ms
- No heavy background work or broad backfills
- Respects existing safety guards and execution flow

For detailed documentation, see [backend/docs/REALTIME_HF_RUNTIME.md](./backend/docs/REALTIME_HF_RUNTIME.md#micro-verification-fast-path)

## Security & Risk Controls

- 95%+ contract test coverage (Hardhat + Foundry)
- Slippage guard: max 2% on swaps
- Exposure caps enforced at contract + orchestration layers
- Multisig (3/5) for admin + fee collector
- Semi-annual audits + bug bounty
- Insurance: Nexus Mutual (evaluation phase)
- Circuit breaker: EmergencyPause.sol w/ staged disable rules

## MVP Status (✅ Complete)

The MVP implementation includes all core functionality for liquidation protection:

**Smart Contracts (5/5)**
- ✅ FlashLoanOrchestrator with Aave V3 Base integration
- ✅ PositionManager for user subscriptions
- ✅ CollateralOptimizer with rebalance events
- ✅ FeeCollector with revenue logic (0.15% / 0.5% fees)
- ✅ EmergencyPause circuit breaker

**Backend Services (4/4)**
- ✅ SubgraphService (liquidation calls, reserves, users with debt)
- ✅ HealthCalculator (HF formula with edge case handling)
- ✅ FlashLoanService (simulation + validation)
- ✅ SubscriptionService (Prisma-backed CRUD)

**API & Real-Time (3/3)**
- ✅ Express REST API (/health, /positions, /protect)
- ✅ Auth middleware (API key + JWT)
- ✅ WebSocket server (/ws) for risk alerts

**Tests & CI (19/19 passing)**
- ✅ Unit tests (HealthCalculator, FlashLoanService)
- ✅ Integration tests (API routes, WebSocket)
- ✅ GitHub Actions workflow (lint, typecheck, test, build)

**Documentation & Deployment**
- ✅ OpenAPI 3.0 spec
- ✅ GraphQL query examples
- ✅ Dockerfile + docker-compose.yml
- ✅ Kubernetes deployment manifests
- ✅ Prometheus + Grafana configurations

### Health Factor Formula (Implemented)
```
HF = (Σ collateral_value × liquidationThreshold) / Σ debt_value
```

**Thresholds:**
- Alert: HF < 1.10 (WebSocket event)
- Emergency: HF < 1.05 (protection trigger)

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis 7+
- Docker & Docker Compose

### Installation
```bash
# Clone the repository
git clone https://github.com/anassgono3-ctrl/LiquidBot.git
cd LiquidBot/backend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Build the project
npm run build

# Run tests
npm test
```

## Testing

LiquidBot includes comprehensive test coverage for both smart contracts and backend services.

### Contract Tests

The smart contracts have deterministic unit tests using mock contracts and optional Base fork tests.

#### Unit Tests (Deterministic, No External Dependencies)

Run locally:
```bash
cd contracts
npm install
npm run test
```

Or from the root:
```bash
npm run contracts:test
```

**Coverage includes:**
- ✅ Happy path: Full liquidation flow (flashLoan → liquidate → swap → repay → profit)
- ✅ Slippage guard: Reverts if swap output < minOut
- ✅ Pause functionality: Blocks execution when paused
- ✅ Whitelist enforcement: Only whitelisted collateral/debt pairs allowed
- ✅ Approval flows: Correct ERC20 approvals for Aave and 1inch
- ✅ Event assertions: LiquidationExecuted emits with exact profit (within 1 wei)
- ✅ Access control: Owner-only operations
- ✅ Configuration management: Address setters with validation

#### E2E Local Test (One-Command Full Flow)

Run a complete end-to-end test with mock contracts:

```bash
cd contracts
npm run e2e:local
```

This is the **recommended one-command test** for validating the entire liquidation system. It:
- Deploys all mocks (Balancer Vault, Aave Pool, 1inch Router, ERC20 tokens)
- Creates a liquidatable position with 5% liquidation bonus
- Executes the full flow: flash loan → liquidation → swap → repay → profit
- Asserts exact profit calculation, flash loan repayment, and payout transfer
- ✅ No external dependencies or RPC required

#### Fork Tests (Optional, Requires RPC)

Fork tests run against a Base mainnet fork to validate protocol integrations. They **auto-skip** if `RPC_URL` is not configured.

Run locally:
```bash
cd contracts
export RPC_URL=https://mainnet.base.org  # or your Base RPC URL
npm run test:fork
```

**Coverage includes:**
- ✅ Deployment on Base fork
- ✅ Protocol address validation (Balancer, Aave, 1inch)
- ✅ Contract configuration
- ✅ Whitelist operations
- ✅ Pause/unpause functionality
- ✅ Call path validation (without real liquidity)

**Note:** Fork tests do NOT rely on real liquidity or execute actual liquidations. They only validate wiring and call paths.

#### E2E Fork Test (Integration with Real Base Addresses)

Validate call-path wiring with real Base protocol addresses:

```bash
cd contracts
export RPC_URL=https://mainnet.base.org
npm run e2e:fork
```

This script:
- Deploys executor to a forked Base network
- Verifies real protocol contracts exist at expected addresses
- Tests configuration, whitelist, and pause functionality
- Auto-skips if RPC_URL not configured

### Backend Tests

The backend has comprehensive unit and integration tests using Vitest.

Run locally:
```bash
cd backend
npm install
npm test
```

Or from the root:
```bash
npm test
```

**Coverage includes:**

#### RiskManager Tests
- ✅ Blacklist enforcement (collateral and debt tokens)
- ✅ Max position size limits
- ✅ Daily loss window tracking
- ✅ After-gas profit threshold enforcement

#### ExecutionService Tests
- ✅ Dry-run path: Payload building, logging skip reasons
- ✅ Real-mode path: Configuration validation, gas price checks
- ✅ ABI encoding for initiateLiquidation
- ✅ MinOut propagation from 1inch to executor
- ✅ Error handling and revert bubbling

#### OneInchQuoteService Tests (v6 API)
- ✅ Authorization header (Bearer token) presence
- ✅ Parameter mapping (src, dst, amount, slippage in %)
- ✅ Slippage conversion (bps → percentage)
- ✅ Response normalization to { to, data, value, minOut }
- ✅ Error handling (API errors, network errors)
- ✅ Input validation

### Run All Tests

Run both contract and backend tests:
```bash
npm run test:all
```

This runs:
1. Contract unit tests (with mocks)
2. Backend unit tests
3. Backend integration tests

### CI/CD

GitHub Actions automatically runs all tests on push/PR:

#### Contract Tests Job
- Installs dependencies
- Compiles contracts with Hardhat
- Runs unit tests
- **Conditionally** runs fork tests if `BASE_FORK_URL` secret is configured

#### Backend Tests Job
- Starts PostgreSQL and Redis services
- Installs dependencies and generates Prisma client
- Runs linter and type checker
- Runs tests with coverage
- Builds the project

### CI Secrets Configuration

For fork tests in CI, add the following secret to your GitHub repository:

**Settings → Secrets and variables → Actions → New repository secret**

- `BASE_FORK_URL`: Your Base RPC URL (e.g., from Alchemy, Infura, or QuickNode)

If this secret is not set, fork tests will be skipped automatically.

### Test Structure

```
contracts/
├── test/
│   ├── LiquidationExecutor.test.ts      # Original basic tests
│   ├── LiquidationExecutor.unit.test.ts # Comprehensive unit tests with mocks
│   ├── LiquidationExecutor.fork.test.ts # Optional Base fork smoke tests
│   └── mocks/
│       ├── MockERC20.sol                # Mock ERC20 token
│       ├── MockBalancerVault.sol        # Mock flash loan provider
│       ├── MockAavePool.sol             # Mock Aave liquidation
│       └── MockOneInchRouter.sol        # Mock swap router

backend/
└── tests/
    ├── unit/
    │   ├── RiskManager.test.ts          # Risk control tests
    │   ├── ExecutionService.test.ts     # Execution pipeline tests
    │   ├── OneInchQuoteService.test.ts  # 1inch API v6 tests
    │   └── ...
    └── integration/
        ├── api.test.ts                  # REST API tests
        ├── websocket.test.ts            # WebSocket tests
        └── execution.test.ts            # End-to-end execution tests
```

## Execution (Scaffold)

The bot includes an **opt-in execution pipeline scaffold** with MEV/gas controls and risk management. This is a safe framework for future liquidation execution — **disabled by default** and currently in dry-run mode.

### ⚠️ Safety First

- **Execution is OFF by default**: `EXECUTION_ENABLED=false`
- **Dry-run mode enabled by default**: `DRY_RUN_EXECUTION=true`
- **No auto-execution from scanner**: Detection and execution are separate concerns
- **Comprehensive risk controls**: Position limits, daily loss limits, blacklists, gas caps

### How It Works

When enabled, the execution pipeline:
1. Takes profitable opportunities from the detection pipeline
2. Applies risk management rules (blacklists, position size, profit threshold)
3. Checks current gas price against configured cap
4. In dry-run mode: logs simulated execution without broadcasting
5. In real mode: executes liquidations (implementation pending)

### Configuration

Add to `.env`:

```bash
# Execution Controls (all optional - defaults are safe)
EXECUTION_ENABLED=false              # Master switch (default: false)
DRY_RUN_EXECUTION=true               # Simulate only (default: true)
MAX_GAS_PRICE_GWEI=50                # Skip if gas too high (default: 50)
MIN_PROFIT_AFTER_GAS_USD=10          # Min profit threshold (default: 10)

# Risk Management
MAX_POSITION_SIZE_USD=5000           # Per-liquidation cap (default: 5000)
DAILY_LOSS_LIMIT_USD=1000            # Daily loss limit (default: 1000)
BLACKLISTED_TOKENS=                  # Comma-separated, e.g., WBTC,XYZ

# Optional MEV Protection
PRIVATE_BUNDLE_RPC=                  # e.g., https://rpc.flashbots.net
```

### Enabling Execution (Staged Approach)

**Stage 1: Dry-Run Testing**
```bash
EXECUTION_ENABLED=true
DRY_RUN_EXECUTION=true
```
This logs execution decisions without broadcasting transactions. Monitor logs to verify logic.

**Stage 2: Real Execution (Future)**
```bash
EXECUTION_ENABLED=true
DRY_RUN_EXECUTION=false
```
⚠️ **Only enable when flash-loan implementation is complete**. Current implementation returns placeholder results.

### Risk Controls

The `RiskManager` enforces:
- **Token blacklist**: Skip liquidations involving specific tokens
- **Position size cap**: Reject liquidations exceeding `MAX_POSITION_SIZE_USD`
- **After-gas profit threshold**: Only execute if profit ≥ `MIN_PROFIT_AFTER_GAS_USD`
- **Daily loss limit**: Stop executing if daily losses exceed `DAILY_LOSS_LIMIT_USD`

### MEV & Gas Controls

The `ExecutionService`:
- Checks current gas price and skips execution if above `MAX_GAS_PRICE_GWEI`
- Supports private bundle submission via `PRIVATE_BUNDLE_RPC` (stub)
- Defaults to dry-run simulation for safety

### Implementation Status

✅ **Complete (Scaffold)**
- Risk management framework
- Gas price gating
- Configuration management
- Dry-run simulation
- Unit & integration tests

⏳ **Pending (Future Work)**
- Flash loan orchestration (Aave/Balancer)
- Aave V3 liquidation call
- DEX router integration for collateral swaps
- Private bundle submission
- On-chain simulation

### Notes

- `PROFIT_MIN_USD` gates profitable opportunity *detection*
- `MIN_PROFIT_AFTER_GAS_USD` gates actual *execution*
- Scanner continues detecting/notifying regardless of execution settings
- All execution results are logged with structured output

## On-Chain Executor (Balancer + Aave + 1inch)

The bot now includes a **production-ready on-chain liquidation executor** that atomically executes liquidations using flash loans, Aave V3 liquidation calls, and 1inch swaps on Base.

### Architecture

The executor consists of:
1. **Smart Contract** (`LiquidationExecutor.sol`): Handles flash loan callback, liquidation, and swap
2. **Backend Service** (`OneInchQuoteService.ts`): Fetches swap quotes and calldata from 1inch API
3. **Execution Pipeline** (`ExecutionService.ts`): Orchestrates the full liquidation flow

### Smart Contract Features

- **Flash Loan Provider**: Balancer V2 Vault (0% fee on Base)
- **Liquidation**: Aave V3 Pool integration
- **Swap Router**: 1inch Aggregation Router V6
- **Safety Controls**:
  - Owner-only execution
  - Pausable circuit breaker
  - Per-asset whitelist
  - Slippage protection via `minOut` parameter
  - Emergency withdraw function

### Deployment

#### 1. Deploy the Contract

```bash
cd contracts
npm install
npm run build:contracts

# Set environment variables
export RPC_URL=https://mainnet.base.org
export EXECUTION_PRIVATE_KEY=0x...your_private_key

# Deploy to Base
npm run deploy:executor
```

This deploys `LiquidationExecutor.sol` with the following addresses (Base):
- Balancer Vault: `0xBA12222222228d8Ba445958a75a0704d566BF2C8`
- Aave V3 Pool: `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`
- 1inch Router: `0x1111111254EEB25477B68fb85Ed929f73A960582`

#### 2. Verify on Basescan

After deployment, verify your contract on Basescan:

```bash
cd contracts

# Set your Basescan API key
export ETHERSCAN_API_KEY=your_basescan_api_key

# Verify with auto-detected constructor args
npm run verify:executor -- --network base --address 0xYourDeployedAddress --payout-default 0xYourPayoutAddress
```

The verification helper automatically:
- Infers constructor arguments from environment variables or uses Base mainnet defaults
- Handles the correct argument order (Balancer Vault, Aave Pool, 1inch Router, Payout Default)
- Provides troubleshooting guidance for common issues

**Troubleshooting:**
- Get your Basescan API key from [basescan.org/myapikey](https://basescan.org/myapikey)
- Ensure `--payout-default` matches the address used during deployment
- Use `--contract` flag if you have multiple contracts with the same name

See `contracts/README.md` for detailed verification options.

#### 3. Configure the Backend

Add to `backend/.env`:

```bash
# On-Chain Executor
EXECUTOR_ADDRESS=0x...deployed_contract_address
EXECUTION_PRIVATE_KEY=0x...your_private_key
RPC_URL=https://mainnet.base.org
CHAIN_ID=8453

# 1inch API (required for swaps)
ONEINCH_API_KEY=your_1inch_api_key_here
ONEINCH_BASE_URL=https://api.1inch.dev/swap/v6.0/8453

# Execution Settings
MAX_SLIPPAGE_BPS=100                 # 1% slippage tolerance
CLOSE_FACTOR_MODE=auto               # auto or fixed (50%)

# Enable execution
EXECUTION_ENABLED=true
DRY_RUN_EXECUTION=false              # ⚠️ Set to false only when ready!
```

#### 4. Whitelist Assets

Before executing liquidations, whitelist the assets:

```solidity
// Call from executor owner
executor.setWhitelist(WETH_ADDRESS, true);
executor.setWhitelist(USDC_ADDRESS, true);
executor.setWhitelist(DAI_ADDRESS, true);
// ... add other collateral/debt assets
```

#### 5. Fund the Executor

Send some ETH to the executor contract for gas:

```bash
# Send 0.1 ETH for gas
cast send $EXECUTOR_ADDRESS --value 0.1ether --private-key $EXECUTION_PRIVATE_KEY
```

### How It Works

When a liquidation opportunity is detected:

1. **Backend prepares parameters**:
   - Calculates `debtToCover` based on close factor
   - Fetches swap calldata from 1inch API
   - Applies slippage protection with `minOut`

2. **Backend calls `executor.initiateLiquidation()`**:
   - Passes user, collateral, debt, amounts, swap calldata

3. **Contract requests Balancer flash loan**:
   - Borrows `debtToCover` amount of debt asset

4. **Contract executes in `receiveFlashLoan()` callback**:
   - Approves Aave Pool for debt token
   - Calls `Pool.liquidationCall()` to liquidate user
   - Receives collateral from liquidation
   - Approves 1inch router for collateral
   - Swaps collateral → debt token using provided calldata
   - Verifies output ≥ `minOut`
   - Repays flash loan (principal + fee)
   - Transfers profit to payout address

5. **Backend receives transaction receipt**:
   - Logs profit and gas used
   - Updates execution metrics

### Safety Checklist

Before enabling real execution:

- [ ] Contract deployed and verified on Base
- [ ] Owner address is secure multisig or hardware wallet
- [ ] All expected collateral and debt assets whitelisted
- [ ] Executor funded with sufficient gas (0.1+ ETH)
- [ ] 1inch API key configured and tested
- [ ] `DRY_RUN_EXECUTION=true` tested first with real opportunities
- [ ] Risk controls configured (`MAX_POSITION_SIZE_USD`, `DAILY_LOSS_LIMIT_USD`)
- [ ] Gas cap set appropriately (`MAX_GAS_PRICE_GWEI`)
- [ ] Monitoring and alerting in place
- [ ] Emergency pause mechanism tested

### Risk Controls

The executor enforces multiple layers of protection:

**Smart Contract:**
- Owner-only execution
- Asset whitelist
- Pausable circuit breaker
- Slippage protection
- Atomic transaction (reverts on failure)

**Backend:**
- Token blacklist
- Position size limits
- Daily loss limits
- After-gas profit threshold
- Gas price gating

### Monitoring

Monitor executor activity:

```bash
# Watch executor logs
tail -f logs/executor.log

# Check executor balance
cast balance $EXECUTOR_ADDRESS

# View recent transactions
cast tx --rpc-url $RPC_URL <txhash>
```

### Contract Testing

Run Solidity tests:

```bash
cd contracts
npm run test:contracts
```

The test suite validates:
- Access control (only owner can execute)
- Whitelist enforcement
- Pause functionality
- Configuration setters
- Ownership transfer

### Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `EXECUTOR_ADDRESS` | - | Deployed contract address |
| `EXECUTION_PRIVATE_KEY` | - | Private key for signing txs |
| `RPC_URL` | - | Base RPC endpoint |
| `CHAIN_ID` | 8453 | Base chain ID |
| `ONEINCH_API_KEY` | - | 1inch API key |
| `ONEINCH_BASE_URL` | `https://api.1inch.dev/swap/v6.0/8453` | 1inch API URL |
| `MAX_SLIPPAGE_BPS` | 100 | Max slippage (1%) |
| `CLOSE_FACTOR_MODE` | auto | Close factor: auto or fixed |
| `PRIVATE_BUNDLE_RPC` | - | Optional MEV relay URL |
| `AAVE_POOL` | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | Aave V3 Pool for HF checks |

### Notes

- Balancer flash loans have 0% fee on most networks including Base
- Close factor auto mode uses full debt amount from opportunity
- Close factor fixed mode uses 50% of total debt
- Private bundle RPC support is a placeholder (not fully implemented)
- 1inch API key can be obtained from https://portal.1inch.dev/
- Always test in dry-run mode first before enabling real execution

## At-Risk Position Scanner

The bot includes an at-risk scanner that proactively detects users approaching liquidation by computing health factors locally.

### How It Works

The scanner:
- Queries a configurable number of users from the Aave V3 Base subgraph
- Computes health factors locally (no dependency on subgraph `healthFactor` field)
- Classifies users into risk tiers: NO_DEBT, DUST, OK, WARN, CRITICAL
- Optionally sends Telegram notifications for at-risk users

**Important:** `AT_RISK_SCAN_LIMIT` controls how many users the bot requests from the subgraph `users(...)` query each poll. It is **not** a filter for "recent users" — ordering is not guaranteed without an explicit `orderBy` clause. We keep it as a small, fixed sample per poll to stay rate-limit friendly since we compute health factors locally.

### Running Modes

#### 1. Continuous Monitoring (Recommended)
```bash
npm start
```
When `AT_RISK_SCAN_LIMIT > 0`, the bot automatically scans for at-risk users during each poll cycle. This is the **normal operation mode** for production use.

Configuration in `.env`:
```bash
AT_RISK_SCAN_LIMIT=50              # Number of users to scan per poll (0 disables)
AT_RISK_WARN_THRESHOLD=1.05        # HF threshold for warning tier
AT_RISK_LIQ_THRESHOLD=1.0          # HF threshold for critical tier
AT_RISK_NOTIFY_CRITICAL=true       # Send alerts for CRITICAL users
AT_RISK_NOTIFY_WARN=false          # Send alerts for WARN users (usually false)
```

#### 2. One-Off Manual Scan
```bash
npm run risk:scan                  # Display results only
npm run risk:scan -- --notify      # Display results + send Telegram alerts
```
This is a **standalone diagnostic script** useful for:
- Manual health checks outside the main bot
- Testing the scanner configuration
- Ad-hoc risk assessments

**Not required for normal operation** — the main bot (`npm start`) already scans when configured.

## Documentation

- [Project Specification](./docs/SPEC.md) - Comprehensive project specification
- [Architecture](./docs/ARCHITECTURE.md) - Detailed architecture documentation
- [Subgraph Queries](./docs/SUBGRAPH_QUERIES.md) - Aave V3 Base subgraph queries
- [Security](./docs/SECURITY.md) - Security practices and risk mitigation

## Roadmap

### Current Phase: Specification & Planning
- [x] Requirements documented
- [x] Revenue model defined
- [x] Architecture outlined
- [x] Corrected subgraph query validated
- [x] KPIs & success metrics enumerated
- [x] Security + compliance considerations included

### Next Phase: Implementation Scaffolding
- [ ] Repository structure setup
- [ ] Backend API scaffolding
- [ ] Smart contract prototypes
- [ ] Subgraph polling module
- [ ] Health factor calculation engine

### Future Phases
- [ ] Flash loan orchestration logic
- [ ] Dashboard UI
- [ ] Integration tests & simulation
- [ ] Private Beta (25 Base ecosystem users)
- [ ] Public Launch
- [ ] Multi-L2 Expansion

## Go-To-Market Phases

1. **Private Beta**: 25 Base ecosystem users
2. **Public Launch**: Co-marketing with Base partners
3. **Partner Integrations**: Aggregators, wallets, protocol frontends
4. **Multi-L2 Expansion**: Arbitrum, Optimism, Blast (analysis driven)

## Contributing

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## Contact

- GitHub: [@anassgono3-ctrl](https://github.com/anassgono3-ctrl)
- Repository: [LiquidBot](https://github.com/anassgono3-ctrl/LiquidBot)

## Acknowledgments

- Aave Protocol for V3 architecture
- The Graph for subgraph infrastructure
- Base Network for L2 infrastructure
- QuickNode for monitoring examples
