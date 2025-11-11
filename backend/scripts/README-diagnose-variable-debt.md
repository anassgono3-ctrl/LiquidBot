# Variable Debt Diagnostics Script

## Overview

This script confirms that variable debt is properly expanded from scaled debt using the reserve's `variableBorrowIndex`. It helps verify the fix for liquidations being skipped due to under-calculated debt amounts.

## Purpose

The script addresses the root cause where **scaled variable debt** (not principal) was being used in planning/gating decisions, leading to tiny `debtToCoverUsd` values and liquidations being skipped with `below_min_repay_usd` errors.

## Usage

### Prerequisites

- Configured `RPC_URL` in `.env` file
- Node.js 18.18.0 or higher

### Running the Script

#### Option 1: Using tsx (Development)
```bash
tsx -r dotenv/config scripts/diagnose-variable-debt.ts <userAddress>
```

#### Option 2: Using compiled JavaScript
```bash
npm run build
node -r dotenv/config dist/scripts/diagnose-variable-debt.js <userAddress>
```

#### Option 3: Using environment variable
Set `TEST_USER_ADDRESS` in your `.env` file:
```bash
TEST_USER_ADDRESS=0x1234...
tsx -r dotenv/config scripts/diagnose-variable-debt.ts
```

## What It Does

For each reserve where a user has debt, the script:

1. **Fetches Scaled Variable Debt** - The raw on-chain scaled debt value
2. **Retrieves Variable Borrow Index** - The reserve's current borrow index (in RAY format, 1e27)
3. **Calculates Principal Debt** - `scaledVariableDebt * variableBorrowIndex / RAY`
4. **Compares with Current Variable Debt** - Validates the calculation
5. **Computes Total Debt USD Value** - Using canonical `calculateUsdValue()` function

## Output Example

```
=== Variable Debt Diagnostics ===
User: 0x1234567890abcdef...
Network: Base (Chain ID 8453)

Fetching user reserves...
Found 2 reserve(s) with debt

--- USDC (0x833589fcd6edb6e08f4c7c32d4f71b54bda02913) ---
  Scaled Variable Debt:     1000.000000
  Variable Borrow Index:    1.050000 (1050000000000000000000000000)
  Calculated Principal:     1050.000000
  Current Variable Debt:    1050.000000
  Stable Debt:              0.000000
  Total Debt (expanded):    1050.000000
  Price (USD):              $1.0000
  Total Debt Value (USD):   $1050.00
  ✓ Variable debt calculation matches within tolerance
  ✓ Interest accrued: 50.000000 USDC
    Expansion factor: 5.00%

--- WETH (0x4200000000000000000000000000000000000006) ---
  Scaled Variable Debt:     0.500000
  Variable Borrow Index:    1.025000 (1025000000000000000000000000)
  Calculated Principal:     0.512500
  Current Variable Debt:    0.512500
  Stable Debt:              0.000000
  Total Debt (expanded):    0.512500
  Price (USD):              $2500.0000
  Total Debt Value (USD):   $1281.25
  ✓ Variable debt calculation matches within tolerance
  ✓ Interest accrued: 0.012500 WETH
    Expansion factor: 2.50%

=== Summary ===
Total reserves with debt: 2
Total debt value: $2331.25

Reserve breakdown:
  USDC: $1050.00 (index: 1.0500)
  WETH: $1281.25 (index: 1.0250)

✓ All debt calculations verified successfully
```

## Key Metrics Explained

### Scaled Variable Debt
The raw on-chain value stored in Aave's variable debt token. This value does **not** include accrued interest and must be expanded using the borrow index.

### Variable Borrow Index
The cumulative interest rate index for the reserve. Starts at 1.0 (1e27 in RAY) and increases over time as interest accrues. An index of 1.05 means 5% interest has accrued since the debt was originated.

### Calculated Principal Debt
The actual debt amount including accrued interest:
```
principalDebt = scaledVariableDebt * variableBorrowIndex / RAY
```
where `RAY = 1e27`

### Expansion Factor
The percentage increase from scaled to principal debt:
```
expansionFactor = (variableBorrowIndex / RAY) - 1
```
This represents the total accrued interest percentage.

## Verification Checks

The script performs these checks:

1. **Calculation Accuracy** - Compares calculated principal debt with the protocol-provided current variable debt (should match within 0.1% tolerance)

2. **Interest Accrual Detection** - Identifies when significant interest has accrued (expansion factor > 0.1%)

3. **USD Value Consistency** - Uses the canonical `calculateUsdValue()` function to ensure USD calculations match the execution pipeline

## Troubleshooting

### Error: RPC_URL not configured
Add `RPC_URL=<your-rpc-endpoint>` to your `.env` file.

### Error: No user address provided
Provide a user address as a command-line argument or set `TEST_USER_ADDRESS` in `.env`.

### Error: Invalid Ethereum address
Ensure the address is a valid checksummed Ethereum address.

### No debt found for this user
The specified address has no outstanding debt on Aave V3 Base.

### Warning: Significant difference
If the calculated principal debt differs significantly from the current variable debt, this may indicate:
- On-chain state changed between queries
- RPC provider lag/inconsistency
- Potential issue with the calculation (investigate further)

## Related Files

- `backend/src/services/AaveDataService.ts` - Implements `getTotalDebt()` with proper debt expansion
- `backend/src/utils/usdMath.ts` - Canonical USD calculation function
- `backend/tests/unit/AaveDataService.test.ts` - Unit tests for debt expansion

## Technical Details

### RAY Math
Aave uses RAY (1e27) for precision in interest rate calculations. When expanding scaled debt:
```typescript
const RAY = BigInt(10 ** 27);
const principalDebt = (scaledDebt * variableBorrowIndex) / RAY;
```

### Why This Fix Matters
Before the fix, the system used `currentVariableDebt` directly without considering that it might be a scaled value. This led to:
- Under-calculated debt amounts
- USD values appearing too small
- Legitimate liquidations being skipped with `below_min_repay_usd` errors

The fix ensures all debt calculations use properly expanded principal debt values.
