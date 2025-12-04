# Oracle Discovery & Validation Scripts

This directory contains standalone scripts for discovering and validating oracle configurations for LiquidBot.

## Available Scripts

### 1. `discover-twap-pools.mjs`

Discovers liquid Uniswap V3 pools on Base for TWAP oracle integration.

**Usage:**
```bash
npm run discover:twap
```

**Environment Variables:**
- `RPC_URL` (required) - Base RPC endpoint
- `TWAP_TARGET_ASSETS` - Comma-separated asset symbols (default: uses `PYTH_ASSETS` or "WETH,USDC,cbETH")

**Output:**
- Console: Ready-to-paste `TWAP_POOLS` string for `.env`
- File: `scripts/output/twap_pools.json` with detailed pool data

**Example:**
```bash
RPC_URL=https://mainnet.base.org npm run discover:twap
```

### 2. `check-pyth.mjs`

Validates Pyth Hermes REST and SSE connectivity for early-warning price feeds.

**Usage:**
```bash
npm run check:pyth
```

**Environment Variables:**
- `PYTH_HTTP_URL` - REST endpoint (default: https://hermes.pyth.network)
- `PYTH_SSE_URL` - SSE streaming endpoint (default: https://hermes.pyth.network/v2/updates/stream)
- `PYTH_ASSETS` - Comma-separated asset symbols (default: "ETH,BTC,USDC")
- `PYTH_FEED_MAP_PATH` - Path to feed ID JSON map (optional, uses built-in defaults)
- `PYTH_STALE_SECS` - Staleness threshold in seconds (default: 60)

**Example:**
```bash
PYTH_ASSETS=ETH,BTC,USDC npm run check:pyth
```

### 3. `check-oracles.mjs`

End-to-end oracle sanity check comparing Pyth, Chainlink, and TWAP prices.

**Usage:**
```bash
npm run check:oracles
```

**Environment Variables:**
- `RPC_URL` (required) - Base RPC endpoint
- `PYTH_HTTP_URL` - Pyth REST endpoint
- `PYTH_ASSETS` - Assets to check
- `PYTH_FEED_MAP_PATH` - Path to feed ID JSON map
- `PYTH_STALE_SECS` - Pyth staleness threshold (default: 60)
- `CHAINLINK_FEEDS` - Token:address pairs for Chainlink feeds
- `TWAP_POOLS` - Pool configurations (format: SYMBOL:address:fee,...)
- `TWAP_WINDOW_SEC` - TWAP observation window (default: 300)
- `TWAP_DELTA_PCT` - Maximum acceptable delta percentage (default: 3)
- `PRICE_STALENESS_SEC` - Chainlink staleness threshold (default: 900)

**Example:**
```bash
RPC_URL=https://mainnet.base.org \
CHAINLINK_FEEDS=WETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70 \
npm run check:oracles
```

## Workflow

### Initial Setup

1. **Discover TWAP pools:**
   ```bash
   npm run discover:twap
   ```
   Copy the suggested `TWAP_POOLS` string to your `.env` file.

2. **Validate Pyth connectivity:**
   ```bash
   npm run check:pyth
   ```
   Verify all feeds are accessible and not stale.

3. **Run end-to-end oracle check:**
   ```bash
   npm run check:oracles
   ```
   Ensure all oracle sources are consistent.

### Before Production

Run the full validation suite:

```bash
# 1. Check Pyth feeds
npm run check:pyth

# 2. Verify oracle consistency
npm run check:oracles

# 3. If any issues, adjust configuration and re-run
```

## Output Directory

Script outputs are saved to `scripts/output/`:
- `twap_pools.json` - Detailed TWAP pool discovery results

This directory is excluded from git via `.gitignore`.

## Configuration Files

- `../config/pyth-feeds.example.json` - Sample Pyth feed ID mappings for Base

## Documentation

See `../docs/oracle-wiring.md` for comprehensive documentation on:
- Oracle architecture and recommended wiring
- Sample .env configurations
- Troubleshooting guide
- Integration with core services

## Notes

- All scripts are **read-only** and safe to run in any environment
- Scripts do not modify core execution code or configuration
- Network access required for live data (RPC, Pyth Hermes endpoints)
- Scripts fail gracefully with clear error messages if dependencies are missing
