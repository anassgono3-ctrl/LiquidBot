# Shadow Execution

## Overview

Shadow execution is a lightweight pre-execution verification feature that produces detailed, structured logs of **would-be liquidation attempts** without actually submitting any transactions to the blockchain. This allows the team to:

- Verify that detection is fast enough and observe end-to-end readiness
- Attribute bottlenecks between detection and execution phases
- Debug liquidation logic without risking actual funds
- Test configuration changes in a safe, non-intrusive manner

## Purpose

The shadow execution hook triggers whenever a user's Health Factor (HF) drops below a configurable threshold. It logs:
- Repay and seize amounts (using fixed 50% close factor)
- Gas planning parameters
- MEV routing configuration
- Path hints for 1inch swaps
- Block context (latest or pending)

All of this happens **without**:
- Making any on-chain writes
- Requesting token approvals
- Calling 1inch API
- Broadcasting transactions

## Configuration

Shadow execution is controlled by two environment variables:

### `SHADOW_EXECUTE_ENABLED`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Master switch to enable/disable shadow execution logging
- **Example**: `SHADOW_EXECUTE_ENABLED=true`

### `SHADOW_EXECUTE_THRESHOLD`
- **Type**: Number (decimal)
- **Default**: `1.005`
- **Description**: Health factor threshold below which shadow execution is triggered. Only users with HF below this value will generate shadow execution logs.
- **Example**: `SHADOW_EXECUTE_THRESHOLD=1.01`

### Configuration in `.env`

Add these lines to your `.env` file:

```bash
# Shadow Execution (Logging-Only Pre-Execution Verification)
SHADOW_EXECUTE_ENABLED=true
SHADOW_EXECUTE_THRESHOLD=1.005
```

## Log Format

Shadow execution produces a single-line JSON log for each candidate that meets the threshold criteria. The log is designed to be grep-friendly and compatible with ELK stack ingestion.

### Example Log Entry

```json
{"tag":"SHADOW_EXECUTE","user":"0x1234567890123456789012345678901234567890","blockTag":12345678,"hf":0.9876,"debtAsset":"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48","repayWei":"500000000","collateralAsset":"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2","seizeWei":"250000000000000000","closeFactorBps":5000,"gas":{"tipGwei":3,"bumpFactor":1.25},"mev":{"mode":"public"},"pathHint":"1inch:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48->0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2","mode":"shadow"}
```

### Log Fields

| Field | Type | Description |
|-------|------|-------------|
| `tag` | string | Always `"SHADOW_EXECUTE"` for shadow execution logs |
| `user` | string | Ethereum address of the user being liquidated |
| `blockTag` | number\|string | Block number or `"pending"` if using pending block verification |
| `hf` | number | Health factor at the time of detection |
| `debtAsset` | string | Address of the debt asset (token being repaid) |
| `repayWei` | string | Amount to repay in wei (50% of total debt) |
| `collateralAsset` | string | Address of the collateral asset (token being seized) |
| `seizeWei` | string | Estimated amount to seize in wei (naive 50% estimate) |
| `closeFactorBps` | number | Close factor in basis points (always 5000 = 50%) |
| `gas` | object | Gas strategy configuration |
| `gas.tipGwei` | number | Priority fee in Gwei (from `GAS_TIP_GWEI_FAST`) |
| `gas.bumpFactor` | number | RBF bump multiplier (from `GAS_BUMP_FACTOR`) |
| `mev` | object | MEV routing configuration |
| `mev.mode` | string | Either `"public"` or `"private"` |
| `mev.endpoint` | string? | Private RPC URL if `mode="private"` |
| `pathHint` | string | Suggested swap route for 1inch |
| `mode` | string | Always `"shadow"` to distinguish from real executions |

## Filtering and Analysis

### Grep for Shadow Execution Logs

```bash
# Get all shadow execution logs
grep 'SHADOW_EXECUTE' app.log

# Extract just the JSON
grep 'SHADOW_EXECUTE' app.log | jq '.'

# Count shadow executions
grep 'SHADOW_EXECUTE' app.log | wc -l

# Get shadow executions for a specific user
grep 'SHADOW_EXECUTE' app.log | jq 'select(.user == "0x1234...")'

# Get shadow executions below HF 1.0
grep 'SHADOW_EXECUTE' app.log | jq 'select(.hf < 1.0)'
```

### Metrics Log

In addition to the structured JSON log, a simple metrics increment log is emitted:

```
[metrics] shadow_execute_count+=1
```

This allows for quick counting of shadow executions without parsing JSON.

## Integration Points

Shadow execution is integrated at the following points in the candidate evaluation pipeline:

1. **Head Sweeps** - During periodic health factor checks across all monitored candidates
2. **Event-Triggered Scans** - When Aave Pool events indicate user position changes:
   - `ReserveDataUpdated`
   - `Borrow`
   - `Repay`
   - `Supply`
   - `Withdraw`
3. **Price-Trigger Scans** - When significant price drops trigger emergency scans

### Debounce and Cooldown

Shadow execution respects the same debounce and cooldown rules as real execution candidates:
- `PER_USER_BLOCK_DEBOUNCE`: Prevents multiple logs for the same user in the same block
- `USER_COOLDOWN_SEC`: Prevents spammy logs for users whose HF fluctuates around the threshold

## Architecture

### Module Location
`backend/src/exec/shadowExecution.ts`

### Key Functions

#### `buildShadowPlan(candidate: ShadowExecCandidate): ShadowExecPlan`
Constructs a shadow execution plan from a candidate. Uses:
- Fixed 50% close factor (CLOSE_FACTOR_MODE=fixed50)
- Naive 50% collateral seizure estimate
- Gas parameters from environment configuration
- MEV routing based on `TX_SUBMIT_MODE` and available RPC endpoints

#### `maybeShadowExecute(candidate: ShadowExecCandidate, threshold?: number): void`
Conditionally logs a shadow execution if:
1. `SHADOW_EXECUTE_ENABLED=true`
2. User's HF is below the threshold (default: `SHADOW_EXECUTE_THRESHOLD`)

**Important**: This function never makes RPC calls, never submits transactions, and never interacts with external APIs.

## Use Cases

### 1. End-to-End Testing
Enable shadow execution in a staging environment to verify that:
- Candidates are being detected correctly
- Detection latency meets requirements
- Configuration values (gas, MEV routing) are correct

### 2. Detection vs Execution Attribution
Compare timestamps between:
- Detection events (from event listeners)
- Shadow execution logs (from candidate evaluation)
- Actual liquidation attempts (if execution is enabled)

This helps identify whether latency is in detection, evaluation, or execution.

### 3. Safe Configuration Changes
When modifying gas strategies, MEV routing, or close factors:
1. Enable shadow execution
2. Observe logs with new configuration
3. Validate outputs before enabling real execution

### 4. Production Monitoring
Keep shadow execution enabled even when real execution is active to:
- Log all liquidation opportunities (not just executed ones)
- Debug missed liquidations
- Measure opportunity coverage

## Safety

Shadow execution is designed to be **completely safe**:
- ✅ Read-only operations (health factor checks already happening)
- ✅ No chain writes or transaction broadcasts
- ✅ No external API calls (1inch, etc.)
- ✅ No token approvals
- ✅ Isolated from real execution code paths
- ✅ Can be toggled on/off without restart (if runtime config is enabled)

## Performance Impact

Shadow execution has **minimal performance impact**:
- Adds simple conditional checks (disabled by default)
- When enabled, adds lightweight JSON serialization and logging
- No additional RPC calls (reuses existing HF check results)
- No blocking operations or network I/O

## Example Workflow

1. **Enable shadow execution**:
   ```bash
   export SHADOW_EXECUTE_ENABLED=true
   export SHADOW_EXECUTE_THRESHOLD=1.005
   ```

2. **Start the application**:
   ```bash
   npm start
   ```

3. **Monitor logs in real-time**:
   ```bash
   tail -f app.log | grep SHADOW_EXECUTE
   ```

4. **Analyze collected data**:
   ```bash
   # Count opportunities
   grep SHADOW_EXECUTE app.log | wc -l
   
   # Average HF of shadow executions
   grep SHADOW_EXECUTE app.log | jq '.hf' | awk '{sum+=$1; n++} END {print sum/n}'
   
   # Most common debt assets
   grep SHADOW_EXECUTE app.log | jq -r '.debtAsset' | sort | uniq -c | sort -rn
   ```

## Troubleshooting

### No shadow execution logs appearing

1. Check that `SHADOW_EXECUTE_ENABLED=true` in your environment
2. Verify that users with HF < `SHADOW_EXECUTE_THRESHOLD` exist
3. Ensure candidate detection is working (check for health factor check logs)
4. Confirm that candidates pass debounce/cooldown filters

### Too many shadow execution logs

1. Increase `SHADOW_EXECUTE_THRESHOLD` to narrow the range
2. Adjust `USER_COOLDOWN_SEC` to reduce log frequency
3. Review `PER_USER_BLOCK_DEBOUNCE` settings

### Shadow execution not respecting threshold

1. Verify `SHADOW_EXECUTE_THRESHOLD` is set correctly
2. Check that HF calculations are accurate
3. Review candidate filtering logic in the integration points

## Related Configuration

Shadow execution interacts with these existing configuration values:

| Variable | Usage |
|----------|-------|
| `GAS_TIP_GWEI_FAST` | Priority fee logged in shadow plans |
| `GAS_BUMP_FACTOR` | RBF multiplier logged in shadow plans |
| `TX_SUBMIT_MODE` | Determines MEV routing mode |
| `PRIVATE_TX_RPC_URL` | Private relay endpoint (if enabled) |
| `PRIVATE_BUNDLE_RPC` | Alternative private relay endpoint |
| `PENDING_VERIFY_ENABLED` | Affects blockTag (pending vs latest) |
| `PER_USER_BLOCK_DEBOUNCE` | Prevents duplicate logs per block |
| `USER_COOLDOWN_SEC` | Prevents log spam for same user |

## Future Enhancements

Potential improvements to shadow execution:

1. **Dynamic Threshold Adjustment**: Runtime API to adjust threshold without restart
2. **Prometheus Metrics**: Dedicated counter metric for shadow executions
3. **Sampling**: Log only a percentage of shadow executions to reduce volume
4. **Enrichment**: Include actual 1inch quote data (with rate limiting)
5. **Comparison**: Compare shadow plans with actual execution outcomes
6. **Alerting**: Trigger notifications when shadow execution rate spikes

## Support

For questions or issues related to shadow execution:
- Review application logs for `[shadow-execution]` prefix
- Check metrics logs for `shadow_execute_count` increments
- Verify configuration in `.env.example` and deployed `.env`
- Examine `backend/src/exec/shadowExecution.ts` source code
