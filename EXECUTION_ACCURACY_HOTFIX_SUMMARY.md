# Execution Accuracy Hotfix Summary

## Overview
This hotfix implements runtime-focused execution accuracy improvements to ensure the bot only acts on real opportunities with correct numbers matching Aave, and never quotes/executes when data is inconsistent or scaled incorrectly.

## Implementation Details

### 1. Execution Guards (Before Router Quotes)

All guards are checked BEFORE attempting any router quotes. Each guard aborts early with a clear reason code.

#### Guard 1: EXECUTION_ENABLED
- **Location**: Start of `executeReal()`
- **Condition**: `!executionConfig.executionEnabled`
- **Abort Reason**: `execution_disabled`
- **Config**: `EXECUTION_ENABLED` env var (default: false)

#### Guard 2: Dust Guard
- **Location**: After health factor check in `executeReal()`
- **Condition**: `totalCollateralBase < DUST_THRESHOLD_WEI && totalDebtBase < DUST_THRESHOLD_WEI && HF < 1.0`
- **Abort Reason**: `dust_guard`
- **Config**: `EXECUTION_DUST_WEI` env var (default: 1e12 wei ≈ $0.01)
- **Purpose**: Skip positions too small to be economically viable

#### Guard 3: Inconsistent Zero Collateral
- **Location**: After dust guard in `executeReal()`
- **Condition**: `collateralUsd == 0 && HF < 1.0`
- **Abort Reason**: `inconsistent_zero_collateral`
- **Purpose**: Detect data inconsistency (HF < 1 with zero collateral is impossible)

#### Guard 4: Scaling Anomaly (Debt)
- **Location**: After debt calculation in `executeReal()`
- **Condition**: `debtToCoverHuman > 1e6 tokens`
- **Abort Reason**: `scaling_guard`
- **Purpose**: Detect when debt amount exceeds 1 million tokens (likely scaling error)

#### Guard 5: Scaling Anomaly (Collateral)
- **Location**: After collateral calculation in `executeReal()`
- **Condition**: `seizedCollateralHuman > 1e6 tokens`
- **Abort Reason**: `scaling_guard`
- **Purpose**: Detect when seized collateral exceeds 1 million tokens (likely scaling error)

#### Guard 6: Unprofitable
- **Location**: After calculating seized USD value in `executeReal()`
- **Condition**: `(seizedUsd - repayUsd) < PROFIT_MIN_USD`
- **Abort Reason**: `unprofitable`
- **Config**: `PROFIT_MIN_USD` env var
- **Purpose**: Only proceed with profitable opportunities

### 2. Canonical Aave Accounting

#### Per-Asset Position Data
- **Source**: `ProtocolDataProvider.getUserReserveData(asset, user)`
- **Returns**:
  - `currentATokenBalance`: Current collateral balance
  - `currentStableDebt`: Current stable debt
  - `currentVariableDebt`: Current variable debt (already principal, not scaled)
  - `scaledVariableDebt`: Scaled variable debt (raw storage value)

#### Variable Debt Reconstruction
- **Formula**: `principalVariableDebt = scaledVariableDebt * variableBorrowIndex / RAY`
- **Source**: `Pool.getReserveData(asset)` for `variableBorrowIndex`
- **Cross-check**: Compare reconstructed value with `currentVariableDebt`
- **Tolerance**: 0.5% (configurable in code: `reconstructed / 200n`)
- **Action**: Abort if delta > tolerance with reason containing "scaling_guard"

#### Total Account Data
- **Source**: `Pool.getUserAccountData(user)`
- **Returns**:
  - `totalCollateralBase`: Total collateral in ETH (18 decimals)
  - `totalDebtBase`: Total debt in ETH (18 decimals)
  - `healthFactor`: Health factor (18 decimals, 1e18 = 1.0)

### 3. Decimals & Price Handling

#### Decimals Verification
- **Log Format**: `decimals check: debt=USDC=6, collateral=cbETH=18`
- **Source**: Cross-check opportunity decimals vs AaveMetadata
- **Correction**: Use metadata decimals if mismatch detected

#### Known Decimals
- cbETH: 18
- USDC: 6
- WETH: 18
- GHO: 18
- DAI: 18

#### Price Staleness
- **Current**: Aave oracle handles staleness checks internally
- **Config**: `PRICE_STALENESS_SEC` (default: 3600 seconds)
- **Note**: Placeholder method `checkChainlinkPriceStaleness()` exists for future direct Chainlink integration

### 4. Logging Improvements

#### Human-Readable Amounts
- **Before**: `debtToCover: 5e23`
- **After**: `debtToCoverHuman: 500.00 USDC`

#### Health Factor Formatting
- **Zero Debt**: Display as "INF" (infinity)
- **Non-Zero Debt**: Display as decimal (e.g., "0.9500")

#### Pre-Quote Diagnostics
Logs before attempting router quotes:
```
[execution] Pre-quote diagnostics:
  debtToCoverRaw: 500000000
  debtToCoverHuman: 500.00
  debtToCoverUsd: 500.000000
  expectedCollateralRaw: 166666666666666666
  expectedCollateralHuman: 0.166666
  seizedUsd: 525.000000
  grossProfit: 25.000000
  debtAsset: USDC (0x833589...)
  collateralAsset: WETH (0x420000...)
  liquidationBonusPct: 5.00%
  bonusBps: 500
  closeFactorMode: fixed50
```

## Testing

### Test Coverage
- **New Test File**: `backend/tests/unit/ExecutionGuards.test.ts`
- **Test Count**: 19 tests
- **Categories**:
  - EXECUTION_ENABLED gate (2 tests)
  - Dust detection (2 tests)
  - Scaling anomaly detection (3 tests)
  - Health factor formatting (3 tests)
  - Profit reasonability (2 tests)
  - Decimal verification (4 tests)
  - Variable debt reconstruction (3 tests)

### Running Tests
```bash
cd backend
npm test -- tests/unit/ExecutionGuards.test.ts
```

### All Tests Pass
```
✓ tests/unit/ExecutionGuards.test.ts (19 tests) 16ms
Test Files  1 passed (1)
Tests  19 passed (19)
```

## Manual Validation Steps

### 1. Verify EXECUTION_ENABLED Gate
```bash
# Backend should skip all executions
EXECUTION_ENABLED=false npm run dev

# Observe logs:
# [execution] Execution disabled via EXECUTION_ENABLED=false
```

### 2. Test Known Addresses

#### Dust Position (0x6fed3f22b4b62909fe3da185b052ed92c2971ad7)
**Expected Behavior**:
- Executor logs: `GUARD: dust_guard - both collateral and debt below threshold`
- No router quotes attempted
- Reason: `dust_guard`

#### Scaling Anomaly (0x863d2b07840051615941e59f0580012ade109341)
**Expected Behavior**:
- Executor logs: `GUARD: scaling_guard - debt amount exceeds 1e6 tokens`
- OR: `SCALING SUSPECTED: Variable debt inconsistency detected`
- No router quotes attempted
- Reason: `scaling_guard`

#### Scaling Anomaly (0x27aa7c98d20bde226085f62dfd627469886e843d)
**Expected Behavior**:
- Executor logs: `GUARD: scaling_guard - collateral amount exceeds 1e6 tokens`
- OR: `SCALING SUSPECTED: Variable debt inconsistency detected`
- No router quotes attempted
- Reason: `scaling_guard`

### 3. Verify Log Format
Look for these patterns in logs:
- ✅ `debtToCoverHuman: 500.00` (not `5e2`)
- ✅ `decimals check: debt=USDC=6, collateral=WETH=18`
- ✅ `HF=INF` when totalDebtBase == 0
- ✅ Guard reasons: `dust_guard`, `scaling_guard`, `inconsistent_zero_collateral`, `unprofitable`, `execution_disabled`

### 4. Verify Guard Order
Execution flow should be:
1. Check EXECUTION_ENABLED → abort if false
2. Check health factor → abort if not liquidatable
3. Check dust guard → abort if dust position
4. Check inconsistent zero collateral → abort if inconsistent
5. Calculate debt to cover with canonical accounting
6. Check scaling guard (debt) → abort if > 1e6 tokens
7. Calculate expected collateral
8. Check scaling guard (collateral) → abort if > 1e6 tokens
9. Check profitability → abort if unprofitable
10. **THEN** attempt router quotes (Uniswap V3 → 1inch)

### 5. Verify No Execution After Guards
**Critical**: No logs should show:
- "REAL execution starting" after a guard abort
- "Uniswap V3 quote" or "1inch quote" after a guard abort
- Any router activity after guard logs

## Configuration

### Environment Variables
```bash
# Master execution switch (default: false)
EXECUTION_ENABLED=false

# Dry run mode (default: true)
DRY_RUN_EXECUTION=true

# Dust threshold in wei (default: 1e12)
EXECUTION_DUST_WEI=1000000000000

# Minimum profit in USD (default: 10)
PROFIT_MIN_USD=10

# Price staleness in seconds (default: 3600)
PRICE_STALENESS_SEC=3600
```

## Deployment Checklist

- [ ] Deploy with `EXECUTION_ENABLED=false` initially
- [ ] Monitor logs for guard behavior on known addresses
- [ ] Verify no "REAL execution starting" after guards
- [ ] Verify router quotes only after all guards pass
- [ ] Check decimals are correct in logs (cbETH=18, USDC=6)
- [ ] Verify HF displays as "INF" for zero debt positions
- [ ] Enable execution: `EXECUTION_ENABLED=true` only after validation

## Troubleshooting

### Issue: Scaling guard triggers on valid positions
**Solution**: Check if decimals are correct. Use AaveMetadata to verify.

### Issue: Dust guard triggers on actionable positions
**Solution**: Adjust `EXECUTION_DUST_WEI` threshold. Current default is 1e12 wei (~$0.01).

### Issue: Unprofitable guard blocks valid opportunities
**Solution**: Verify price feeds are up to date. Check `PROFIT_MIN_USD` configuration.

### Issue: Variable debt reconstruction fails tolerance check
**Solution**: This indicates potential scaling issue. Do not increase tolerance - investigate root cause.

## References

### Key Files
- `backend/src/services/ExecutionService.ts` - Main execution logic
- `backend/src/services/AaveDataService.ts` - Canonical Aave data fetching
- `backend/tests/unit/ExecutionGuards.test.ts` - Guard tests

### Key Methods
- `executeReal()` - Main execution entry point with all guards
- `calculateDebtToCover()` - Canonical accounting with cross-check
- `getUserReserveData()` - Per-asset position data
- `getUserAccountData()` - Total account data
- `getTotalDebt()` - Debt reconstruction with tolerance check

### Configuration
- `backend/src/config/executionConfig.ts` - Execution configuration
- `backend/src/config/envSchema.ts` - Environment variable schema
