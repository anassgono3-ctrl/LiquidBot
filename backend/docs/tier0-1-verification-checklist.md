# Tier 0 + Tier 1 Performance Upgrades - Verification Checklist

This document describes the verification steps and acceptance criteria for the Tier 0 and Tier 1 performance upgrades to LiquidBot.

## Overview

These upgrades reduce health factor (HF) detection latency and improve liquidation race competitiveness through:
- **Tier 0**: Critical ordering & hygiene improvements (fast subsets, hedging optimization, post-liquidation refresh, address normalization)
- **Tier 1**: Predictive features & prioritization (index jump prediction, price shock handling, risk ordering)

## Configuration

All features are controlled via environment variables with safe defaults for immediate deployment:

```bash
# Tier 0 - Fast Subset Before Large Sweeps
RESERVE_FAST_SUBSET_SWEEP_DELAY_MS=80  # Delay large sweeps (default: 80ms)

# Tier 0 - Disable Hedging For Single Micro-Verifies
MICRO_VERIFY_HEDGE_FOR_SINGLE=false    # Skip hedging for single verifies (default: false)
MICRO_VERIFY_DEDICATED_RPC=            # Optional dedicated RPC endpoint

# Tier 0 - Post-Liquidation Refresh
POST_LIQUIDATION_REFRESH=true          # Sync refresh after liquidation (default: true)

# Tier 0 - Address Normalization
ADDRESS_NORMALIZE_LOWERCASE=true       # Enforce lowercase normalization (default: true)

# Tier 1 - Index Jump Prediction
INDEX_JUMP_BPS_TRIGGER=3               # Index jump threshold in bps (default: 3)
HF_PRED_CRITICAL=1.0008                # Critical HF threshold (default: 1.0008)

# Tier 1 - Risk Ordering
RISK_ORDERING_SIMPLE=true              # Enable risk-based ordering (default: true)
```

## Feature Verification

### 1. Fast Subset Before Large Sweeps

**Expected Behavior:**
- When a `ReserveDataUpdated` event occurs with near-threshold borrowers
- System computes intersection of near-threshold users and reserve borrowers
- Micro-verifies intersection users BEFORE large borrower sweep
- Large sweep delayed by `RESERVE_FAST_SUBSET_SWEEP_DELAY_MS`

**Log Signatures:**
```
[fast-lane] reserve_fast-intersection reserve=0x... size=5 nearThreshold=10 borrowers=100 verifying=5
[micro-verify] user=0x... trigger=reserve_fast latency=120ms hedged=false hf=1.0005 block=12345
[fast-lane] reserve_fast-intersection-complete reserve=0x... size=5 verified=5 durationMs=650
```

**Metrics:**
- `liquidbot_reserve_event_to_first_microverify_ms` histogram
- `liquidbot_subset_intersection_size` histogram
- `liquidbot_large_sweep_defer_ms` histogram

**Acceptance:**
- ✅ Intersection logs appear before `[reserve-recheck]` batch logs
- ✅ Micro-verify latency p50 ≤150ms, p95 ≤220ms
- ✅ Verified users excluded from subsequent large sweep

### 2. Disable Hedging For Single Micro-Verifies

**Expected Behavior:**
- Single-account micro-verifies skip hedging by default
- Hedging only used if `MICRO_VERIFY_HEDGE_FOR_SINGLE=true` OR trigger is not fast-lane
- Fast-lane triggers: `reserve_fast`, `index_jump`, `price_shock`, `liquidation_refresh`, `proj_cross`

**Log Signatures:**
```
[micro-verify] user=0x... trigger=reserve_fast latency=140ms hedged=false hf=1.0005
```

**Metrics:**
- `liquidbot_microverify_hedged_total` counter (should be low for fast-lane triggers)
- `liquidbot_micro_verify_latency_ms` histogram

**Acceptance:**
- ✅ Fast-lane micro-verifies show `hedged=false` in logs
- ✅ Micro-verify latency p50 ≤140ms, p95 ≤200ms
- ✅ Hedge rate <2% for single-account verifies

### 3. Post-Liquidation Refresh

**Expected Behavior:**
- On `LiquidationCall` event for watched user
- Synchronous `getUserAccountData` call at current block
- User HF updated immediately
- User removed from tracking if HF > exit margin or debt below minimum

**Log Signatures:**
```
[liquidation-refresh] user=0x... oldHf=0.98 newHf=1.15 removed=true latency=180ms
```

**Metrics:**
- `liquidbot_post_liquidation_refresh_ms` histogram

**Acceptance:**
- ✅ Liquidation-refresh log appears within 250ms of LiquidationCall event
- ✅ User disappears from `[pre-sim]` queue if cleared
- ✅ Stale entries removed within 1 block

### 4. Address Normalization

**Expected Behavior:**
- All address keys normalized to lowercase when `ADDRESS_NORMALIZE_LOWERCASE=true`
- Applies to: hot-set tracker, borrower index, watch sets, candidate manager
- Diagnostic warnings if intersection unexpectedly empty

**Log Signatures:**
```
[address-normalize] reserve_fast: intersection=0 but setA=10, setB=100. Possible normalization mismatch.
```

**Acceptance:**
- ✅ Mixed-case addresses matched consistently
- ✅ No diagnostic warnings under normal operation
- ✅ Intersection sizes match expected values

### 5. Index Jump Prediction

**Expected Behavior:**
- Track previous `variableBorrowIndex` and `liquidityIndex` per reserve
- On index update, calculate basis point delta
- If delta ≥ `INDEX_JUMP_BPS_TRIGGER`, predict HF for near-threshold borrowers
- Enqueue micro-verify if predicted HF < `HF_PRED_CRITICAL`

**Log Signatures:**
```
[predict] index-jump reserve=0x... user=0x... predHf=1.0007 deltaBps=5
[micro-verify] user=0x... trigger=index_jump latency=135ms hedged=false hf=1.0006
```

**Acceptance:**
- ✅ Index jumps ≥3 bps trigger predictions
- ✅ Predicted critical users get immediate micro-verify
- ✅ Prediction accuracy within reasonable bounds

### 6. Price Shock Subset Path

**Expected Behavior:**
- On sharp price drop event, apply same intersection logic as reserve events
- Micro-verify near-threshold users affected by price shock BEFORE full scan

**Log Signatures:**
```
[fast-lane] price_shock-intersection reserve=0x... size=8 nearThreshold=15 borrowers=120 verifying=8
[micro-verify] user=0x... trigger=price_shock latency=145ms hedged=false hf=0.9998
```

**Acceptance:**
- ✅ Price shock triggers fast subset path
- ✅ Critical users verified before full scan

### 7. Risk Ordering Enhancement

**Expected Behavior:**
- Near-threshold queue ordered by risk score when `RISK_ORDERING_SIMPLE=true`
- Score = w1*(1.0015 - hf) + w2*(hf - projHF) + w3*log10(debtUSD)
- Higher scores = higher priority

**Log Signatures:**
```
[risk-order] user=0x... score=15.2341 hf=1.0005 projHf=0.9998 debtUsd=5000.00
```

**Acceptance:**
- ✅ Queue ordered by descending score
- ✅ Users with lower HF and larger debt prioritized
- ✅ Worsening HF (HF - projHF) increases priority

## Rollback Procedures

All features can be disabled individually:

```bash
# Disable fast subset
RESERVE_FAST_SUBSET_MAX=0

# Re-enable hedging for single verifies
MICRO_VERIFY_HEDGE_FOR_SINGLE=true

# Disable post-liquidation refresh
POST_LIQUIDATION_REFRESH=false

# Disable address normalization (not recommended)
ADDRESS_NORMALIZE_LOWERCASE=false

# Disable index jump prediction
INDEX_JUMP_BPS_TRIGGER=999999

# Disable risk ordering
RISK_ORDERING_SIMPLE=false
```

## Performance KPIs

Monitor these metrics to validate improvements:

| Metric | Baseline | Target | Current |
|--------|----------|--------|---------|
| ReserveDataUpdated→first micro-verify | ~500-700ms | p50 ≤150ms, p95 ≤220ms | _TBD_ |
| Single-account micro-verify latency | 280-764ms | p50 ≤140ms, p95 ≤200ms | _TBD_ |
| Post-liquidation stale persistence | 2+ blocks | ≤250ms removal | _TBD_ |
| Large sweep start after reserve event | immediate | ≥60ms after subset | _TBD_ |
| Micro-verify hedge rate | ~100% | <2% | _TBD_ |

## Testing Checklist

- [ ] Unit tests pass for all new modules (Address, HFPredictor, RiskOrdering)
- [ ] Integration test: fast subset executes before large sweep
- [ ] Integration test: no hedging for fast-lane triggers
- [ ] Integration test: post-liquidation refresh removes cleared users
- [ ] Load test: system handles high event volume without degradation
- [ ] Rollback test: disabling features restores previous behavior

## Troubleshooting

### High Micro-Verify Latency
- Check `MICRO_VERIFY_DEDICATED_RPC` configuration
- Verify network connectivity to RPC endpoints
- Review `liquidbot_micro_verify_latency_ms` histogram

### Empty Intersections
- Check for address normalization warnings in logs
- Verify `ADDRESS_NORMALIZE_LOWERCASE=true`
- Inspect hot-set and borrower index sizes

### Missed Liquidations
- Review `[fast-lane]` and `[micro-verify]` logs
- Check if predictions are triggering correctly
- Verify risk ordering is enabled
- Monitor `liquidbot_reserve_event_to_first_microverify_ms`

## Support

For issues or questions:
1. Check logs for diagnostic messages
2. Review metrics dashboard
3. Consult this checklist
4. Contact development team with reproduction steps
