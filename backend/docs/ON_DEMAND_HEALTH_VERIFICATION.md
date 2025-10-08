# On-Demand Health Factor & Verification

This document describes the on-demand health factor resolution system, verification mechanisms, price feed layers, and profit calculation formula.

## Overview

LiquidBot uses an **on-demand health factor** approach where health factors are computed only when a new liquidation event is detected. This eliminates bulk snapshot queries and reduces subgraph load.

## On-Demand Health Factor Resolution

### How It Works

1. **Polling**: The subgraph poller fetches recent liquidation calls (default: 5 per poll)
2. **Delta Detection**: The liquidation tracker identifies new events not seen before
3. **Bootstrap Suppression**: First poll batch is ignored to prevent false alerts on startup
4. **Per-User Resolution**: For each unique user in new events, a single GraphQL query fetches their position
5. **Health Factor Attachment**: Computed HF is attached to the liquidation event

### Configuration

```bash
# Poll limit - maximum new liquidations to process per poll
POLL_LIMIT=5

# Ignore bootstrap batch (first poll) for notifications
IGNORE_BOOTSTRAP_BATCH=true
```

### Benefits

- **Reduced Load**: No bulk user snapshots (previously 500 users every poll)
- **Lower Latency**: Only query users with actual liquidation events
- **Better Performance**: Minimal Zod parsing overhead
- **Predictable Cost**: Scales with liquidation frequency, not user count

## Health Factor Verification

The `HealthFactorVerifier` service provides cross-verification of health factors by recomputing them with filtered reserves.

### Purpose

- Validate health factor calculations
- Detect inconsistencies in subgraph data
- Provide confidence metrics for liquidation opportunities

### Usage

```typescript
import { HealthFactorVerifier } from './services/HealthFactorVerifier.js';

const verifier = new HealthFactorVerifier({
  client: graphQLClient,
  tolerance: 0.01,  // Acceptable difference (1%)
  debugErrors: true
});

const result = await verifier.verifyHealthFactor(userId, originalHF);

if (result && !result.isConsistent) {
  console.log(`HF mismatch: original=${result.original}, verified=${result.verified}, diff=${result.diff}`);
}
```

### Configuration

```bash
# Enable detailed error logging for verification
SUBGRAPH_DEBUG_ERRORS=true
```

## Price Feed Layers

LiquidBot supports multiple price feed sources with automatic fallback.

### Layer 1: Chainlink Feeds (Optional)

When configured, Chainlink price feeds provide real-time on-chain prices.

```bash
# Chainlink RPC endpoint
CHAINLINK_RPC_URL=https://mainnet.base.org

# Feed addresses (comma-separated symbol:address pairs)
CHAINLINK_FEEDS=ETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,USDC:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B
```

**How It Works**:
1. PriceService checks if Chainlink feeds are configured
2. Queries `latestRoundData()` from the aggregator contract
3. Normalizes price (typically 8 decimals)
4. Falls back to stub prices if query fails or price invalid

### Layer 2: Stub Prices (Fallback)

Hardcoded prices for common tokens used when Chainlink unavailable:

```typescript
{
  'USDC': 1.0,
  'USDT': 1.0,
  'WETH': 3000.0,
  'WBTC': 60000.0,
  // ... more tokens
}
```

### Caching

Both layers use a 60-second cache to reduce API calls and improve performance.

## Profit Calculation Formula

The `ProfitCalculator` service provides a detailed breakdown of liquidation profit.

### Formula

```
grossProfit = (collateralValue - principalValue) + (collateralValue × bonusPct)
netProfit = grossProfit - fees - gasCost
```

Where:
- **collateralValue**: USD value of liquidated collateral
- **principalValue**: USD value of debt being repaid
- **bonusPct**: Liquidation bonus (typically 5%)
- **fees**: Protocol fees (basis points)
- **gasCost**: Estimated gas cost in USD

### Configuration

```bash
# Protocol fee in basis points (30 = 0.30%)
PROFIT_FEE_BPS=30

# Minimum profitable threshold in USD
PROFIT_MIN_USD=10

# Gas cost estimate in USD
GAS_COST_USD=0
```

### Usage

```typescript
import { ProfitCalculator } from './services/ProfitCalculator.js';

const calculator = new ProfitCalculator({
  bonusPct: 0.05,      // 5% liquidation bonus
  feeBps: 30,          // 0.30% fee
  gasCostUsd: 0        // No gas cost
});

const breakdown = calculator.calculateProfit(
  1000,  // collateral value USD
  900    // principal value USD
);

console.log(`Gross: $${breakdown.gross}`);
console.log(`Fees: $${breakdown.fees}`);
console.log(`Gas: $${breakdown.gasCost}`);
console.log(`Net: $${breakdown.net}`);
```

### Profit Breakdown

The `OpportunityService` now uses `ProfitCalculator` and includes:

- **gross**: Total profit before deductions
- **bonusValue**: Liquidation bonus amount
- **fees**: Protocol/execution fees
- **gasCost**: Gas cost estimate
- **net**: Final profit (stored in `profitEstimateUsd`)

## Historical Health Factor Backfill

The `hf-backfill` script recomputes health factors for historical users.

### Usage

```bash
# Backfill 5 most recent liquidations
node -r dotenv/config dist/scripts/hf-backfill.js --recent=5

# Backfill 100 recent liquidations
node -r dotenv/config dist/scripts/hf-backfill.js --recent=100
```

### Output

Creates `hf-backfill-output.json`:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "recentCount": 5,
  "totalUsers": 3,
  "results": [
    {
      "userId": "0xabc...",
      "healthFactor": 1.234,
      "timestamp": "2024-01-15T10:30:01.000Z"
    },
    {
      "userId": "0xdef...",
      "healthFactor": null,
      "timestamp": "2024-01-15T10:30:02.000Z",
      "error": "User not found"
    }
  ]
}
```

## Bootstrap Suppression

When `IGNORE_BOOTSTRAP_BATCH=true` (default), the first poll batch is suppressed:

1. **First Poll**: Tracker sees all events as "new" (no prior state)
2. **Suppression**: `onNewLiquidations` callback is skipped
3. **Log Message**: `[subgraph] bootstrap batch ignored (N events suppressed)`
4. **Subsequent Polls**: Normal processing resumes

### Why?

- Prevents false notifications on service startup
- Avoids processing stale liquidations as new opportunities
- Reduces noise in monitoring systems

### Disabling

```bash
# Process all events including bootstrap batch
IGNORE_BOOTSTRAP_BATCH=false
```

## Monitoring

### Metrics

- `liquidation_new_events_total`: Counter of new liquidation events
- `liquidation_snapshot_size`: Current poll snapshot size
- `liquidation_seen_total`: Total unique liquidations tracked

### Health Endpoint

```bash
curl http://localhost:3000/health
```

Response includes:
```json
{
  "liquidationTracker": {
    "seenTotal": 150,
    "pollLimit": 5
  },
  "onDemandHealthFactor": true
}
```

## Best Practices

1. **Poll Limit**: Keep low (5-10) to minimize subgraph load
2. **Bootstrap Suppression**: Keep enabled in production
3. **Chainlink Feeds**: Configure for accurate prices if available
4. **Gas Cost**: Update periodically based on network conditions
5. **Verification**: Enable for critical opportunities before execution
6. **Backfill**: Run periodically to audit historical data

## Migration from Bulk Mode

Previously, the system used bulk user snapshots (500 users every poll). The on-demand approach eliminates:

- ❌ Bulk snapshot queries
- ❌ Massive Zod parsing overhead
- ❌ Unnecessary health factor computations
- ❌ High subgraph API usage

Now:
- ✅ Single-user queries only
- ✅ Minimal parsing overhead
- ✅ Computation only for liquidations
- ✅ Reduced API usage
