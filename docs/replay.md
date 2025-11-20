# Historical Replay Mode

## Overview

Historical Replay Mode enables deterministic analysis of the liquidation bot's performance across past block ranges. By "time traveling" through historical data, you can:

- **Measure Coverage**: How many liquidations did we detect vs miss?
- **Analyze Lead Time**: How early did we detect liquidatable positions?
- **Tune Thresholds**: Experiment with MIN_DEBT_USD and MIN_PROFIT_USD settings
- **Benchmark Performance**: Measure scanning latency and identify bottlenecks
- **Validate Logic**: Test detection heuristics against real historical data

All replay execution is **safe by design**—no transactions are broadcast to the public chain.

## Quick Start

### 1. Configure Environment

Create a `.env` file or set environment variables:

```bash
# Enable replay mode
REPLAY_ENABLED=true

# Define block range (Base chain example)
REPLAY_START_BLOCK=38393176
REPLAY_END_BLOCK=38395221
REPLAY_CHAIN_ID=8453

# Replay behavior
REPLAY_MODE=simulate          # observe | simulate | hybrid | exec-fork
REPLAY_SPEED=accelerated      # realtime | accelerated | max

# Data sources
REPLAY_PRICE_SOURCE=oracle    # oracle | subgraph | mixed

# Output configuration
REPLAY_EXPORT_DIR=./replay/out
REPLAY_COMPARE_WITH_ONCHAIN=true

# Required: RPC configuration
RPC_URL=https://your-archive-node-url
AAVE_POOL_ADDRESS=0x...
AAVE_ORACLE=0x...

# Optional: Subgraph for ground truth
SUBGRAPH_URL=https://your-subgraph-url

# Safety: Execution must be disabled
EXECUTION_ENABLED=false
```

### 2. Run Replay

```bash
cd backend
npm run replay
```

### 3. Analyze Results

Results are written to `REPLAY_EXPORT_DIR` as JSONL files:

- `blocks.jsonl`: Per-block metrics
- `candidates.jsonl`: Per-candidate details
- `missed.jsonl`: Missed liquidations
- `summary.jsonl`: Final aggregated statistics

## Configuration Reference

### Core Settings

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REPLAY_ENABLED` | boolean | `false` | Enable replay mode |
| `REPLAY_MODE` | enum | `simulate` | Execution mode (see below) |
| `REPLAY_START_BLOCK` | number | - | First block to replay (required) |
| `REPLAY_END_BLOCK` | number | - | Last block to replay (required) |
| `REPLAY_CHAIN_ID` | number | `8453` | Chain ID (Base default) |

### Replay Modes

- **`observe`**: Candidate detection only, no simulation
- **`simulate`**: Perform `callStatic` liquidation to assess success
- **`hybrid`**: Simulate only candidates above profit/HF thresholds
- **`exec-fork`**: Execute against local Anvil/Foundry fork (never broadcasts)

### Performance Controls

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REPLAY_SPEED` | enum | `accelerated` | Playback speed |
| `REPLAY_BLOCK_STEP` | number | `1` | Process every N blocks |
| `REPLAY_SLEEP_MS` | number | `0` | Override sleep between blocks |

**Speed Modes:**
- `max`: No delays, process as fast as possible
- `accelerated`: 100ms between blocks
- `realtime`: ~2s delays to simulate actual block times

### Data Sources

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REPLAY_PRICE_SOURCE` | enum | `oracle` | Price data source |
| `REPLAY_COMPARE_WITH_ONCHAIN` | boolean | `true` | Load ground truth liquidations |

**Price Sources:**
- `oracle`: Use on-chain oracle prices at historical blocks
- `subgraph`: Use subgraph price data (if available)
- `mixed`: Prefer oracle, fallback to subgraph

### Output Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REPLAY_EXPORT_DIR` | string | `./replay/out` | Output directory for JSONL files |
| `REPLAY_LOG_CALDATA` | boolean | `true` | Include calldata in logs |
| `REPLAY_LOG_MISSED` | boolean | `true` | Write missed.jsonl |

### Error Handling

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REPLAY_PAUSE_ON_ERROR` | boolean | `true` | Stop after max errors |
| `REPLAY_MAX_BLOCK_ERRORS` | number | `10` | Max block errors before stopping |

### Threshold Overrides

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REPLAY_INCLUDE_LOW_DEBT` | boolean | `false` | Include positions below MIN_DEBT_USD |
| `REPLAY_FORCE_MIN_DEBT_USD` | number | - | Override MIN_DEBT_USD for analysis |
| `REPLAY_FORCE_MIN_PROFIT_USD` | number | - | Override MIN_PROFIT_USD for analysis |

### Fork Execution (exec-fork mode)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REPLAY_LOCAL_FORK_URL` | string | - | Local fork URL (required for exec-fork) |
| `REPLAY_FORK_AUTO_ADVANCE` | boolean | `true` | Auto-advance fork blocks |

## Output Format

### blocks.jsonl

Per-block metrics:

```json
{
  "type": "block",
  "block": 38393492,
  "timestamp": 1732053484,
  "scanLatencyMs": 182,
  "candidates": 42,
  "onChainLiquidations": 7,
  "missed": ["0xd353...a6ca"],
  "falsePositives": ["0x0860...d1ff"]
}
```

### candidates.jsonl

Per-candidate details:

```json
{
  "type": "candidate",
  "block": 38393492,
  "user": "0x9bba...d02f",
  "hf": 0.9873,
  "debtUSD": 1504.53,
  "collateralUSD": 1572.23,
  "profitEstUSD": 37.70,
  "wouldSend": true,
  "simulation": "ok",
  "onChainLiquidated": true,
  "classification": "detected"
}
```

**Classifications:**
- `detected`: User was liquidated on-chain at same or later block
- `false-positive`: User was never liquidated on-chain
- `unexecuted`: User could have been liquidated but wasn't

### missed.jsonl

Missed liquidations:

```json
{
  "type": "missed",
  "block": 38393492,
  "user": "0xabc...def",
  "txHash": "0x123...456",
  "reason": "not-detected"
}
```

### summary.jsonl

Final aggregated statistics:

```json
{
  "type": "summary",
  "blocks": 2046,
  "candidates": 12344,
  "onChainLiquidations": 91,
  "detected": 88,
  "missed": 3,
  "falsePositives": 27,
  "coverageRatio": 0.967,
  "avgLeadBlocks": 1.2,
  "medianLeadBlocks": 1.0,
  "minLeadBlocks": 0,
  "maxLeadBlocks": 5,
  "avgProfitUSD": 45.23,
  "totalScanLatencyMs": 372840,
  "avgScanLatencyMs": 182.15
}
```

## Use Cases

### 1. Coverage Analysis

Measure what percentage of liquidations you detected:

```bash
REPLAY_ENABLED=true \
REPLAY_START_BLOCK=38393176 \
REPLAY_END_BLOCK=38395221 \
REPLAY_MODE=observe \
REPLAY_SPEED=max \
npm run replay
```

Check `summary.jsonl` for `coverageRatio`.

### 2. Threshold Tuning

Experiment with different debt thresholds:

```bash
REPLAY_ENABLED=true \
REPLAY_FORCE_MIN_DEBT_USD=100 \
REPLAY_FORCE_MIN_PROFIT_USD=10 \
npm run replay
```

Compare coverage vs false positive rate.

### 3. Lead Time Optimization

Measure how early you detect liquidations:

```bash
REPLAY_ENABLED=true \
REPLAY_MODE=simulate \
npm run replay
```

Check `avgLeadBlocks` and `medianLeadBlocks` in summary.

### 4. Performance Benchmarking

Identify scanning bottlenecks:

```bash
REPLAY_ENABLED=true \
REPLAY_SPEED=max \
npm run replay
```

Analyze `scanLatencyMs` in blocks.jsonl.

## Safety Features

### Forced Execution Disable

Replay mode **enforces** `EXECUTION_ENABLED=false`. If you set it to `true`, the CLI will exit with an error. This prevents accidental mainnet transactions.

### Private Key Redaction

All logs automatically redact private keys and sensitive credentials.

### No Broadcast Guarantee

In `exec-fork` mode, transactions are sent only to the local fork. No broadcast to public mempool.

## Performance Tips

### 1. Use Archive Nodes

Historical state queries require an archive node. Public RPC endpoints often have limited history.

### 2. Manage Rate Limits

For large block ranges, consider:
- Using `REPLAY_BLOCK_STEP > 1` to sample
- Adding `REPLAY_SLEEP_MS` to throttle
- Batching multiple replays with smaller ranges

### 3. Optimize Ground Truth Loading

Loading events from subgraph is faster than on-chain logs:
- Set `SUBGRAPH_URL` if available
- Use `REPLAY_COMPARE_WITH_ONCHAIN=false` if you don't need ground truth

### 4. Accelerated Playback

For initial testing, use small ranges:

```bash
REPLAY_START_BLOCK=38393176
REPLAY_END_BLOCK=38393276  # Just 100 blocks
REPLAY_SPEED=max
```

## Troubleshooting

### "Block not found" errors

Your RPC node doesn't have historical data for the requested blocks. Use an archive node or reduce `REPLAY_START_BLOCK`.

### "Max block errors exceeded"

Your RPC is timing out or rate-limiting. Try:
- Increasing `REPLAY_MAX_BLOCK_ERRORS`
- Adding `REPLAY_SLEEP_MS=1000`
- Using `REPLAY_BLOCK_STEP=10` to sample

### Low coverage ratio

Possible causes:
- Candidate detection logic needs tuning
- Thresholds (MIN_DEBT_USD) too restrictive
- Price feeds not available for historical blocks

Check `missed.jsonl` for details.

## Integration with Live Mode

Replay mode is **isolated** from live operation:
- When `REPLAY_ENABLED=false`, live mode runs normally
- No interference between modes
- Configuration changes don't affect live execution

## Future Enhancements

Planned features (out of scope for initial PR):
- Predictive modeling integration
- Multi-RPC write racing simulation
- GUI visualization of replay metrics
- Automatic threshold optimization

## Examples

### Complete Example: Base Chain Analysis

```bash
# Set environment
export REPLAY_ENABLED=true
export REPLAY_START_BLOCK=38393176
export REPLAY_END_BLOCK=38395221
export REPLAY_CHAIN_ID=8453
export REPLAY_MODE=simulate
export REPLAY_SPEED=accelerated
export REPLAY_EXPORT_DIR=./replay/base-nov-2024
export RPC_URL=https://base-mainnet.infura.io/v3/YOUR_KEY
export AAVE_POOL_ADDRESS=0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
export AAVE_ORACLE=0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156
export EXECUTION_ENABLED=false

# Run replay
npm run replay

# Analyze results
cat ./replay/base-nov-2024/summary.jsonl | jq .
```

### Quick Test: 10 Blocks

```bash
REPLAY_ENABLED=true \
REPLAY_START_BLOCK=38393176 \
REPLAY_END_BLOCK=38393186 \
REPLAY_MODE=observe \
REPLAY_SPEED=max \
EXECUTION_ENABLED=false \
npm run replay
```

## References

- [Architecture Documentation](./ARCHITECTURE.md)
- [Phase 2 Implementation Plan](./phase2-core-implementation.md)
- [Aave V3 Liquidation Docs](https://docs.aave.com/developers/core-contracts/pool#liquidationcall)
