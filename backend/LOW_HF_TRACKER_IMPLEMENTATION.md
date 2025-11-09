# Low Health Factor Observability Tracker

## Overview

The Low Health Factor (HF) Tracker is a non-intrusive observability feature that captures detailed per-user snapshots for candidates whose cached health factor falls below a configured threshold (`ALWAYS_INCLUDE_HF_BELOW`). This feature provides operators with confidence that health factor classification and filtering logic are accurate, without introducing any additional RPC calls or performance overhead.

## Key Features

### 1. **In-Memory Tracking**
- Stores detailed snapshots of low-HF user data in bounded memory
- Configurable maximum entries (`LOW_HF_TRACKER_MAX`, default: 1000)
- Two recording modes:
  - **`all` mode**: Captures all low-HF candidates up to the max limit
  - **`min` mode**: Only tracks the single minimum HF candidate per batch

### 2. **Zero Performance Impact**
- Reuses existing batch health check results from `RealTimeHFService`
- No additional on-chain calls or RPC requests
- Minimal memory footprint with bounded storage

### 3. **Graceful Shutdown & Dump**
- Automatically dumps captured data to timestamped JSON files on SIGINT (Ctrl+C)
- Files written to `diagnostics/` directory
- Filename format: `lowhf-dump-YYYY-MM-DDTHH-MM-SS-mmmZ.json`

### 4. **HTTP Endpoints**
Real-time inspection of tracked data while the bot runs:

#### GET /status
Returns summary statistics including:
```json
{
  "lastBlock": 12345678,
  "candidateCount": 150,
  "lastMinHF": 0.9523,
  "lowHfCount": 42
}
```

#### GET /lowhf
Returns paginated low-HF entries with optional reserve details:
- Query parameters:
  - `limit`: Max entries to return (default: 100, max: 1000)
  - `offset`: Pagination offset (default: 0)
  - `includeReserves`: Include reserve breakdown (0=false, 1=true, default: 1)

Example response:
```json
{
  "entries": [
    {
      "address": "0x123...",
      "lastHF": 0.9523,
      "timestamp": 1699458012345,
      "blockNumber": 12345678,
      "triggerType": "head",
      "totalCollateralUsd": 15234.56,
      "totalDebtUsd": 14890.23,
      "reserves": []  // Only in 'all' mode
    }
  ],
  "count": 100,
  "total": 425,
  "limit": 100,
  "offset": 0,
  "minHF": 0.9523
}
```

### 5. **Verification Script**
Validates dump file integrity by:
- Recomputing health factors from stored USD components
- Comparing with reported HF values
- Flagging mismatches beyond 5% tolerance

Usage:
```bash
npm run verify:lowhf diagnostics/lowhf-dump-2025-11-08T17-40-10-123Z.json
```

### 6. **Prometheus Metrics**
- `liquidbot_lowhf_snapshot_total{mode="all|min"}` - Total snapshots captured
- `liquidbot_lowhf_extended_snapshot_total` - Total snapshots captured with per-reserve data (schema v1.1+)
- `liquidbot_lowhf_min_hf` - Histogram of minimum health factors (buckets: 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.5)
- `liquidbot_lowhf_mismatch_total` - Verification mismatches detected

### 7. **Periodic Summary Logging**
Optional periodic logs (configurable interval, default: 15 minutes):
```
[lowhf-tracker] summary: entries=425/1000 minHF=0.9523 mode=all elapsed=900s
```

On dump (graceful shutdown), shows breakdown of basic vs extended entries:
```
[lowhf-tracker] Dump written to diagnostics/lowhf-dump-2025-11-09T12-00-00-000Z.json (425 entries: 38 basic, 387 extended)
```

## Configuration

All configuration is via environment variables in `.env`:

```bash
# Enable/disable the tracker (default: true)
LOW_HF_TRACKER_ENABLED=true

# Maximum in-memory entries (default: 1000)
LOW_HF_TRACKER_MAX=1000

# Recording mode: 'all' or 'min' (default: all)
LOW_HF_RECORD_MODE=all

# Dump on graceful shutdown (default: true)
LOW_HF_DUMP_ON_SHUTDOWN=true

# Periodic summary interval in seconds, 0 to disable (default: 900)
LOW_HF_SUMMARY_INTERVAL_SEC=900

# Enable per-reserve extended data capture (default: true)
# When false, reserves are not stored, reducing memory usage
LOW_HF_EXTENDED_ENABLED=true
```

The threshold for what constitutes "low HF" is controlled by the existing `ALWAYS_INCLUDE_HF_BELOW` configuration (default: 1.10), which is also used for head-check prioritization.

## Dump File Format

### Schema Version 1.1 (Current)

The dump file now includes enhanced metadata and a separate `extendedEntries` array for entries with per-reserve data:

```json
{
  "metadata": {
    "schemaVersion": "1.1",
    "timestamp": "2025-11-09T12:00:00.000Z",
    "mode": "all",
    "count": 425,
    "extendedCount": 387,
    "minHF": 0.9523,
    "threshold": 1.10
  },
  "entries": [
    {
      "address": "0x1234567890abcdef...",
      "lastHF": 0.9523,
      "timestamp": 1699458012345,
      "blockNumber": 12345678,
      "triggerType": "head",
      "totalCollateralUsd": 15234.56,
      "totalDebtUsd": 14890.23,
      "reserves": [
        {
          "asset": "0x4200000000000000000000000000000000000006",
          "symbol": "WETH",
          "ltv": 0.80,
          "liquidationThreshold": 0.825,
          "collateralUsd": 10000.00,
          "debtUsd": 0,
          "sourcePrice": "chainlink:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"
        },
        {
          "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          "symbol": "USDC",
          "ltv": 0.77,
          "liquidationThreshold": 0.80,
          "collateralUsd": 5234.56,
          "debtUsd": 14890.23,
          "sourcePrice": "chainlink:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B"
        }
      ]
    },
    {
      "address": "0xabcdef0123456789...",
      "lastHF": 1.0234,
      "timestamp": 1699458012350,
      "blockNumber": 12345679,
      "triggerType": "head",
      "totalCollateralUsd": 8000.00,
      "totalDebtUsd": 7500.00
    }
  ],
  "extendedEntries": [
    {
      "address": "0x1234567890abcdef...",
      "lastHF": 0.9523,
      "timestamp": 1699458012345,
      "blockNumber": 12345678,
      "triggerType": "head",
      "totalCollateralUsd": 15234.56,
      "totalDebtUsd": 14890.23,
      "reserves": [
        {
          "asset": "0x4200000000000000000000000000000000000006",
          "symbol": "WETH",
          "ltv": 0.80,
          "liquidationThreshold": 0.825,
          "collateralUsd": 10000.00,
          "debtUsd": 0,
          "sourcePrice": "chainlink:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"
        },
        {
          "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          "symbol": "USDC",
          "ltv": 0.77,
          "liquidationThreshold": 0.80,
          "collateralUsd": 5234.56,
          "debtUsd": 14890.23,
          "sourcePrice": "chainlink:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B"
        }
      ]
    }
  ]
}
```

### Schema Fields

#### Metadata
- `schemaVersion` (string): Schema version identifier (e.g., "1.1")
- `timestamp` (string): ISO 8601 timestamp when dump was created
- `mode` (string): Recording mode - "all" or "min"
- `count` (number): Total number of entries in the dump
- `extendedCount` (number): Number of entries with per-reserve data
- `minHF` (number | null): Minimum health factor observed
- `threshold` (number): The ALWAYS_INCLUDE_HF_BELOW threshold used

#### Entry Fields
- `address` (string): User's Ethereum address
- `lastHF` (number): Last recorded health factor
- `timestamp` (number): Unix timestamp (milliseconds) when recorded
- `blockNumber` (number): Block number where HF was checked
- `triggerType` (string): Type of trigger - "event", "head", or "price"
- `totalCollateralUsd` (number): Total collateral in USD
- `totalDebtUsd` (number): Total debt in USD
- `reserves` (array, optional): Per-reserve breakdown (only in extended entries)

#### Reserve Fields (when present)
- `asset` (string): Reserve asset contract address
- `symbol` (string): Token symbol (e.g., "WETH", "USDC")
- `ltv` (number): Loan-to-value ratio (0-1)
- `liquidationThreshold` (number): Liquidation threshold (0-1)
- `collateralUsd` (number): Collateral amount in USD for this reserve
- `debtUsd` (number): Debt amount in USD for this reserve
- `sourcePrice` (string): Price source provenance (e.g., "chainlink:0x...")

### Backward Compatibility

The schema is backward compatible with version 1.0 (implicit). Tools reading dumps should:
1. Check for `schemaVersion` field; if missing, assume version 1.0
2. Handle missing `extendedCount` and `extendedEntries` fields gracefully
3. Fall back to approximate HF verification when reserves are not available

## Verification Workflow

1. **Run bot and accumulate data**:
   ```bash
   npm start
   ```

2. **Graceful shutdown** (Ctrl+C):
   - Bot dumps tracked data to `diagnostics/lowhf-dump-<timestamp>.json`
   - Continues normal shutdown sequence

3. **Verify dump integrity**:
   ```bash
   npm run verify:lowhf diagnostics/lowhf-dump-2025-11-08T17-40-10-123Z.json
   ```

4. **Expected output**:
   ```
   [verify-lowhf] Verifying dump file: diagnostics/lowhf-dump-2025-11-08T17-40-10-123Z.json
   [verify-lowhf] Dump metadata:
     Timestamp: 2025-11-08T17:40:10.123Z
     Mode: all
     Count: 425
     MinHF: 0.9523
     Threshold: 1.10

   [verify-lowhf] Verification results:
     Total entries: 425
     Mismatches (>5%): 0

   ✅ All entries verified successfully!
   ```

## Integration Points

### RealTimeHFService
The tracker integrates seamlessly into the existing real-time health factor monitoring pipeline:

1. **Initialization** (constructor):
   - Creates `LowHFTracker` instance if `LOW_HF_TRACKER_ENABLED=true`

2. **Batch Health Checks** (`batchCheckCandidates`):
   - After decoding each user's health data from Multicall3 results
   - Extracts `totalCollateralUsd` and `totalDebtUsd` from existing results
   - Calls `tracker.record()` if HF < `ALWAYS_INCLUDE_HF_BELOW`
   - **Current Limitation**: Reserve data not yet populated (see below)

3. **Shutdown** (`stop` method):
   - Dumps tracker data if `LOW_HF_DUMP_ON_SHUTDOWN=true`
   - Stops periodic summary timer

### Reserve Data Implementation Status

**Current Status (v1.1 schema ready, data fetching not yet implemented):**

The tracker and dump schema fully support per-reserve data (schema v1.1), but the current implementation does not yet fetch and pass reserve data from `RealTimeHFService`. This means:
- `extendedCount` will be 0 in dump files
- All entries verified using approximate method (80% liquidation threshold)
- Deterministic verification not yet available

**To implement reserve data fetching:**

The challenge is fetching per-reserve data without adding excessive RPC overhead. The current batch check uses `getUserAccountData`, which only returns aggregate totals. Options:

1. **Second-phase multicall** (recommended):
   - After initial batch, identify low-HF users
   - Run secondary multicall batch to fetch per-reserve data for those users only
   - Use `AaveProtocolDataProvider.getUserReserveData(asset, user)` for each active reserve
   - Requires knowing active reserves per user (from events or configuration)

2. **Sequential RPC calls**:
   - Use `AaveDataService.getAllUserReserves(user)` after batch completes
   - Adds N sequential RPC calls where N = number of low-HF users
   - Simpler but slower

3. **Event-based reserve tracking**:
   - Track user's active reserves from Supply/Withdraw/Borrow/Repay events
   - Cache in CandidateManager alongside user state
   - Use cached list for targeted multicall queries

**Implementation location**: `RealTimeHFService.batchCheckCandidates()` around line 1992

See TODO comment in code for detailed implementation notes.

## Performance Considerations

### Memory Usage

**Without Extended Data** (`LOW_HF_EXTENDED_ENABLED=false`):
- Base entry size: ~150-200 bytes per entry
- 1000 entries: ~150-200 KB total
- Bounded by `LOW_HF_TRACKER_MAX` (default: 1000)

**With Extended Data** (`LOW_HF_EXTENDED_ENABLED=true`):
- Base entry: ~150-200 bytes
- Per reserve: ~150-200 bytes (asset, symbol, thresholds, USD values, sourcePrice)
- Typical user: 2-4 active reserves
- Entry with reserves: ~450-800 bytes
- 1000 entries (with reserves): ~450-800 KB total
- **Max footprint estimate**: ~1 MB for 1000 extended entries

**Memory Safety:**
- Total entries bounded by `LOW_HF_TRACKER_MAX`
- When at capacity, highest HF entries evicted to make room for lower HF
- Reserve data only retained for entries meeting HF threshold
- No unbounded growth regardless of runtime duration

**Recommendations:**
- Default settings (1000 max, extended enabled) suitable for most deployments
- High-throughput production: Consider `LOW_HF_TRACKER_MAX=500` or `LOW_HF_EXTENDED_ENABLED=false`
- Development/debugging: Use `LOW_HF_RECORD_MODE=all` with extended data for full observability

### CPU Overhead
- Negligible: only records data already computed
- No additional cryptographic operations or encoding
- Extended data capture adds minimal overhead (simple object copy)
- Prometheus counter increments: sub-microsecond per entry

### I/O Impact
- Dump only on shutdown (one-time cost)
- Optional periodic logging (default: every 15 minutes)
- Typical dump file size: 200 KB - 2 MB (depends on entry count and reserves)

## Best Practices

1. **Start with `mode=all`** for comprehensive diagnostics
2. **Use `mode=min`** in high-throughput production environments to minimize memory
3. **Set appropriate `LOW_HF_TRACKER_MAX`** based on expected candidate volume
4. **Review dumps regularly** to identify patterns in low-HF candidates
5. **Compare verification results** to validate health factor calculations

## Troubleshooting

### Dump file not created on shutdown
- Verify `LOW_HF_DUMP_ON_SHUTDOWN=true` in `.env`
- Check that shutdown was graceful (Ctrl+C, not `kill -9`)
- Ensure `diagnostics/` directory is writable

### Verification shows many mismatches
- Expected if `mode=min` (no per-reserve liquidation thresholds available)
- Liquidation thresholds vary across reserves; approximation uses 80% average
- For accurate verification, use `mode=all` to capture reserve details
- Check if `extendedCount=0` in dump metadata (see below)

### Extended count is 0 (extendedCount=0)
This means no entries have per-reserve data, preventing deterministic verification:

**Causes:**
1. `LOW_HF_EXTENDED_ENABLED=false` - Set to `true` to enable
2. `LOW_HF_RECORD_MODE=min` - Only captures single min entry, often without reserves
3. Reserve data not being passed from RealTimeHFService to tracker.record()
4. No low-HF candidates detected during runtime (all HF > threshold)

**Solutions:**
```bash
# 1. Enable extended tracking
LOW_HF_EXTENDED_ENABLED=true

# 2. Use 'all' mode to capture all low-HF candidates
LOW_HF_RECORD_MODE=all

# 3. Verify reserve data flow in logs (look for "X extended" in dump message)
# Expected: "[lowhf-tracker] Dump written to ... (425 entries: 38 basic, 387 extended)"

# 4. Check RealTimeHFService is fetching and passing reserve data
# (see Integration Points section)
```

### High memory usage
- Reduce `LOW_HF_TRACKER_MAX`
- Switch to `mode=min` to track only the lowest HF per batch
- Set `LOW_HF_EXTENDED_ENABLED=false` to disable per-reserve data (saves ~200-400 bytes per entry)

## Future Enhancements (Out of Scope)

- Persistent database storage for historical analysis
- Automatic upload of dump files to remote storage
- Streaming gRPC/WebSocket feed of low-HF updates
- Daily rotation and automatic compression
- Per-reserve breakdown in `min` mode (requires additional data passing)

## Testing

### Unit Tests
The `LowHFTracker` class is designed to be testable:

```typescript
import { LowHFTracker } from './services/LowHFTracker';

const tracker = new LowHFTracker({
  maxEntries: 10,
  recordMode: 'all',
  dumpOnShutdown: false,
  summaryIntervalSec: 0 // Disable periodic logging for tests
});

// Record a low HF entry
tracker.record(
  '0x123...',
  0.95,
  12345678,
  'head',
  10000,
  9500
);

// Assert
assert.equal(tracker.getCount(), 1);
assert.equal(tracker.getMinHF(), 0.95);
```

### Integration Tests
Test the full workflow with `RealTimeHFService`:

1. Start service with tracker enabled
2. Trigger batch health checks
3. Verify entries are recorded
4. Shutdown and verify dump file creation
5. Run verification script on dump

## References

- [Real-Time HF Service](./src/services/RealTimeHFService.ts)
- [Low HF Tracker](./src/services/LowHFTracker.ts)
- [Verification Script](./scripts/verify-lowhf.ts)
- [Prometheus Metrics](./src/metrics/index.ts)
