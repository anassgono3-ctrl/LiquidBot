# Historical Replay Mode

This module implements a fully functional historical replay mode that mirrors normal runtime (npm start) behavior while remaining strictly read-only for Phase 2 validation.

## Features

- **Event-driven replay**: Decodes and feeds historical on-chain events (ReserveDataUpdated, Borrow, Repay, Withdraw, Supply, LiquidationCall, Price Oracle updates) into existing handlers
- **Detection lag metrics**: Tracks when users are first detected as liquidatable vs when they are actually liquidated
- **Read-only execution**: No transaction signing, no notifications
- **Namespace isolation**: All Redis keys use `replay:` prefix
- **Comprehensive outputs**: NDJSON per-block logs and JSON summary with metrics

## Usage

```bash
# Set environment variables
export REPLAY=1
export REPLAY_BLOCK_RANGE=20000000-20001000
export REPLAY_RPC_URL=https://mainnet.base.org  # Or use RPC_URL

# Run replay
npm run replay
```

Or as a single command:

```bash
REPLAY=1 REPLAY_BLOCK_RANGE=20000000-20001000 npm run replay
```

## Configuration

### Environment Variables

- `REPLAY` (required): Set to `1` to enable replay mode
- `REPLAY_BLOCK_RANGE` (required): Block range to replay in format `START-END` (e.g., `20000000-20001000`)
- `REPLAY_RPC_URL` (optional): RPC URL to use for replay. Falls back to `RPC_URL` if not set.

### Configuration Impact

The replay mode respects the following configuration parameters from your environment:

- `HOTLIST_MIN_HF` / `HOTLIST_MAX_HF`: Health factor thresholds for watch set
- `HOTLIST_MIN_DEBT_USD`: Minimum debt for candidate inclusion
- `MIN_DEBT_USD`: Global minimum debt filter
- `PROFIT_MIN_USD`: Minimum profit threshold
- `MICRO_VERIFY_ENABLED`: Fast subset micro-verification
- `PREDICTIVE_ENABLED`: Predictive health factor engine
- `HOT_SET_ENABLED`: Hot/warm/cold set tracking

## Output Files

Replay generates three output files in `/tmp/replay-output/`:

### 1. Block-level NDJSON Log

Format: `replay-blocks-{START}-{END}-{timestamp}.ndjson`

Each line is a JSON object with:

```json
{
  "block": 20000100,
  "timestamp": 1700000000,
  "candidateCount": 5,
  "hotsetCount": 2,
  "nearThresholdCount": 1,
  "fastSubsetSize": 10,
  "predictorTriggers": 0,
  "newHFEntrants": ["0xuser1", "0xuser2"],
  "liquidationCalls": [
    {
      "user": "0xuser1",
      "debtAsset": "0x...",
      "collateralAsset": "0x...",
      "debtToCover": "1000000"
    }
  ],
  "minHF": 0.98,
  "durationMs": 250
}
```

### 2. Summary JSON

Format: `replay-summary-{START}-{END}-{timestamp}.json`

```json
{
  "range": {
    "start": 20000000,
    "end": 20001000
  },
  "totalBlocks": 1001,
  "totalUsersEvaluated": 523,
  "totalUniqueLiquidatableUsers": 15,
  "totalLiquidationEvents": 18,
  "detectionCoveragePct": 88.89,
  "medianDetectionLag": 3,
  "missedCountByReason": {
    "watch_set_gap": 1,
    "min_debt_filter": 1,
    "profit_filter": 0,
    "unknown": 0
  },
  "earliestLiquidationBlock": 20000123,
  "configSnapshot": {
    "hotlistMinHf": 0.99,
    "hotlistMaxHf": 1.03,
    "hotlistMinDebtUsd": 5,
    "minDebtUsd": 10,
    "profitMinUsd": 1,
    "fastSubsetEnabled": true,
    "predictorEnabled": false,
    "microVerifyEnabled": true
  }
}
```

### 3. Detection CSV (Optional)

Format: `replay-summary-{START}-{END}-{timestamp}-detections.csv`

```csv
userAddress,firstDetectBlock,liquidationBlock,detectionLagBlocks,missReason
0xuser1,20000100,20000105,5,
0xuser2,,20000200,,min_debt_filter
0xuser3,20000150,20000152,2,
```

## Detection Lag Metrics

For each liquidation event, the system computes:

- **firstDetectBlock**: First block where HF < 1.0 for the user
- **liquidationBlock**: Block where liquidation occurred
- **detectionLagBlocks**: `liquidationBlock - firstDetectBlock` (null if missed)
- **missReason**: Classification if detection was missed:
  - `watch_set_gap`: User not in watch set
  - `min_debt_filter`: Filtered out by minimum debt threshold
  - `profit_filter`: Filtered out by minimum profit threshold
  - `unknown`: Other reasons

## Architecture

### Components

1. **HistoricalEventFetcher**: Fetches and decodes on-chain events using ethers.js
2. **ReplayMetricsCollector**: Tracks detection metrics and generates summaries
3. **ReplayOutputWriter**: Writes NDJSON and JSON outputs
4. **ReplayService**: Main orchestration service that:
   - Initializes modules (CandidateManager, HotSetTracker, PrecomputeService) in read-only mode
   - Processes events block by block
   - Computes health factors at historical blocks using `getUserAccountData` with block overrides
   - Records detection metrics

### Event Processing Flow

1. Fetch all events in block range (chunked to avoid rate limits)
2. Group events by block
3. For each block:
   - Extract affected users from events
   - Query health factor for each user at that block
   - Track users with HF < 1.0 as "detected"
   - Record liquidation events
   - Compute metrics
   - Write block log entry

### Redis Namespace

All Redis operations use the `replay:` prefix to isolate replay state from production state.

## Limitations

- **RPC intensive**: Queries `getUserAccountData` for every affected user at every block
- **Rate limiting**: May require rate limit adjustments for large block ranges
- **Memory**: Holds all events in memory (may need streaming for very large ranges)

## Best Practices

1. **Start small**: Test with a small block range (e.g., 100-200 blocks) first
2. **Use archive node**: Requires an RPC endpoint with archive/historical state access
3. **Monitor rate limits**: Add delays if hitting rate limits
4. **Check outputs**: Review NDJSON and summary before analyzing results

## Example Workflow

```bash
# 1. Set up environment
export RPC_URL=https://mainnet.base.org
export AAVE_POOL_ADDRESS=0xA238Dd80C259a72e81d7e4664a9801593F98d1c5

# 2. Run replay for a specific range
REPLAY=1 REPLAY_BLOCK_RANGE=20000000-20000100 npm run replay

# 3. Check outputs
ls -lh /tmp/replay-output/

# 4. Analyze summary
cat /tmp/replay-output/replay-summary-*.json | jq .

# 5. Review detection coverage
cat /tmp/replay-output/replay-summary-*.json | jq '.detectionCoveragePct'

# 6. Check median lag
cat /tmp/replay-output/replay-summary-*.json | jq '.medianDetectionLag'
```

## Future Enhancements

- Streaming event processing for very large ranges
- Parallel block processing for faster replays
- Integration with existing pipeline modules (FastSubset, RiskOrdering, etc.)
- Miss reason classification using actual filter logic
- CSV export flag as CLI argument instead of automatic
- Progress reporting during long replays
