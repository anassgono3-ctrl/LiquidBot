# Historical Replay Harness

## Overview

The historical replay harness reconstructs liquidation eligibility and detection timing over a specified Base block range. It enables post-hoc analysis of the bot's coverage, detection lag, and execution readiness against actual on-chain liquidation events.

## Purpose

- **Measure detection coverage**: What % of on-chain liquidations were detected (HF < 1.0) before execution?
- **Measure execution readiness**: What % of liquidations would have been executed (passed profit filters)?
- **Analyze lag**: How many blocks between first detection and actual liquidation?
- **Classify misses**: Why were liquidations missed? (below min debt, watch set gap, profit filter, etc.)

## Usage

### Basic Command

```bash
REPLAY=1 REPLAY_BLOCK_RANGE=38393176-38395221 npm run replay
```

Or from the root:

```bash
REPLAY=1 REPLAY_BLOCK_RANGE=38393176-38395221 yarn replay
```

### Required Environment Variables

- `REPLAY=1` - Enables replay mode
- `REPLAY_BLOCK_RANGE=start-end` - Block range to analyze (inclusive)
- `RPC_URL` - RPC endpoint with archival block access
- `AAVE_POOL_ADDRESS` or `AAVE_POOL` - Aave V3 Pool contract address
- `AAVE_ORACLE` - Aave Oracle contract address

### Optional Configuration

The replay harness automatically uses existing configuration for:
- `MIN_DEBT_USD` - Minimum debt threshold for execution
- `MIN_PROFIT_AFTER_GAS_USD` - Minimum profit threshold
- `GAS_COST_USD` - Estimated gas cost

**Note:** Replay mode automatically sets:
- `EXECUTION_ENABLED=false`
- `DRY_RUN_EXECUTION=true`

These cannot be overridden to prevent accidental on-chain transactions during replay.

## Output Artifacts

All outputs are written to `replay/output/`:

### 1. liquidations.csv

CSV file with one row per liquidation event:

```csv
user,txHash,txBlock,seizedUSD,debtUSD,firstLiquidatableBlock,earliestWouldExecuteBlock,detectionLag,executionLag,missReason
0x1234...,0xabc...,38393200,1000.50,900.00,38393195,38393198,5,2,success
0x5678...,0xdef...,38393500,2000.00,1800.00,,,,,watch_set_gap
```

**Columns:**
- `user` - Liquidated user address
- `txHash` - Transaction hash of liquidation
- `txBlock` - Block number of liquidation
- `seizedUSD` - Collateral seized in USD
- `debtUSD` - Debt repaid in USD
- `firstLiquidatableBlock` - First block where HF < 1.0 (empty if never detected)
- `earliestWouldExecuteBlock` - First block where execution would have occurred (empty if never passed filters)
- `detectionLag` - Blocks from first detection to liquidation (empty if not detected)
- `executionLag` - Blocks from execution readiness to liquidation (empty if never ready)
- `missReason` - Reason for miss (see below)

### 2. summary.json

JSON file with aggregate statistics:

```json
{
  "totalLiquidations": 50,
  "detectionCoveragePct": 92.0,
  "executionCoveragePct": 78.0,
  "medianDetectionLagBlocks": 3.5,
  "medianExecutionLagBlocks": 2.0,
  "missedByReason": {
    "success": 39,
    "below_min_debt": 3,
    "watch_set_gap": 4,
    "profit_filter": 4,
    "unknown": 0
  },
  "totalPotentialProfitMissedUSD": 1250.00
}
```

**Fields:**
- `totalLiquidations` - Total liquidation events in range
- `detectionCoveragePct` - % of liquidations detected before execution
- `executionCoveragePct` - % of liquidations that would have been executed
- `medianDetectionLagBlocks` - Median blocks from detection to liquidation
- `medianExecutionLagBlocks` - Median blocks from execution readiness to liquidation
- `missedByReason` - Count of liquidations by miss reason
- `totalPotentialProfitMissedUSD` - Total missed profit (excluding successes)

### 3. Console Output

The harness prints:
- Progress updates during replay
- Final summary table
- Top 10 largest missed opportunities by potential profit

## Miss Reason Classification

- `success` - Liquidation would have been executed (earliestWouldExecuteBlock <= txBlock)
- `below_min_debt` - Debt was below MIN_DEBT_USD threshold
- `watch_set_gap` - User never appeared in candidate set before liquidation
- `profit_filter` - Detected but didn't pass profit filter
- `unknown` - Other reasons (should be rare)

## Interpreting Results

### High Detection Coverage (>90%)

Indicates the candidate generation and HF calculation logic successfully identifies liquidatable users.

### Low Execution Coverage (<70%)

May indicate:
- MIN_DEBT_USD threshold is too high
- Profit filters are too conservative
- Gas cost estimates are too high

Check the `missedByReason` breakdown to identify the primary cause.

### Large Detection Lag

If median detection lag is >5 blocks, consider:
- Increasing candidate refresh frequency
- Enabling more aggressive HF thresholds for watch set inclusion
- Investigating price feed update delays

### Watch Set Gaps

If many misses are due to `watch_set_gap`, investigate:
- Subgraph refresh intervals
- On-chain backfill configuration
- Candidate discovery logic

## Examples

### Analyze Recent Range

```bash
# Get current block first
cast block-number

# Replay last 2000 blocks
REPLAY=1 REPLAY_BLOCK_RANGE=38393000-38395000 npm run replay
```

### Compare Two Periods

```bash
# Before optimization
REPLAY=1 REPLAY_BLOCK_RANGE=38390000-38392000 npm run replay
mv replay/output/summary.json replay/output/summary-before.json

# After optimization
REPLAY=1 REPLAY_BLOCK_RANGE=38393000-38395000 npm run replay
mv replay/output/summary.json replay/output/summary-after.json

# Compare results
diff replay/output/summary-before.json replay/output/summary-after.json
```

## Limitations

### Simplified Execution Simulation

The current implementation uses a simplified execution check based on debt size and estimated profit. It does NOT:
- Build actual liquidation calldata
- Perform eth_call simulation
- Check swap route availability
- Account for gas price variations

Future enhancements may add full simulation.

### Single User Tracking

The harness tracks only users that appear in liquidation events. It does not:
- Scan all protocol users
- Test candidate generation from scratch
- Simulate real-time discovery

### Memory Constraints

Large block ranges (>10,000 blocks) may consume significant memory. Consider:
- Breaking into smaller ranges
- Adding streaming CSV writes (future enhancement)

## Troubleshooting

### Error: "This RPC endpoint may not support archival block access"

Your RPC provider does not support querying historical block state. You need:
- An archival RPC endpoint
- Public options: Alchemy, Infura, QuickNode (with archival access)
- Or run your own archival node

### Error: "REPLAY_BLOCK_RANGE is required when REPLAY=1"

Set the block range environment variable:

```bash
export REPLAY_BLOCK_RANGE=38393176-38395221
```

### Empty CSV / Zero Liquidations

No liquidation events occurred in the specified range. Try:
- Expanding the block range
- Checking if the range covers a period with market volatility

## Future Enhancements

- Full eth_call liquidation simulation
- Parallel block processing for speed
- Gas price sensitivity analysis
- Profit sensitivity scenarios
- Multi-window replay comparison
- Streaming CSV writes for large ranges

## Related Documentation

- [OPERATIONS.md](./OPERATIONS.md) - Bot operation guide
- [EXECUTION_ACCELERATION.md](./EXECUTION_ACCELERATION.md) - Execution optimization
- [LOW_HF_TRACKER_IMPLEMENTATION.md](./LOW_HF_TRACKER_IMPLEMENTATION.md) - Detection monitoring
