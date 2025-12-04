# LiquidBot Configuration Parameters

This document describes all configuration parameters for the LiquidBot backend service.

## Pre-Submit Liquidation Pipeline

The pre-submit liquidation pipeline enables early liquidation submission using Pyth Network as a fast price feed while maintaining Chainlink as the oracle-of-record.

### Pyth Network Integration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `PYTH_ENABLED` | boolean | `false` | Enable Pyth price feed integration for predictive early-warning |
| `PYTH_WS_URL` | string | `wss://hermes.pyth.network/ws` | Pyth Network WebSocket endpoint |
| `PYTH_HTTP_URL` | string | `https://hermes.pyth.network` | Pyth Network HTTP endpoint for price history |
| `PYTH_ASSETS` | string | `WETH,WBTC,cbETH,USDC` | Comma-separated list of asset symbols to track |
| `PYTH_STALE_SECS` | number | `10` | Maximum age in seconds before price is considered stale |

**Example:**
```bash
PYTH_ENABLED=true
PYTH_WS_URL=wss://hermes.pyth.network/ws
PYTH_HTTP_URL=https://hermes.pyth.network
PYTH_ASSETS=WETH,WBTC,cbETH,USDC,cbBTC,AAVE
PYTH_STALE_SECS=10
```

**Validation:**
Use `npm run check:oracles` to validate Pyth connectivity and staleness:
```bash
npm run check:oracles -- --assets WETH,cbETH --verbose
```

**Feed ID Mapping:**
Pyth feed IDs are defined in `backend/src/services/PythListener.ts`. For reference, see `backend/src/config/pyth-feeds.example.json` which provides a JSON mapping of symbols to Pyth feed IDs for Base network.

### TWAP Sanity Check

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `TWAP_ENABLED` | boolean | `false` | Enable DEX TWAP price sanity checks |
| `TWAP_WINDOW_SEC` | number | `300` | TWAP calculation window in seconds (5 minutes) |
| `TWAP_DELTA_PCT` | number | `0.012` | Maximum allowed price deviation (1.2%) |
| `TWAP_POOLS` | JSON | `[]` | Array of pool configurations for TWAP calculation |

**Pool Configuration Format:**
```json
[
  {
    "symbol": "WETH",
    "pool": "0xd0b53D9277642d899DF5C87A3966A349A798F224",
    "dex": "uniswap_v3",
    "token0IsAsset": true
  }
]
```

**Example:**
```bash
TWAP_ENABLED=true
TWAP_WINDOW_SEC=300
TWAP_DELTA_PCT=0.012
TWAP_POOLS='[{"symbol":"WETH","pool":"0xd0b53D9277642d899DF5C87A3966A349A798F224","dex":"uniswap_v3","token0IsAsset":true},{"symbol":"cbETH","pool":"0x...","dex":"uniswap_v3","token0IsAsset":false}]'
```

**Pool Discovery:**
Use `npm run discover:twap` to automatically find suitable Uniswap V3 pools on Base:
```bash
# Discover pools for default assets (WETH, cbETH, cbBTC, weETH)
npm run discover:twap

# Custom assets and quotes
npm run discover:twap -- --symbols WETH,cbETH,cbBTC --quotes USDC,WETH --fees 500,3000

# Filter by minimum liquidity
npm run discover:twap -- --min-liquidity 100000
```

The tool outputs a ready-to-paste `TWAP_POOLS` configuration string. See [scripts/README-twap-discovery.md](../backend/scripts/README-twap-discovery.md) for details.

**Validation:**
After configuring `TWAP_POOLS`, validate the setup with:
```bash
npm run check:oracles
```

This checks TWAP price deviations against Chainlink/Pyth reference prices and reports any pools that exceed the `TWAP_DELTA_PCT` threshold.

### Pre-Submit Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `PRE_SUBMIT_ENABLED` | boolean | `false` | Enable pre-submit liquidation transactions |
| `PRE_SUBMIT_ETA_MAX` | number | `90` | Maximum ETA in seconds to consider for pre-submit |
| `HF_TRIGGER_BUFFER` | number | `1.02` | Health factor trigger threshold (1.02 = 2% buffer above liquidation) |
| `GAS_PRICE_MARGIN` | number | `0.10` | Gas price buffer percentage (0.10 = 10% margin) |
| `TTL_BLOCKS` | number | `40` | Time-to-live in blocks for pending pre-submits before cleanup |
| `PRE_SUBMIT_MIN_POSITION_USD` | number | (optional) | Minimum position size in USD (defaults to `MIN_DEBT_USD` if not set) |
| `TELEMETRY_PRE_SUBMIT_ENABLED` | boolean | `true` | Enable telemetry/metrics for pre-submit pipeline |

**Example:**
```bash
PRE_SUBMIT_ENABLED=true
PRE_SUBMIT_ETA_MAX=90
HF_TRIGGER_BUFFER=1.02
GAS_PRICE_MARGIN=0.10
TTL_BLOCKS=40
PRE_SUBMIT_MIN_POSITION_USD=1000
TELEMETRY_PRE_SUBMIT_ENABLED=true
```

### Decision Gates

The pre-submit manager applies the following gates before submitting a transaction:

1. **Feature Enabled**: `PRE_SUBMIT_ENABLED=true`
2. **ETA Gate**: `etaSec <= PRE_SUBMIT_ETA_MAX` OR candidate flagged for fast-path
3. **HF Projection Gate**: `hfProjected <= HF_TRIGGER_BUFFER`
4. **Position Size Gate**: `debtUsd >= PRE_SUBMIT_MIN_POSITION_USD` (or `MIN_DEBT_USD`)
5. **TWAP Sanity Gate** (if enabled): Price deviation within `TWAP_DELTA_PCT`

If any gate fails, the pre-submit is skipped and a metric is incremented.

### Safety Notes

- **Chainlink is Oracle-of-Record**: All on-chain liquidation validation uses Chainlink prices
- **Pyth is Early-Warning Only**: Used to predict when Chainlink will update
- **TWAP Prevents Manipulation**: DEX TWAP check reduces false positives from price manipulation
- **Minimum Position Size**: Prevents wasting gas on small liquidations
- **TTL Cleanup**: Expired pending transactions are automatically cleaned up

### Reusing Existing Parameters

The pre-submit pipeline reuses these existing configuration parameters:

- `MIN_DEBT_USD`: Minimum debt threshold (used if `PRE_SUBMIT_MIN_POSITION_USD` not set)
- `EXECUTION_PRIVATE_KEY`: Private key for signing pre-submit transactions
- `RPC_URL` or `CHAINLINK_RPC_URL`: RPC endpoint for transaction submission
- `AAVE_POOL` or `AAVE_POOL_ADDRESS`: Aave pool contract address
- `CHAIN_ID`: Network chain ID (default: 8453 for Base)

### Observability

When `TELEMETRY_PRE_SUBMIT_ENABLED=true`, the following Prometheus metrics are exposed:

**Pyth Metrics:**
- `pyth_price_updates_total{symbol}`: Total Pyth price updates received
- `pyth_stale_prices_total{symbol}`: Total stale prices detected
- `pyth_connection_errors_total`: Connection errors
- `pyth_reconnects_total`: Reconnection attempts
- `pyth_price_age_sec{symbol}`: Price age histogram

**TWAP Metrics:**
- `twap_sanity_checks_total{symbol,result}`: TWAP checks (pass/fail)
- `twap_delta_pct{symbol}`: Price delta histogram
- `twap_computation_duration_ms{symbol}`: Computation time

**Pre-Submit Metrics:**
- `pre_submit_attempts_total{result}`: Attempts (submitted/gate_failed/error)
- `pre_submit_gate_failures_total{gate}`: Gate failures by type
- `pre_submit_gas_estimated`: Gas estimation histogram
- `pre_submit_outcomes_total{outcome}`: Outcomes (success/reverted/expired)
- `pre_submit_time_to_mine_sec`: Time-to-mine histogram
- `pre_submit_eta_accuracy_sec`: ETA accuracy histogram

### Quick Start Example

```bash
# Enable all pre-submit features
PYTH_ENABLED=true
PYTH_ASSETS=WETH,WBTC,cbETH

TWAP_ENABLED=true
TWAP_POOLS='[{"symbol":"WETH","pool":"0xd0b53D9277642d899DF5C87A3966A349A798F224","dex":"uniswap_v3"}]'

PRE_SUBMIT_ENABLED=true
PRE_SUBMIT_ETA_MAX=90
HF_TRIGGER_BUFFER=1.02

# Reuse existing execution config
EXECUTION_PRIVATE_KEY=0x...
RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR-API-KEY
```

### Disabling Pre-Submit Pipeline

To disable all pre-submit features, simply set:

```bash
PRE_SUBMIT_ENABLED=false
PYTH_ENABLED=false
TWAP_ENABLED=false
```

All services will remain inactive and will not impact existing Chainlink-based liquidation flow.

## Other Configuration Parameters

(This section would contain documentation for other existing parameters in the system)

### Chainlink Price Feeds

| Parameter | Description |
|-----------|-------------|
| `CHAINLINK_RPC_URL` | RPC URL for Chainlink price feed queries |
| `CHAINLINK_FEEDS` | Comma-separated Chainlink feed addresses |
| `PRICE_STALENESS_SEC` | Maximum age for Chainlink prices (default: 900s) |

### Execution Configuration

| Parameter | Description |
|-----------|-------------|
| `EXECUTION_ENABLED` | Enable liquidation execution |
| `DRY_RUN_EXECUTION` | Execute in dry-run mode (no real transactions) |
| `MIN_DEBT_USD` | Minimum debt threshold for liquidations |
| `MAX_GAS_PRICE_GWEI` | Maximum gas price cap |

### Predictive Engine

| Parameter | Description |
|-----------|-------------|
| `PREDICTIVE_ENABLED` | Enable predictive HF engine |
| `PREDICTIVE_HF_BUFFER_BPS` | HF buffer in basis points (default: 40) |
| `PREDICTIVE_HORIZON_SEC` | Prediction horizon in seconds (default: 180) |

(Additional sections would document all other parameters...)
