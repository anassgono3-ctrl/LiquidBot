# Oracle Wiring Guide

This guide explains the recommended oracle wiring for LiquidBot, combining Pyth Network (Hermes) for early-warning price feeds, Chainlink as the oracle-of-record, and Uniswap V3 TWAP for sanity checks.

## Overview

LiquidBot uses a multi-oracle strategy to maximize reliability and minimize missed liquidations:

1. **Pyth Network (Hermes)** - Early-warning system via REST API and SSE streaming
2. **Chainlink** - Primary oracle-of-record for on-chain execution
3. **Uniswap V3 TWAP** - Sanity check for liquid assets (especially WETH)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Oracle Integration                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Pyth Hermes (Early Warning)                                 │
│  ├─ REST API: Latest prices (low latency)                    │
│  └─ SSE Stream: Real-time updates (sub-second)               │
│                                                               │
│  Chainlink (Oracle of Record)                                │
│  ├─ Direct feeds: ETH/USD, BTC/USD, USDC/USD                 │
│  └─ Ratio feeds: cbETH/ETH, wstETH/ETH                       │
│                                                               │
│  Uniswap V3 TWAP (Sanity Check)                              │
│  └─ Liquid pools: WETH/USDC, cbETH/WETH                      │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Recommended Wiring

### Pyth (Early Warning)

Pyth provides low-latency price updates that can trigger pre-emptive health factor checks before Chainlink updates on-chain.

**Configuration:**

```bash
# Pyth Hermes endpoints
PYTH_HTTP_URL=https://hermes.pyth.network
PYTH_SSE_URL=https://hermes.pyth.network/v2/updates/stream

# Feed ID map (optional, uses defaults if not set)
PYTH_FEED_MAP_PATH=./config/pyth-feeds.example.json

# Assets to monitor
PYTH_ASSETS=ETH,BTC,USDC,cbETH,wstETH

# Staleness threshold (seconds)
PYTH_STALE_SECS=60
```

**Feed IDs (Base mainnet):**

See `config/pyth-feeds.example.json` for a complete list. Key feeds:

- ETH/USD: `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace`
- BTC/USD: `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`
- USDC/USD: `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a`

### Chainlink (Oracle of Record)

Chainlink is used for final price verification before executing liquidations.

**Configuration:**

```bash
# Chainlink price feeds (Base mainnet)
CHAINLINK_FEEDS=WETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,USDC:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B,cbETH:0xd7818272B9e248357d13057AAb0B417aF31E817d,WBTC:0x0000000000000000000000000000000000000000

# Ratio feeds (automatically composed with base asset)
# cbETH/ETH composed with ETH/USD gives cbETH/USD
# wstETH/ETH composed with ETH/USD gives wstETH/USD
DERIVED_RATIO_FEEDS=cbETH:cbETH_ETH,wstETH:wstETH_ETH

# Staleness threshold (seconds) - Chainlink updates less frequently than Pyth
PRICE_STALENESS_SEC=900
```

**Feed Addresses (Base mainnet):**

- WETH/USD: `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70`
- USDC/USD: `0x7e860098F58bBFC8648a4311b374B1D669a2bc6B`
- cbETH/USD: `0xd7818272B9e248357d13057AAb0B417aF31E817d`
- cbETH/ETH (ratio): `0x43a5C292A453A3bF3606fa856197f09D7B74251a` (if needed)
- wstETH/ETH (ratio): (check Chainlink docs for Base)

### Uniswap V3 TWAP (Sanity Check)

TWAP provides a manipulation-resistant sanity check for liquid assets.

**Configuration:**

```bash
# TWAP pools (discovered via discover:twap script)
# Format: SYMBOL:pool_address:fee_tier
TWAP_POOLS=WETH:0xd0b53D9277642d899DF5C87A3966A349A798F224:3000,cbETH:0x0000000000000000000000000000000000000000:3000

# TWAP observation window (seconds)
TWAP_WINDOW_SEC=300

# Maximum acceptable delta between TWAP and Chainlink (percentage)
TWAP_DELTA_PCT=3

# Assets to use TWAP for (fallback to PYTH_ASSETS)
TWAP_TARGET_ASSETS=WETH,cbETH
```

## Discovery and Validation Scripts

### 1. Discover TWAP Pools

Find liquid Uniswap V3 pools for TWAP integration:

```bash
npm run discover:twap
```

This will:
- Query Uniswap V3 Factory for pools across fee tiers (0.05%, 0.30%, 1.00%)
- Fetch liquidity and observation cardinality for each pool
- Rank pools by liquidity
- Output a ready-to-paste `TWAP_POOLS` string for `.env`
- Save detailed results to `scripts/output/twap_pools.json`

**Example output:**

```bash
TWAP_POOLS=WETH:0xd0b53D9277642d899DF5C87A3966A349A798F224:3000,cbETH:0x123...:3000
```

### 2. Check Pyth Connectivity

Validate Pyth Hermes REST and SSE connectivity:

```bash
npm run check:pyth
```

This will:
- Test REST API for latest prices
- Subscribe to SSE stream for real-time updates
- Display prices, confidence intervals, and publish times
- Flag staleness issues

**Example output:**

```
ETH:
  Price: 2500.123456 ± 0.5
  Published: 2024-12-04T23:00:00.000Z (5s ago) ✓
```

### 3. End-to-End Oracle Check

Compare all oracle sources and validate consistency:

```bash
npm run check:oracles
```

This will:
- Fetch prices from Pyth, Chainlink, and TWAP
- Calculate deltas between sources
- Flag staleness and excessive deltas
- Provide actionable recommendations

**Example output:**

```
Checking: WETH
📡 Pyth: $2500.12
📡 Chainlink: $2501.45
📊 TWAP ratio: 1.0005
📐 Pyth vs Chainlink: 0.05% ✓
```

## Sample .env Configuration

Here's a complete example for Base mainnet:

```bash
# Base RPC
RPC_URL=https://mainnet.base.org

# Pyth Configuration
PYTH_HTTP_URL=https://hermes.pyth.network
PYTH_SSE_URL=https://hermes.pyth.network/v2/updates/stream
PYTH_ASSETS=ETH,BTC,USDC,cbETH
PYTH_STALE_SECS=60
PYTH_FEED_MAP_PATH=./config/pyth-feeds.example.json

# Chainlink Configuration
CHAINLINK_FEEDS=WETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,USDC:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B
PRICE_STALENESS_SEC=900
RATIO_PRICE_ENABLED=true

# TWAP Configuration
TWAP_POOLS=WETH:0xd0b53D9277642d899DF5C87A3966A349A798F224:3000
TWAP_WINDOW_SEC=300
TWAP_DELTA_PCT=3
TWAP_TARGET_ASSETS=WETH
```

## Usage Workflow

### Initial Setup

1. **Discover pools:**
   ```bash
   npm run discover:twap
   ```
   Copy the output `TWAP_POOLS` string to your `.env` file.

2. **Validate Pyth connectivity:**
   ```bash
   npm run check:pyth
   ```
   Verify all feeds are accessible and not stale.

3. **Run end-to-end check:**
   ```bash
   npm run check:oracles
   ```
   Ensure all oracle sources are consistent.

### Before Enabling Production

Run the full validation suite:

```bash
# 1. Check Pyth feeds
npm run check:pyth

# 2. Verify oracle consistency
npm run check:oracles

# 3. If any issues, adjust configuration and re-run
```

### Monitoring in Production

- Run `check:oracles` periodically (e.g., daily cron job) to detect:
  - Feed staleness
  - Price divergence between sources
  - Missing oracle configurations

- Set up alerts for:
  - Pyth SSE connection drops
  - Chainlink staleness > threshold
  - TWAP delta > threshold

## Troubleshooting

### Pyth feeds are stale

- **Cause:** Low on-chain demand for specific feed
- **Solution:** Increase `PYTH_STALE_SECS` or use Chainlink as primary

### TWAP delta exceeds threshold

- **Cause:** Pool manipulation or low liquidity
- **Solution:**
  - Increase `TWAP_DELTA_PCT`
  - Switch to higher liquidity pool (use `discover:twap`)
  - Disable TWAP for that asset

### Chainlink feed not updating

- **Cause:** Price hasn't moved enough to trigger update
- **Solution:** Normal behavior, adjust `PRICE_STALENESS_SEC` if needed

### No pools found for asset

- **Cause:** Asset may not have liquid Uniswap V3 pools on Base
- **Solution:** Skip TWAP for that asset, rely on Pyth + Chainlink

## Integration with Core Services

The oracle tooling is **independent** of core execution:

- **No changes to core code** - All scripts are standalone
- **Safe to test** - Scripts only read data, never write or execute
- **Incremental adoption** - Can enable oracle sources one at a time

To integrate with core services:

1. Configure environment variables as shown above
2. Core services will automatically use configured oracles
3. No code changes required - configuration-driven

## Resources

- [Pyth Network Price Feeds](https://pyth.network/developers/price-feed-ids)
- [Chainlink Base Feeds](https://docs.chain.link/data-feeds/price-feeds/addresses?network=base)
- [Uniswap V3 TWAP Documentation](https://docs.uniswap.org/concepts/protocol/oracle)

## Security Considerations

1. **Never commit API keys** - Use environment variables
2. **Validate feed IDs** - Always cross-check against official Pyth registry
3. **Monitor for manipulation** - TWAP provides sanity check against oracle attacks
4. **Use multiple sources** - Pyth + Chainlink redundancy prevents single point of failure

## Support

For issues or questions:
- Open an issue on GitHub
- Check existing oracle-related issues
- Review the troubleshooting section above
