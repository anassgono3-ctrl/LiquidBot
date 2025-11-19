# Historical Replay Mode

## Overview

Historical replay mode provides a deterministic, read-only reconstruction of liquidation detection over a fixed block range. This feature allows you to analyze past liquidation opportunities without executing any transactions.

## Features

- **Deterministic Replay**: Reconstructs HF (Health Factor) detection for a specified block interval
- **Read-Only**: No transactions are signed or broadcast; operates in forced dry-run mode
- **Isolated Execution**: Uses namespaced cache prefixes to avoid polluting production data
- **Detailed Metrics**: Generates per-block metrics and aggregate summaries
- **Safety First**: All execution flags are overridden, notifications are disabled

## Configuration

Replay mode requires exactly two environment variables:

### REPLAY

Enable replay mode (boolean flag):

```bash
REPLAY=1
# or
REPLAY=true
```

### REPLAY_BLOCK_RANGE

Specify the block range to replay in format `start-end`:

```bash
REPLAY_BLOCK_RANGE=38393176-38395221
```

**Constraints:**
- Both start and end must be valid non-negative integers
- Start block must be <= end block
- Maximum range size: 100,000 blocks (hard safety cap)

## Usage

### Running Replay Mode

1. Set environment variables in your `.env` file or export them:

```bash
export REPLAY=1
export REPLAY_BLOCK_RANGE=38393176-38395221
```

2. Run the replay script:

```bash
npm run replay
```

### Example

```bash
# In .env file
REPLAY=1
REPLAY_BLOCK_RANGE=38393176-38393276
RPC_URL=https://mainnet.base.org

# Run replay
npm run replay
```

## Output

Replay mode generates two output files in the `./replay` directory:

### 1. NDJSON Metrics File

**Path**: `./replay/replay-{START}-{END}.ndjson`

Newline-delimited JSON file with per-block metrics:

```json
{"block":38393176,"candidateCount":141,"liquidatableCount":2,"minHF":0.9987,"newLiquidatables":["0xabc..."],"durationMs":123}
{"block":38393177,"candidateCount":141,"liquidatableCount":0,"minHF":1.0234,"newLiquidatables":[],"durationMs":98}
```

**Fields:**
- `block`: Block number
- `candidateCount`: Number of candidates checked
- `liquidatableCount`: Number of liquidatable users detected
- `minHF`: Minimum health factor observed in this block
- `newLiquidatables`: Array of newly liquidatable user addresses
- `durationMs`: Processing time for this block in milliseconds

### 2. Summary JSON File

**Path**: `./replay/replay-{START}-{END}-summary.json`

Aggregate metrics for the entire replay:

```json
{
  "startBlock": 38393176,
  "endBlock": 38395221,
  "totalBlocks": 2046,
  "totalLiquidatables": 15,
  "earliestLiquidationBlock": 38393180,
  "totalUniqueLiquidatableUsers": 12,
  "averageDurationMs": 105.3,
  "totalDurationMs": 215442
}
```

**Fields:**
- `startBlock`: Starting block number
- `endBlock`: Ending block number
- `totalBlocks`: Total number of blocks processed
- `totalLiquidatables`: Total liquidatable instances detected
- `earliestLiquidationBlock`: First block where a liquidation was detected (null if none)
- `totalUniqueLiquidatableUsers`: Count of unique user addresses that became liquidatable
- `averageDurationMs`: Average processing time per block
- `totalDurationMs`: Total replay execution time

## Safety Features

### Execution Overrides

When replay mode is enabled:

1. **DRY_RUN_EXECUTION** is forced to `true`
2. **EXECUTE** is forced to `false`
3. **GAS_BURST_DISABLED** is enabled (if flag exists)
4. Write racing is disabled
5. No transactions are signed or broadcast

### Notification Guards

All external notifications are disabled:
- Telegram notifications
- External webhooks
- Alert systems

### Cache Isolation

Replay uses namespaced cache prefixes:
- Format: `replay:{start}-{end}:*`
- No mutation of production Redis keys
- In-memory maps maintain isolation

## Limitations

### Current Implementation

1. **No Candidate Discovery**: The current implementation does not include candidate discovery from events or subgraph. This will be added in future iterations.

2. **No Liquidation Event Extraction**: Detection of on-chain `LiquidationCall` events is marked as TODO and will be implemented when log source abstraction is ready.

3. **No Predictive HF Math**: Uses existing logic only; no additional predictive adjustments beyond current codebase.

4. **No Transaction Simulation**: eth_call-based liquidation simulation is optional and not yet implemented.

### Recommended Use Cases

- Analyzing historical liquidation patterns
- Backtesting detection logic
- Performance benchmarking
- Research and analysis
- Debugging detection issues

### Not Recommended For

- Live execution or real-time monitoring
- Profit calculation (uses current gas prices, not historical)
- Exact recreation of historical executions (uses current code logic)

## Error Handling

### Validation Errors

The CLI will exit with a non-zero code if:
- `REPLAY=1` but `REPLAY_BLOCK_RANGE` is missing
- Block range format is invalid
- Start block > end block
- Range exceeds 100,000 blocks
- RPC_URL is not configured

### Runtime Errors

- Block processing errors are logged but don't stop the replay
- Continues to next block on individual block failures
- Final summary includes only successfully processed blocks

## Performance

### Block Processing Speed

Depends on:
- RPC provider rate limits
- Number of candidates per block
- Network latency
- Multicall batch size

Typical performance: 50-200 blocks/minute on Base mainnet with standard RPC.

### Optimization Tips

1. Use a dedicated RPC endpoint with higher rate limits
2. For long ranges, split into multiple smaller replays
3. Run during off-peak hours to avoid congestion
4. Consider using archive node for historical data

## Troubleshooting

### "RPC_URL must be configured"

Ensure `RPC_URL` or `WS_RPC_URL` is set in your environment:

```bash
RPC_URL=https://mainnet.base.org
```

### "Invalid REPLAY_BLOCK_RANGE format"

Check format is `start-end` with no spaces:

```bash
# Correct
REPLAY_BLOCK_RANGE=38393176-38395221

# Incorrect
REPLAY_BLOCK_RANGE=38393176 - 38395221
```

### "Range exceeds maximum allowed"

Split large ranges into chunks of 100,000 blocks or less:

```bash
# Instead of this (too large)
REPLAY_BLOCK_RANGE=1000000-1200000

# Do this (split into two)
REPLAY_BLOCK_RANGE=1000000-1100000  # First run
REPLAY_BLOCK_RANGE=1100000-1200000  # Second run
```

## Future Enhancements

Planned features for future releases:

1. **Candidate Discovery**: Integration with SubgraphSeeder and OnChainBackfillService
2. **Liquidation Event Extraction**: Parse LiquidationCall events from logs
3. **Historical Price Feeds**: Use block-pinned Chainlink prices
4. **Parallel Processing**: Multi-threaded block processing for faster replay
5. **Resume Capability**: Checkpoint and resume interrupted replays
6. **Custom Filters**: Filter by user addresses, reserves, or HF thresholds
7. **Export Formats**: CSV, Parquet, and database export options

## Support

For issues or questions:
1. Check this documentation
2. Review error messages carefully
3. Ensure environment variables are correctly set
4. Verify RPC endpoint is accessible
5. Check `./replay` directory permissions

## Examples

### Analyze Recent Blocks

```bash
REPLAY=1
REPLAY_BLOCK_RANGE=38400000-38400100
npm run replay
```

### Daily Analysis

```bash
# Approximately 7200 blocks per day on Base (12s block time)
REPLAY=1
REPLAY_BLOCK_RANGE=38393176-38400376
npm run replay
```

### Narrow Investigation

```bash
# Investigate specific incident
REPLAY=1
REPLAY_BLOCK_RANGE=38393200-38393220
npm run replay
```
