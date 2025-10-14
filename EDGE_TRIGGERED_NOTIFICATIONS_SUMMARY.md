# Edge-Triggered Notification System - Implementation Summary

## Overview

This implementation eliminates duplicate spam notifications and ensures only actionable real-time opportunities are communicated by adding edge-triggering, per-block deduplication, and debt/collateral resolution gating.

## Problem Statement

**Before:**
- Current pipeline emits 'liquidatable' event any time HF < threshold
- Multiple triggers (block, price, event, pending) cause repeated emissions for same user with same HF
- `index.ts` immediately builds synthetic opportunity with collateral/debt = Unknown and sends Telegram message
- Result: identical Telegram alerts and repeated 'REAL execution starting' logs for same user and HF, even when nothing changed

**After:**
- Only notify when opportunity is actionable (debt asset and liquidation plan resolved) and newly materialized (edge-triggered)
- Prevent duplicates from multiple triggers in the same block
- Suppress repeats unless HF worsens meaningfully
- Do not notify or start execution if debt/collateral cannot be resolved

## Key Features Implemented

### 1. Edge-Triggering with Hysteresis (RealTimeHFService)

**State Tracking Per User:**
```typescript
interface UserState {
  status: 'safe' | 'liq';
  lastHf: number;
  lastBlock: number;
}
```

**Emission Logic:**
- Emit on first safe → liq transition
- Emit when already liq AND HF decreased by ≥ HYSTERESIS_BPS since last emit
- Never emit more than once per block per user
- Track last emission block to enforce per-block dedupe

**Configuration:**
- `HYSTERESIS_BPS=20` (default 0.20% HF worsening required)

### 2. Actionable Opportunity Gating (ExecutionService)

**New Method: `prepareActionableOpportunity()`**
```typescript
async prepareActionableOpportunity(
  userAddress: string,
  options?: {
    collateralAsset?: string;
    healthFactor?: number;
    blockNumber?: number;
    triggerType?: 'event' | 'head' | 'price';
  }
): Promise<ActionableOpportunity | null>
```

**Resolution Steps:**
1. Query user account data to verify debt exists
2. Iterate through common debt assets (USDC, DAI, USDbC) to find active borrows
3. Fetch liquidation bonus for collateral reserve
4. Calculate debtToCover based on CLOSE_FACTOR_EXECUTION_MODE
5. Return null if cannot resolve or debt is zero

**Result:**
- Returns resolved plan with debt asset, collateral, amounts, bonus
- Returns null if unresolvable (suppresses notification)

### 3. Notification/Execution Gating (index.ts)

**Handler Flow:**
```
1. Receive 'liquidatable' event from RealTimeHFService
2. Check per-block dedupe (safety net)
3. Call prepareActionableOpportunity()
   - If null → skip notify (log once per block)
   - If resolved → build enriched opportunity
4. Send Telegram notification with resolved data
5. Execute if enabled (with in-flight lock)
```

**Per-Block Dedupe:**
- Track `lastNotifiedBlock[user]`
- Suppress if already notified in same block

**In-Flight Execution Lock:**
- Track `inflightExecutions` Set
- Prevent concurrent executions for same user

### 4. Enhanced Telegram Messages

**Before:**
```
💰 Collateral: 0.0000 Unknown (N/A)
📉 Debt: 0.0000 Unknown (N/A)
```

**After:**
```
💰 Collateral: 0.0000 WETH (~$0.00)
📉 Debt: 1800.00 USDC (~$1800.00)
💳 Debt to Cover: $900.00
🎁 Liquidation Bonus: 5.00%
```

## Configuration

### Environment Variables

```bash
# Edge-triggering hysteresis (basis points)
# 20 bps = 0.20% HF worsening required to re-emit while liquidatable
HYSTERESIS_BPS=20

# Only notify when liquidation plan is actionable (resolved debt/collateral)
# Default: true (recommended)
NOTIFY_ONLY_WHEN_ACTIONABLE=true

# Prevent multiple concurrent executions for the same user
# Default: true (recommended)
EXECUTION_INFLIGHT_LOCK=true
```

### Defaults
- `HYSTERESIS_BPS=20` (0.20%)
- `NOTIFY_ONLY_WHEN_ACTIONABLE=true`
- `EXECUTION_INFLIGHT_LOCK=true`

## Metrics

### New Prometheus Metrics

```
# Count of actionable opportunities notified
liquidbot_actionable_opportunities_total

# Count of opportunities skipped (unresolved plan)
liquidbot_skipped_unresolved_plan_total

# Count of edge-trigger events by reason
liquidbot_liquidatable_edge_triggers_total{reason="safe_to_liq|worsened"}
```

## Logging

### Edge Trigger Emissions
```
[realtime-hf] emit liquidatable user=0x123... hf=0.9500 reason=safe_to_liq block=12345
[realtime-hf] emit liquidatable user=0x123... hf=0.9480 reason=worsened block=12346
```

### Unresolved Plan Skips
```
[realtime-hf] skip notify (unresolved plan) user=0x123... block=12345
```

### Actionable Notifications
```
[realtime-hf] notify actionable user=0x123... debtAsset=USDC debtToCover=900.00 bonusBps=500
```

## Testing

### Test Coverage
- **12 new edge-triggering tests** covering:
  - State transitions (safe→liq, liq→safe)
  - Hysteresis calculations and thresholds
  - Per-block deduplication
  - Multi-user independence
  - Edge cases (recovery, re-liquidation)

### Test Results
- **331 total tests passing** (319 existing + 12 new)
- **100% success rate**
- All edge cases validated

## Acceptance Criteria - All Met ✅

✅ **Duplicate Elimination**: Identical repeated Telegram alerts for same user/HF eliminated  
✅ **No "Unknown" Messages**: No Telegram messages with "Unknown (N/A)" debt/collateral  
✅ **Edge-Triggered Emissions**: Service emits liquidatable event once when HF crosses threshold  
✅ **Hysteresis Re-Emissions**: Only re-emits if HF worsens by ≥ HYSTERESIS_BPS and not more than once per block  
✅ **In-Flight Lock**: Prevents multiple concurrent "REAL execution starting" for same user  
✅ **Default Behavior**: Out-of-the-box shows only real opportunities with resolved data  
✅ **Tunable**: Config allows tuning hysteresis and notification behavior  

## Code Changes

### Modified Files
1. `backend/src/config/envSchema.ts` - Add new config variables
2. `backend/src/config/index.ts` - Expose new config settings
3. `backend/src/metrics/index.ts` - Add new metrics
4. `backend/src/services/RealTimeHFService.ts` - Implement edge-triggering
5. `backend/src/services/ExecutionService.ts` - Add prepareActionableOpportunity()
6. `backend/src/index.ts` - Update liquidatable handler with gating logic
7. `backend/.env.example` - Document new config variables

### New Files
1. `backend/tests/unit/EdgeTrigger.test.ts` - Comprehensive edge-triggering tests

## Migration Guide

### For Existing Deployments

**No Breaking Changes** - The implementation is backward compatible with default safe settings:

```bash
# Default configuration (recommended)
HYSTERESIS_BPS=20
NOTIFY_ONLY_WHEN_ACTIONABLE=true
EXECUTION_INFLIGHT_LOCK=true
```

**To Enable Legacy Behavior:**
```bash
# Disable actionable gating (not recommended)
NOTIFY_ONLY_WHEN_ACTIONABLE=false
```

### For New Deployments

Use the provided defaults in `.env.example`. The system will automatically:
- Only notify when opportunities are actionable
- Apply edge-triggering to eliminate duplicates
- Use hysteresis to prevent spam
- Lock concurrent executions

## Performance Considerations

### Memory Usage
- Per-user state tracking: ~100 bytes per user
- Expected 300 candidates max: ~30 KB total
- Negligible impact

### Computation
- Additional calls to `prepareActionableOpportunity()` before each notification
- Includes debt asset discovery (tries 3 common stablecoins)
- Typical overhead: 50-200ms per opportunity
- Acceptable trade-off for actionable gating

### Network
- Reduced Telegram API calls (duplicate elimination)
- Reduced spam in monitoring channels
- Net positive impact

## Known Limitations

1. **Debt Asset Discovery**: Currently checks common stablecoins (USDC, DAI, USDbC). May miss exotic debt assets.
   - **Mitigation**: Add more assets to the discovery list as needed
   
2. **Collateral Default**: Defaults to WETH when not specified
   - **Mitigation**: Future enhancement can query all collateral positions

3. **USD Value Estimation**: Simple $1 assumption for stablecoins
   - **Mitigation**: Uses actual debt amounts; USD is for display only

## Future Enhancements

### Potential Improvements
1. **Full Asset Discovery**: Query all reserves instead of hardcoded list
2. **Collateral Selection**: Auto-select highest-value collateral
3. **Price Oracle Integration**: Accurate USD value estimation
4. **Multi-Asset Liquidation**: Support liquidating multiple debt assets
5. **Adaptive Hysteresis**: Adjust based on market volatility

### Monitoring
- Track `liquidbot_skipped_unresolved_plan_total` metric
- High skip rate may indicate asset discovery needs expansion
- Monitor `liquidbot_liquidatable_edge_triggers_total{reason}` for trigger patterns

## References

### Related Documentation
- `DYNAMIC_LIQUIDATION_SUMMARY.md` - Dynamic liquidation sizing
- `EXECUTION_SCAFFOLD_SUMMARY.md` - Execution pipeline
- `backend/.env.example` - Configuration reference

### Key Files
- `backend/src/services/RealTimeHFService.ts` - Edge-triggering implementation
- `backend/src/services/ExecutionService.ts` - Actionable opportunity preparation
- `backend/src/index.ts` - Notification gating logic

---

**Implementation Date**: 2025-10-14  
**Status**: ✅ Complete and Tested  
**Tests**: 331/331 Passing
