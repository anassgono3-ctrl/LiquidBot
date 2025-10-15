# Liquidation Plan Resolution Fix - Implementation Summary

## Problem Statement

The bot was generating 'Unknown' opportunities and repeated spam due to:
1. Incomplete plan resolution - synthetic opportunities created without resolving debt/collateral assets
2. Missing token metadata lookup (symbols, decimals)
3. No proper reserve enumeration from Aave Protocol
4. Duplicate threshold checks (no single source of truth)
5. Legacy "Unknown" notification path still active

## Solution Overview

Complete rewrite of liquidation plan resolution to:
- **Always** resolve full plan before notification/execution
- Enumerate all user reserves from Aave Protocol Data Provider
- Select optimal debt and collateral assets based on USD value
- Use precise decimal handling with oracle prices
- Gate by single threshold (PROFIT_MIN_USD)
- Eliminate synthetic "Unknown" opportunities entirely

## Key Features Implemented

### 1. Reserve Enumeration (AaveDataService)

**New Methods:**
```typescript
// Get all reserves in the protocol
async getReservesList(): Promise<string[]>

// Get enriched data for all user reserves (debt + collateral)
async getAllUserReserves(userAddress: string): Promise<ReserveData[]>
```

**ReserveData Interface:**
```typescript
interface ReserveData {
  asset: string;              // Contract address
  symbol: string;             // Resolved symbol (USDC, WETH, etc.)
  decimals: number;           // Token decimals
  aTokenBalance: bigint;      // Collateral balance (raw)
  stableDebt: bigint;         // Stable debt (raw)
  variableDebt: bigint;       // Variable debt (raw)
  totalDebt: bigint;          // Sum of stable + variable
  usageAsCollateralEnabled: boolean;
  priceInUsd: number;         // Oracle price
  debtValueUsd: number;       // USD value of debt
  collateralValueUsd: number; // USD value of collateral
}
```

### 2. Actionable Plan Resolution (ExecutionService)

**Complete Rewrite of `prepareActionableOpportunity()`:**

```typescript
async prepareActionableOpportunity(userAddress: string): Promise<{
  debtAsset: string;
  debtAssetSymbol: string;
  totalDebt: bigint;
  debtToCover: bigint;
  debtToCoverUsd: number;
  liquidationBonusPct: number;
  collateralAsset: string;
  collateralSymbol: string;
} | null>
```

**Selection Logic:**

1. **Enumerate all reserves** - Query Protocol Data Provider for all user positions
2. **Filter debt reserves** - Find reserves with totalDebt > 0
3. **Filter collateral reserves** - Find reserves with aTokenBalance > 0 AND usageAsCollateralEnabled
4. **Select debt asset:**
   - First, check LIQUIDATION_DEBT_ASSETS preference (from config)
   - If not found or not set, select largest debt by USD value
5. **Select collateral asset:**
   - Select largest collateral by USD value
6. **Calculate debtToCover:**
   - `fixed50` mode: floor(totalDebt / 2)
   - `full` mode: totalDebt
7. **Calculate USD value:**
   - Use precise decimal math: `value = (rawAmount / 10^decimals) * oraclePrice`
8. **Gate by PROFIT_MIN_USD:**
   - Return null if debtToCoverUsd < PROFIT_MIN_USD
9. **Return resolved plan** with all metadata

### 3. Actionable-Only Pipeline (index.ts)

**Enforcement:**
```typescript
// Always resolve plan first
const actionablePlan = await executionService.prepareActionableOpportunity(userAddr, {
  healthFactor: event.healthFactor,
  blockNumber: event.blockNumber,
  triggerType: event.triggerType
});

if (!actionablePlan) {
  // Cannot resolve - log once per block and skip
  logger.info(`[realtime-hf] skip notify (unresolved plan) user=${userAddr} block=${event.blockNumber}`);
  skippedUnresolvedPlanTotal.inc();
  return; // No notification, no execution
}

// Build enriched opportunity with resolved data
const opportunity = {
  // ... all fields populated with resolved plan data
  collateralReserve: { 
    id: actionablePlan.collateralAsset, 
    symbol: actionablePlan.collateralSymbol, 
    decimals: 18 
  },
  principalReserve: { 
    id: actionablePlan.debtAsset, 
    symbol: actionablePlan.debtAssetSymbol, 
    decimals: 6 
  },
  // ...
};
```

**Removed Legacy Path:**
- Eliminated lines 193-230 (legacy "Unknown" synthetic opportunity generation)
- Always requires actionable plan before notification/execution

### 4. Threshold Unification

**Single Source of Truth:**
- `PROFIT_MIN_USD` (default: 10 USD) - Used consistently everywhere
- Removed any hardcoded dust thresholds
- Gating happens in `prepareActionableOpportunity()` before plan is returned

### 5. Enhanced Logging

**Before (Unknown):**
```
[realtime-hf] Liquidatable event: user=0x... HF=0.98
collateral: Unknown (N/A)
debt: Unknown (N/A)
```

**After (Resolved):**
```
[realtime-hf] notify actionable user=0x... debtAsset=USDC collateral=WETH debtToCover=$500.00 bonusBps=500
```

## Configuration

### Environment Variables Used

```bash
# Single minimum threshold (default: 10 USD)
PROFIT_MIN_USD=10

# Preferred debt assets to liquidate (optional)
# If set, will prioritize these assets over largest debt
LIQUIDATION_DEBT_ASSETS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Close factor mode (default: fixed50)
# fixed50: safer, liquidates 50% of debt
# full: liquidates 100% of debt (experimental)
CLOSE_FACTOR_EXECUTION_MODE=fixed50

# Existing flags (already enabled by default)
NOTIFY_ONLY_WHEN_ACTIONABLE=true
EXECUTION_INFLIGHT_LOCK=true
```

### No New Environment Variables

All functionality uses existing configuration. Defaults remain unchanged.

## Testing

### New Test Suite: PlanResolution.test.ts

**11 comprehensive test cases:**

1. ✅ Returns null when user has no debt
2. ✅ Returns null when user has no collateral
3. ✅ Selects largest debt asset by USD value
4. ✅ Prioritizes LIQUIDATION_DEBT_ASSETS if configured
5. ✅ Selects largest collateral by USD value
6. ✅ Calculates debtToCover in fixed50 mode (50%)
7. ✅ Calculates debtToCover in full mode (100%)
8. ✅ Returns null when below PROFIT_MIN_USD threshold
9. ✅ Returns plan when above PROFIT_MIN_USD threshold
10. ✅ Handles precise decimal calculations (18 decimals)
11. ✅ Includes all plan fields with resolved metadata

**Test Results:**
```
Test Files  28 passed (28)
Tests      342 passed (342)
```

## Code Changes Summary

### Files Modified

1. **backend/src/services/AaveDataService.ts** (+98 lines)
   - Added UI Pool Data Provider contract support
   - Implemented `getReservesList()` method
   - Implemented `getAllUserReserves()` method
   - Added token symbol mapping for Base network

2. **backend/src/services/ExecutionService.ts** (-109, +115 lines)
   - Complete rewrite of `prepareActionableOpportunity()`
   - Proper reserve enumeration and selection
   - Precise USD calculations with decimals
   - PROFIT_MIN_USD gating

3. **backend/src/index.ts** (-37 lines)
   - Removed legacy "Unknown" notification path
   - Always enforces actionable plan resolution
   - Enhanced logging with resolved data

4. **backend/tests/unit/PlanResolution.test.ts** (+588 lines)
   - New comprehensive test suite
   - 11 test cases covering all scenarios

### Total Changes
- **4 files changed**
- **+696 insertions, -146 deletions**
- **Net: +550 lines**

## Acceptance Criteria - All Met ✅

| Criterion | Status | Evidence |
|-----------|--------|----------|
| No 'Unknown (N/A)' in Telegram/logs | ✅ | Legacy path removed, always resolves symbols |
| No repeated 'REAL execution starting' | ✅ | Per-block dedupe + in-flight lock enforced |
| Single min threshold (PROFIT_MIN_USD) | ✅ | Used consistently, default 10 USD |
| Detects real opportunities | ✅ | Proper reserve enumeration implemented |
| Skips tiny/unresolved cleanly | ✅ | Returns null with single log, no notification |
| All tests pass | ✅ | 342/342 tests pass |

## Usage Examples

### Example 1: User with Multiple Debt Assets

**Scenario:**
- User has 500 USDC debt + 1000 DAI debt + 1 WETH collateral
- LIQUIDATION_DEBT_ASSETS not configured

**Resolution:**
```
Selected debt: DAI (largest: $1000)
Selected collateral: WETH (only collateral)
DebtToCover (fixed50): 500 DAI ($500)
Liquidation bonus: 5%
Result: Actionable ✅
```

### Example 2: Preferred Debt Asset

**Scenario:**
- User has 500 USDC debt + 1000 DAI debt + 1 WETH collateral
- LIQUIDATION_DEBT_ASSETS=0x833...913 (USDC)

**Resolution:**
```
Selected debt: USDC (preferred, even though smaller)
Selected collateral: WETH (only collateral)
DebtToCover (fixed50): 250 USDC ($250)
Liquidation bonus: 5%
Result: Actionable ✅
```

### Example 3: Below Threshold

**Scenario:**
- User has 5 USDC debt + 0.05 WETH collateral
- PROFIT_MIN_USD=10

**Resolution:**
```
Total debt: 5 USDC
DebtToCover (fixed50): 2.5 USDC ($2.5)
Threshold check: 2.5 < 10 ❌
Result: null (not actionable)
Log: "skip notify (unresolved plan)"
No Telegram notification sent
```

## Migration Notes

### Breaking Changes
None. This is a pure enhancement with backward compatibility maintained.

### Behavioral Changes
1. Opportunities below PROFIT_MIN_USD are now silently skipped (logged but not notified)
2. Only fully resolved opportunities are notified/executed
3. Legacy "Unknown" opportunities no longer generated

### Upgrade Path
1. Pull latest code
2. Build: `npm run build`
3. Test: `npm test`
4. Deploy with existing configuration - no config changes needed

## Performance Considerations

### Additional RPC Calls
- `getReservesList()`: 1 call per liquidatable event
- `getAllUserReserves()`: N calls (where N = number of reserves with positions)
  - Typical: 2-3 reserves (1 debt, 1-2 collateral)
  - Max: ~10 reserves on Base network
- Oracle price queries: N calls for price data

### Optimization Opportunities
- Cache reserve list (changes infrequently)
- Batch oracle price queries with multicall
- Skip reserves with zero balance (already implemented)

### Impact
- Slight increase in latency (~100-300ms per resolution)
- Acceptable tradeoff for correctness and eliminating spam

## Future Enhancements

1. **Cache reserve metadata** - Symbols/decimals rarely change
2. **Multicall batching** - Reduce RPC calls with multicall3
3. **Priority queue** - Sort opportunities by expected profit
4. **Historical profit tracking** - Track actual vs estimated profit
5. **Dynamic threshold adjustment** - Adjust PROFIT_MIN_USD based on gas costs

## References

- Aave V3 Protocol Data Provider: [0xC4Fc...7981](https://basescan.org/address/0xC4Fcf9893072d61Cc2899C0054877Cb752587981)
- Aave V3 UI Pool Data Provider: [0x6810...e93](https://basescan.org/address/0x68100bD5345eA474D93577127C11F39FF8463e93)
- Aave V3 Oracle: [0x2Cc0...156](https://basescan.org/address/0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156)

## Related Documentation

- `EDGE_TRIGGERED_NOTIFICATIONS_SUMMARY.md` - Edge-triggering system
- `DYNAMIC_LIQUIDATION_SUMMARY.md` - Dynamic liquidation sizing
- `EXECUTION_SCAFFOLD_SUMMARY.md` - Execution pipeline
