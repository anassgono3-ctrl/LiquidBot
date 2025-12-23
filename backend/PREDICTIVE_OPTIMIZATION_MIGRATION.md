# Predictive RPC Cost Optimization - Migration Guide

## Overview

This migration guide covers the configuration changes needed to enable the new predictive RPC cost optimization features. These changes significantly reduce RPC costs when predictive liquidation monitoring is enabled by:

1. **Strict signal gating**: Only activates predictive on real early-warning signals (Pyth + TWAP or Chainlink)
2. **Near-band filtering**: Only evaluates users close to liquidation threshold
3. **Queue deduplication**: Prevents repeated evaluations of the same user
4. **Budget enforcement**: Caps RPC calls and candidates per block
5. **Batched verification**: Uses Multicall3 to batch health factor reads

## New Environment Variables

### Signal Gating Configuration

```bash
# Signal mode for predictive activation
# Options: pyth_twap | chainlink | both | pyth_twap_or_chainlink (default)
# - pyth_twap: Requires both Pyth and TWAP signals
# - chainlink: Requires Chainlink NewTransmission signal
# - both: Requires Pyth+TWAP AND Chainlink
# - pyth_twap_or_chainlink: Requires either Pyth+TWAP OR Chainlink (recommended)
PREDICTIVE_SIGNAL_MODE=pyth_twap_or_chainlink

# Minimum debt in USD for predictive to activate
# Falls back to MIN_DEBT_USD if not set
# Default: 1
PREDICTIVE_MIN_DEBT_USD=100

# Pyth price delta threshold (percentage)
# Predictive activates when Pyth delta exceeds this
# Default: 0.5 (0.5%)
PYTH_DELTA_PCT=0.5

# TWAP agreement threshold (uses existing TWAP_DELTA_PCT)
# Predictive requires TWAP to agree with Pyth within this delta
# Default: 0.012 (1.2%)
# TWAP_DELTA_PCT=0.012  # Already exists in your .env
```

### Queue Budget and Safety Limits

```bash
# Maximum RPC calls per block for predictive
# Prevents RPC cost spikes by capping calls
# Default: 200
PREDICTIVE_QUEUE_BUDGET_CALLS_PER_BLOCK=200

# Maximum candidates per block for predictive
# Limits queue growth and processing load
# Default: 60
PREDICTIVE_QUEUE_MAX_CANDIDATES_PER_BLOCK=60

# Cooldown period in seconds between evaluations of same user
# Prevents redundant evaluations
# Default: 60
PREDICTIVE_EVAL_COOLDOWN_SEC=60

# Safety maximum for queue size
# Hard limit to prevent memory issues
# Default: 500
PREDICTIVE_QUEUE_SAFETY_MAX=500

# Comma-separated list of assets to enable predictive for
# Empty = all assets (not recommended with AUTO_DISCOVER_FEEDS=true)
# Example: WETH,WBTC,cbETH
PREDICTIVE_ASSETS=
```

### Per-User Debounce

```bash
# Minimum blocks between evaluations of same user
# Prevents same-block re-evaluation
# Default: 3
PER_USER_BLOCK_DEBOUNCE=3

# User cooldown in seconds
# Additional time-based cooldown
# Default: 120
USER_COOLDOWN_SEC=120
```

## Migration Steps

### Step 1: Update Your .env File

Add the new variables to your `.env` file. You can start with the recommended defaults:

```bash
# Add to your .env file
PREDICTIVE_SIGNAL_MODE=pyth_twap_or_chainlink
PREDICTIVE_MIN_DEBT_USD=100
PYTH_DELTA_PCT=0.5
PREDICTIVE_QUEUE_BUDGET_CALLS_PER_BLOCK=200
PREDICTIVE_QUEUE_MAX_CANDIDATES_PER_BLOCK=60
PREDICTIVE_EVAL_COOLDOWN_SEC=60
PREDICTIVE_QUEUE_SAFETY_MAX=500
PREDICTIVE_ASSETS=
PER_USER_BLOCK_DEBOUNCE=3
USER_COOLDOWN_SEC=120
```

### Step 2: Configure Asset Whitelist (Recommended with AUTO_DISCOVER_FEEDS)

If you have `AUTO_DISCOVER_FEEDS=true`, it's highly recommended to restrict predictive to specific high-value assets:

```bash
# Recommended: Only enable predictive for major assets
PREDICTIVE_ASSETS=WETH,WBTC,cbETH,USDC

# Or leave empty to allow all assets (higher RPC cost)
# PREDICTIVE_ASSETS=
```

### Step 3: Tune Budgets Based on Your Infrastructure

Adjust budgets based on your RPC provider limits and cost tolerance:

**For aggressive cost savings:**
```bash
PREDICTIVE_QUEUE_BUDGET_CALLS_PER_BLOCK=100
PREDICTIVE_QUEUE_MAX_CANDIDATES_PER_BLOCK=30
PREDICTIVE_EVAL_COOLDOWN_SEC=120
```

**For balanced performance:**
```bash
PREDICTIVE_QUEUE_BUDGET_CALLS_PER_BLOCK=200
PREDICTIVE_QUEUE_MAX_CANDIDATES_PER_BLOCK=60
PREDICTIVE_EVAL_COOLDOWN_SEC=60
```

**For maximum coverage (higher cost):**
```bash
PREDICTIVE_QUEUE_BUDGET_CALLS_PER_BLOCK=400
PREDICTIVE_QUEUE_MAX_CANDIDATES_PER_BLOCK=120
PREDICTIVE_EVAL_COOLDOWN_SEC=30
```

### Step 4: Configure Oracle Signals

Ensure your oracle services are configured:

**Pyth (optional but recommended):**
```bash
PYTH_ENABLED=true
PYTH_WS_URL=wss://hermes.pyth.network/ws
PYTH_HTTP_URL=https://hermes.pyth.network
PYTH_ASSETS=WETH,WBTC,cbETH,USDC
PYTH_STALE_SECS=10
```

**TWAP (optional but recommended with Pyth):**
```bash
TWAP_ENABLED=true
TWAP_WINDOW_SEC=300
TWAP_DELTA_PCT=0.012
TWAP_POOLS=[{"symbol":"WETH","pool":"0x...","dex":"uniswap_v3"}]
```

**Chainlink (usually enabled):**
```bash
PRICE_TRIGGER_ENABLED=true
PRICE_TRIGGER_ASSETS=WETH,WBTC,cbETH,USDC
PRICE_TRIGGER_BPS_BY_ASSET={"WETH":30,"WBTC":30,"cbETH":30,"USDC":5}
```

### Step 5: Restart the Service

```bash
npm run build
npm start
```

## Expected Impact

With these settings, you should observe:

### RPC Cost Reduction
- **70-80% reduction** in eth_call volume when markets are quiet
- **40-60% reduction** during volatile periods
- Costs similar to PRICE_TRIGGER-only mode on Base (~$0.20-0.30/hour)

### Behavioral Changes
- Predictive only activates on significant price movements
- Users far from liquidation (HF > 1.0015) are skipped
- No repeated evaluations of same user within cooldown
- Queue size remains bounded by safety limits

### Monitoring
Check these metrics to verify optimization:
- `liquidbot_predictive_call_budget_used` - Should stay under limit
- `liquidbot_predictive_skipped_not_near_band_total` - Should be high
- `liquidbot_predictive_dedup_skips_total` - Should show dedup working
- `liquidbot_predictive_queue_size` - Should stay well below safety max

## Troubleshooting

### Issue: Predictive not activating at all

**Check:**
1. Is `PREDICTIVE_ENABLED=true`?
2. Is `PREDICTIVE_QUEUE_ENABLED=true`?
3. Are oracle signals being received? (Check Pyth/TWAP/Chainlink logs)
4. Is signal mode too restrictive? Try `PREDICTIVE_SIGNAL_MODE=pyth_twap_or_chainlink`

### Issue: RPC costs still high

**Solutions:**
1. Reduce budgets: Lower `PREDICTIVE_QUEUE_BUDGET_CALLS_PER_BLOCK`
2. Restrict assets: Set `PREDICTIVE_ASSETS` to major assets only
3. Increase cooldown: Raise `PREDICTIVE_EVAL_COOLDOWN_SEC` to 120+
4. Check `PREDICTIVE_NEAR_BAND_BPS`: Lower value = stricter filtering

### Issue: Missing liquidation opportunities

**Solutions:**
1. Ensure `PRICE_TRIGGER_ENABLED=true` for baseline coverage
2. Lower `PREDICTIVE_MIN_DEBT_USD` to catch smaller positions
3. Increase `PREDICTIVE_NEAR_BAND_BPS` from 15 to 30 or 50
4. Use `PREDICTIVE_SIGNAL_MODE=pyth_twap_or_chainlink` for more signals

## Rollback

To disable the new optimization and revert to previous behavior:

```bash
# In your .env
PREDICTIVE_QUEUE_ENABLED=false

# Or entirely disable predictive
PREDICTIVE_ENABLED=false
```

The system will fall back to PRICE_TRIGGER-only mode.

## Support

For issues or questions:
1. Check logs for `[predictive-signal-gate]`, `[predictive-queue-mgr]` entries
2. Review Prometheus metrics in your monitoring dashboard
3. Open an issue on GitHub with logs and metrics screenshots
