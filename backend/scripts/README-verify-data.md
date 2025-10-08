# verify-data.ts - Data Verification Script

## Overview

The `verify-data.ts` script is a standalone verification tool that validates the correctness and internal consistency of data pulled from the Aave V3 Base subgraph and the bot's calculations. It performs comprehensive checks on liquidation calls, user reserve data, and health factor calculations.

## Purpose

This script helps ensure data integrity by:
- Validating schema correctness of liquidation call data
- Verifying user reserve data consistency
- Cross-checking health factor calculations between the HealthCalculator service and independent recomputation
- Detecting data anomalies (negative balances, invalid thresholds, etc.)

## Usage

### Prerequisites

1. Valid subgraph endpoint configured in `.env`
2. `USE_MOCK_SUBGRAPH=false` (script requires real subgraph data)
3. Built TypeScript project (`npm run build`)

### Command Line Options

```bash
node -r dotenv/config dist/scripts/verify-data.js [options]
```

**Options:**
- `--recent=<N>`: Verify last N liquidation calls (default: 10)
- `--user=<address>`: Verify a specific user by Ethereum address
- `--verbose`: Enable verbose output with detailed checks
- `--out=<file>`: Output JSON report to specified file
- `--show-hf`: Force per-user HF detail output (even if not verbose)
- `--quiet`: Suppress standard per-liquidation ID lines; only show HF when --show-hf or mismatches
- `--json-hf`: Include hfDetails array in JSON output (requires --out)
- `--hf-epsilon=<float>`: HF comparison tolerance (default: 1e-9)
- `--dust-epsilon=<float>`: Dust debt threshold in ETH (default: 1e-9)
- `--help`, `-h`: Show help message

### Examples

#### 1. Verify Last 10 Liquidations (Default)
```bash
node -r dotenv/config dist/scripts/verify-data.js
```

#### 2. Verify Last 25 Liquidations
```bash
node -r dotenv/config dist/scripts/verify-data.js --recent=25
```

#### 3. Show Health Factor Details
```bash
node -r dotenv/config dist/scripts/verify-data.js --recent=5 --show-hf
```

Or use the npm script:
```bash
npm run verify:hf
```

#### 4. Quiet Mode with HF Details Only
```bash
node -r dotenv/config dist/scripts/verify-data.js --recent=10 --quiet --show-hf
```

#### 5. Generate JSON Report with Full HF Details
```bash
node -r dotenv/config dist/scripts/verify-data.js --recent=25 --out=verify-report.json --json-hf
```

#### 6. Verify Specific User with Verbose Output
```bash
node -r dotenv/config dist/scripts/verify-data.js --user=0x1234567890abcdef --verbose
```

#### 7. Custom HF Epsilon for Strict Validation
```bash
node -r dotenv/config dist/scripts/verify-data.js --recent=10 --show-hf --hf-epsilon=1e-12
```

## Verification Checks

### 1. Schema Validation

Validates liquidation call fields:
- `id`: Must be non-empty string
- `user`: Must be valid address string
- `timestamp`: Must be positive number
- `principalAmount`, `collateralAmount`: Must be non-empty strings
- `decimals`: Must be non-negative numbers (if present)

### 2. User Reserve Data Consistency

For each user involved in a liquidation:

**a) borrowedReservesCount Verification**
- Compares reported `borrowedReservesCount` against actual count of reserves with non-zero debt (variable + stable)
- Reports mismatch if counts don't match
- Lists affected reserve symbols

**b) Collateral Threshold Validation**
- Verifies that reserves with `usageAsCollateralEnabled=true` have `reserveLiquidationThreshold > 0`
- Flags any inconsistencies as errors

**c) Negative Balance Detection**
- Checks for negative `currentATokenBalance`
- Checks for negative `currentVariableDebt`
- Checks for negative `currentStableDebt`
- All negative values are flagged as errors

### 3. Health Factor Verification

For each user with valid data:

**a) Dual Calculation**
- Calculates health factor using `HealthCalculator` service
- Independently recalculates health factor using inline logic
- Formula: `HF = (Σ collateral_value × liquidationThreshold) / Σ debt_value`

**b) Comparison**
- Compares absolute difference between the two calculations
- Tolerance threshold: configurable via `--hf-epsilon` (default: 1e-9)
- Reports inconsistencies if difference exceeds tolerance

**c) Classification**
The script classifies each user's health factor into one of five categories:

- **NO_DEBT**: User has zero debt (HF would be Infinity). Reported as `null` in output.
- **DUST_DEBT**: User has debt below the dust-epsilon threshold (default: 1e-9 ETH). These are effectively zero debt positions but with trace amounts.
- **HUGE**: Health factor exceeds 10000, indicating effectively no liquidation risk.
- **MISMATCH**: Absolute difference between primary and recomputed HF exceeds hf-epsilon, indicating a calculation inconsistency.
- **OK**: Normal health factor with consistent calculations.

**d) Result Structure**
```typescript
{
  calculatorHF: number;      // From HealthCalculator
  independentHF: number;     // From inline calculation
  diff: number;              // Absolute difference
  isConsistent: boolean;     // Within tolerance?
}
```

**e) HF Detail Structure (when using --show-hf or --json-hf)**
```typescript
{
  user: string;                    // User address
  healthFactor: number | null;     // Primary HF (null for NO_DEBT)
  classification: string;          // NO_DEBT, DUST_DEBT, HUGE, MISMATCH, OK
  totalCollateralETH: number;      // Total collateral value in ETH
  totalDebtETH: number;            // Total debt value in ETH
  weightedCollateralETH: number;   // Collateral × liquidation threshold
  recomputedHF: number | null;     // Independently computed HF
  hfDiff: number | null;           // |primary - recomputed|
  reason?: string;                 // Explanation for classification
}
```

## Output Format

### Console Output

**Normal Mode:**
```
[verify-data] Starting data verification...
[verify-data] Mode: Verify last 10 liquidations
[verify-data] Fetching 10 recent liquidations...
[verify-data] Found 10 liquidations
[verify-data] [1/10] liq-0x123abc
[verify-data] [2/10] liq-0x456def
...
[verify-data] Verification Summary:
  Total liquidations: 10
  Verified: 10
  Errors: 0
  Warnings: 1
[verify-data] Complete.
```

**Verbose Mode:**
```
[verify-data] [1/10] Verifying liquidation liq-0x123abc...
  - User: 0x1234567890abcdef
  - Borrowed reserves: 2 (actual: 2)
  - Health factor: 0.9523 (independent: 0.9523)
  - No issues found
```

**With --show-hf Flag:**
```
[verify-data] [1/10] liq-0x123abc
  - HF: 1.2500 classification=OK collateralETH=1.5000e+0 debtETH=1.0000e+0 weightedCollateral=1.2500e+0 diff=1.23e-10
[verify-data] [2/10] liq-0x456def
  - HF: null classification=NO_DEBT collateralETH=5.0000e+0 debtETH=0.0000e+0 weightedCollateral=4.0000e+0 diff=- reason="Zero debt"
```

**Summary Output with HF Breakdown:**
```
[verify-data] Verification Summary:
  Total liquidations: 10
  Verified: 10
  Errors: 0
  Warnings: 1

[verify-data] Health Factor Summary:
  OK: 7
  NO_DEBT (null): 2
  DUST_DEBT: 0
  HUGE (>10000): 1
  MISMATCH: 0
```

### JSON Report Structure

See [examples/verify-data-sample-output.json](../examples/verify-data-sample-output.json) for a complete example.

```typescript
{
  timestamp: string;           // ISO timestamp of verification run
  totalLiquidations: number;   // Total liquidations checked
  verifiedCount: number;       // Successfully verified count
  errorCount: number;          // Total errors found
  warningCount: number;        // Total warnings found
  summary: {                   // HF summary breakdown
    hfOk: number;              // Count of OK classifications
    hfNull: number;            // Count of NO_DEBT (null HF)
    hfDust: number;            // Count of DUST_DEBT
    hfHuge: number;            // Count of HUGE (HF > 10000)
    hfMismatch: number;        // Count of MISMATCH
  };
  liquidations: [              // Array of verification results
    {
      liquidationId: string;
      user: string;
      timestamp: number;
      schemaValid: boolean;
      userDataFetched: boolean;
      issues: [{
        type: string;          // Issue category
        severity: 'error' | 'warning' | 'info';
        message: string;
        details?: any;         // Additional context
      }];
      healthFactorCheck?: {
        calculatorHF: number;
        independentHF: number;
        diff: number;
        isConsistent: boolean;
      };
      borrowedReservesCheck?: {
        reported: number;
        actual: number;
        matches: boolean;
        mismatchList?: string[];
      };
      hfDetail?: {             // HF detail (always present when userDataFetched)
        user: string;
        healthFactor: number | null;
        classification: string;
        totalCollateralETH: number;
        totalDebtETH: number;
        weightedCollateralETH: number;
        recomputedHF: number | null;
        hfDiff: number | null;
        reason?: string;
      };
    }
  ];
  hfDetails?: [                // Full HF details (only if --json-hf used)
    {
      user: string;
      healthFactor: number | null;
      classification: string;
      totalCollateralETH: number;
      totalDebtETH: number;
      weightedCollateralETH: number;
      recomputedHF: number | null;
      hfDiff: number | null;
      reason?: string;
    }
  ];
}
```

## Exit Codes

- `0`: Success (no errors or HF mismatches found)
- `2`: Failure (errors detected, HF mismatches found, or fatal error)
- `1`: Legacy failure code (replaced by exit code 2)

## Issue Types

| Type | Severity | Description |
|------|----------|-------------|
| `schema` | error | Invalid liquidation call schema |
| `userData` | error/warning | User data fetch failed or not found |
| `borrowedReservesCount` | warning | Mismatch between reported and actual borrowed reserves |
| `collateralThreshold` | error | Invalid collateral threshold for enabled collateral |
| `negativeBalance` | error | Negative aToken balance detected |
| `negativeDebt` | error | Negative debt amount detected |
| `healthFactorMismatch` | error | Health factor calculations don't match |

## Integration

This script can be integrated into CI/CD pipelines or scheduled as a periodic data integrity check:

```bash
# Example: Daily verification cron job
0 2 * * * cd /app/backend && node -r dotenv/config dist/scripts/verify-data.js --recent=50 --out=/app/logs/verify-$(date +\%Y\%m\%d).json
```

## Development

### Running Tests

```bash
npm test -- tests/unit/verify-data-functions.test.ts
```

### Building

```bash
npm run build
```

The script compiles to `dist/scripts/verify-data.js`.

## Troubleshooting

**"Cannot run with USE_MOCK_SUBGRAPH=true"**
- Set `USE_MOCK_SUBGRAPH=false` in `.env`
- Ensure valid subgraph endpoint and API key are configured

**"User not found in subgraph"**
- User may not have any positions
- Verify the address is correct
- Check subgraph is accessible and up-to-date

**Health factor calculation mismatches**
- May indicate a bug in HealthCalculator or subgraph data inconsistency
- Review the detailed diff output
- Check reserve price data and liquidation thresholds

## Related Files

- Script source: [`scripts/verify-data.ts`](./verify-data.ts)
- Tests: [`tests/unit/verify-data-functions.test.ts`](../tests/unit/verify-data-functions.test.ts)
- Sample output: [`examples/verify-data-sample-output.json`](../examples/verify-data-sample-output.json)
- Health calculator: [`src/services/HealthCalculator.ts`](../src/services/HealthCalculator.ts)
- Subgraph service: [`src/services/SubgraphService.ts`](../src/services/SubgraphService.ts)
