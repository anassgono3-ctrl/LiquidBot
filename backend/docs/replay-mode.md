# Historical Replay Mode

## Overview

The Historical Replay Mode is a deterministic validation tool designed to test and validate the Tier 0/1 performance infrastructure (fast subset micro-verify, predictive indexing, risk ordering) before advancing to Phase 2 (live execution).

Replay mode reconstructs liquidation opportunities and timing from historical block ranges without signing or broadcasting any transactions.

## Purpose

- **Pre-validation**: Test performance infrastructure changes against known historical data
- **Detection Latency Analysis**: Measure how quickly the system would have detected liquidatable positions
- **Candidate Breadth Assessment**: Evaluate the completeness of candidate discovery mechanisms
- **Missed Opportunity Analysis**: Identify users who became liquidatable and understand why they would or would not have been executed under current configuration

## Usage

### Basic Usage

```bash
REPLAY=1 REPLAY_BLOCK_RANGE=38393176-38395221 npm run replay
```

### Environment Variables

Only two environment variables are needed for replay mode:

- **`REPLAY`**: Must be set to `1` to enable replay mode
- **`REPLAY_BLOCK_RANGE`**: Block range in format `START-END` (e.g., `38393176-38395221`)

### Example with RPC URL

```bash
REPLAY=1 \
REPLAY_BLOCK_RANGE=38393176-38395221 \
RPC_URL=https://mainnet.base.org \
npm run replay
```

### Requirements

- **RPC URL**: An archival RPC node with historical state access (set via `RPC_URL` or `WS_RPC_URL`)
- **Block Range**: Maximum span of 100,000 blocks per replay run

## Safety Features

Replay mode implements multiple safety overrides to ensure complete isolation from production:

1. **No Execution**: All execution attempts return immediately with `reason: 'replay_mode_active'`
2. **No Notifications**: All Telegram notifications are suppressed
3. **No Side Effects**: Production caches, queues, and Redis keys remain untouched
4. **Dummy Secrets**: Safe dummy values are injected for required secrets (API_KEY, JWT_SECRET) to avoid validation errors

## Output Artifacts

### Per-Block NDJSON Log

Location: `./replay/replay-<START>-<END>.ndjson`

Each line contains metrics for a single block:

```json
{
  "block": 38393176,
  "timestamp": 1234567890,
  "candidateCount": 150,
  "liquidatableCount": 3,
  "minHF": 0.987,
  "newLiquidatables": ["0xabc...def"],
  "durationMs": 234
}
```

Fields:
- `block`: Block number
- `timestamp`: Block timestamp (Unix epoch)
- `candidateCount`: Number of candidates evaluated
- `liquidatableCount`: Number of users with HF < 1.0 in this block
- `minHF`: Minimum health factor observed (null if no liquidatable users)
- `newLiquidatables`: Array of addresses that crossed HF < 1.0 for the first time
- `durationMs`: Processing time for this block

### Summary JSON

Location: `./replay/replay-<START>-<END>-summary.json`

Aggregated metrics across the entire replay:

```json
{
  "startBlock": 38393176,
  "endBlock": 38395221,
  "totalBlocks": 2046,
  "totalUniqueLiquidatableUsers": 12,
  "earliestLiquidationBlock": 38393180,
  "totalLiquidatableEvents": 47,
  "avgDurationMs": 245.3,
  "minHF": 0.923,
  "generatedAt": "2024-11-19T23:45:00.000Z"
}
```

Fields:
- `startBlock`, `endBlock`: Range processed
- `totalBlocks`: Number of blocks processed
- `totalUniqueLiquidatableUsers`: Count of unique addresses that became liquidatable
- `earliestLiquidationBlock`: First block where HF < 1.0 was detected (null if none)
- `totalLiquidatableEvents`: Total number of liquidatable observations across all blocks
- `avgDurationMs`: Average processing time per block
- `minHF`: Global minimum health factor observed (null if none)
- `generatedAt`: ISO timestamp of summary generation

## Current Limitations

The current implementation provides a scaffold for replay mode with the following areas for future enhancement:

1. **Price Resolution**: Prices are not yet resolved at historical blocks. Full implementation would integrate with PriceService/AaveOracle using `blockTag` parameter.

2. **Candidate Discovery**: Candidate sets are currently empty placeholders. Full implementation would integrate with hotlist/watch logic or BorrowersIndex.

3. **Health Factor Computation**: HF calculations are not yet implemented. Full implementation would call HealthFactorResolver or similar with block-pinned queries.

4. **Historical Liquidation Detection**: Stub for parsing `LiquidationCall` events from historical blocks. Depends on service abstraction readiness.

These limitations are intentional to maintain minimal scope while establishing the replay infrastructure and safety guarantees.

## Extension Notes

When extending replay mode functionality:

1. **Block Pinning**: Use `{ blockTag: blockNumber }` in all provider calls to ensure historical state access
2. **Archival Requirements**: Ensure RPC endpoint supports archival queries (especially for Base mainnet)
3. **Rate Limiting**: Consider adding delays between block queries if hitting rate limits
4. **Memory Management**: For large block ranges, consider streaming output to avoid memory issues
5. **Metrics Integration**: Future versions may emit Prometheus metrics for latency distribution analysis

## Validation Workflow

1. **Before Code Changes**: Run replay over a representative historical range to establish baseline metrics
2. **After Code Changes**: Run same replay to measure performance improvements/regressions
3. **Compare Outputs**: Diff NDJSON logs to identify changes in detection timing, candidate breadth, or missed opportunities
4. **Advance with Confidence**: Only enable live execution (Phase 2) after validating improvements in replay mode

## Troubleshooting

### "REPLAY_BLOCK_RANGE required when REPLAY=1"

Ensure `REPLAY_BLOCK_RANGE` is set with format `START-END`.

### "Invalid REPLAY_BLOCK_RANGE format"

Check that:
- Format is exactly `START-END` with numeric values
- No spaces around the dash
- Both numbers are valid positive integers

### "REPLAY_BLOCK_RANGE span too large"

The span (END - START + 1) exceeds 100,000 blocks. Split into smaller ranges.

### "RPC_URL or WS_RPC_URL required for replay mode"

Set one of these environment variables to point to an archival RPC endpoint.

### "Block X not found"

The RPC node doesn't have historical data for the requested block. Ensure you're using an archival node, not a pruned node.

## Example Session

```bash
$ REPLAY=1 REPLAY_BLOCK_RANGE=38393176-38393200 RPC_URL=https://mainnet.base.org npm run replay

[replay-cli] Starting historical replay mode
[replay-cli] Parsed block range: 38393176 to 38393200
[replay-cli] Replay configuration:
[replay-cli]   Block range: 38393176-38393200
[replay-cli]   Total blocks: 25
[replay-cli]   RPC URL: https://mainnet.base.org
[replay-cli]   Safety overrides: EXECUTE=false, DRY_RUN_EXECUTION=true
[replay] Starting replay from block 38393176 to 38393200 (25 blocks)
[replay] Connected to RPC: https://mainnet.base.org
[replay] Writing per-block metrics to: /path/to/replay/replay-38393176-38393200.ndjson
[replay] Progress: block 38393176/38393200 (4.0%) candidates=0 liquidatable=0 newLiq=0 duration=145ms
[replay] Progress: block 38393200/38393200 (100.0%) candidates=0 liquidatable=0 newLiq=0 duration=132ms
[replay] Completed per-block metrics write to /path/to/replay/replay-38393176-38393200.ndjson
[replay] Summary written to: /path/to/replay/replay-38393176-38393200-summary.json

[replay] === REPLAY SUMMARY ===
[replay] Blocks processed: 25
[replay] Unique liquidatable users: 0
[replay] Earliest liquidation block: N/A
[replay] Total liquidatable events: 0
[replay] Average processing time: 138.50ms per block
[replay] Global minimum HF: N/A
[replay] === END SUMMARY ===

[replay] Replay completed successfully
[replay-cli] Replay completed successfully
```

## Future Enhancements

Potential extensions beyond the current scope:

- **Profit/Gas Simulation**: Estimate profitability and gas costs for detected opportunities
- **Transaction Building**: Generate (but don't broadcast) liquidation calldata
- **Parallel Processing**: Process multiple blocks concurrently for faster replay
- **Diff Mode**: Compare two replay runs to highlight changes
- **Export Formats**: CSV, Parquet, or database export for analysis tools
- **Web UI**: Visualization dashboard for replay metrics
