# Provider Throttling Hotfix - Operational Guide

## Overview

This hotfix addresses provider rate limiting (HTTP 429) and metadata issues discovered after PR #152. It introduces:

1. **RPC Budget System**: Token bucket rate limiter to prevent provider throttling
2. **Enhanced Error Handling**: 429 detection with exponential backoff and provider failover
3. **Token Metadata Registry**: Eliminates `symbol_missing` warnings with lazy on-chain discovery
4. **Event Coalescing**: Removes fast-lane bypass to ensure proper batching
5. **Runtime Caps**: Clamps reserve recheck limits to prevent RPC storms

## Quick Start

### Required Environment Variables

Add these to your `.env`:

```bash
# RPC Budget Configuration (adjust based on your Alchemy tier)
RPC_BUDGET_BURST=100              # Token bucket capacity
RPC_BUDGET_CU_PER_SEC=50          # Refill rate (tokens/sec)
RPC_BUDGET_MIN_SPACING_MS=10      # Minimum delay between calls
RPC_JITTER_MS=5                   # Random jitter for anti-thundering herd

# Reserve Recheck Limits (runtime-clamped to 300 max)
RESERVE_RECHECK_TOP_N=300         # Lowered from 800 default

# Optional: Secondary RPC for failover
SECONDARY_HEAD_RPC_URL=https://mainnet.base.org
```

### Recommended Settings by Alchemy Tier

#### Free Tier (not recommended for production)
```bash
RPC_BUDGET_CU_PER_SEC=10
RPC_BUDGET_BURST=20
RESERVE_RECHECK_TOP_N=100
```

#### Growth Tier ($49/mo - 300 CU/sec)
```bash
RPC_BUDGET_CU_PER_SEC=50
RPC_BUDGET_BURST=100
RESERVE_RECHECK_TOP_N=200
```

#### Scale Tier ($199/mo - 1000 CU/sec)
```bash
RPC_BUDGET_CU_PER_SEC=150
RPC_BUDGET_BURST=300
RESERVE_RECHECK_TOP_N=300
```

## What Changed

### 1. RPC Budget System

**Before**: No rate limiting → provider throttling under load → 429 errors → websocket disconnects

**After**: Token bucket limiter gates all RPC calls → smooth throughput → no throttling

**Location**: `src/rpc/RpcBudget.ts`

**How it works**:
- Each RPC call acquires tokens from the bucket
- Bucket refills at configured rate (RPC_BUDGET_CU_PER_SEC)
- Calls queue when bucket is empty
- Prevents sudden spikes that trigger rate limits

### 2. RPC Client with 429 Handling

**Before**: Raw ethers provider → CALL_EXCEPTION with "missing revert data" on throttling

**After**: Wrapped client detects 429 → applies backoff → retries with jitter → failover to secondary provider

**Location**: `src/rpc/RpcClient.ts`

**Features**:
- Detects HTTP 429 and Alchemy-specific errors
- Exponential backoff (100ms → 200ms → 400ms → ...)
- Provider pool with cooldown (default 30 seconds)
- Rate-limited logging (once per 5 seconds per endpoint)
- Never silently swallows errors

### 3. Event Coalescing (Fast-Lane Bypass Removed)

**Before**: ReserveDataUpdated events bypassed coalescing → 800 borrowers checked per event → RPC storm

**After**: ALL events use coalescing → debounce window (120ms) → dedupe reserves → single batch per block

**Location**: `src/services/RealTimeHFService.ts:2443`

**Impact**:
- Reduced: 5 events × 800 calls = 4000 calls
- Now: 1 batch × unique reserves = ~200 calls
- Respects `EVENT_BATCH_COALESCE_MS` and `EVENT_BATCH_MAX_PER_BLOCK`

### 4. Reserve Recheck Caps

**Before**: `RESERVE_RECHECK_TOP_N=800` could be set arbitrarily high

**After**: Runtime-clamped to 300 maximum regardless of env setting

**Location**: `src/config/envSchema.ts:647`

**Rationale**: Even with env misconfiguration, system won't exceed safe limits

### 5. Token Metadata Registry

**Before**: Hardcoded map → `symbol_missing` warnings for new tokens → assets potentially skipped

**After**: 3-tier resolution:
1. AaveMetadata (authoritative)
2. Hardcoded overrides (Base tokens: USDC, WETH, cbBTC, etc.)
3. Lazy on-chain fetch with cache (5 min TTL)

**Location**: `src/services/TokenMetadataRegistry.ts`

**Supported Tokens** (Base mainnet):
- USDC (0x833589fcd6edb6e08f4c7c32d4f71b54bda02913)
- WETH (0x4200000000000000000000000000000000000006)
- cbBTC (0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf)
- USDbC (0x9506a02b003d7a7eaf86579863a29601528ca0be)
- cbETH (0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22)
- wstETH (0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452)
- weETH (0x04c0599ae5a44757c0af6f9ec3b93da8976c150a)
- AAVE (0x63706e401c06ac8513145b7687a14804d17f814b)
- EURC (0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42)
- GHO (0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee)

## Monitoring

### Key Metrics

Check Prometheus metrics to verify the fix is working:

```
# RPC budget health
liquidbot_rpc_budget_tokens_current    # Should stay above 0
liquidbot_rpc_budget_queue_length       # Should stay low (< 10)
liquidbot_rpc_budget_acquired_total     # Steady increase
liquidbot_rpc_budget_avg_wait_ms        # Should be low (< 100ms)

# Provider health
liquidbot_rpc_provider_errors_total{type="429_rate_limit"}  # Should be 0 or decreasing
liquidbot_rpc_provider_cooldown_active                       # Should be 0 most of the time
```

### Log Indicators

**Good** (normal operation):
```
[rpc-budget] Initialized: capacity=100, refillRate=50/sec
[reserve-coalescer] Coalesced 3 events for reserve 0x... (debounce=80ms)
[token-metadata-registry] Fetched on-chain: 0x... -> cbBTC (8 decimals)
```

**Warning** (throttling detected but handled):
```
[rpc-client] [eth_call] https://***:443: RPC 429 rate limit hit (attempt 1/3), provider in cooldown for 30000ms
```

**Critical** (needs attention):
```
[rpc-client] All providers are in cooldown or unavailable
```

## Troubleshooting

### Still seeing 429 errors?

1. **Check your Alchemy tier**: Free tier is insufficient for production
2. **Lower RPC_BUDGET_CU_PER_SEC**: Start at 50% of your plan's limit
3. **Add SECONDARY_HEAD_RPC_URL**: Use a different provider as backup
4. **Reduce RESERVE_RECHECK_TOP_N**: Try 150-200
5. **Check concurrent services**: Other apps using the same API key?

### High RPC budget queue length?

Indicates demand exceeds capacity:

```bash
# Increase refill rate if you have headroom
RPC_BUDGET_CU_PER_SEC=75  # From 50

# Or reduce demand
RESERVE_RECHECK_TOP_N=200  # From 300
MICRO_VERIFY_MAX_PER_BLOCK=15  # From 25
```

### Metadata still missing for custom tokens?

Add them to `src/metadata/token-metadata-overrides.ts`:

```typescript
{
  address: '0x...'.toLowerCase(),
  symbol: 'TOKEN',
  decimals: 18,
  name: 'Token Name'
}
```

### Slow response times?

Check metrics:
- `liquidbot_rpc_budget_avg_wait_ms` > 500ms: Increase budget or reduce demand
- `liquidbot_rpc_provider_errors_total{type="timeout"}` high: Add secondary RPC

## Rolling Back

If you need to revert:

1. Checkout previous commit before this hotfix
2. Rebuild: `npm run build`
3. Restart service

**Note**: This is NOT recommended as it will re-introduce throttling issues.

## Future Improvements

Planned for next iteration:

1. **Dynamic budget adjustment**: Auto-tune based on 429 rate
2. **Per-method budgeting**: Different limits for eth_call vs getLogs
3. **Multicall optimization**: Reduce total call count via batching
4. **Predictive micro-verify gating**: Only urgent candidates (ETA < 30s)
5. **WebSocket heartbeat**: Better reconnection logic

## Support

If you encounter issues:

1. Check logs for structured errors
2. Review Prometheus metrics
3. Verify env configuration matches your Alchemy tier
4. Open an issue with:
   - Alchemy tier
   - Relevant env vars (redact keys)
   - Log snippets showing the issue
   - Metric snapshots

## References

- PR #152: Predictive Orchestrator wiring
- Alchemy Compute Units: https://docs.alchemy.com/docs/compute-units
- Token Bucket Algorithm: https://en.wikipedia.org/wiki/Token_bucket
