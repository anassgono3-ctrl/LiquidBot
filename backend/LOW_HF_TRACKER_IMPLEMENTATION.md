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
- `liquidbot_lowhf_min_hf` - Histogram of minimum health factors (buckets: 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.5)
- `liquidbot_lowhf_mismatch_total` - Verification mismatches detected

### 7. **Periodic Summary Logging**
Optional periodic logs (configurable interval, default: 15 minutes):
```
[lowhf-tracker] summary: entries=425/1000 minHF=0.9523 mode=all elapsed=900s
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
```

The threshold for what constitutes "low HF" is controlled by the existing `ALWAYS_INCLUDE_HF_BELOW` configuration (default: 1.10), which is also used for head-check prioritization.

## Dump File Format

```json
{
  "metadata": {
    "timestamp": "2025-11-08T17:40:10.123Z",
    "mode": "all",
    "count": 425,
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
          "asset": "0xabcd...",
          "symbol": "WETH",
          "ltv": 0.80,
          "liquidationThreshold": 0.85,
          "collateralUsd": 10000.00,
          "debtUsd": 0,
          "sourcePrice": "chainlink:0xfeed..."
        }
      ]
    }
  ]
}
```

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
   - No additional RPC calls

3. **Shutdown** (`stop` method):
   - Dumps tracker data if `LOW_HF_DUMP_ON_SHUTDOWN=true`
   - Stops periodic summary timer

## Performance Considerations

### Memory Usage
- Bounded by `LOW_HF_TRACKER_MAX` (default: 1000 entries)
- Each entry: ~200-500 bytes (depends on reserve count in 'all' mode)
- Max memory footprint: ~0.5-1 MB for 1000 entries

### CPU Overhead
- Negligible: only records data already computed
- No additional cryptographic operations or encoding

### I/O Impact
- Dump only on shutdown (one-time cost)
- Optional periodic logging (default: every 15 minutes)

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

### High memory usage
- Reduce `LOW_HF_TRACKER_MAX`
- Switch to `mode=min` to track only the lowest HF per batch

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
