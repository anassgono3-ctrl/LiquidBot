# Aave V3 Accounting Pipeline Refactor - Complete

## Problem Solved

After the last merge, liquidation alerts showed impossible numbers:
- Token debts: 10^19–10^26 (should be < 1e9)
- Collateral: 0.0000 with HF < 1 (inconsistent)
- Logs: "Variable debt mismatch", "Suspiciously large variable debt", "SCALING WARNING"

**Root causes**:
1. RAY/WAD/token-decimal mixups
2. Inconsistent collateral/debt reconstruction
3. Price-decimal confusion (Chainlink 8 vs Aave 18)
4. Not using canonical on-chain sources

## Solution Implemented

### 1. Decimal Utilities Module ✅
**File**: `src/utils/decimals.ts` (254 lines)

Provides canonical decimal handling:
- `to18()` / `from18()` - normalize to/from 18 decimals
- `applyRay()` - apply RAY (1e27) indices
- `usdValue()` - consistent USD calculations
- `baseToUsd()` - ETH base to USD conversion
- `formatTokenAmount()` - human-readable formatting
- `validateAmount()` - sanity checking

**Testing**: 43 unit tests, all passing

### 2. Asset Metadata Cache ✅
**File**: `src/services/AssetMetadataCache.ts` (289 lines)

Efficient caching layer:
- Symbol, decimals, price feed info (1 hour TTL)
- Asset prices from Aave oracle (30 seconds TTL)
- ETH/USD from Chainlink (30 seconds TTL)
- Total supply for sanity checks (5 minutes TTL)

### 3. Enhanced AaveDataService ✅
**File**: `src/services/AaveDataService.ts` (+282 lines)

New canonical methods:
- `getUserAccountDataCanonical()` - source of truth with USD conversion
- `getUserReservesCanonical()` - per-asset breakdown with sanity checks
- `validateConsistency()` - 0.5% tolerance validation

**Sanity guards implemented**:
1. If HF < 1 and collateral == 0, re-fetch once
2. Human amounts must be < 1e9 tokens
3. Amounts must be < totalSupply * 1.05
4. Per-asset totals must match canonical within 0.5%

### 4. Enhanced Notifications ✅
**File**: `src/services/NotificationService.ts` (+122 lines)

Improvements:
- Scaling sanity checks before sending
- Suspicious alerts blocked
- Better formatting (6 decimals for tokens, smart USD precision)
- HF with exactly 4 decimals
- Structured logging of filter decisions

### 5. Validation Script ✅
**File**: `scripts/validate-aave-scaling.ts` (342 lines)

Validates against live on-chain data:
```bash
tsx scripts/validate-aave-scaling.ts \
  --rpc https://mainnet.base.org \
  --user 0x...
```

Checks:
- Canonical data fetching
- Decimal conversions
- Consistency within 0.5%
- Reports discrepancies

### 6. Configuration ✅
**Files**: `src/config/envSchema.ts`, `.env.example`

New configuration:
- `LIQUIDATION_CLOSE_FACTOR` (default 0.5)
- Uses existing `RPC_URL` and `CHAIN_ID`
- Documented in `.env.example`

### 7. Documentation ✅
**File**: `docs/AAVE_ACCOUNTING_REFACTOR.md` (506 lines)

Comprehensive guide covering:
- Problem statement and solution
- API documentation
- Configuration guide
- Validation script usage
- Integration examples
- Troubleshooting guide

## Statistics

**Files Changed**: 10
- New files: 5 (1,677 lines)
- Modified files: 5 (+409 lines)
- **Total**: 2,086 lines added

**Testing**:
- 571 tests passing (43 new)
- Build successful
- All new files pass linting
- CodeQL: 0 alerts

**Commits**: 5
1. Add comprehensive decimal utilities module with tests
2. Add AssetMetadataCache and enhance AaveDataService
3. Add validation script and configuration
4. Enhance NotificationService with sanity checks
5. Add comprehensive documentation

## Key Technical Changes

### Canonical Data Flow
```
getUserAccountData (on-chain)
  → totalCollateralBase (ETH 1e18)
  → totalDebtBase (ETH 1e18)
  ↓
ETH/USD from Chainlink (8 decimals)
  ↓
baseToUsd() with proper normalization
  ↓
totalCollateralUsd, totalDebtUsd (accurate)
```

### Per-Asset Calculation
```
scaledVariableDebt (token decimals)
  × variableBorrowIndex (RAY 1e27)
  ÷ 1e27
  → principalVariableDebt (token decimals, includes interest)

aToken.balanceOf() (already 1:1 with underlying)
  → collateral (token decimals, no liquidityIndex multiplication)

Both normalized to 18 decimals
  × price (normalized to 18 decimals)
  ÷ 1e18
  → accurate USD values
```

### Sanity Guards
1. ✅ Amounts < 1e9 tokens (prevents 10^19+ errors)
2. ✅ Amounts < totalSupply * 1.05 (prevents impossible values)
3. ✅ HF < 1 with 0 collateral triggers re-fetch
4. ✅ Per-asset vs canonical within 0.5%
5. ✅ Alerts blocked if guards fail

## Expected Impact

### Before
- Alerts with 10^19–10^26 token amounts
- HF < 1 with 0 collateral
- Inconsistent per-asset vs total
- Difficult to debug

### After
- All amounts < 1e9 tokens
- Consistent HF and collateral
- Per-asset matches canonical within 0.5%
- Suspicious alerts blocked
- Validation script for verification

## Verification Steps

```bash
# 1. Run tests
npm test  # 571 passing

# 2. Build
npm run build  # Success

# 3. Validate against on-chain data
tsx scripts/validate-aave-scaling.ts \
  --rpc https://mainnet.base.org \
  --user <address>

# 4. Check for security issues
# CodeQL: 0 alerts ✅
```

## Deployment Checklist

- [x] All tests passing
- [x] Build successful
- [x] Linting passing
- [x] Security scan clean (CodeQL: 0 alerts)
- [x] Documentation complete
- [x] Validation script tested
- [ ] Update .env with LIQUIDATION_CLOSE_FACTOR if needed
- [ ] Monitor logs for "SCALING SUSPECTED" after deployment
- [ ] Run validation script on production users

## Monitoring After Deployment

Look for these improvements:
1. No more 10^19+ token amounts in logs
2. No "HF < 1 but collateral == 0" inconsistencies
3. Fewer "below_min_repay_usd" skips
4. Consistent per-asset vs canonical totals
5. Blocked suspicious alerts logged

Check for warnings:
```
[aave-data] Suspiciously large variable debt detected
[aave-data] SCALING ERROR: Debt exceeds 105% of total supply
[notification] SCALING SUSPECTED - skipping notification
```

## Summary

This refactor provides:
1. ✅ **Correct calculations**: Proper RAY/WAD/decimal handling throughout
2. ✅ **Canonical sources**: getUserAccountData as source of truth
3. ✅ **Sanity guards**: Multiple checks prevent impossible values
4. ✅ **Better alerts**: Formatted correctly, suspicious ones blocked
5. ✅ **Validation tooling**: Script to verify against on-chain data
6. ✅ **Complete documentation**: Integration guides and troubleshooting

All changes are minimal, surgical, backward-compatible, and thoroughly tested. The pipeline now correctly handles all decimal conversions and prevents the scaling errors that were causing impossible liquidation alerts.

## Follow-Up Guard Behaviors (Post PR #93)

### Execution Service Guards

Additional pre-execution safety checks implemented in `ExecutionService.ts`:

#### 1. Dust Position Guard
- **Threshold**: Configurable via `EXECUTION_DUST_WEI` (default: 1e12 wei)
- **Logic**: If `HF < 1` but `totalCollateralBase < dust_threshold`, abort execution
- **Reason**: Micro dust positions with HF<1 are suspicious and not actionable
- **Exit**: Returns `dust_position_not_actionable`

#### 2. Zero Collateral Guard
- **Logic**: If `collateralUsd == 0` while `HF < 1`, abort execution
- **Reason**: Indicates likely data inconsistency or scaling issue
- **Exit**: Returns `zero_collateral_hf_below_one`

#### 3. Scaling Suspected Guard
- **Logic**: If `debtToCoverHuman > 1e9` tokens, throw error in `calculateDebtToCover`
- **Reason**: Prevents execution with impossibly large debt amounts (previous threshold was warning at 1e6)
- **Exit**: Throws `Error('Scaling error suspected: debt amount exceeds 1e9 tokens')`
- **Result**: No "REAL execution starting" log after scaling error detection

#### 4. Reason for HF<1 Logging
- **When**: If `HF < 1` and position passes guards
- **Log**: `[execution] Reason for HF<1: collateralUSD=$X.XXXXXX, debtUSD=$Y.YYYYYY`
- **Purpose**: Explicit context for actionable liquidations

### Validator Script Enhancements

Extended `validate-aave-scaling.ts` with:

#### Multi-User Support
```bash
# Multiple users via repeated flag
tsx scripts/validate-aave-scaling.ts --rpc <URL> --user 0x... --user 0x...

# Multiple users via comma-separated list
tsx scripts/validate-aave-scaling.ts --rpc <URL> --users 0x...,0x...
```

#### Adaptive Precision
- USD values < $0.01: 6 decimal places
- USD values >= $0.01: 2 decimal places
- Prevents tiny amounts from displaying as $0.00

#### Dust Handling
- **Environment**: `VALIDATOR_DUST_WEI` (default: 1e12 wei)
- **Behavior**: Assets below threshold tagged with "(dust)"
- **Exit Code**: Non-zero only for real inconsistencies (not dust)

#### Zero/Zero Consistency
- **Old**: Division-by-zero when both canonical and recomputed are 0 → 100% diff → FAIL
- **New**: Treats zero == zero as PASS

#### Infinite Health Factor
- **Old**: Displayed as `1.157920892373162e+59` (Aave's max uint)
- **New**: Displayed as `INF` when debt == 0

#### Raw Values
- **Flag**: `--raw`
- **Output**: Shows underlying bigint wei values for debugging

#### Smallest Values Summary
- Reports smallest non-zero debt and collateral detected
- Helps identify dust thresholds and precision issues

### Canonical Debt Retrieval

The variable debt reconstruction already uses the canonical method:
```typescript
principalVariableDebt = scaledVariableDebt * variableBorrowIndex / RAY
```

This approach is used throughout:
- `AaveDataService.getTotalDebt()` (existing implementation)
- Validator script (uses `applyRay()` helper)
- No old variable debt logic remains in execution path
