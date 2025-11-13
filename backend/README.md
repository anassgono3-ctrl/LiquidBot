# LiquidBot Backend

Backend services for the Aave V3 Base liquidation protection service.

## Overview

The LiquidBot backend provides:
- **On-chain liquidation discovery** (default) via real-time event monitoring and startup backfill
- **Optional subgraph integration** for candidate seeding when enabled
- **On-demand health factor resolution** (per liquidation, no bulk snapshots)
- **Liquidation opportunity detection with profit estimation**
- **Hotlist tracking** for near-threshold users (configurable HF bands)
- **Precompute service** for pre-cached liquidation calldata on top-K candidates
- **Liquidation audit** with classifier-based reason codes for missed liquidations
- **Liquidation Sentry** for comprehensive miss diagnostics with profit and timing analysis
- **Aave oracle integration** for accurate USD pricing
- **Decision trace store** for post-hoc analysis
- **Telegram notifications for profitable opportunities**
- Flash loan orchestration for position protection
- Subscription management and protection logging
- WebSocket alerts for liquidation opportunities
- RESTful API with authentication
- Prometheus metrics for monitoring

**Note**: Bulk health monitoring has been disabled. Health factors are now computed on-demand only when new liquidation events are detected, reducing API quota consumption by >95%.

**Operator Guide**: See [OPERATIONS.md](./OPERATIONS.md) for startup verification and feature activation guidance.

## Candidate Discovery Modes

LiquidBot supports two discovery modes controlled by the `USE_SUBGRAPH` environment variable:

### Default Mode (USE_SUBGRAPH=false)
- **On-chain discovery only** - No subgraph dependency
- **Startup backfill**: Scans recent Aave Pool events to seed initial candidates
- **Real-time events**: Monitors Borrow, Repay, Supply, Withdraw events for new users
- **Head-check paging**: Rotates through candidates efficiently to reduce RPC load
- Best for production with limited RPC quotas

### Optional Subgraph Mode (USE_SUBGRAPH=true)
- **Subgraph seeding**: Periodically fetches users from Aave subgraph
- **Paged queries**: Supports multiple pages up to `CANDIDATE_MAX`
- **Real-time events**: Still monitors on-chain events for immediate updates
- Requires `GRAPH_API_KEY` and `SUBGRAPH_DEPLOYMENT_ID`
- Note: Subgraph is for discovery only; prices come from on-chain sources

## Configuration

Key environment variables:

### Chainlink Price Feeds (Optional)

LiquidBot supports Chainlink price feeds for accurate token prices. When not configured, the system uses stub prices.

```bash
# Optional Chainlink RPC URL for price feeds
CHAINLINK_RPC_URL=https://mainnet.base.org

# Comma-separated list of token:feedAddress pairs
# Example: ETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,USDC:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B
CHAINLINK_FEEDS=ETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,USDC:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B
```

**Features:**
- **Dynamic decimals**: PriceService automatically fetches decimals per feed on initialization
- **Safe BigInt normalization**: Avoids "Cannot mix BigInt and other types" errors
- **Stale data detection**: Warns when `answeredInRound < roundId`
- **Age warnings**: Alerts when price data is older than 1 hour
- **Stub fallback with metrics**: Automatically falls back to default prices with logging and Prometheus metrics

**Metrics:**
- `liquidbot_price_oracle_chainlink_requests_total{status, symbol}`: Total Chainlink requests
- `liquidbot_price_oracle_chainlink_stale_total{symbol}`: Stale data detections
- `liquidbot_price_oracle_stub_fallback_total{symbol, reason}`: Stub fallback occurrences

**Verification:**
```bash
# Test Chainlink feeds (requires CHAINLINK_RPC_URL and CHAINLINK_FEEDS in .env)
npm run verify:chainlink
```

**Prior Behavior:**
- Previous versions assumed all Chainlink feeds used 8 decimals (hard-coded `1e8`)
- This could cause minor price mis-scaling for feeds with different decimals
- The risk was low for Base mainnet as most feeds use 8 decimals

**Current Behavior:**
- Decimals are fetched per-feed on PriceService initialization
- Each feed's decimals are cached in memory (`feedSymbol -> decimals`)
- Price normalization uses correct scaling: `Number(answer) / (10 ** decimals)`
- Startup logs show: `[price] Feed WETH decimals=8 address=0x...`

### Subgraph Feature Gating
```bash
# Master switch for subgraph (default: false)
USE_SUBGRAPH=false

# When USE_SUBGRAPH=true, these are required:
GRAPH_API_KEY=your_gateway_key
SUBGRAPH_DEPLOYMENT_ID=GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF
```

### On-Chain Backfill (default path)
```bash
# Enable startup backfill (default: true)
REALTIME_INITIAL_BACKFILL_ENABLED=true
# Blocks to scan backward (default: 50000)
REALTIME_INITIAL_BACKFILL_BLOCKS=50000
# Chunk size for log queries (default: 2000)
REALTIME_INITIAL_BACKFILL_CHUNK_BLOCKS=2000
# Max logs to scan (default: 20000)
REALTIME_INITIAL_BACKFILL_MAX_LOGS=20000
# Optional dedicated RPC URL for backfill
# Recommended: use HTTP for backfill, WS for real-time
# If not set, reuses the WS_RPC_URL provider
BACKFILL_RPC_URL=https://mainnet.base.org
```

**Provider Selection Logic:**
- If `BACKFILL_RPC_URL` is set:
  - `http://` or `https://` → creates JsonRpcProvider for backfill
  - `ws://` or `wss://` → creates WebSocketProvider for backfill
- If `BACKFILL_RPC_URL` is NOT set:
  - Reuses the already-connected provider from `WS_RPC_URL`
  - Avoids creating a second provider connection
- **Recommended setup:**
  - `WS_RPC_URL=wss://...` for real-time event listeners
  - `BACKFILL_RPC_URL=https://...` for backfill (reduces connection overhead, avoids wss issues)

### Head-Check Paging/Rotation
```bash
# Strategy: 'all' or 'paged' (default: paged)
HEAD_CHECK_PAGE_STRATEGY=paged
# Candidates per head cycle (default: 250)
HEAD_CHECK_PAGE_SIZE=250
# Always include candidates below this HF threshold (default: 1.10)
ALWAYS_INCLUDE_HF_BELOW=1.10
```

### Optional Dual RPC Fallback
```bash
# Optional secondary HTTP RPC endpoint for head-check fallback
# Useful for reducing chunk failures under rate limits
SECONDARY_HEAD_RPC_URL=https://backup-rpc.example.com

# Optional hedge window in milliseconds for dirty-first chunks
# When set, fire requests on both primary and secondary, take first result
# Keep narrow (250-300ms) to avoid doubling traffic. Default: disabled
HEAD_CHECK_HEDGE_MS=300
```

### Notification and Execution Settings
```bash
# Only send Telegram notifications when all required data is present (default: true)
# This prevents UNKNOWN/N/A alerts by gating notifications at the service level
NOTIFY_ONLY_WHEN_ACTIONABLE=true

# Minimum profit threshold for notifications (USD)
# Recommended: 5-10 to reduce spam, increase to 15-20 for production
PROFIT_MIN_USD=5

# Execution health factor threshold in basis points (default: 9800 = 0.98)
# Users with HF below this threshold are considered liquidatable
EXECUTION_HF_THRESHOLD_BPS=9800
```

### Subgraph Paging (when USE_SUBGRAPH=true)
```bash
# Page size for subgraph queries (50-200, default: 100)
SUBGRAPH_PAGE_SIZE=100
```

## Reliability and Safety Features

### Strict Reserve Validation
The backend validates all liquidation pairs against on-chain Aave V3 reserves before execution:
- Enumerates reserves from Protocol Data Provider at startup
- Caches metadata (symbol, decimals, liquidation threshold, borrowing enabled)
- Rejects non-reserve assets (e.g., weETH) **before** estimateGas
- Logs structured skip reasons for debugging

### Health Factor-Based Close Factor
Close factor is automatically determined based on user health factor:
- **HF < 0.95**: 100% of debt can be liquidated
- **HF >= 0.95**: 50% of debt can be liquidated (default Aave close factor)

This follows Aave V3 liquidation rules and maximizes liquidation efficiency for critical positions.

### Actionable-Only Notifications
When `NOTIFY_ONLY_WHEN_ACTIONABLE=true` (default), Telegram alerts are only sent if:
- Both debt and collateral reserves are valid Aave reserves
- Symbols and decimals are resolved (no UNKNOWN/N/A)
- Prices are available from on-chain oracle
- `debtToCover` is computed and > 0
- Liquidation plan can be fully resolved

Skip reasons are logged with structured context for debugging:
- `missing_reserve`: Reserve ID not found
- `missing_symbol`: Symbol is UNKNOWN or N/A
- `missing_decimals`: Decimals not resolved
- `price_unavailable`: Oracle price missing or zero
- `zero_debt_to_cover`: Computed debtToCover is zero
- `invalid_pair`: Asset not a valid Aave reserve

### Per-Run Consistent Reads (blockTag)
All on-chain reads during a head-check run use the same `blockTag` for consistency:
- Health factor checks via multicall
- Oracle price reads
- Reserve data queries
- Prevents race conditions from block progression mid-run

### Aave Pool Error Decoding
Execution failures decode Aave Pool custom errors for operator clarity:
- `0x8622f8e4` → `COLLATERAL_CANNOT_BE_LIQUIDATED`
- `0x3f9a3604` → `HEALTH_FACTOR_NOT_BELOW_THRESHOLD`
- `0x0a4c7556` → `NO_ACTIVE_RESERVE`
- Logs include user, assets, health factor, and debtToCover context

### Trade-offs

**On-Chain Backfill**:
- ✅ No external dependencies
- ✅ Works with any RPC provider
- ✅ Smart provider selection: HTTP for backfill, WS for real-time
- ✅ Provider reuse: Can share existing WS connection if BACKFILL_RPC_URL not set
- ⚠️ Startup time depends on block range
- ⚠️ May miss users inactive during backfill window

**Subgraph Seeding**:
- ✅ Comprehensive user discovery
- ✅ Fast startup
- ⚠️ Requires Graph API key
- ⚠️ Additional rate limits to manage

**Head-Check Paging**:
- ✅ Reduces RPC load by ~75% (250/1000+ candidates per block)
- ✅ Always includes low-HF candidates (<1.1)
- ⚠️ Full candidate rotation takes multiple blocks

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis 7+

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev
```

### Development

```bash
# Start in development mode
npm run dev
```

## API Endpoints

All endpoints require authentication via:
- **API Key**: `x-api-key: <your-api-key>` header
- **JWT Token**: `Authorization: Bearer <token>` header

### `GET /api/v1/health`
Health check endpoint.

### `GET /api/v1/positions`
Get list of monitored positions with health factors.

### `POST /api/v1/protect`
Queue a protection request for a user.

### WebSocket: `ws://localhost:3000/ws`
Real-time alerts for:
- **Liquidation opportunities** (`opportunity.new`)
- **Health factor breaches** (`health.breach`)
- **Risk alerts** (HF < 1.1)

See [docs/ALERTS.md](./docs/ALERTS.md) for detailed event formats.

## Health Factor Formula

$$
HF = \frac{\sum (collateral\_value \times liquidationThreshold)}{\sum (debt\_value)}
$$

**Risk Thresholds:**
- `HF > 1.5`: Healthy
- `1.1 < HF < 1.5`: Moderate risk
- `1.05 < HF < 1.1`: High risk (alert)
- `HF < 1.05`: Critical (emergency)
- `HF < 1.0`: Liquidation eligible

## Validation Scripts

### Aave Accounting Validation

The `validate-aave-scaling.ts` script validates Aave V3 accounting pipeline by comparing on-chain data with recomputed values.

**Usage:**
```bash
# Validate a single user
tsx scripts/validate-aave-scaling.ts \
  --rpc https://mainnet.base.org \
  --user 0x1234567890123456789012345678901234567890

# Validate multiple users (comma-separated)
tsx scripts/validate-aave-scaling.ts \
  --rpc https://mainnet.base.org \
  --users 0x1234...,0x5678...,0x9abc...

# Validate multiple users (repeated --user flag)
tsx scripts/validate-aave-scaling.ts \
  --rpc https://mainnet.base.org \
  --user 0x1234... \
  --user 0x5678... \
  --user 0x9abc...

# Show raw bigint values for debugging
tsx scripts/validate-aave-scaling.ts \
  --rpc https://mainnet.base.org \
  --user 0x1234... \
  --raw
```

**Options:**
- `--rpc <URL>`: RPC endpoint URL (required)
- `--user <ADDRESS>`: User address to validate (can be repeated)
- `--users <ADDRESSES>`: Comma-separated list of user addresses
- `--raw`: Show raw bigint values for debugging

**Environment Variables:**
- `VALIDATOR_DUST_WEI`: Dust threshold in wei (default: 1e12). Positions below this threshold are tagged as "(dust)" and don't cause validation failures.

**Features:**
- **Per-asset breakdown**: Shows debt and collateral for each reserve with any non-zero position
- **Adaptive USD precision**: Displays USD values with 6 decimals for amounts < $0.01, otherwise 2 decimals
- **Dust detection**: Tags micro positions as "(dust)" to distinguish from real inconsistencies
- **Zero/zero handling**: Treats both canonical and recomputed totals being zero as PASS (avoids false failures)
- **Infinite health factor**: Displays health factor as "INF" when debt == 0 instead of scientific notation
- **Smart exit codes**: Returns non-zero only for real inconsistencies (not dust-level differences)
- **Smallest values summary**: Reports the smallest non-zero collateral and debt detected
- **Reason for HF<1**: When actionable, displays explicit collateralUSD and debtUSD values

**Output Example:**
```
Total Collateral Base (ETH): 0.001234 ETH
Total Debt Base (ETH):       0.000567 ETH
Health Factor:               INF

Per-Asset Breakdown:

USDC (dust):
  Debt:       0.000001 ($0.000001)
  Collateral: 0.000000 ($0.000000)
  ✓ No issues detected

ETH:
  Debt:       0.00 ($0.00)
  Collateral: 1.234567 ($3,456.78)
  ✓ No issues detected

Smallest Non-Zero Values:
  Debt:       $0.000001
  Collateral: $3,456.78

✓ All validation checks passed!
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Lint
npm run lint

# Type check
npm run typecheck

# Build
npm run build
```

### Test Environment Defaults

During `npm test`:
- `API_KEY` & `JWT_SECRET` auto-populate with test-safe placeholders if absent.
- `USE_MOCK_SUBGRAPH` defaults to `true` (no external calls).
- To exercise live subgraph behavior in a specific test, set:
  ```bash
  USE_MOCK_SUBGRAPH=false GRAPH_API_KEY=your_key SUBGRAPH_DEPLOYMENT_ID=your_deployment npm test
  ```
- Production (non-test) mode still fails fast if secrets are missing.

### Coverage Thresholds

The project enforces minimum coverage thresholds in CI:
- **Lines/Statements**: 80%
- **Functions**: 65%
- **Branches**: 70%

Coverage reports are generated in `./coverage` directory.

## Services

- **SubgraphService**: Fetch Aave V3 data from The Graph with retry logic and rate limiting
- **HealthCalculator**: Calculate health factors
- **OnDemandHealthFactor**: Per-user health factor resolution (no caching, no batching)
- **HealthMonitor**: DISABLED - Bulk health monitoring removed in favor of on-demand resolution
- **OpportunityService**: Detect and evaluate liquidation opportunities with profit estimation
- **PriceService**: USD price lookups (stub, ready for oracle integration)
- **NotificationService**: Telegram bot notifications for opportunities and breaches
- **FlashLoanService**: Plan and execute refinancing (stub)
- **SubscriptionService**: Manage user subscriptions

### On-Demand Health Factor Resolution

**Design Philosophy**: Health factors are computed **only** when a new liquidation event is detected, strictly on a per-user basis. This eliminates bulk snapshot queries (previously 500 users every poll) and massive Zod parsing overhead.

**Key Features**:
- **Bulk monitoring DISABLED**: `HealthMonitor` is now a no-op stub
- **Bootstrap suppression**: First poll batch ignored (configurable via `IGNORE_BOOTSTRAP_BATCH`)
- **Reduced poll limit**: Default poll limit reduced from 50 to 5 (configurable via `POLL_LIMIT`)
- **Single-user queries**: Each unique user in new liquidations triggers one individual query
- **No batching**: Sequential per-user resolution (simpler, more predictable)
- **Health factor verification**: Optional cross-verification with `HealthFactorVerifier`
- **Enhanced profit calculation**: Centralized `ProfitCalculator` with detailed breakdowns (gross, fees, gas, net)
- **Chainlink price feeds**: Optional real-time on-chain prices with fallback to stub prices

**How It Works**:
1. Poller detects new liquidation events (delta from tracker)
2. First poll batch suppressed if `IGNORE_BOOTSTRAP_BATCH=true` (default)
3. For each unique user address in new events:
   - `OnDemandHealthFactor.getHealthFactor(userId)` is called
   - Single GraphQL query: `query SingleUser($id: ID!) { user(id: $id) { ... } }`
   - Health factor calculated and attached to liquidation event
4. Opportunities are built from liquidations with attached health factors
5. Profit calculated with `ProfitCalculator` (gross, bonus, fees, gas, net)

**Benefits**:
- **Reduced API quota**: No more 500-user bulk queries
- **No Zod spam**: Single-user schemas are simple and parse cleanly
- **Event-driven**: Health factors resolved only when liquidations occur
- **Predictable**: One query per unique user, no complex batching logic
- **No bootstrap noise**: First poll batch ignored to prevent false alerts

**Configuration**:
```env
HEALTH_QUERY_MODE=on_demand       # Query mode (always on_demand now)
POLL_LIMIT=5                      # Max new liquidations to process per poll
IGNORE_BOOTSTRAP_BATCH=true       # Ignore first poll batch for notifications
GAS_COST_USD=0                    # Gas cost estimate in USD for profit calculation
CHAINLINK_RPC_URL=                # Optional Chainlink RPC URL for price feeds
CHAINLINK_FEEDS=                  # Optional Chainlink feed addresses (comma-separated)
```

**Efficiency**:
- With **no new liquidations**: Zero health factor queries
- With **N unique users** in new liquidations: Exactly **N queries** (one per user)
- **Bootstrap suppression**: Prevents processing stale liquidations on startup

**Documentation**: See [docs/ON_DEMAND_HEALTH_VERIFICATION.md](./docs/ON_DEMAND_HEALTH_VERIFICATION.md) for detailed information on:
- Health factor verification logic
- Price feed layers (Chainlink + stub fallback)
- Profit calculation formula with detailed breakdown
- Historical backfill script usage (`hf-backfill.ts`)

## At-Risk User Scanning (Optional)

**New Feature**: Limited bulk scanning to proactively detect accounts approaching liquidation without relying on subgraph `healthFactor` fields.

**Key Principles**:
- **Optional**: Controlled by `AT_RISK_SCAN_LIMIT` (0 disables entirely)
- **Lightweight**: Single slim multi-user query per poll (if enabled)
- **Local computation**: Health factors computed locally from reserve data
- **Rate-limit safe**: Hard cap at 200 users to prevent runaway scans
- **Classification tiers**: NO_DEBT, DUST, OK, WARN, CRITICAL
- **Selective notifications**: CRITICAL always notified, WARN optional

**Configuration**:
```env
AT_RISK_SCAN_LIMIT=50              # Number of users to scan per poll (0 disables)
AT_RISK_WARN_THRESHOLD=1.05        # HF below this triggers warning tier
AT_RISK_LIQ_THRESHOLD=1.0          # HF below this is critical (liquidatable)
AT_RISK_DUST_EPSILON=1e-9          # Debt ETH threshold to treat as dust
AT_RISK_NOTIFY_WARN=false          # Whether to notify warn tier users
```

**Classification Logic**:
```
if totalDebtETH < dustEpsilon → DUST (hf=null)
else if totalDebtETH == 0 → NO_DEBT (hf=null)
else hf = weightedCollateralETH / totalDebtETH
  if hf < LIQ_THRESHOLD → CRITICAL
  else if hf < WARN_THRESHOLD → WARN
  else → OK
```

**How It Works**:
1. After processing liquidation events, if `AT_RISK_SCAN_LIMIT > 0`:
   - Query up to N users with debt from subgraph (slim query, no healthFactor field)
   - Compute health factors locally using existing `HealthCalculator`
   - Classify users into risk tiers
   - Send notifications for CRITICAL users (and WARN if enabled)
2. Metrics tracked:
   - `at_risk_scan_users_total`: Total users scanned
   - `at_risk_scan_critical_total`: Users below liquidation threshold
   - `at_risk_scan_warn_total`: Users in warning tier

**Benefits**:
- **Proactive detection**: Surface at-risk users before liquidation events
- **No health snapshots**: Uses existing on-demand architecture
- **Minimal overhead**: One additional query per poll cycle (if enabled)
- **Configurable notifications**: Choose whether to alert on warnings

**Safeguards**:
- Per-page clamp to SUBGRAPH_PAGE_SIZE (max 1000) respecting The Graph's limits
- Pagination across multiple pages to honor AT_RISK_SCAN_LIMIT
- Errors logged but don't degrade main liquidation path
- Can be disabled entirely by setting limit to 0

## Environment Validation

The service validates critical environment variables at startup using Zod schemas. It will exit early with descriptive errors if:
- `USE_MOCK_SUBGRAPH=false` but `GRAPH_API_KEY` or `SUBGRAPH_DEPLOYMENT_ID` is missing
- Required auth variables (`API_KEY`, `JWT_SECRET`) are blank or too short

This fail-fast approach prevents misconfigured deployments from running.

## Subgraph Resilience & Fallback

The SubgraphService includes built-in resilience features:

### Retry Policy
- Configurable retry attempts (default: 3)
- Exponential backoff with jitter
- Prevents transient failures from affecting operations

### Rate Limiting
- Token bucket implementation (default: 30 requests per 10 seconds)
- Prevents API quota exhaustion
- Dropped requests increment `liquidbot_rate_limit_subgraph_dropped_total` metric

### Automatic Fallback
If live subgraph requests fail `SUBGRAPH_FAILURE_THRESHOLD` times consecutively (default: 5), the service:
1. Logs a warning
2. Switches to degraded mock mode
3. Reports `mode: degraded` in `/health` endpoint
4. Stops making live calls until process restart

**Configuration:**
```env
SUBGRAPH_FAILURE_THRESHOLD=5
SUBGRAPH_RETRY_ATTEMPTS=3
SUBGRAPH_RETRY_BASE_MS=150
SUBGRAPH_RATE_LIMIT_CAPACITY=30
SUBGRAPH_RATE_LIMIT_INTERVAL_MS=10000
```

## Subgraph Polling

The backend now performs live polling of the Aave V3 Base subgraph for liquidation calls when `USE_MOCK_SUBGRAPH=false`.

| Variable | Default | Description |
|----------|---------|-------------|
| SUBGRAPH_POLL_INTERVAL_MS | 15000 | Interval between liquidation poll cycles (ms) |

In live mode you should see logs:
```
[subgraph] starting poller (interval=15000ms)
[subgraph] poll start
[subgraph] retrieved 0 liquidation calls
```

To disable network calls during development/testing:
```
USE_MOCK_SUBGRAPH=true
```

### Subgraph Polling Diagnostics

Set `SUBGRAPH_DEBUG_ERRORS=true` to emit raw error objects (use only in development).

Degradation mode triggers only on operational/network failures, not on schema parse (Zod) errors. Parse mismatches are surfaced in logs without counting toward failure thresholds.

Example live poll cycle:
```
[subgraph] poll start
[subgraph] retrieved 3 liquidation calls (sample ids: 0xabc123..., 0xdef456..., 0x7890ab...)
```

Example degraded cycle:
```
[subgraph] poll start (degraded mode) – returning empty snapshot
```

## Observability & Metrics

The service exposes Prometheus metrics at `GET /metrics`.

### Key Metrics

All metrics are prefixed with `liquidbot_`:

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `liquidbot_subgraph_requests_total` | Counter | `status` (success\|error\|fallback) | Count of subgraph request attempts |
| `liquidbot_subgraph_request_duration_seconds` | Histogram | `operation` | Latency distribution per operation |
| `liquidbot_subgraph_consecutive_failures` | Gauge | none | Current consecutive failure streak |
| `liquidbot_subgraph_last_success_timestamp` | Gauge | none | Unix timestamp of last successful request |
| `liquidbot_subgraph_fallback_activated_total` | Counter | none | Times fallback to mock activated |
| `liquidbot_rate_limit_subgraph_dropped_total` | Counter | none | Requests denied by rate limiter |
| `liquidbot_ws_clients` | Gauge | none | Active WebSocket clients |
| `liquidbot_liquidation_new_events_total` | Counter | none | New liquidation events detected |
| `liquidbot_liquidation_snapshot_size` | Gauge | none | Most recent liquidation snapshot size |
| `liquidbot_liquidation_seen_total` | Gauge | none | Unique liquidation IDs tracked |
| **`liquidbot_opportunities_generated_total`** | Counter | none | **Liquidation opportunities generated** |
| **`liquidbot_opportunity_profit_estimate`** | Histogram | none | **Estimated profit in USD (buckets: 1-1000)** |

### Enhanced Health Endpoint

The `/health` endpoint now includes comprehensive monitoring status:

```json
{
  "status": "ok",
  "app": {
    "uptimeSeconds": 1234,
    "version": "0.1.0"
  },
  "subgraph": {
    "mode": "live",
    "consecutiveFailures": 0,
    "lastSuccessTs": 1738851703,
    "fallbackActivated": false,
    "rateLimiter": {
      "capacity": 30,
      "tokensRemaining": 27,
      "refillIntervalMs": 10000
    }
  },
  "liquidationTracker": {
    "seenTotal": 150,
    "pollLimit": 50
  },
  "opportunity": {
    "lastBatchSize": 3,
    "totalOpportunities": 45,
    "lastProfitSampleUsd": 25.50
  },
  "healthMonitoring": {
    "mode": "disabled",
    "message": "Bulk health monitoring disabled - using on-demand resolution"
  },
  "onDemandHealthFactor": true,
  "notifications": {
    "telegramEnabled": true
  }
}
```

**Mode values:**
- `live`: Operating normally
- `degraded`: Fallback activated due to failure threshold
- `mock`: Configured for mock mode via `USE_MOCK_SUBGRAPH=true`

## Operations Runbook

### Monitoring Degraded Mode

If the subgraph enters degraded mode:
1. Check `/health` for `subgraph.mode: degraded`
2. Review logs for failure warnings
3. Verify The Graph gateway status
4. Check `liquidbot_subgraph_consecutive_failures` metric
5. Restart service to attempt recovery: `npm run start`

### Rate Limit Tuning

If seeing dropped requests:
1. Monitor `liquidbot_rate_limit_subgraph_dropped_total`
2. Increase `SUBGRAPH_RATE_LIMIT_CAPACITY` or reduce `SUBGRAPH_RATE_LIMIT_INTERVAL_MS`
3. Ensure usage stays within The Graph API quota

### Failure Threshold Tuning

Adjust `SUBGRAPH_FAILURE_THRESHOLD` based on:
- Network reliability
- Acceptable degradation latency
- Alert noise tolerance

Lower values = faster failover, higher values = more retry attempts before degradation.

## Liquidation Sentry (New Feature)

Advanced diagnostics layer for analyzing missed liquidations. Provides structured classification with timing, profit estimates, and execution decision tracking.

### Configuration

```bash
# Enable miss classifier (default: false)
MISS_CLASSIFIER_ENABLED=true

# HF transience threshold in blocks (default: 3)
MISS_TRANSIENT_BLOCKS=3

# Minimum profit threshold in USD (default: 10)
MISS_MIN_PROFIT_USD=10

# Gas price threshold for gas_outbid detection in Gwei (default: 50)
MISS_GAS_THRESHOLD_GWEI=50

# Enable profit estimation (default: true)
MISS_ENABLE_PROFIT_CHECK=true
```

### Classification Reasons

- `not_in_watch_set` - User not tracked
- `raced` - Competitor executed first
- `hf_transient` - Brief HF violation, recovered quickly
- `insufficient_profit` - Profit below threshold
- `execution_filtered` - Suppressed by execution guard
- `revert` - Attempt reverted on-chain
- `gas_outbid` - Competitor used higher gas price
- `oracle_jitter` - Price swing reversal (placeholder)
- `unknown` - Fallback category

### Testing

```bash
# Run unit tests (17 tests)
npm test -- liquidationMissClassifier

# Run validation harness (9 scenarios)
npx tsx scripts/test-liquidation-sentry.ts
```

### Metrics

- `liquidbot_liquidation_miss_total{reason}` - Miss counts by reason
- `liquidbot_liquidation_latency_blocks` - Detection-to-event latency
- `liquidbot_liquidation_profit_gap_usd` - Missed profit estimates
- `liquidbot_liquidation_classifier_errors_total` - Classification errors
- `liquidbot_liquidation_hf_transience_total` - Transient HF violations

See [docs/LIQUIDATION_SENTRY.md](docs/LIQUIDATION_SENTRY.md) for detailed documentation.

## Documentation

- **[Liquidation Sentry](docs/LIQUIDATION_SENTRY.md)** - NEW: Miss classification and diagnostics
- **[Health Monitoring & Alerts](docs/ALERTS.md)** - Opportunity detection, profit simulation, Telegram notifications
- [Liquidation Tracking](docs/LIQUIDATION_TRACKING.md) - Incremental liquidation detection
- [OpenAPI Spec](docs/openapi.yaml)
- [GraphQL Examples](examples/)
- [Monitoring Setup](monitoring/)
- [Deployment](deploy/)

## License

MIT
