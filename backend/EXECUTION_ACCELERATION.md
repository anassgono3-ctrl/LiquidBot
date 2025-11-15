# Execution Path Acceleration

This document describes the execution path acceleration features designed to reduce end-to-end decision latency from health factor breach to transaction broadcast on Base network.

## Overview

The execution acceleration system implements several optimization techniques:

1. **Fast HF Delta Predictor** - Predicts users trending toward liquidation
2. **Optimistic Pre-Simulation Cache** - Pre-computes liquidation plans for hot users
3. **Collateral Price Snapshot Coalescing** - Ensures consistent per-block pricing
4. **Multi-Provider Read Hedge** - Parallels primary/secondary RPC calls
5. **Pre-Warmed Allowances** - Checks and manages token approvals
6. **Gas Strategy** - Maintains pre-computed gas tip ladder
7. **Optimized Guard Order** - Reorders decision guards for efficiency

## Configuration

### Environment Variables

#### Pre-Simulation Settings

```bash
# Enable pre-simulation and caching (default: true)
PRE_SIM_ENABLED=true

# HF window for pre-simulation queueing (default: 1.01)
# Users projected to reach this HF are queued
PRE_SIM_HF_WINDOW=1.01

# Minimum debt USD to qualify for pre-sim (default: 100)
PRE_SIM_MIN_DEBT_USD=100

# Cache TTL in blocks (default: 2)
PRE_SIM_CACHE_TTL_BLOCKS=2
```

#### Gas Ladder Settings

```bash
# Enable gas ladder (default: true)
GAS_LADDER_ENABLED=true

# Fast tip in Gwei (default: 5)
GAS_LADDER_FAST_TIP_GWEI=5

# Mid tip in Gwei (default: 3)
GAS_LADDER_MID_TIP_GWEI=3

# Safe tip in Gwei (default: 2)
GAS_LADDER_SAFE_TIP_GWEI=2
```

#### Approvals Settings

```bash
# Auto-send approval transactions (default: false, safe)
# When false, only logs what would be done (dry-run)
APPROVALS_AUTO_SEND=false
```

#### Multi-Provider Hedge Settings

```bash
# Secondary RPC URL for hedged reads
SECONDARY_HEAD_RPC_URL=https://your-secondary-rpc.com

# Delay before firing secondary request in ms (default: 300)
HEAD_CHECK_HEDGE_MS=300
```

## Features

### 1. Fast HF Delta Predictor

Tracks rolling ΔHF/Δblock for each user (N=4 observations) to predict health factor trajectory.

**How it works:**
- Maintains 4-observation history per user
- Computes ΔHF/Δblock slope
- Projects HF for next block
- Queues users with projected HF < 1.001 and debt ≥ MIN_DEBT_USD

**Logs:**
```
[pre-sim] queued user=0x1234... hf=1.0050 proj=0.9998 debt=$1500.00
```

### 2. Optimistic Pre-Simulation Cache

LRU cache for pre-computed liquidation plans with 2-block TTL.

**Cache key:** `(user, debtAsset, collateralAsset, blockTag)`

**Metrics:**
- `liquidbot_pre_sim_cache_hit_total` - Cache hits
- `liquidbot_pre_sim_cache_miss_total` - Cache misses
- `liquidbot_pre_sim_latency_ms` - Computation latency

### 3. Collateral Price Snapshot Coalescing

Guarantees one price resolution per symbol per blockTag for consistency.

**Usage:**
```typescript
const price = await priceService.getPriceAtBlock('WETH', blockNumber);
```

**Metrics:**
- `liquidbot_price_per_block_coalesced_total{symbol}` - Coalescing usage

### 4. Multi-Provider Read Hedge

Races primary RPC against secondary after configured delay.

**Operations hedged:**
- `getUserAccountData`
- Health factor reads
- Critical multicalls (last page)

**Logs:**
```
[hedge] fired op=getUserAccountData primaryLatency=350ms winner=primary
[hedge] fired op=multicall3 primaryLatency=520ms winner=secondary
```

**Metrics:**
- `liquidbot_hedge_fired_total{operation}` - Hedge triggers
- `liquidbot_hedge_winner_secondary_total{operation}` - Secondary wins

### 5. Pre-Warmed Allowances

Monitors ERC20 allowances for repay tokens on startup and periodically.

**Default tokens:**
- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- EURC: `0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42`
- WETH: `0x4200000000000000000000000000000000000006`
- cbETH: `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22`

**Logs:**
```
[approvals] ok token=USDC current=1000000000000
[approvals] needed token=WETH current=0 required=1000000000000000000000000
[approvals] dry-run token=WETH (APPROVALS_AUTO_SEND=false)
```

### 6. Gas Strategy

Maintains pre-computed gas tip ladder updated each block.

**Plans:**
- **Fast**: 5 Gwei tip (for competitive liquidations)
- **Mid**: 3 Gwei tip (for normal operations)
- **Safe**: 2 Gwei tip (for non-urgent transactions)

**Usage:**
```typescript
const { maxFeePerGas, maxPriorityFeePerGas, plan } = gasLadder.getGasPlan('fast');
```

**Logs:**
```
[gas] plan=fast base=0.05 tip=5
```

## Smoke Test

Run the smoke test to validate acceleration features:

```bash
cd backend
npm run accel:smoke
```

### Test Coverage

The smoke test validates:
1. Pre-sim cache hit rate ≥ 60%
2. Average decision latency < 450ms
3. Gas ladder fast > mid > safe ordering
4. Hedged provider operation
5. Per-block price coalescing
6. Metrics availability

### Success Criteria

```
✓ Pre-sim cache hit rate: 100.0% (target: ≥60%)
✓ Average decision latency: 15.43ms (target: <450ms)
✓ Gas plans ordered correctly
✓ Hedged calls working
✓ Price coalescing functional
✓ Metrics registered
```

### Custom Borrowers

Provide custom addresses via environment:

```bash
SMOKE_TEST_BORROWERS=0xabc...,0xdef...,0x123... npm run accel:smoke
```

## Monitoring

### Key Metrics

Monitor these Prometheus metrics:

```
# Pre-simulation
liquidbot_pre_sim_cache_hit_total
liquidbot_pre_sim_cache_miss_total
liquidbot_pre_sim_latency_ms

# Price coalescing
liquidbot_price_per_block_coalesced_total{symbol}

# Hedge performance
liquidbot_hedge_fired_total{operation}
liquidbot_hedge_winner_secondary_total{operation}
```

### Dashboard Queries

**Pre-sim cache hit rate:**
```promql
rate(liquidbot_pre_sim_cache_hit_total[5m]) / 
  (rate(liquidbot_pre_sim_cache_hit_total[5m]) + 
   rate(liquidbot_pre_sim_cache_miss_total[5m]))
```

**Hedge win rate (secondary):**
```promql
rate(liquidbot_hedge_winner_secondary_total[5m]) / 
  rate(liquidbot_hedge_fired_total[5m])
```

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Pre-sim cache hit rate | ≥ 60% | For hot users |
| Decision latency | < 450ms | Average end-to-end |
| Hedge trigger rate | < 20% | Primary should be fast enough |
| Price coalesce savings | > 30% | Reduced redundant calls |

## Troubleshooting

### Low cache hit rate

**Symptoms:** Pre-sim cache hit rate < 60%

**Solutions:**
1. Increase `PRE_SIM_CACHE_TTL_BLOCKS` (but watch staleness)
2. Lower `PRE_SIM_HF_WINDOW` to queue more users
3. Check if hot users are actually crossing the threshold

### High hedge usage

**Symptoms:** Hedge fires > 20% of calls

**Solutions:**
1. Primary RPC may be slow - upgrade tier
2. Increase `HEAD_CHECK_HEDGE_MS` to give primary more time
3. Check network/firewall issues

### High decision latency

**Symptoms:** Average latency > 450ms

**Solutions:**
1. Enable pre-sim cache: `PRE_SIM_ENABLED=true`
2. Use secondary RPC for hedging
3. Reduce `MULTICALL_BATCH_SIZE` if timeouts occur
4. Check RPC provider performance

## Safety

### Dry-Run Mode

By default, the system runs in dry-run mode:

- **APPROVALS_AUTO_SEND=false**: Only logs needed approvals
- **DRY_RUN_EXECUTION=true**: Simulates but doesn't send transactions

### Production Checklist

Before enabling in production:

- [ ] Configure reliable primary and secondary RPCs
- [ ] Test with `APPROVALS_AUTO_SEND=false` first
- [ ] Verify pre-sim queue size is reasonable (<1000)
- [ ] Monitor hedge metrics to ensure secondary isn't winning too often
- [ ] Set appropriate gas ladder tips for network conditions
- [ ] Test smoke script passes consistently

## Architecture

```
┌─────────────────────────────────────────────────────┐
│         RealTimeHFService (HF Monitoring)           │
│  - Tracks ΔHF/Δblock per user (N=4 observations)   │
│  - Projects HF_next and queues for pre-sim         │
│  - Uses HedgedProvider for health checks           │
└──────────────────┬──────────────────────────────────┘
                   │
                   │ liquidatable event
                   ↓
┌─────────────────────────────────────────────────────┐
│         ExecutionService (Decision Engine)          │
│  - Checks PreSimCache for hot users                │
│  - Uses GasLadder for fast gas pricing             │
│  - Validates guards in optimized order             │
└──────────────────┬──────────────────────────────────┘
                   │
                   │ decision
                   ↓
┌─────────────────────────────────────────────────────┐
│              Transaction Broadcast                  │
│  - PrivateTxSender for MEV protection              │
│  - Pre-warmed approvals (AllowanceChecker)         │
└─────────────────────────────────────────────────────┘
```

## References

- [Base Network Documentation](https://docs.base.org/)
- [Aave V3 Liquidations](https://docs.aave.com/developers/guides/liquidations)
- [EIP-1559 Gas Market](https://eips.ethereum.org/EIPS/eip-1559)
