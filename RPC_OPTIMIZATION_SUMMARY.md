# RPC Optimization & Duplicate Scan Elimination - Implementation Summary

## Problem Statement

After PR #152 introduced predictive orchestration and fast-path features, RPC consumption increased dramatically. Production logs showed:

1. **Duplicate concurrent chunking** per block:
   ```
   [realtime-hf] run=unknown block=... Chunking 532 calls into batches of 150  (twice)
   Followed by parallel "Chunk 1/4 complete…" lines duplicated a second time
   ```

2. **Missing config fields** causing TypeScript errors:
   - `config.predictiveNearOnly`
   - `config.predictiveNearBandBps`
   - `config.reserveMinIndexDeltaBps`

3. **Excessive scanning** even when:
   - Reserve index deltas were negligible (sub-bps noise)
   - Users were far from liquidation threshold (HF ~1.17)
   - Same trigger fired multiple times per block

## Solution Overview

This PR implements a comprehensive fix with minimal code changes:

### 1. Scan Concurrency Control (NEW)

**File**: `backend/src/services/ScanConcurrencyController.ts`

A lightweight lock/lease mechanism that prevents duplicate concurrent scans:

- **Lock Key**: `{triggerType}:{blockNumber}:{reserve}`
- **Timeout**: 30 seconds (auto-expires stale locks)
- **Integration**: Wraps `RealTimeHFService.batchCheckCandidates`

**Impact**:
- Eliminates duplicate "Chunking X calls" logs
- Prevents overlapping price-trigger scans on same block
- Allows different trigger types to run concurrently (head vs price vs reserve)

### 2. Enhanced Metrics (NEW)

**File**: `backend/src/metrics/index.ts`

Three new Prometheus counters track RPC optimization:

```typescript
scansSuppressedByLock           // Duplicate scans prevented
scansSuppressedByDeltaGate      // Reserve scans below threshold
predictiveEnqueuesSkippedByBand // Far-from-liquidation users skipped
```

**Usage**:
- Track effectiveness of optimization
- Monitor for over-aggressive suppression
- Dashboard alerts if suppression rate too high

### 3. Configuration (VERIFIED + ENHANCED)

**Files**: 
- `backend/src/config/index.ts` (already has all fields)
- `backend/src/config/envSchema.ts` (already has all fields)
- `backend/.env.example` (updated with recommendations)

**Verified Existing Config**:
- ✅ `predictiveNearOnly` (default: true)
- ✅ `predictiveNearBandBps` (default: 30)
- ✅ `reserveMinIndexDeltaBps` (default: 2)

**Added to .env.example**:
```env
# Per-asset price trigger thresholds (USDC stable, needs higher threshold)
PRICE_TRIGGER_BPS_BY_ASSET=WETH:8,USDC:60
PRICE_TRIGGER_DEBOUNCE_BY_ASSET=WETH:6,USDC:20

# Recommended: Drop "extreme" scenario to reduce RPC load
PREDICTIVE_SCENARIOS=baseline,adverse

# Already present defaults (documented for clarity)
PREDICTIVE_NEAR_ONLY=true
PREDICTIVE_NEAR_BAND_BPS=30
RESERVE_MIN_INDEX_DELTA_BPS=2
INDEX_JUMP_BPS_TRIGGER=3
HF_PRED_CRITICAL=1.0008
```

### 4. Integration Points

#### RealTimeHFService.ts
```typescript
// Before batchCheckCandidates processes users
const lockAcquired = this.scanConcurrencyController.tryAcquireLock(triggerType, blockNumber);
if (!lockAcquired) {
  scansSuppressedByLock.inc({ trigger_type: triggerType });
  console.log(`[scan-suppress] type=${triggerType} block=${blockNumber} reason=in_flight`);
  return;
}

// After processing (success or error)
finally {
  this.scanConcurrencyController.releaseLock(triggerType, blockNumber);
}
```

#### Reserve Index Delta Gating
```typescript
if (!shouldRecheck) {
  scansSuppressedByDeltaGate.inc({ asset: assetSymbol });
  console.log(`[reserve-skip] asset=${assetSymbol} reason=delta_below_threshold`);
  return;
}
```

#### PredictiveOrchestrator.ts
```typescript
if (config.predictiveNearOnly && !this.isInNearLiquidationBand(candidate)) {
  predictiveEnqueuesSkippedByBand.inc({ scenario: candidate.scenario });
  console.log(`[predictive-skip] user=${user} reason=hf_not_near_band`);
  return;
}
```

## Testing

### Unit Tests

1. **ScanConcurrencyController.test.ts** (10 tests)
   - Lock acquisition/release
   - Duplicate prevention per trigger type
   - Different blocks/reserves allowed
   - Stale lock expiration
   - In-flight detection

2. **RpcOptimizationConfig.test.ts** (7 tests)
   - All config fields exist and accessible
   - Correct types (boolean, number)
   - Optional per-asset configs

### Test Results
```
✓ tests/unit/ScanConcurrencyController.test.ts  (10 tests) 6ms
✓ tests/unit/RpcOptimizationConfig.test.ts      (7 tests)  4ms
✓ TypeScript compilation: 0 errors
✓ CodeQL security scan: 0 alerts
```

## Expected Behavior Changes

### Before (Observed in Logs)
```
[realtime-hf] run=123 block=45678 Chunking 532 calls into batches of 150
[realtime-hf] Chunk 1/4 complete (150 calls, 0.82s)
[realtime-hf] Chunk 2/4 complete (150 calls, 0.91s)
[realtime-hf] run=124 block=45678 Chunking 532 calls into batches of 150  ← DUPLICATE
[realtime-hf] Chunk 1/4 complete (150 calls, 0.79s)                      ← DUPLICATE
...
```

### After (Expected)
```
[realtime-hf] run=123 block=45678 Chunking 532 calls into batches of 150
[realtime-hf] Chunk 1/4 complete (150 calls, 0.82s)
[scan-suppress] type=price block=45678 reason=in_flight addresses=532  ← PREVENTED
[realtime-hf] Chunk 2/4 complete (150 calls, 0.91s)
[realtime-hf] Chunk 3/4 complete (150 calls, 0.88s)
[realtime-hf] Chunk 4/4 complete (82 calls, 0.44s)
```

### Reserve Index Gating
```
[reserve-index-delta] reserve=0xabc asset=USDC liquidityDelta=0.8bps maxDelta=0.8bps
[reserve-skip] asset=USDC reason=delta_below_threshold (< 2bps)
scansSuppressedByDeltaGate{asset="USDC"} += 1
```

### Predictive Near-Band Filtering
```
[predictive-skip] user=0xdef... scenario=adverse hfCurrent=1.1700 hfProjected=1.1500 reason=hf_not_near_band
predictiveEnqueuesSkippedByBand{scenario="adverse"} += 1
```

## Performance Impact

### RPC Request Reduction (Estimated)

| Optimization | Reduction | Scenario |
|-------------|-----------|----------|
| Duplicate scan prevention | 50% | Two price-trigger scans → One |
| Reserve delta gating | 30-40% | Skip <2bps noise on stables |
| Predictive near-band | 40-60% | Skip HF > 1.03 users |
| **Combined** | **~60-75%** | Compound effect |

### Metrics to Monitor

1. **scansSuppressedByLock**: Should be 1-5% of total scans (not too high)
2. **scansSuppressedByDeltaGate**: High for stables (USDC, DAI), low for volatiles (WETH)
3. **predictiveEnqueuesSkippedByBand**: Should be 40-60% of total candidates

## Rollback Plan

If RPC reduction is too aggressive and misses liquidations:

1. **Disable concurrency control**: Remove lock checks (revert to duplicate scans)
2. **Lower delta threshold**: Set `RESERVE_MIN_INDEX_DELTA_BPS=1` (half current)
3. **Widen near-band**: Set `PREDICTIVE_NEAR_BAND_BPS=50` (was 30)
4. **Re-enable extreme**: Add back `PREDICTIVE_SCENARIOS=baseline,adverse,extreme`

## Files Changed

### Core Implementation
- `backend/src/services/ScanConcurrencyController.ts` (NEW - 132 lines)
- `backend/src/services/RealTimeHFService.ts` (+28 lines)
- `backend/src/risk/PredictiveOrchestrator.ts` (+3 lines)
- `backend/src/metrics/index.ts` (+24 lines)

### Configuration & Tests
- `backend/.env.example` (+11 lines)
- `backend/tests/unit/ScanConcurrencyController.test.ts` (NEW - 99 lines)
- `backend/tests/unit/RpcOptimizationConfig.test.ts` (NEW - 41 lines)

### Total Impact
- **Lines Added**: ~338
- **Lines Modified**: ~31
- **Files Changed**: 7
- **New Files**: 3

## Validation Checklist

- [x] TypeScript compilation passes (0 errors)
- [x] All unit tests pass (17/17)
- [x] CodeQL security scan clean (0 alerts)
- [x] Config fields verified accessible
- [x] Metrics exportable to Prometheus
- [x] Logging markers present in code
- [x] .env.example updated with recommendations
- [x] No breaking changes to existing API

## Follow-up Recommendations

### Phase 2 (Future)
1. **WS Health Backoff**: Add exponential backoff when ws_unhealthy appears
2. **Per-Reserve Concurrency**: Extend locks to support reserve-specific gates
3. **Dynamic Thresholds**: Auto-adjust deltaBps based on asset volatility
4. **Dashboard**: Grafana dashboard for new suppression metrics

### Monitoring (First Week)
1. Watch for missed liquidations (compare to baseline)
2. Track RPC volume reduction (target: 50-70%)
3. Monitor suppression metrics (should be non-zero but not >80%)
4. Check for any new timeout patterns

## References

- Original Issue: PRs #152, #173, #174, #175
- Config Schema: `backend/src/config/envSchema.ts`
- Metrics Registry: `backend/src/metrics/index.ts`
- Service Integration: `backend/src/services/RealTimeHFService.ts`
