# Deterministic Health Factor Validation

## Overview

The Extended Low-HF Tracking system provides comprehensive observability and verification capabilities for health factor (HF) calculations in the LiquidBot liquidation protection service. This system captures full provenance data for low-HF positions, enabling deterministic verification of HF computations and classification logic.

## Architecture

### Data Model

The system uses two entry formats for flexibility:

#### 1. Basic Format (`LowHFEntry`)
Simple format with aggregate totals (legacy, backward compatible):
```typescript
interface LowHFEntry {
  address: string;
  lastHF: number;
  timestamp: number;
  blockNumber: number;
  triggerType: 'event' | 'head' | 'price';
  totalCollateralUsd: number;
  totalDebtUsd: number;
  reserves?: ReserveData[];
}
```

#### 2. Extended Format (`LowHFExtendedEntry`)
Full provenance with reserve-level detail:
```typescript
interface LowHFExtendedEntry {
  timestamp: string;              // ISO 8601
  blockNumber: number;
  blockHash: string;
  trigger: 'head' | 'event' | 'price';
  user: string;
  reportedHfFloat: number;
  reportedHfRawBps: number;       // Basis points for precision
  reserves: LowHFReserveDetail[]; // Full breakdown
  weightedCollateralUsd: number;  // Σ(collateralUsd × threshold)
  totalCollateralUsd: number;
  totalDebtUsd: number;
  recomputedHf: number;           // Inline verification
  deltaReportedVsRecomputed: number;
}
```

#### Reserve Detail Format
Each reserve includes full provenance:
```typescript
interface LowHFReserveDetail {
  tokenAddress: string;
  symbol: string;
  tokenDecimals: number;
  collateralRaw: string;          // BigInt as string
  debtRaw: string;                // BigInt as string
  collateralUsd: number;
  debtUsd: number;
  liquidationThresholdBps: number;
  liquidationBonusBps?: number;
  ltvBps?: number;
  priceSource: 'chainlink' | 'stub' | 'other';
  priceAnswerRaw: string;         // Raw oracle answer
  priceDecimals: number;
  priceRoundId?: string;          // Chainlink round ID
  priceUpdatedAt?: number;        // Unix timestamp
}
```

## Configuration

### Environment Variables

```bash
# Basic Tracking (existing)
LOW_HF_TRACKER_ENABLED=true         # Enable low-HF tracking
LOW_HF_TRACKER_MAX=1000             # Max entries in ring buffer
LOW_HF_RECORD_MODE=all              # all|min
LOW_HF_DUMP_ON_SHUTDOWN=true        # Dump on SIGINT
LOW_HF_SUMMARY_INTERVAL_SEC=900     # Periodic logging (0=disabled)
ALWAYS_INCLUDE_HF_BELOW=1.10        # Threshold for recording

# Archive Verification (new)
LOW_HF_ARCHIVE_RPC_URL=             # Archive node URL (optional)
LOW_HF_ARCHIVE_VERIFY_SAMPLE=0      # Sample size (0=all)
LOW_HF_ARCHIVE_TIMEOUT_MS=8000      # Per-user timeout
```

### Recording Modes

- **`all`**: Record all low-HF positions (up to `LOW_HF_TRACKER_MAX`)
  - Evicts highest HF when at capacity
  - Best for comprehensive analysis
  
- **`min`**: Record only the minimum HF position
  - Minimal memory footprint
  - Best for monitoring worst-case scenarios

## Usage

### 1. Running the Bot

The tracker automatically captures low-HF positions during normal operation:

```bash
# With extended tracking enabled
LOW_HF_TRACKER_ENABLED=true \
LOW_HF_RECORD_MODE=all \
npm start
```

### 2. Generating Dumps

Dumps are created automatically on shutdown (SIGINT/SIGTERM):

```bash
# Graceful shutdown triggers dump
^C  # Ctrl+C

# Output: diagnostics/lowhf-extended-dump-2025-11-08T21-36-41-248Z.json
```

Dump file naming:
- **Basic format**: `lowhf-dump-<timestamp>.json`
- **Extended format**: `lowhf-extended-dump-<timestamp>.json`

### 3. Verification Workflow

#### Mode A: Mathematical Consistency Check

Recomputes HF from stored reserve data and validates consistency:

```bash
npm run verify:lowhf-dump diagnostics/lowhf-extended-dump-2025-11-08T21-36-41-248Z.json
```

**Output:**
```
[verify] === Mode A: Mathematical Consistency Check ===
[verify] Results:
  Total entries: 150
  Verified: 148
  Mismatches: 2
  Errors: 0

✅ All entries verified successfully!
   Mathematical consistency: PASS
```

**Checks performed:**
- ✅ Weighted collateral calculation
- ✅ Total collateral summation
- ✅ Total debt summation
- ✅ Health factor formula
- ✅ Delta tolerance validation

#### Mode B: Archive Node Verification (Future)

Re-fetches user data at the exact block using an archive node:

```bash
LOW_HF_ARCHIVE_RPC_URL=https://base-archive.example.com \
npm run verify:lowhf-dump diagnostics/lowhf-extended-dump-<timestamp>.json
```

**Validates:**
- On-chain balances match stored values
- Oracle prices match stored answers
- Reserve configuration consistency
- Block hash verification

#### Mode C: Sample-Based Verification (Future)

Randomly samples entries to reduce archive node load:

```bash
LOW_HF_ARCHIVE_RPC_URL=https://base-archive.example.com \
LOW_HF_ARCHIVE_VERIFY_SAMPLE=10 \
npm run verify:lowhf-dump diagnostics/lowhf-extended-dump-<timestamp>.json
```

## API Endpoints

### GET /lowhf

Retrieve tracked low-HF entries with optional reserve detail:

```bash
# Without reserve detail (summary only)
curl 'http://localhost:3000/lowhf?detail=0&limit=10'

# With full reserve detail
curl 'http://localhost:3000/lowhf?detail=1&limit=10'

# Pagination
curl 'http://localhost:3000/lowhf?limit=50&offset=100'
```

**Response:**
```json
{
  "entries": [...],
  "count": 10,
  "total": 150,
  "limit": 10,
  "offset": 0,
  "minHF": 0.8523
}
```

**Query Parameters:**
- `detail` (0|1): Include reserve breakdown (default: 1)
- `limit` (1-1000): Results per page (default: 100)
- `offset` (≥0): Pagination offset (default: 0)
- `includeReserves` (0|1): Legacy parameter (use `detail` instead)

### GET /status

System status includes low-HF tracking metrics:

```bash
curl http://localhost:3000/status
```

**Response includes:**
```json
{
  "status": "running",
  "lastBlock": 12345678,
  "candidateCount": 25,
  "lastMinHF": 0.8523,
  "lowHfCount": 150
}
```

## Metrics

### Prometheus Metrics

```
# Snapshot capture
liquidbot_lowhf_snapshot_total{mode="all|min"}
liquidbot_lowhf_min_hf (histogram)

# Verification
liquidbot_lowhf_recompute_mismatch_total
liquidbot_lowhf_archive_mismatch_total
liquidbot_lowhf_archive_verified_total

# Legacy
liquidbot_lowhf_mismatch_total
```

## Verification Interpretation

### Success Criteria

✅ **PASS** - Zero tolerance violations:
- All weighted collateral calculations match
- All totals sum correctly
- Health factor formula consistent
- Delta < 0.001% for floating-point operations

⚠️ **ACCEPTABLE** - Minor floating-point precision differences:
- Delta < 1e-6 absolute
- Delta < 0.01% relative
- Documented rounding behavior

❌ **FAIL** - Significant mismatches requiring investigation:
- Delta > 1e-6 absolute
- Delta > 0.01% relative
- Inconsistent liquidation thresholds
- Price feed discrepancies

### Common Issues

#### 1. Floating-Point Precision
**Symptom:** Small deltas (< 1e-9) in HF calculations

**Cause:** IEEE 754 floating-point arithmetic

**Resolution:** Expected behavior, verify delta is within tolerance

#### 2. Oracle Price Staleness
**Symptom:** Archive verification shows different prices

**Cause:** Chainlink price updated between capture and verification

**Resolution:** Check `priceUpdatedAt` field, accept if age difference explained

#### 3. Reserve Configuration Changes
**Symptom:** Archive verification shows different liquidation thresholds

**Cause:** Aave governance changed parameters

**Resolution:** Review Aave governance proposals, validate block number

## Performance Considerations

### Memory Usage

| Mode | Entries | Reserve Detail | Memory Est. |
|------|---------|----------------|-------------|
| min  | 1       | No             | ~1 KB       |
| min  | 1       | Yes            | ~5 KB       |
| all  | 1000    | No             | ~500 KB     |
| all  | 1000    | Yes            | ~5 MB       |

**Recommendations:**
- Use `mode=min` for production monitoring
- Use `mode=all` for debugging and analysis
- Adjust `LOW_HF_TRACKER_MAX` based on available memory

### Archive Verification Cost

| Operation | RPC Calls | Archive Node Load |
|-----------|-----------|-------------------|
| Mode A    | 0         | None              |
| Mode B (full) | N × 5 | High              |
| Mode C (sample=10) | 50 | Low               |

**Recommendations:**
- Use Mode A for routine verification (free)
- Use Mode C with small samples for spot checks
- Reserve Mode B for investigating specific issues

## Troubleshooting

### Issue: No Extended Entries in Dump

**Symptoms:**
```
[verify] ⚠️  No extended entries found in dump file.
```

**Causes:**
1. Tracker disabled: `LOW_HF_TRACKER_ENABLED=false`
2. No low-HF users detected
3. Threshold too low: `ALWAYS_INCLUDE_HF_BELOW` too restrictive

**Resolution:**
- Verify tracker is enabled in config
- Check system logs for low-HF detections
- Adjust threshold if needed

### Issue: High Mismatch Rate

**Symptoms:**
```
[verify] Mismatches: 50/100
```

**Causes:**
1. Bug in HF calculation logic
2. Price feed inconsistencies
3. Reserve configuration mismatch

**Resolution:**
1. Review mismatch details in output
2. Check for common patterns (specific reserves, price sources)
3. File issue with reproduction case

### Issue: Archive Verification Timeouts

**Symptoms:**
```
[verify] Errors: 10 verification errors
```

**Causes:**
1. Archive node overloaded
2. Timeout too aggressive
3. Network issues

**Resolution:**
- Increase `LOW_HF_ARCHIVE_TIMEOUT_MS`
- Reduce sample size
- Use Mode A instead

## Development

### Adding Extended Tracking to New Code Paths

When capturing low-HF data with reserve details:

```typescript
import { LowHFExtendedEntry, LowHFReserveDetail } from './services/LowHFTracker.js';

// Build reserve details
const reserves: LowHFReserveDetail[] = [];
for (const userReserve of user.reserves) {
  const priceMetadata = priceService.getPriceMetadata(symbol);
  
  reserves.push({
    tokenAddress: reserve.address,
    symbol: reserve.symbol,
    tokenDecimals: reserve.decimals,
    collateralRaw: collateralBalance.toString(),
    debtRaw: debtBalance.toString(),
    collateralUsd: collateralValue,
    debtUsd: debtValue,
    liquidationThresholdBps: reserve.liquidationThreshold,
    liquidationBonusBps: reserve.liquidationBonus,
    ltvBps: reserve.ltv,
    priceSource: priceMetadata.source,
    priceAnswerRaw: priceMetadata.answerRaw,
    priceDecimals: priceMetadata.decimals,
    priceRoundId: priceMetadata.roundId,
    priceUpdatedAt: priceMetadata.updatedAt
  });
}

// Compute weighted collateral
let weightedCollateralUsd = 0;
for (const r of reserves) {
  weightedCollateralUsd += r.collateralUsd * (r.liquidationThresholdBps / 10000);
}

// Compute HF
const recomputedHf = totalDebtUsd > 0 
  ? weightedCollateralUsd / totalDebtUsd 
  : Infinity;

// Create extended entry
const entry: LowHFExtendedEntry = {
  timestamp: new Date().toISOString(),
  blockNumber,
  blockHash,
  trigger: 'head',
  user: userAddress,
  reportedHfFloat: healthFactor,
  reportedHfRawBps: Math.floor(healthFactor * 10000),
  reserves,
  weightedCollateralUsd,
  totalCollateralUsd,
  totalDebtUsd,
  recomputedHf,
  deltaReportedVsRecomputed: Math.abs(healthFactor - recomputedHf)
};

// Record
lowHfTracker.recordExtended(entry);
```

### Testing

```bash
# Unit tests
npm test

# Integration test with mock data
npm run test:lowhf-tracker

# Verification script test
npm run verify:lowhf-dump /tmp/test-dump.json
```

## Future Enhancements

### Planned Features

1. **Archive Node Integration**
   - Complete Mode B/C implementation
   - Parallel verification for performance
   - Result caching

2. **Compression**
   - gzip dump files to reduce storage
   - Maintain JSON readability option

3. **WebSocket Streaming**
   - Real-time low-HF entry streaming
   - Live monitoring dashboards

4. **CLI Tools**
   - `lowhf query --address 0x...` - Fetch entry by address
   - `lowhf diff dump1.json dump2.json` - Compare dumps
   - `lowhf stats dump.json` - Statistical analysis

5. **Grafana Integration**
   - Dashboard templates
   - Alert rules for mismatches

## Support

For issues, questions, or feature requests:
- GitHub Issues: [LiquidBot Repository]
- Documentation: `/backend/docs/`
- Examples: `/backend/examples/`
