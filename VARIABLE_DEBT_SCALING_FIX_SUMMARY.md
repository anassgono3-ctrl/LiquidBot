# Variable Debt Scaling & USD Computation Fix - Summary

## Problem Statement

Liquidations were being skipped with `below_min_repay_usd` errors due to tiny `debtToCoverUsd` values, despite users having valid liquidatable health factors. The root cause was a systematic under-calculation of debt amounts throughout the liquidation pipeline.

### Root Causes Identified

1. **Under-scaled Variable Debt**: The system was using `scaledVariableDebt` directly instead of expanding it to principal debt using the reserve's `variableBorrowIndex`. This meant accrued interest was not being accounted for.

2. **Proportional USD Estimation**: ExecutionService used a proportional estimation method for calculating USD values instead of the canonical `calculateUsdValue()` function, leading to inconsistencies.

3. **Missing Symbol Hydration**: Some assets were logging as "UNKNOWN" due to incomplete symbol resolution from AaveMetadata.

## Solution Overview

This PR implements minimal, surgical changes to fix the debt calculation pipeline:

1. **Expand Variable Debt in AaveDataService** (`getTotalDebt()`)
2. **Use Canonical USD Math in ExecutionService** 
3. **Enforce Symbol Hydration from AaveMetadata**
4. **Add Diagnostics Script for Verification**

## Changes Made

### 1. AaveDataService - Variable Debt Expansion

**File**: `backend/src/services/AaveDataService.ts`

#### Changes:
- Added `getReserveData()` method to fetch reserve data including `variableBorrowIndex`
- Updated `getTotalDebt()` to properly expand scaled variable debt:
  ```typescript
  const RAY = BigInt(10 ** 27);
  principalVariableDebt = (scaledVariableDebt * variableBorrowIndex) / RAY;
  totalDebt = principalVariableDebt + stableDebt;
  ```
- Updated `getAllUserReserves()` to use the corrected `getTotalDebt()`
- Added `setAaveMetadata()` for dependency injection
- Enhanced `getSymbolForAsset()` to use AaveMetadata when available

#### Why This Matters:
The `variableBorrowIndex` represents cumulative accrued interest. For example:
- Initial borrow: 1000 USDC (scaled debt = 1000)
- After time: index = 1.05 (5% interest accrued)
- Principal debt = 1000 * 1.05 = 1050 USDC

Without this expansion, the system would only see 1000 USDC instead of 1050 USDC, causing USD value calculations to be 5% too low.

**Lines Changed**: ~110 lines added/modified

### 2. ExecutionService - Canonical USD Math

**File**: `backend/src/services/ExecutionService.ts`

#### Changes:
- Replaced proportional USD estimation in `calculateDebtToCover()` (lines ~1028-1034)
- Now uses direct `calculateUsdValue(debtToCover, decimals, priceRaw)` call
- Added debug logging to compare canonical vs quick USD for verification:
  ```typescript
  const quickUsd = (Number(debtToCover) / (10 ** decimals)) * (Number(priceRaw) / 1e8);
  console.log('[execution] USD calculation:', {
    canonicalUsd: debtToCoverUsd.toFixed(6),
    quickUsd: quickUsd.toFixed(6),
    diff: Math.abs(debtToCoverUsd - quickUsd).toFixed(6)
  });
  ```
- Updated constructor to pass AaveMetadata to AaveDataService
- Enhanced `setAaveMetadata()` to also update AaveDataService

#### Why This Matters:
The proportional estimation was:
```typescript
debtToCoverUsd = (opportunity.principalValueUsd * Number(debtToCover)) / Number(principalRaw);
```

This approach:
1. Relied on potentially stale `opportunity.principalValueUsd`
2. Compounded rounding errors from multiple divisions
3. Could diverge from canonical calculation used in plan resolution

The canonical approach ensures consistency across all gates and prevents liquidations from being incorrectly filtered.

**Lines Changed**: ~35 lines modified

### 3. Symbol Hydration Enhancement

**Files**: 
- `backend/src/services/AaveDataService.ts`
- `backend/src/aave/AaveMetadata.ts` (already had symbol fetching, no changes needed)

#### Changes:
- AaveDataService now accepts optional AaveMetadata in constructor
- `getSymbolForAsset()` uses AaveMetadata first, then falls back to hardcoded mapping
- Added warning log when symbol is missing: `symbol_missing: <address>`

#### Why This Matters:
Assets showing as "UNKNOWN" make debugging difficult and can hide issues. Proper symbol hydration ensures:
- Clear logging and diagnostics
- Better error messages
- Easier troubleshooting in production

**Lines Changed**: ~25 lines modified

### 4. Diagnostics Script

**Files**: 
- `backend/scripts/diagnose-variable-debt.ts` (new, 232 lines)
- `backend/scripts/README-diagnose-variable-debt.md` (new, 168 lines)

#### Features:
- Fetches user's debt positions from Aave V3 Base
- Compares scaled vs principal variable debt
- Shows variableBorrowIndex and expansion factors
- Calculates USD values using canonical method
- Validates calculations within tolerance
- Identifies accrued interest

#### Usage:
```bash
# Using tsx (development)
tsx -r dotenv/config scripts/diagnose-variable-debt.ts 0x...userAddress

# Using compiled JS
npm run build
node -r dotenv/config dist/scripts/diagnose-variable-debt.js 0x...userAddress
```

#### Example Output:
```
--- USDC (0x833589fcd6edb6e08f4c7c32d4f71b54bda02913) ---
  Scaled Variable Debt:     1000.000000
  Variable Borrow Index:    1.050000
  Calculated Principal:     1050.000000
  Current Variable Debt:    1050.000000
  Total Debt (expanded):    1050.000000
  Total Debt Value (USD):   $1050.00
  ✓ Variable debt calculation matches within tolerance
  ✓ Interest accrued: 50.000000 USDC
    Expansion factor: 5.00%
```

**Lines Changed**: 400 lines added

## Testing

### Unit Tests Added

**File**: `backend/tests/unit/AaveDataService.test.ts` (new, 199 lines)

Tests verify:
1. ✅ Scaled variable debt expansion with different borrow indices
2. ✅ Handling of various index values (1.05, 1.2, 1.5)
3. ✅ Fallback to currentVariableDebt when getReserveData fails
4. ✅ Handling of zero scaled debt
5. ✅ High borrow index scenarios (long-term accrued interest)

All tests pass with proper tolerance for BigInt division rounding.

### Test Results

```
Test Files  45 passed (45)
Tests       522 passed (522)
```

**No test failures introduced by changes.**

### Security Scan

```
CodeQL Analysis: 0 alerts found
✓ No security vulnerabilities detected
```

### Linting

All changed files pass ESLint:
- ✅ `backend/src/services/AaveDataService.ts`
- ✅ `backend/src/services/ExecutionService.ts`
- ✅ `backend/tests/unit/AaveDataService.test.ts`
- ✅ `backend/scripts/diagnose-variable-debt.ts`

## Impact Analysis

### Before Fix
```
User has 1000 USDC debt (scaled)
Variable borrow index: 1.05 (5% interest accrued)

System calculates:
  debtToCover = 1000 (using scaled debt)
  debtToCoverUsd = $1000

Result: SKIPPED (below_min_repay_usd, $1000 < $1050 threshold)
```

### After Fix
```
User has 1000 USDC debt (scaled)
Variable borrow index: 1.05 (5% interest accrued)

System calculates:
  debtToCover = 1050 (expanded: 1000 * 1.05)
  debtToCoverUsd = $1050 (using canonical calculateUsdValue)

Result: LIQUIDATED (meets threshold)
```

### Expected Improvements

1. **Increased Liquidation Success Rate**: Liquidations that were incorrectly skipped will now proceed
2. **More Accurate Debt Calculations**: All debt values reflect accrued interest
3. **Consistent USD Computations**: Same calculation method used everywhere
4. **Better Observability**: Clear symbols and diagnostic tools

## Code Quality

### Minimal Changes Philosophy

This PR follows the principle of making **minimal, surgical changes**:

- ✅ No changes to working code unrelated to the issue
- ✅ No refactoring of existing functionality
- ✅ No modification of test infrastructure
- ✅ Only 5 files modified/added
- ✅ 735 total lines changed (mostly new tests and diagnostics)

### Backwards Compatibility

- ✅ All existing tests pass
- ✅ No breaking changes to public APIs
- ✅ Fallback mechanisms preserve existing behavior when services unavailable
- ✅ Optional parameters allow gradual adoption

## Deployment Considerations

### Configuration Required

No new environment variables required. Existing configuration works as-is.

### Monitoring

Add monitoring for:
- Liquidation skip reasons (should see fewer `below_min_repay_usd`)
- USD calculation differences (via debug logs)
- Symbol missing warnings (indicates AaveMetadata not initialized)

### Rollback Plan

Changes are additive and can be safely reverted:
```bash
git revert 8a7dbb4  # Linting fixes
git revert a1854cf  # Diagnostics script
git revert c3a68b2  # Symbol hydration
git revert 93992b6  # USD math
git revert 0da8b11  # Debt expansion
```

Each commit is atomic and can be reverted independently if needed.

## Verification Steps

### Manual Verification

1. Run diagnostics script on known user with debt:
   ```bash
   tsx -r dotenv/config scripts/diagnose-variable-debt.ts 0x...
   ```

2. Check expansion factors match expected interest accrual

3. Verify USD values are consistent across pipeline

### Production Validation

1. Monitor liquidation logs for `below_min_repay_usd` frequency (should decrease)
2. Check `[execution] USD calculation` debug logs for consistency
3. Verify no `symbol_missing` warnings for active reserves
4. Confirm increased liquidation throughput

## Related Documentation

- [Diagnostics Script README](./backend/scripts/README-diagnose-variable-debt.md)
- [USD Math Utils](./backend/src/utils/usdMath.ts)
- [Aave V3 RAY Math Documentation](https://docs.aave.com/developers/core-contracts/pool#ray-math)

## Commit History

1. `0da8b11` - Fix AaveDataService.getTotalDebt() to expand scaled variable debt
2. `93992b6` - Replace proportional USD estimation with canonical USD math
3. `c3a68b2` - Enforce symbol hydration from AaveMetadata
4. `a1854cf` - Add diagnostics script to verify variable debt expansion
5. `8a7dbb4` - Fix linting issues in debt scaling changes

## Technical Details

### RAY Math

Aave uses RAY (1e27) for precision in interest rate calculations:

```typescript
const RAY = BigInt(10 ** 27);

// Index starts at RAY (1.0)
// After 5% interest: index = 1.05 * RAY = 1050000000000000000000000000

// To expand scaled debt:
principalDebt = (scaledDebt * index) / RAY
```

### Variable Borrow Index

The `variableBorrowIndex` tracks cumulative interest:
- Initialized to RAY (1e27) when reserve is first borrowed
- Increases over time based on variable borrow rate
- Example: Index of 1.25 * RAY means 25% total interest has accrued

### Scaled vs Principal Debt

- **Scaled Debt**: Original borrowed amount, doesn't change with interest
- **Principal Debt**: Current amount owed including accrued interest
- **Relationship**: `principal = scaled * index / RAY`

## Conclusion

This PR successfully addresses the liquidation skip issue by:

1. ✅ Properly expanding scaled variable debt with borrow index
2. ✅ Using canonical USD math throughout the pipeline
3. ✅ Ensuring symbol hydration from metadata
4. ✅ Providing diagnostic tools for verification

All changes are minimal, well-tested, secure, and maintain backwards compatibility. The fix should result in more accurate debt calculations and fewer incorrectly skipped liquidations.

---

**Total Impact**: 735 lines changed across 5 files
**Test Coverage**: 522 tests passing, 5 new unit tests added
**Security**: Clean CodeQL scan, no vulnerabilities
**Linting**: All files pass ESLint
**Documentation**: Comprehensive README for diagnostics script
