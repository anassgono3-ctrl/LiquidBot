# Oracle Validation Tool

## Overview

The `check-oracles.ts` script validates Pyth, Chainlink, and TWAP oracle wiring end-to-end based on your `.env` configuration. It provides actionable diagnostics and returns a non-zero exit code on failure, making it suitable for CI/CD pipelines and pre-deployment validation.

## Purpose

Before enabling the Pyth + TWAP early-warning flow on mainnet (introduced in PR #161), you need to verify that:

1. **Pyth feeds** are accessible and not stale
2. **Chainlink feeds** are healthy and returning valid prices
3. **TWAP pools** produce prices within acceptable deviation from reference oracles

This tool automates all three checks and provides a comprehensive report.

## Usage

### Basic Usage

```bash
npm run check:oracles
```

This validates all configured oracles using settings from `.env`.

### Custom Assets

```bash
npm run check:oracles -- --assets WETH,cbETH,cbBTC
```

Override `PYTH_ASSETS` to check specific assets only.

### Custom TWAP Window

```bash
npm run check:oracles -- --window 600
```

Set the TWAP calculation window to 600 seconds (10 minutes).

### Custom Delta Threshold

```bash
npm run check:oracles -- --delta 0.02
```

Set the maximum allowed TWAP deviation to 2.0% (default: 1.2%).

### Verbose Output

```bash
npm run check:oracles -- --verbose
```

Show detailed information including feed IDs, timestamps, and pool addresses.

## Output

The script generates a per-source report showing:

### Pyth Network Validation

- ✅ Price, age, confidence interval
- ⚠️  Stale data warnings (age > `PYTH_STALE_SECS`)
- ❌ Connection errors or missing feeds

### Chainlink Feed Validation

- ✅ Price, age, round ID
- ⚠️  Stale data warnings (age > `PRICE_STALENESS_SEC`)
- ❌ Invalid prices (non-positive) or connection errors

### TWAP Validation

- ✅ TWAP price vs reference price, delta percentage
- ⊘ Insufficient swap data (passes by default)
- ❌ Delta exceeds threshold or computation errors

### Summary

- Count of checked feeds per source
- Count of failures/stale feeds per source
- Overall PASS/FAIL status
- Exit code: **0** for pass, **1** for fail

### Example Output

```
🔍 Oracle Validation Tool

✅ RPC connected: Block 12345678

━━━ Pyth Network Validation ━━━
HTTP URL: https://hermes.pyth.network
Assets: WETH, cbETH, cbBTC, weETH
Staleness threshold: 10s

✅ WETH: $2,345.67 (age: 3s, conf: ±$1.23)
✅ cbETH: $2,340.00 (age: 4s, conf: ±$1.20)
⚠️  cbBTC: $45,678.90 (age: 12s, conf: ±$5.00) STALE
✅ weETH: $2,350.00 (age: 5s, conf: ±$1.25)

━━━ Chainlink Feed Validation ━━━
Staleness threshold: 900s

✅ WETH: $2,345.70 (age: 45s)
✅ USDC: $1.0000 (age: 120s)
✅ cbETH: $2,340.50 (age: 60s)

━━━ TWAP Validation ━━━
Window: 300s
Max delta: 1.20%

✅ WETH: TWAP=$2,344.80 vs Ref=$2,345.70 (delta: 0.04%)
⊘ cbETH: Insufficient swap data in 300s window
✅ cbBTC: TWAP=$45,650.00 vs Ref=$45,678.90 (delta: 0.06%)

━━━ Summary ━━━

Pyth: 4 checked, 1 failed/stale
Chainlink: 3 checked, 0 failed/stale
TWAP: 3 checked, 0 failed

❌ One or more oracle sources FAILED
```

**Exit code: 1** (due to stale Pyth feed for cbBTC)

## Configuration

The script reads these environment variables:

### Required

- **`RPC_URL`** or **`CHAINLINK_RPC_URL`**: Base RPC endpoint

### Pyth Settings

- **`PYTH_ENABLED`**: Enable Pyth validation (default: `false`)
- **`PYTH_HTTP_URL`**: Pyth HTTP endpoint (default: `https://hermes.pyth.network`)
- **`PYTH_ASSETS`**: Comma-separated asset symbols (default: `WETH,WBTC,cbETH,USDC`)
- **`PYTH_STALE_SECS`**: Staleness threshold in seconds (default: `10`)

### Chainlink Settings

- **`CHAINLINK_FEEDS`**: Comma-separated `SYMBOL:ADDRESS` pairs (e.g., `WETH:0x71041...,USDC:0x7e860...`)
- **`PRICE_STALENESS_SEC`**: Staleness threshold in seconds (default: `900`)

### TWAP Settings

- **`TWAP_ENABLED`**: Enable TWAP validation (default: `false`)
- **`TWAP_POOLS`**: JSON array of pool configurations
- **`TWAP_WINDOW_SEC`**: TWAP window in seconds (default: `300`)
- **`TWAP_DELTA_PCT`**: Max deviation as decimal (default: `0.012` = 1.2%)

## How It Works

### Pyth Validation

1. Queries Pyth HTTP API (`/v2/updates/price/latest`) for each configured asset
2. Checks price age against `PYTH_STALE_SECS` threshold
3. Reports price, confidence interval, and staleness

### Chainlink Validation

1. Calls `latestRoundData()` on each configured feed contract
2. Validates non-positive answers are rejected
3. Checks age against `PRICE_STALENESS_SEC` threshold
4. Uses existing `normalizeChainlinkPrice` utility for safe price parsing

### TWAP Validation

1. Fetches Swap events from Uniswap V3 pool over `TWAP_WINDOW_SEC`
2. Computes volume-weighted TWAP from on-chain swap data
3. Compares TWAP to reference price (Chainlink preferred, Pyth fallback)
4. Validates deviation is within `TWAP_DELTA_PCT` threshold
5. Passes by default if insufficient swap data (conservative approach)

## Exit Codes

- **0**: All oracle sources passed validation
- **1**: One or more failures detected (stale feeds, connectivity issues, exceeded thresholds)

This makes the tool suitable for:
- Pre-deployment checks in CI/CD
- Scheduled health monitoring (cron jobs)
- Manual verification before enabling features

## Use Cases

### Pre-Deployment Validation

```bash
npm run check:oracles || exit 1
```

Fail deployment if oracles are misconfigured or unhealthy.

### Scheduled Monitoring

```bash
*/15 * * * * cd /app/backend && npm run check:oracles >> /var/log/oracle-check.log 2>&1
```

Run every 15 minutes and log results for alerting.

### Manual Pre-Mainnet Check

```bash
npm run check:oracles -- --verbose > oracle-report.txt
```

Generate detailed report before enabling `PRE_SUBMIT_ENABLED=true`.

## Troubleshooting

### Pyth: Connection errors

- Check `PYTH_HTTP_URL` is accessible
- Verify network connectivity to Pyth endpoints
- Try fallback HTTP URL if WebSocket is down

### Pyth: No feed ID configured

- Check `backend/src/config/pyth-feeds.example.json` for supported assets
- Add missing feed IDs to `PYTH_PRICE_FEED_IDS` in `check-oracles.ts`

### Chainlink: Invalid non-positive answer

- Feed may be misconfigured or deprecated
- Verify feed address in [Chainlink Base feeds](https://docs.chain.link/data-feeds/price-feeds/addresses?network=base)
- Check if feed has been replaced or decommissioned

### Chainlink: Stale data

- Increase `PRICE_STALENESS_SEC` threshold (e.g., 1800 for 30 minutes)
- Check if feed is still actively updated on-chain
- Verify feed is appropriate for your use case (some feeds update less frequently)

### TWAP: Insufficient swap data

- This is normal for less liquid pools or during quiet market periods
- The check passes by default to avoid false failures
- If persistent, consider discovering a more liquid pool with `npm run discover:twap`

### TWAP: Delta exceeds threshold

- Market volatility can cause legitimate deviations
- Increase `TWAP_DELTA_PCT` if needed (e.g., 0.02 for 2%)
- Verify pool is not being manipulated (check recent swaps on Basescan)
- Consider using a longer `TWAP_WINDOW_SEC` to smooth out noise

### RPC connection failed

- Verify `RPC_URL` in `.env`
- Check API key if using Alchemy/QuickNode/Chainstack
- Ensure RPC provider supports Base network
- Test connectivity: `curl $RPC_URL`

## Integration with Pre-Submit Pipeline

This tool complements the pre-submit liquidation pipeline (PR #161):

1. **Discovery**: Use `npm run discover:twap` to find pools
2. **Validation**: Use `npm run check:oracles` to verify configuration
3. **Enable**: Set `PRE_SUBMIT_ENABLED=true`, `PYTH_ENABLED=true`, `TWAP_ENABLED=true`
4. **Monitor**: Watch logs for TWAP sanity failures and Pyth staleness warnings
5. **Iterate**: Adjust thresholds based on observed behavior

## Best Practices

- **Run before mainnet**: Always validate oracles before enabling pre-submit on mainnet
- **Schedule regular checks**: Set up cron job for continuous monitoring
- **Verbose mode for debugging**: Use `--verbose` when investigating issues
- **Adjust thresholds conservatively**: Start with strict thresholds and relax as needed
- **Monitor TWAP sanity failures**: Investigate if TWAP frequently fails to pass

## See Also

- [TWAP Discovery Tool](./README-twap-discovery.md): Discover suitable TWAP pools
- [params.md](../../docs/params.md): Full parameter documentation
- [PR #161](https://github.com/anassgono3-ctrl/LiquidBot/pull/161): Pre-submit liquidation pipeline
