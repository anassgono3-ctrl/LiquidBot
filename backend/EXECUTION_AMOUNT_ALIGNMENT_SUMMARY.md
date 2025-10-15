# Execution Amount Math Alignment - Implementation Summary

## Problem Statement

The executor and plan resolver were using different math for USD calculations, leading to potential inconsistencies and zero-amount quote errors. This PR aligns the execution amount math with the plan resolver and adds pre-quote diagnostics.

## Solution Overview

### 1. Canonical USD Math (src/utils/usdMath.ts)

Created a new utility module with standardized USD calculation using 1e18 normalization:

**Key Functions:**
```typescript
// Calculate USD value using 1e18 normalization
calculateUsdValue(rawAmount: bigint, tokenDecimals: number, priceRaw: bigint): number

// Format raw token amount to human-readable string
formatTokenAmount(rawAmount: bigint, tokenDecimals: number): string
```

**Math Implementation:**
```
1. Convert oracle price from 1e8 to 1e18: price1e18 = priceRaw * 1e10
2. Normalize amount to 1e18: amount1e18 = rawAmount * 10^(18 - tokenDecimals)
3. Calculate USD: usd = (amount1e18 * price1e18) / 1e18
```

This ensures:
- No early rounding to zero for small amounts
- Consistent precision across all decimal formats (6, 8, 18, etc.)
- Exact parity with plan resolver calculations

### 2. AaveDataService Updates

**Changes:**
- Added `priceRaw: bigint` field to `ReserveData` interface
- Updated `getAllUserReserves()` to use `calculateUsdValue()` for USD calculations
- Stores both human-readable price (`priceInUsd: number`) and raw price (`priceRaw: bigint`)

**Impact:**
- Plan resolver now uses canonical 1e18 math
- USD values computed identically across all code paths

### 3. ExecutionService Updates

**prepareActionableOpportunity():**
- Updated to use `calculateUsdValue()` for debtToCoverUsd calculation
- Ensures plan resolver produces consistent results

**executeReal():**
- Added pre-quote diagnostics logging immediately before OneInchQuoteService call:
  ```typescript
  console.log('[execution] Pre-quote diagnostics:', {
    debtToCoverRaw: debtToCover.toString(),
    debtToCoverHuman: formatTokenAmount(debtToCover, debtDecimals),
    debtToCoverUsd: debtToCoverUsdPrecise.toFixed(6),
    expectedCollateralRaw: expectedCollateralRaw.toString(),
    expectedCollateralHuman: formatTokenAmount(expectedCollateralRaw, collateralDecimals),
    debtAsset,
    collateralAsset,
    liquidationBonusPct,
    bonusBps: Math.round(liquidationBonusPct * 10000),
    closeFactorMode: config.closeFactorExecutionMode
  });
  ```
- Calculates expected collateral amount using precise 1e18 math
- Passes raw BigInt amounts (as strings) to quote service

### 4. OneInchQuoteService Updates

**Enhanced Validation:**
```typescript
// Validate amount is a valid non-zero BigInt
let amountBigInt: bigint;
try {
  amountBigInt = BigInt(request.amount || '0');
} catch {
  throw new Error(`amount must be a valid integer string: ${request.amount}`);
}

if (amountBigInt <= 0n) {
  throw new Error(`amount must be greater than 0, got: ${request.amount}`);
}
```

**Benefits:**
- Catches zero/invalid amounts before API call
- Better error messages for debugging
- Accepts raw token amounts (BigInt as string)

## Test Coverage

### New Tests (tests/unit/usdMath.test.ts)
- 13 comprehensive tests covering:
  - USDC (6 decimals), WETH (18 decimals), DAI (18 decimals)
  - Small amounts without rounding to zero
  - High-precision decimals (>18)
  - Zero amount handling
  - Human-readable formatting
  - Parity with plan resolver

### Updated Tests
- Updated all mock `ReserveData` objects in PlanResolution.test.ts to include `priceRaw` field
- All 355 tests pass

## Acceptance Criteria Met

✅ **Diagnostic Logging:**
- Single diagnostic line logs debtToCoverRaw, debtToCoverHuman, and debtToCoverUsd before quoting

✅ **No Zero-Amount Errors:**
- Quote layer receives strictly positive raw amounts
- Validation catches zero amounts with clear error messages

✅ **USD Math Parity:**
- Executor and resolver use identical `calculateUsdValue()` function
- 1e18 normalization prevents early rounding
- Integer math tolerance maintained

✅ **Non-Goals Respected:**
- No new environment variables
- No changes to trigger logic or dedupe
- Focus solely on amount/USD math parity and logging

## Example Output

```
[execution] Pre-quote diagnostics: {
  debtToCoverRaw: '50000000',
  debtToCoverHuman: '50',
  debtToCoverUsd: '50.000000',
  expectedCollateralRaw: '52500000',
  expectedCollateralHuman: '52.5',
  debtAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  collateralAsset: '0x4200000000000000000000000000000000000006',
  liquidationBonusPct: 0.05,
  bonusBps: 500,
  closeFactorMode: 'fixed50'
}
```

## Files Changed

- `backend/src/utils/usdMath.ts` (new): Canonical USD math utilities
- `backend/tests/unit/usdMath.test.ts` (new): Comprehensive tests
- `backend/src/services/AaveDataService.ts`: Updated to use canonical USD math
- `backend/src/services/ExecutionService.ts`: Added pre-quote diagnostics, updated to use canonical math
- `backend/src/services/OneInchQuoteService.ts`: Enhanced amount validation
- `backend/tests/unit/PlanResolution.test.ts`: Updated mocks with priceRaw field

**Total:** 6 files changed, 319 insertions(+), 18 deletions(-)

## Impact

This change ensures:
1. **Consistency:** Executor and resolver calculate USD values identically
2. **Debuggability:** Pre-quote diagnostics make it easy to diagnose issues
3. **Robustness:** Better validation prevents zero-amount quote errors
4. **Precision:** 1e18 normalization handles all token decimal formats correctly
