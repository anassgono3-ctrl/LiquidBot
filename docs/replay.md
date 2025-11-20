# Historical Replay Mode

## Overview

The Historical Replay Pipeline allows you to "time travel" through past blocks and replay the liquidation bot's detection logic deterministically. This feature helps you:

- **Measure Coverage**: Determine what percentage of historical liquidations your bot would have detected
- **Analyze Lead Time**: Calculate how many blocks before each liquidation you would have detected the opportunity
- **Assess Race Viability**: Evaluate if detected opportunities had sufficient profit and timing to win races
- **Identify Missed Opportunities**: Understand why certain liquidations were missed
- **Optimize Configuration**: Test different thresholds and parameters against historical data

## Key Features

- **Full Block Scan**: Iterates through every block in the specified range
- **Historical State Reconstruction**: Uses blockTag to fetch accurate account data at each historical block
- **Ground Truth Comparison**: Indexes all actual LiquidationCall events as ground truth
- **Comprehensive Classification**: Labels each user as detected, missed, or false_positive
- **Deterministic Output**: Generates reproducible JSONL artifacts for analysis
- **Safety First**: Execution is forcibly disabled - no real transactions are broadcast

## Quick Start

### 1. Configure Environment

Add replay configuration to your `.env` file:

```bash
# Required: RPC endpoint (must support historical queries with blockTag)
RPC_URL=https://mainnet.base.org

# Required: Block range to replay
REPLAY_BLOCK_RANGE=38393176-38395221

# Optional: Replay configuration
REPLAY_ENABLED=true
REPLAY_MODE=pipeline
REPLAY_SCAN_STRATEGY=full
REPLAY_OUTPUT_DIR=./replay/out

# Optional: Universe management
REPLAY_NEAR_HF=1.02              # Keep tracking users below this HF
REPLAY_EVICT_HF=1.08             # Start eviction counter above this HF
REPLAY_EVICT_CONSECUTIVE=5       # Evict after this many consecutive high-HF blocks

# Optional: Simulation
REPLAY_SIMULATE_FIRST_DETECTION=true
REPLAY_SIMULATE_LIQUIDATION_BLOCK=true
REPLAY_PROFIT_GAS_FALLBACK_USD=0.1

# Safety limits
REPLAY_MAX_ACCOUNTS_PER_BLOCK=50000
```

### 2. Run Replay

```bash
# Using environment variable
npm run replay

# Or specify block range directly
npm run replay 38393176 38395221
```

### 3. Review Output

Three JSONL files are generated in `REPLAY_OUTPUT_DIR`:

- **blocks.jsonl**: Per-block metrics (scan time, candidates, detections)
- **candidates.jsonl**: Per-user details (HF, profit, classification, lead time)
- **summary.jsonl**: Overall statistics (coverage, average lead blocks, race viability)

## Configuration Reference

### Core Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `REPLAY_ENABLED` | `false` | Enable replay mode |
| `REPLAY_MODE` | `pipeline` | Replay mode (currently only `pipeline` supported) |
| `REPLAY_BLOCK_RANGE` | - | Block range in format `START-END` |
| `REPLAY_OUTPUT_DIR` | `./replay/out` | Directory for output artifacts |

### Universe Management

The replay system maintains a dynamic "universe" of candidate users to check each block:

| Variable | Default | Description |
|----------|---------|-------------|
| `REPLAY_NEAR_HF` | `1.02` | Keep tracking users with HF below this threshold |
| `REPLAY_EVICT_HF` | `1.08` | Begin eviction counter for users above this HF |
| `REPLAY_EVICT_CONSECUTIVE` | `5` | Evict user after this many consecutive blocks above `REPLAY_EVICT_HF` |
| `REPLAY_MAX_ACCOUNTS_PER_BLOCK` | `50000` | Safety cap on universe size |

**Example**: A user at HF 1.05 stays in the universe. If their HF rises to 1.10 for 5 consecutive blocks, they're evicted to save resources.

### Simulation Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `REPLAY_SIMULATE_FIRST_DETECTION` | `true` | Simulate liquidation at first detection block |
| `REPLAY_SIMULATE_LIQUIDATION_BLOCK` | `true` | Simulate liquidation at actual liquidation block |
| `REPLAY_PROFIT_GAS_FALLBACK_USD` | `0.1` | Gas cost fallback for profit estimation |

### Inherited Settings

Replay also uses these existing configuration values:

- `EXECUTION_HF_THRESHOLD_BPS`: HF threshold for execution eligibility (default: 9800 = 0.98)
- `MIN_PROFIT_USD`: Minimum profit threshold for race viability (default: 10)
- `MULTICALL_BATCH_SIZE`: Batch size for getUserAccountData calls (default: 120)

## Output Format

### blocks.jsonl

One row per block scanned:

```jsonl
{
  "type": "block",
  "block": 38393176,
  "timestamp": 1710849600,
  "scanLatencyMs": 850,
  "candidates": 45,
  "newDetections": 2,
  "onChainLiquidations": 1,
  "missed": 0,
  "detected": 1,
  "falsePositives": 0
}
```

### candidates.jsonl

One row per unique user (sorted by address):

```jsonl
{
  "type": "candidate",
  "block": 38393180,
  "user": "0x1234...",
  "hf": 0.98,
  "debtUSD": 5000.0,
  "collateralUSD": 4900.0,
  "detectionProfitUSD": 125.5,
  "eventProfitUSD": 150.0,
  "firstDetectionBlock": 38393180,
  "liquidationBlock": 38393185,
  "leadBlocks": 5,
  "classification": "detected",
  "simulationStatus": "ok",
  "revertReason": "",
  "raceViable": true,
  "hfAtDetection": 0.98,
  "hfAtLiquidation": 0.96
}
```

**Classification Values**:
- `detected`: User was detected before or at liquidation block
- `missed`: Liquidation occurred without prior detection
- `false_positive`: User was detected but never liquidated
- `pending`: No detection or liquidation (shouldn't appear in final output)

**Simulation Status**:
- `ok`: Simulation succeeded (liquidation would have worked)
- `revert`: Simulation reverted (shows reason in `revertReason`)
- `skipped`: Simulation not performed

### summary.jsonl

Single row with aggregate statistics:

```jsonl
{
  "type": "summary",
  "startBlock": 38393176,
  "endBlock": 38395221,
  "totalBlocks": 2046,
  "groundTruthCount": 15,
  "detected": 12,
  "missed": 3,
  "falsePositives": 8,
  "coverageRatio": 0.80,
  "avgLeadBlocks": 4.5,
  "medianLeadBlocks": 3.0,
  "raceViableCount": 10,
  "detectionProfitTotalUSD": 2500.0,
  "eventProfitTotalUSD": 3000.0,
  "durationMs": 125000,
  "groundTruthAvailable": true
}
```

## Use Cases

### Measure Detection Coverage

```bash
# Replay last week of production
npm run replay 38000000 38100000

# Check summary
cat ./replay/out/summary.jsonl | jq '.'
```

**Key metrics**:
- `coverageRatio`: % of liquidations detected (target: >95%)
- `missed`: Count of undetected liquidations (investigate these)

### Analyze Lead Time Distribution

```bash
# Extract lead blocks for detected events
cat ./replay/out/candidates.jsonl | \
  jq 'select(.classification == "detected") | .leadBlocks' | \
  sort -n
```

**Questions to answer**:
- What's the median lead time? (>2 blocks is good for racing)
- Are there same-block detections? (leadBlocks=0, hard to race)
- What's the distribution tail? (outliers may indicate slow health factor deterioration)

### Identify False Positives

```bash
# Show false positive users
cat ./replay/out/candidates.jsonl | \
  jq 'select(.classification == "false_positive")'
```

**Possible causes**:
- User repaid debt before liquidation
- Health factor improved due to price recovery
- Configuration thresholds too aggressive

### Test Configuration Changes

Replay with different thresholds:

```bash
# Test stricter HF threshold
EXECUTION_HF_THRESHOLD_BPS=9500 npm run replay 38393176 38395221

# Compare against baseline
diff baseline_summary.jsonl replay/out/summary.jsonl
```

### Performance Benchmarking

Monitor `scanLatencyMs` in blocks.jsonl to evaluate:
- RPC provider speed
- Multicall batch sizing efficiency
- Universe size impact on performance

## Best Practices

### RPC Provider Selection

- **Archive Node Required**: Must support historical `blockTag` queries
- **Rate Limits**: Use a provider with high rate limits or dedicated plan
- **Latency**: Lower latency = faster replay (typically 50-200ms per block)

### Block Range Selection

- **Start Small**: Test with 100-500 blocks first
- **Chunk Large Ranges**: For 10k+ blocks, split into multiple runs
- **Avoid Recent Blocks**: Use blocks at least 1000 blocks old to ensure finality

### Interpreting Results

**High Coverage (>95%)**:
- ✓ Detection logic is working well
- ✓ Monitoring sufficient candidate universe

**Low Coverage (<80%)**:
- ✗ Check if `REPLAY_NEAR_HF` is too high (not including at-risk users)
- ✗ Verify RPC provider returns accurate data
- ✗ Review logs for fetch errors

**High False Positive Rate (>30%)**:
- ✗ `EXECUTION_HF_THRESHOLD_BPS` may be too high
- ✗ Detection may be too early (consider `PRE_SIM_HF_WINDOW` tuning)

**Low Race Viability (<50% of detected)**:
- ✗ Profit estimation may be inaccurate
- ✗ `MIN_PROFIT_USD` threshold may be too high
- ✗ Simulations failing (check `revertReason` distribution)

## Limitations

- **No Simulation Chaining**: Simulations are independent; doesn't model cascading liquidations
- **Static Universe**: Only includes ground-truth users + near-threshold users; doesn't discover all potential candidates
- **Simple Profit Model**: Uses basic calculation without DEX slippage simulation
- **Single-Asset Focus**: Doesn't optimize for best collateral/debt pair selection

## Troubleshooting

### "RPC_URL not set"
Ensure `RPC_URL` is configured in `.env`. This must be an archive node supporting `blockTag`.

### "Failed to fetch logs"
- Check RPC provider supports `eth_getLogs` with large block ranges
- Reduce chunk size by adjusting internal constants if needed
- Verify network connectivity

### "Multicall failed at block X"
- Provider may not support Multicall3 at that historical block
- Try a different RPC provider with better archive support
- Verify `MULTICALL3_ADDRESS` is correct for Base network

### "Out of memory"
- Reduce `REPLAY_MAX_ACCOUNTS_PER_BLOCK`
- Split large block range into smaller chunks
- Increase `REPLAY_EVICT_CONSECUTIVE` to evict users faster

### Determinism Issues
If re-running the same range produces different results:
- RPC provider may be returning inconsistent data (try different provider)
- Ensure no environment variables changed between runs
- Check for timestamp-based randomness in code

## Advanced Topics

### Custom Analysis

Use the JSONL output with standard tools:

```bash
# Calculate profit per detected liquidation
cat candidates.jsonl | \
  jq -s 'map(select(.classification == "detected")) |
         map(.detectionProfitUSD) |
         add / length'

# Find highest-value missed opportunities
cat candidates.jsonl | \
  jq 'select(.classification == "missed") |
      select(.eventProfitUSD != null)' | \
  jq -s 'sort_by(-.eventProfitUSD) | .[0:5]'
```

### Parallel Execution

For very large ranges, split and run in parallel:

```bash
# Split into 4 chunks
npm run replay 38000000 38025000 &
npm run replay 38025001 38050000 &
npm run replay 38050001 38075000 &
npm run replay 38075001 38100000 &
wait

# Combine results
cat replay/out/**/candidates.jsonl > combined_candidates.jsonl
```

## Future Enhancements

Planned features for future releases:

- **Event-Centered Strategy**: Only scan blocks with liquidation events
- **Predictive Modeling**: Test `PREDICTIVE_ENABLED` logic in replay
- **Fork-Based Simulation**: Optionally use local fork for more accurate simulations
- **Multi-RPC Racing**: Test parallel RPC write logic
- **GUI Visualization**: Interactive dashboard for replay results

## Support

For issues or questions:
- Check existing test cases in `tests/unit/replay/`
- Review controller implementation in `src/replay/ReplayController.ts`
- Open an issue on GitHub with replay configuration and error logs
