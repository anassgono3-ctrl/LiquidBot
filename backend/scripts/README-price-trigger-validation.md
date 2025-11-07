# Price Trigger Validation Scripts

## Overview

This directory contains validation and testing scripts for the Chainlink price ingestion and price-trigger emergency scan logic. These scripts allow you to verify price feed connectivity, test trigger logic in isolation, and simulate integrated behavior without relying on live market volatility.

## Scripts

### 1. verify-chainlink-prices.ts

Validates Chainlink price feed configuration and connectivity by querying `latestRoundData()` from each configured feed.

**Purpose:**
- Verify RPC connectivity to Chainlink aggregators
- Validate feed addresses are correct
- Check that prices are being reported and are non-negative
- Display normalized price values for manual inspection

**Usage:**
```bash
# After building
node -r dotenv/config dist/scripts/verify-chainlink-prices.js

# Or via npm script
npm run verify:chainlink
```

**Required Environment Variables:**
- `CHAINLINK_RPC_URL` or `RPC_URL`: RPC endpoint (e.g., `https://mainnet.base.org`)
- `CHAINLINK_FEEDS`: Comma-separated list of `SYMBOL:ADDRESS` pairs
  - Example: `ETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,USDC:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B`

**Output:**
```
verify-chainlink-prices: Starting verification...
RPC: https://mainnet.base.org
Feeds: ETH, USDC

✅ ETH: raw=186523000000 decimals=8 normalized=1865.23
✅ USDC: raw=100000000 decimals=8 normalized=1.0

Verification complete.
All feeds verified successfully.
```

**Exit Codes:**
- `0`: All feeds verified successfully
- `1`: One or more feeds failed verification or missing required environment variables

---

### 2. test-price-trigger-unit.ts

Synthetic unit test for price trigger logic including drop threshold and debounce behavior.

**Purpose:**
- Test price drop calculation (basis points)
- Verify trigger fires when drop exceeds threshold
- Verify debounce prevents rapid repeated triggers
- Validate trigger fires again after debounce window expires

**Usage:**
```bash
# After building
node dist/scripts/test-price-trigger-unit.js

# Or via npm script
npm run test:price-trigger-unit
```

**No environment variables required.** This is a standalone synthetic test.

**Output:**
```
[unit] baseline set price=100000000
[unit] update prev=100000000 current=99950000 dropBps=5
[unit] update prev=99950000 current=99880000 dropBps=7
[unit] update prev=99880000 current=99770000 dropBps=11
[unit] TRIGGER firing (dropBps=11 >= 10)
[unit] scan executed
[unit] update prev=99770000 current=99660000 dropBps=11
[unit] trigger suppressed by debounce (0.0s < 5s)
[unit] update prev=99660000 current=99550000 dropBps=11
[unit] TRIGGER firing (dropBps=11 >= 10)
[unit] scan executed
```

**Exit Codes:**
- `0`: Test completed successfully

---

### 3. simulate-price-trigger-integrated.ts

Integration simulation that exercises the complete price trigger path including configuration loading, price updates, emergency scan invocation, and debounce logic.

**Purpose:**
- Validate integration between config, price trigger logic, and emergency scan
- Simulate multiple price updates with realistic drop scenarios
- Verify debounce timing works as expected
- Test emergency scan candidate selection and execution

**Usage:**
```bash
# After building
node -r dotenv/config dist/scripts/simulate-price-trigger-integrated.js

# Or via npm script
npm run simulate:price-trigger
```

**Required Environment Variables:**
- `API_KEY`: API key for config validation (can be test value)
- `JWT_SECRET`: JWT secret for config validation (can be test value)

**Optional Environment Variables (simulation will use defaults if not set):**
- `PRICE_TRIGGER_ENABLED`: Enable/disable (default: `true` for simulation)
- `PRICE_TRIGGER_DROP_BPS`: Drop threshold in basis points (default: `10`)
- `PRICE_TRIGGER_MAX_SCAN`: Max candidates to scan (default: `5`)
- `PRICE_TRIGGER_DEBOUNCE_SEC`: Debounce window in seconds (default: `5`)
- `PRICE_TRIGGER_ASSETS`: Comma-separated asset list (default: `WETH,WBTC`)

**Example:**
```bash
# With custom configuration
API_KEY=test-key JWT_SECRET=test-secret \
PRICE_TRIGGER_ENABLED=true \
PRICE_TRIGGER_DROP_BPS=15 \
PRICE_TRIGGER_MAX_SCAN=10 \
PRICE_TRIGGER_DEBOUNCE_SEC=3 \
PRICE_TRIGGER_ASSETS=WETH \
node -r dotenv/config dist/scripts/simulate-price-trigger-integrated.js
```

**Output:**
```
[price-trigger] enabled=true dropBps=10 maxScan=5 debounceSec=5 assets=WETH

[simulate] Starting price update sequence...

[simulate] Update 1: Setting baseline price for WETH
[price-trigger] Initialized price tracking for WETH (first update)

[simulate] Update 2: 5 bps drop (below threshold, no trigger expected)

[simulate] Update 3: 12 bps drop (exceeds threshold, trigger expected)
[price-trigger] Sharp price drop detected: asset=WETH drop=11.00bps threshold=10bps trigger=price
[price-trigger] Emergency scan complete: asset=WETH scanned=5 liquidatable=3 trigger=price

[simulate] Update 4: Additional drop (debounce suppression expected)
[price-trigger] Debounced: asset=WETH drop=13.00bps elapsed=0s debounce=5s

[simulate] Waiting 6s for debounce window to pass...

[simulate] Update 5: Drop after debounce window (trigger expected)
[price-trigger] Sharp price drop detected: asset=WETH drop=15.00bps threshold=10bps trigger=price
[price-trigger] Emergency scan complete: asset=WETH scanned=5 liquidatable=3 trigger=price

[simulate] Simulation complete.
```

**Exit Codes:**
- `0`: Simulation completed successfully
- `1`: Error during simulation

---

## Metrics (Optional)

The file `src/metrics/priceTriggerMetrics.ts` provides optional Prometheus metrics for price trigger activity:

- `liquidbot_price_trigger_scans_total`: Counter of emergency scans by asset
- `liquidbot_price_trigger_scan_latency_ms`: Histogram of scan latency

These metrics are available for integration but are **not required**. The existing RealTimeHFService already uses similar metrics (`realtimePriceEmergencyScansTotal` and `emergencyScanLatency` from `src/metrics/index.ts`).

To use the new metrics, import them in your service:
```typescript
import { priceTriggerScansTotal, priceTriggerLatencyMs } from '../metrics/priceTriggerMetrics.js';

// Increment scan counter
priceTriggerScansTotal.labels(asset).inc();

// Record latency
const startTime = Date.now();
// ... perform scan ...
priceTriggerLatencyMs.observe(Date.now() - startTime);
```

---

## Building

All scripts are compiled as part of the standard build process:

```bash
npm run build
```

Compiled scripts are output to `dist/scripts/`.

---

## Integration with Real-Time Service

The price trigger logic validated by these scripts is integrated into `RealTimeHFService`:

1. **Price Updates**: Chainlink `AnswerUpdated` events are monitored via WebSocket
2. **Drop Calculation**: Basis points drop is calculated from consecutive price updates
3. **Threshold Check**: Triggers when drop ≥ `PRICE_TRIGGER_DROP_BPS`
4. **Debounce**: Prevents repeated scans within `PRICE_TRIGGER_DEBOUNCE_SEC`
5. **Emergency Scan**: Invokes batch health check on affected candidates
6. **Metrics**: Increments counters and records latency

Configuration is loaded from environment variables (see `.env.example`).

---

## Troubleshooting

**"Missing CHAINLINK_RPC_URL or CHAINLINK_FEEDS"**
- Ensure environment variables are set
- Check `.env` file exists and is loaded with `-r dotenv/config`

**"JsonRpcProvider failed to detect network"**
- Verify RPC URL is correct and accessible
- Check network connectivity
- Ensure RPC endpoint supports the required Chainlink aggregator interface

**Simulation fails with ZodError**
- Ensure `API_KEY` and `JWT_SECRET` are set (even test values work)
- These are required for config validation, not actual authentication

---

## Related Files

- Script sources: [`scripts/verify-chainlink-prices.ts`](./verify-chainlink-prices.ts), [`scripts/test-price-trigger-unit.ts`](./test-price-trigger-unit.ts), [`scripts/simulate-price-trigger-integrated.ts`](./simulate-price-trigger-integrated.ts)
- Metrics: [`src/metrics/priceTriggerMetrics.ts`](../src/metrics/priceTriggerMetrics.ts)
- Real-time service: [`src/services/RealTimeHFService.ts`](../src/services/RealTimeHFService.ts)
- Config: [`src/config/index.ts`](../src/config/index.ts), [`.env.example`](../.env.example)
