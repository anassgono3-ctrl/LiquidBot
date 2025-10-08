# LiquidBot Backend

Backend services for the Aave V3 Base liquidation protection service.

## Overview

The LiquidBot backend provides:
- Real-time liquidation event monitoring via Aave V3 Base subgraph
- **On-demand health factor resolution** (per liquidation, no bulk snapshots)
- **Liquidation opportunity detection with profit estimation**
- **Telegram notifications for profitable opportunities**
- Flash loan orchestration for position protection
- Subscription management and protection logging
- WebSocket alerts for liquidation opportunities
- RESTful API with authentication
- Prometheus metrics for monitoring

**Note**: Bulk health monitoring has been disabled. Health factors are now computed on-demand only when new liquidation events are detected, reducing API quota consumption by >95%.

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

**Key Changes**:
- **Bulk monitoring DISABLED**: `HealthMonitor` is now a no-op stub
- **No scheduled snapshots**: Health factor updates removed from polling loop
- **Single-user queries only**: Each unique user in new liquidations triggers one individual query
- **No batching**: Sequential per-user resolution (simpler, more predictable)
- **No caching**: Direct query each time (can be added later if needed)

**How It Works**:
1. Poller detects new liquidation events (delta from tracker)
2. For each unique user address in new events:
   - `OnDemandHealthFactor.getHealthFactor(userId)` is called
   - Single GraphQL query: `query SingleUser($id: ID!) { user(id: $id) { ... } }`
   - Health factor calculated and attached to liquidation event
3. Opportunities are built from liquidations with attached health factors

**Benefits**:
- **Reduced API quota**: No more 500-user bulk queries
- **No Zod spam**: Single-user schemas are simple and parse cleanly
- **Event-driven**: Health factors resolved only when liquidations occur
- **Predictable**: One query per unique user, no complex batching logic

**Configuration**:
```env
HEALTH_QUERY_MODE=on_demand       # Query mode (always on_demand now)
```

**Efficiency**:
- With **no new liquidations**: Zero health factor queries
- With **N unique users** in new liquidations: Exactly **N queries** (one per user)

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

## Documentation

- **[Health Monitoring & Alerts](docs/ALERTS.md)** - Opportunity detection, profit simulation, Telegram notifications
- [Liquidation Tracking](docs/LIQUIDATION_TRACKING.md) - Incremental liquidation detection
- [OpenAPI Spec](docs/openapi.yaml)
- [GraphQL Examples](examples/)
- [Monitoring Setup](monitoring/)
- [Deployment](deploy/)

## License

MIT
