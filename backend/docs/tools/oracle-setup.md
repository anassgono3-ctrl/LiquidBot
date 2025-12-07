# Oracle Setup Guide

This guide walks you through configuring TWAP and Pyth oracles for the LiquidBot early-warning system.

## Overview

The oracle discovery and validation tooling helps operators:
1. **Discover TWAP pools** - Find optimal Uniswap V3 pools for TWAP price feeds
2. **Validate Pyth connectivity** - Test Pyth Hermes REST and SSE endpoints
3. **Verify TWAP sanity** - Compare TWAP prices against Chainlink to ensure accuracy

## Prerequisites

- Node.js 18+ installed
- Access to Base RPC endpoint (e.g., `https://mainnet.base.org`)
- Familiarity with `.env` configuration files

## Step 1: Configure Pyth Hermes

### 1.1 Set Pyth Environment Variables

Add the following to your `.env` file:

```bash
# Pyth Network Integration
PYTH_ENABLED=false  # Set to true when ready to enable
# Base URL for Pyth Hermes REST API (endpoints like /v2/updates/price/latest are appended by code)
PYTH_HTTP_URL=https://hermes.pyth.network
PYTH_WS_URL=wss://hermes.pyth.network/ws
PYTH_ASSETS=WETH,WBTC,cbETH,USDC
PYTH_STALE_SECS=10
PYTH_FEED_MAP_PATH=./config/pyth-feeds.json
```

**Important:** `PYTH_HTTP_URL` should be set to the base URL only (`https://hermes.pyth.network`), **not** to a specific endpoint like `/v2/price_feeds`. The application code will append the correct endpoint paths (e.g., `/v2/updates/price/latest?ids[]=<feedId>`) automatically.

### 1.2 Create Feed Map

Copy the sample feed map and customize for your deployment:

```bash
cp config/pyth-feeds.sample.json config/pyth-feeds.json
```

Edit `config/pyth-feeds.json` to add or update feed IDs. Feed IDs can be found at:
https://pyth.network/developers/price-feed-ids

Example entry:
```json
{
  "feeds": {
    "WETH": {
      "feedId": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
      "description": "ETH/USD"
    }
  }
}
```

### 1.3 Test Pyth Connectivity

Run the Pyth connectivity test:

```bash
node scripts/test-pyth-hermes.mjs
```

Expected output:
- ✅ REST API returns fresh prices for all configured assets
- ✅ SSE stream delivers price updates within test duration
- ⚠️ If tests fail, verify `PYTH_HTTP_URL` and network connectivity

## Step 2: Discover TWAP Pools

### 2.1 Run Pool Discovery

Discover Uniswap V3 pools for your target assets:

```bash
# Discover pools for default assets (WETH, cbETH, WBTC)
node scripts/discover-twap-pools.mjs

# Or specify custom targets
TWAP_TARGETS=WETH,cbETH,USDC,AAVE node scripts/discover-twap-pools.mjs
```

Expected output:
```
🔍 TWAP Pool Discovery for Base Network
=========================================

RPC URL: https://mainnet.base.org
Targets: WETH, cbETH, WBTC
...

✨ TWAP_POOLS Configuration
=========================================

[
  {
    "symbol": "WETH",
    "pool": "0x4C36388bE6F416A29C8d8Eee81C771cE6bE14B18",
    "dex": "uniswap_v3",
    "fee": 500,
    "quote": "USDC",
    "liquidity": "12345678901234567890"
  },
  ...
]

Ready to paste into .env:
TWAP_POOLS='[{"symbol":"WETH","pool":"0x...","dex":"uniswap_v3",...}]'
```

### 2.2 Configure TWAP in .env

Copy the output `TWAP_POOLS` string to your `.env`:

```bash
# TWAP Configuration
TWAP_ENABLED=false  # Set to true when ready
TWAP_WINDOW_SEC=300  # 5-minute TWAP window
TWAP_DELTA_PCT=0.012  # 1.2% max deviation from Chainlink
TWAP_POOLS='[{"symbol":"WETH","pool":"0x4C36388bE6F416A29C8d8Eee81C771cE6bE14B18","dex":"uniswap_v3","fee":500,"quote":"USDC"}]'
```

## Step 3: Validate TWAP Sanity

### 3.1 Configure Chainlink Feeds

Ensure `CHAINLINK_FEEDS` is set in `.env` for comparison:

```bash
CHAINLINK_FEEDS=WETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,USDC:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B,cbETH:0xd7818272B9e248357d13057AAb0B417aF31E817d
```

### 3.2 Run TWAP Sanity Check

Test TWAP against Chainlink:

```bash
node scripts/test-twap-sanity.mjs
```

Expected output:
```
🔍 TWAP Sanity Check
=========================================

RPC URL: https://mainnet.base.org
TWAP Window: 300s
Max Delta: 1.20%

📊 WETH (uniswap_v3)
------------------------------------------------------------
Pool: 0x4C36388bE6F416A29C8d8Eee81C771cE6bE14B18
  TWAP Price: 3250.456123 (avg tick: 123456.78)
  Chainlink Price: 3251.120000 (age: 12s)
  Delta: 0.663877 (0.02%)
  ✅ PASS - Delta within threshold

✨ Summary
=========================================

Total: 3
Passed: 3
Failed: 0

  ✅ PASS WETH (Δ 0.02%)
  ✅ PASS cbETH (Δ 0.15%)
  ✅ PASS WBTC (Δ 0.08%)

✅ All TWAP sanity checks passed
```

## Step 4: Enable Pre-Submit Pipeline (Staged Rollout)

### Phase 1: Monitoring Only

Enable oracles in monitoring mode (no execution):

```bash
PYTH_ENABLED=true
TWAP_ENABLED=true
PRE_SUBMIT_ENABLED=false  # Keep disabled initially
```

Monitor logs for:
- Pyth price updates and staleness
- TWAP computation success rates
- Price deltas vs Chainlink

### Phase 2: Dry Run Pre-Submit

Enable pre-submit in dry-run mode:

```bash
PRE_SUBMIT_ENABLED=true
DRY_RUN_EXECUTION=true  # Transactions not broadcast
```

Review dry-run logs to verify:
- ETA predictions are accurate
- Gas price margins are appropriate
- Position sizing is correct

### Phase 3: Production

Enable live pre-submit execution:

```bash
PRE_SUBMIT_ENABLED=true
DRY_RUN_EXECUTION=false
EXECUTION_ENABLED=true  # Enable actual execution
```

**⚠️ IMPORTANT:** Only enable after thorough testing in phases 1-2.

## Troubleshooting

### Pyth Connectivity Issues

**Problem:** REST API returns no data or stale prices
- **Solution:** Verify `PYTH_HTTP_URL` is set to base URL only: `https://hermes.pyth.network` (not `/v2/price_feeds`)
- **Solution:** The code will automatically append endpoints like `/v2/updates/price/latest?ids[]=<feedId>`
- **Solution:** Check feed IDs in `PYTH_FEED_MAP_PATH` against https://pyth.network/developers/price-feed-ids
- **Solution:** Ensure your network can reach hermes.pyth.network (check firewall/proxy)

**Problem:** SSE stream not receiving updates
- **Solution:** Verify network allows WebSocket/SSE connections
- **Solution:** Check firewall rules for outbound HTTPS and WSS
- **Solution:** Some corporate networks block WebSocket - use HTTP polling as fallback

### TWAP Pool Discovery Issues

**Problem:** No pools found for target asset
- **Solution:** Verify asset symbol matches token list (case-insensitive)
- **Solution:** Check if token exists on Base and has liquidity on Uniswap V3
- **Solution:** Lower `MIN_LIQUIDITY` threshold if pools exist but are filtered out

**Problem:** Pool exists but TWAP computation fails
- **Solution:** Verify pool has sufficient observation cardinality
- **Solution:** Reduce `TWAP_WINDOW_SEC` if pool is newly created

### TWAP Sanity Check Failures

**Problem:** High delta percentage vs Chainlink
- **Solution:** Increase `TWAP_DELTA_PCT` if deltas are consistently within acceptable range
- **Solution:** Verify pool liquidity is sufficient (low liquidity = high slippage)
- **Solution:** Check if Chainlink feed address is correct

**Problem:** TWAP computation fails
- **Solution:** Verify `TWAP_WINDOW_SEC` doesn't exceed pool observation history
- **Solution:** Check RPC endpoint supports historical queries (archive node may be needed)

## Advanced Configuration

### Custom RPC Endpoints

Use separate RPC endpoints for different operations:

```bash
# HTTP for pool discovery and TWAP
RPC_URL=https://mainnet.base.org

# WebSocket for real-time Pyth streaming
WS_RPC_URL=wss://mainnet.base.org

# Archive node for historical TWAP queries
BACKFILL_RPC_URL=https://base-mainnet-archive.example.com
```

### Per-Asset TWAP Windows

Configure different TWAP windows per asset by adding `twapWindow` to pool configs:

```json
{
  "symbol": "WETH",
  "pool": "0x...",
  "dex": "uniswap_v3",
  "twapWindow": 600
}
```

### Multiple Quote Tokens

Discovery script tests USDC and WETH pairs by default. To add more, edit `scripts/discover-twap-pools.mjs`:
```javascript
const QUOTE_TOKENS = ["USDC", "WETH", "DAI"];
```

## Next Steps

- Review [scripts/README-oracle-tools.md](../../scripts/README-oracle-tools.md) for detailed CLI usage
- Monitor Prometheus metrics for oracle health:
  - `pyth_price_updates_total`
  - `twap_sanity_checks_total`
  - `twap_price_delta_pct`
- Set up Telegram notifications for oracle issues

## References

- [Pyth Network Documentation](https://docs.pyth.network/)
- [Uniswap V3 TWAP Oracles](https://docs.uniswap.org/concepts/protocol/oracle)
- [Chainlink Price Feeds](https://docs.chain.link/data-feeds/price-feeds)
