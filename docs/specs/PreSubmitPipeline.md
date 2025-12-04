# Pre-Submit Liquidation Pipeline Specification

## Purpose

The Pre-Submit Liquidation Pipeline enables LiquidBot to submit liquidation transactions **ahead** of Chainlink oracle updates by using Pyth Network as an early-warning price feed. This reduces execution latency and increases competitiveness in liquidation scenarios where price movements trigger health factor violations.

### Key Principles

1. **Chainlink remains oracle-of-record**: All on-chain liquidation validation uses Chainlink prices
2. **Pyth is early-warning only**: Used to predict when Chainlink will update and trigger liquidations
3. **Safety-first**: Multiple gates prevent false positives and wasted gas
4. **Feature-flagged**: Can be disabled without impacting existing functionality

## Architecture Overview

```
┌─────────────┐
│ Pyth Network│ (fast updates, ~400ms)
└──────┬──────┘
       │ price updates
       ▼
┌──────────────────┐
│ PythListener     │ (staleness detection)
└────────┬─────────┘
         │ onPriceUpdate
         ▼
┌───────────────────────────┐
│ PredictiveOrchestrator    │ (existing)
└────────┬──────────────────┘
         │ candidate events (with etaSec)
         ▼
┌──────────────────┐        ┌─────────────────┐
│ PreSubmitManager │◄──────►│ TwapSanity      │ (DEX check)
└────────┬─────────┘        └─────────────────┘
         │ signed tx
         ▼
┌──────────────────┐
│ Mempool/RPC      │
└──────────────────┘
         │
         ▼
┌──────────────────────────┐
│ OnChainConfirmWatcher    │ (per-block)
└──────────────────────────┘
         │ correlate with Chainlink rounds
         ▼
   ✓ Success / ✗ Revert
```

## Components

### 1. PythListener

**File**: `backend/src/services/PythListener.ts`

**Responsibility**: Subscribe to Pyth price feeds and emit updates to PredictiveOrchestrator

**Configuration**:
- `PYTH_ENABLED` (default: `false`) - Master switch
- `PYTH_WS_URL` - WebSocket endpoint (e.g., `wss://hermes.pyth.network/ws`)
- `PYTH_HTTP_URL` - HTTP endpoint for price history
- `PYTH_ASSETS` - Comma-separated list of symbols (e.g., `WETH,WBTC,cbETH`)
- `PYTH_STALE_SECS` (default: `10`) - Max age before price considered stale

**Key Methods**:
- `start()` - Connect to Pyth WebSocket
- `stop()` - Disconnect cleanly
- `onPriceUpdate(callback)` - Register callback for price updates

**Staleness Detection**:
- Each price update includes a `publishTime` timestamp
- If `now - publishTime > PYTH_STALE_SECS`, emit warning metric but still forward update
- Track consecutive stale updates; disconnect/reconnect if threshold exceeded

**Metrics**:
- `pyth_price_updates_total` (by symbol)
- `pyth_stale_prices_total` (by symbol)
- `pyth_connection_errors_total`
- `pyth_reconnects_total`

### 2. TwapSanity

**File**: `backend/src/services/TwapSanity.ts`

**Responsibility**: Compute short-window TWAP from DEX pools and validate against reference price

**Configuration**:
- `TWAP_ENABLED` (default: `false`)
- `TWAP_WINDOW_SEC` (default: `300`) - TWAP window in seconds (5 minutes)
- `TWAP_DELTA_PCT` (default: `0.012`) - Max allowed deviation (1.2%)
- `TWAP_POOLS` - JSON array of pool configs: `[{"symbol":"WETH","pool":"0x...","dex":"uniswap_v3"}]`

**Key Methods**:
- `sanityCheck(symbol: string, refPrice: number): Promise<{ok: boolean, twapPrice: number | null, delta?: number}>`

**Logic**:
1. Fetch recent swap events from configured DEX pool
2. Compute time-weighted average price over `TWAP_WINDOW_SEC`
3. Compare `|twapPrice - refPrice| / refPrice`
4. Return `ok: true` if delta ≤ `TWAP_DELTA_PCT`, else `ok: false`

**Metrics**:
- `twap_sanity_checks_total{symbol,result}` (result: pass/fail)
- `twap_delta_pct{symbol}` - Delta histogram

### 3. PreSubmitManager

**File**: `backend/src/services/PreSubmitManager.ts`

**Responsibility**: Decision logic for pre-submitting liquidation transactions

**Configuration**:
- `PRE_SUBMIT_ENABLED` (default: `false`)
- `PRE_SUBMIT_ETA_MAX` (default: `90`) - Max ETA in seconds to consider
- `HF_TRIGGER_BUFFER` (default: `1.02`) - Minimum projected HF threshold
- `GAS_PRICE_MARGIN` (default: `0.10`) - Gas price buffer (10%)
- `TTL_BLOCKS` (default: `40`) - Max blocks to wait for confirmation
- `PRE_SUBMIT_MIN_POSITION_USD` (optional) - Minimum position size (defaults to `MIN_DEBT_USD`)

**Listener Registration**:
- Implements `PredictiveEventListener` interface
- Registered with `PredictiveOrchestrator.registerListener()`

**Decision Flow**:

```typescript
onPredictiveCandidate(event: PredictiveScenarioEvent) {
  const { candidate, shouldFlagFastpath } = event;
  
  // Gate 1: Feature enabled
  if (!PRE_SUBMIT_ENABLED) return;
  
  // Gate 2: Fast-path flag OR acceptable ETA
  if (!shouldFlagFastpath && candidate.etaSec > PRE_SUBMIT_ETA_MAX) return;
  
  // Gate 3: Projected HF below buffer
  if (candidate.hfProjected > HF_TRIGGER_BUFFER) return;
  
  // Gate 4: Minimum position size
  const minDebt = PRE_SUBMIT_MIN_POSITION_USD ?? MIN_DEBT_USD;
  if (candidate.debtUsd < minDebt) return;
  
  // Gate 5: TWAP sanity check
  if (TWAP_ENABLED) {
    const sanity = await twapSanity.sanityCheck(candidate.collateralSymbol, candidate.priceUsed);
    if (!sanity.ok) {
      log('TWAP sanity failed, aborting pre-submit');
      return;
    }
  }
  
  // Build and submit transaction
  await buildAndSubmit(candidate);
}
```

**Transaction Building**:
1. Fetch liquidation executor contract ABI
2. Build `liquidationCall` calldata with:
   - Collateral asset address
   - Debt asset address
   - User address
   - Debt amount (close factor × total debt)
   - Receive aToken flag
3. Estimate gas with `GAS_PRICE_MARGIN` buffer
4. Sign transaction offline with `EXECUTION_PRIVATE_KEY`
5. Submit raw transaction via RPC

**Pending Tracking**:
- Store in `pendingPreSubmits` map: `txHash → { candidate, submittedBlock, ttl, metadata }`
- Indexed by user address for lookup

**Metrics**:
- `pre_submit_attempts_total{result}` (result: submitted/gate_failed/error)
- `pre_submit_gate_failures_total{gate}` (gate: eta/hf/size/twap)
- `pre_submit_gas_estimated` - Histogram

### 4. OnChainConfirmWatcher

**File**: `backend/src/services/OnChainConfirmWatcher.ts`

**Responsibility**: Watch on-chain blocks and correlate pending pre-submits with outcomes

**Configuration**:
- Reuses existing RPC configuration
- Listens to new block events

**Per-Block Logic**:
1. Fetch Chainlink `latestRoundData()` for configured feeds
2. Check if round changed since last block
3. For each `pendingPreSubmits` entry:
   - Query transaction receipt
   - If mined:
     - Query borrower HF from Aave
     - If HF < 1.0 → mark as `success`
     - If HF ≥ 1.0 or tx reverted → mark as `failure`, capture revert reason
   - If not mined and `currentBlock - submittedBlock > TTL_BLOCKS`:
     - Mark as `expired`
4. Remove processed entries from `pendingPreSubmits`

**Metrics**:
- `pre_submit_outcomes_total{outcome}` (outcome: success/reverted/expired)
- `pre_submit_revert_reasons_total{reason}`
- `pre_submit_time_to_mine_sec` - Histogram
- `pre_submit_eta_accuracy_sec` - Delta between predicted and actual

### 5. Integration with PredictiveOrchestrator

**File**: `backend/src/risk/PredictiveOrchestrator.ts`

**Changes Required**:
1. Accept `PythListener` registration (when `PYTH_ENABLED`)
2. Forward Pyth price updates to `PredictiveEngine.updatePrice()` with source tag
3. Register `PreSubmitManager` and `OnChainConfirmWatcher` as listeners
4. Ensure `etaSec` is included in candidate metadata when available

**No breaking changes** - existing behavior preserved when new flags disabled

### 6. PriceService Extension

**File**: `backend/src/services/PriceService.ts`

**Changes Required**:
1. Add method `acceptExternalUpdate(symbol, price, timestamp, source)` 
2. Store source metadata: `'chainlink' | 'pyth' | 'twap'`
3. When predictive orchestrator queries price, optionally return source
4. Pyth prices are **not** used for on-chain valuation - only for projection

## Safety Gates

### 1. Staleness Gate
- **Check**: Pyth price timestamp within `PYTH_STALE_SECS`
- **Action**: Log warning, increment metric, but still process (degraded mode)

### 2. TWAP Sanity Gate
- **Check**: DEX TWAP price within `TWAP_DELTA_PCT` of Pyth price
- **Action**: Abort pre-submit if mismatch, increment `pre_submit_gate_failures_total{gate="twap"}`

### 3. Minimum Position Size Gate
- **Check**: `debtUsd >= PRE_SUBMIT_MIN_POSITION_USD` (or `MIN_DEBT_USD` if unset)
- **Action**: Skip small positions to avoid gas waste

### 4. ETA Gate
- **Check**: `etaSec <= PRE_SUBMIT_ETA_MAX` OR `shouldFlagFastpath`
- **Action**: Only pre-submit if Chainlink update expected soon

### 5. HF Projection Gate
- **Check**: `hfProjected <= HF_TRIGGER_BUFFER`
- **Action**: Only pre-submit if liquidation likely

### 6. TTL Expiry
- **Check**: `currentBlock - submittedBlock <= TTL_BLOCKS`
- **Action**: Clean up pending entries that didn't mine

## Configuration Defaults

```bash
# Pyth Configuration
PYTH_ENABLED=false
PYTH_WS_URL=wss://hermes.pyth.network/ws
PYTH_HTTP_URL=https://hermes.pyth.network
PYTH_ASSETS=WETH,WBTC,cbETH,USDC
PYTH_STALE_SECS=10

# TWAP Sanity Configuration
TWAP_ENABLED=false
TWAP_WINDOW_SEC=300
TWAP_DELTA_PCT=0.012
TWAP_POOLS='[{"symbol":"WETH","pool":"0xd0b53D9277642d899DF5C87A3966A349A798F224","dex":"uniswap_v3"}]'

# Pre-Submit Configuration
PRE_SUBMIT_ENABLED=false
PRE_SUBMIT_ETA_MAX=90
HF_TRIGGER_BUFFER=1.02
GAS_PRICE_MARGIN=0.10
TTL_BLOCKS=40
# PRE_SUBMIT_MIN_POSITION_USD (optional, defaults to MIN_DEBT_USD)

# Telemetry
TELEMETRY_PRE_SUBMIT_ENABLED=true
```

## Observability

### Logs

**PythListener**:
```
[pyth-listener] Connected to wss://hermes.pyth.network/ws
[pyth-listener] Subscribed to 4 assets: WETH, WBTC, cbETH, USDC
[pyth-listener] Price update: WETH=$3,245.67 (age: 1.2s)
[pyth-listener] WARNING: Stale price for WBTC (age: 15.3s)
```

**PreSubmitManager**:
```
[pre-submit] Candidate: user=0xabc...def hfProjected=0.987 etaSec=45 debt=$12,500
[pre-submit] Gate: TWAP sanity PASS (delta: 0.8%)
[pre-submit] Submitted tx: 0x123...abc (gas: 350k, gasPrice: 0.5 gwei)
[pre-submit] Gate: ETA too large (120s > 90s max), skipping
```

**OnChainConfirmWatcher**:
```
[confirm-watcher] Block 12345678: Chainlink round changed (ETH/USD)
[confirm-watcher] TX 0x123...abc CONFIRMED: user HF=0.953 (SUCCESS)
[confirm-watcher] TX 0x456...def REVERTED: "35" (insufficient collateral)
[confirm-watcher] Expired 2 pending pre-submits (TTL exceeded)
```

### Metrics (Prometheus)

```
# Pyth metrics
pyth_price_updates_total{symbol="WETH"} 1234
pyth_stale_prices_total{symbol="WBTC"} 5
pyth_connection_errors_total 2

# TWAP metrics
twap_sanity_checks_total{symbol="WETH",result="pass"} 45
twap_sanity_checks_total{symbol="WETH",result="fail"} 3
twap_delta_pct{symbol="WETH",quantile="0.5"} 0.005

# Pre-submit metrics
pre_submit_attempts_total{result="submitted"} 23
pre_submit_attempts_total{result="gate_failed"} 67
pre_submit_gate_failures_total{gate="eta"} 34
pre_submit_gate_failures_total{gate="twap"} 12
pre_submit_gas_estimated{quantile="0.95"} 425000

# Outcome metrics
pre_submit_outcomes_total{outcome="success"} 18
pre_submit_outcomes_total{outcome="reverted"} 4
pre_submit_outcomes_total{outcome="expired"} 1
pre_submit_revert_reasons_total{reason="35"} 2
pre_submit_time_to_mine_sec{quantile="0.5"} 12.5
pre_submit_eta_accuracy_sec{quantile="0.5"} -3.2
```

## Testing Checklist

### Unit Tests

- [ ] **TwapSanity**: Compute TWAP correctly, detect price deviations
- [ ] **PythListener**: Handle staleness, reconnect on errors
- [ ] **PreSubmitManager**: Decision gates (all gates pass/fail scenarios)
- [ ] **OnChainConfirmWatcher**: Correlate pending txs with outcomes

### Integration Tests

- [ ] **Fork Test**: Full flow simulation
  1. Start with Chainlink price at $3,000
  2. Pyth reports $2,850 (5% drop)
  3. PredictiveOrchestrator projects HF=0.95 for user
  4. PreSubmitManager builds and submits tx
  5. Simulate Chainlink round update to $2,850
  6. OnChainConfirmWatcher confirms tx success
  7. Verify metrics captured

- [ ] **Revert Case**:
  1. Pre-submit tx
  2. Chainlink updates but user HF remains >1.0
  3. Transaction reverts on-chain
  4. OnChainConfirmWatcher marks as failure

- [ ] **TTL Expiry**:
  1. Submit tx
  2. Chainlink never updates (price recovers)
  3. After TTL_BLOCKS, watcher cleans up pending entry

## Security Notes

1. **Private Key Security**: `EXECUTION_PRIVATE_KEY` must be secured (env var, secrets manager)
2. **Gas Limits**: Enforce max gas price to prevent runaway costs
3. **Rate Limiting**: Limit pre-submit attempts per block to avoid spam
4. **Revert Analysis**: Log all revert reasons for audit trail
5. **Source Separation**: Never use Pyth prices for on-chain validation (Chainlink only)

## Acceptance Criteria

✅ **Feature Flag Works**: All new features can be disabled via env without breaking existing flow

✅ **Pyth Integration**: Successfully subscribe to Pyth feeds and detect staleness

✅ **TWAP Sanity**: Correctly fetch DEX prices and validate against reference

✅ **Pre-Submit Flow**: Build, sign, and submit transactions ahead of Chainlink updates

✅ **Confirmation Tracking**: Correlate pending txs with on-chain outcomes

✅ **Telemetry**: All metrics and logs captured as specified

✅ **No Regressions**: Existing Chainlink-backed pricing and execution paths unaffected

✅ **Fork Test Passes**: Simulated Pyth→Chainlink flow succeeds with correct outcome

## Future Enhancements

- **Multi-Oracle Aggregation**: Combine Pyth, Chainlink, and API3 for consensus
- **Dynamic ETA Estimation**: ML model to predict Chainlink update timing
- **Gas Optimization**: Bundle multiple liquidations in single transaction
- **MEV Protection**: Submit via Flashbots or other private mempools
- **Cross-Chain**: Extend to other networks with Pyth support
