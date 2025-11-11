# Real-Time Liquidation Pipeline

Production-grade liquidation recognition and execution pipeline with strict numeric correctness, same-block verification, and comprehensive safety controls.

## Architecture

### Core Components

1. **Scanner** - Event-driven candidate discovery
   - Monitors Aave Pool events (Supply, Borrow, Repay, Withdraw)
   - Periodic head sweep over tracked debtor set
   - Optional price update triggers
   - Per-user per-block deduplication
   - Per-user cooldown tracking

2. **SameBlockVerifier** - Atomic verification
   - Multicall3-based health factor checks
   - Single blockTag for consistency
   - Eliminates race conditions
   - Batch verification support

3. **RiskEngine** - Precise HF computation
   - BigInt-only calculations (no floats)
   - Proper scaling for all token decimals
   - eMode category support
   - Isolation mode handling
   - BASE_CURRENCY_UNIT detection

4. **ProfitEngine** - Liquidation simulation
   - Debt/collateral asset selection
   - Close factor application
   - Seize amount calculation
   - Slippage and gas cost accounting
   - Min profit threshold enforcement

5. **Executor** - On-chain execution
   - LiquidationExecutor contract integration
   - Flash loan orchestration
   - DEX router integration
   - Post-exec settlement

## Data Flow

```
Events/HeadSweep → Scanner → SameBlockVerifier → RiskEngine → ProfitEngine → Executor
      ↓               ↓            ↓                 ↓             ↓            ↓
  Discovery       Dedupe      Verification       HF Calc     Profitability  Execute
                  Cooldown    (Multicall)       (BigInt)    (Simulation)   (On-chain)
```

### Decision Funnel

1. **Discovery**: All users with relevant events or in tracked set
2. **Verified**: HF < 1.0 and totalDebtUSD ≥ MIN_DEBT_USD at same block
3. **Profitable**: Net profit ≥ MIN_PROFIT_USD after slippage and gas
4. **Executed**: Successfully executed on-chain (if EXECUTE=true)

## Numeric Correctness

### BigInt Throughout

All calculations use `bigint` for precision. No float operations.

```typescript
// ✅ Correct
const amount = 5n * (10n ** 18n);
const price = 2000n * (10n ** 8n);
const value = (amount * price) / ((10n ** 18n) * (10n ** 8n));

// ❌ Wrong
const amount = 5 * 1e18;
const price = 2000 * 1e8;
const value = (amount * price) / (1e18 * 1e8);
```

### Scaling Constants

```typescript
const WAD = 10n ** 18n;  // Balances, health factors
const RAY = 10n ** 27n;  // Indices (liquidityIndex, variableBorrowIndex)
const BPS = 10000n;      // Basis points (thresholds, bonuses)
```

### Token Decimals

Handled explicitly for each token:
- WETH/WBTC/DAI: varies (18, 8, 18)
- USDC/USDT: 6 decimals
- Custom tokens: read from ERC20.decimals()

### Oracle Prices

Never assume oracle price unit. Always read `BASE_CURRENCY_UNIT`:

```typescript
const baseCurrencyUnit = await oracle.BASE_CURRENCY_UNIT(); // Usually 1e8
const valueBase = (amount * price) / (tokenUnit * baseCurrencyUnit);
```

## Configuration

### Environment Variables

```bash
# Core thresholds
MIN_DEBT_USD=200              # Minimum debt to process
MIN_PROFIT_USD=15             # Minimum profit to execute
MAX_SLIPPAGE_BPS=80           # 0.8% max slippage
CLOSE_FACTOR_BPS=5000         # 50% close factor

# Gas controls
GAS_PRICE_CEILING_GWEI=50     # Skip if gas > ceiling
GAS_COST_USD=0                # Fixed gas cost estimate

# Execution mode
EXECUTE=false                 # Master switch (default: false)
DRY_RUN_EXECUTION=true        # Simulate only (default: true)
ALLOW_FLASH=false             # Enable flash loans

# Safety
USER_COOLDOWN_MS=60000        # 1 minute cooldown per user
MAX_CANDIDATES=300            # Max tracked candidates

# Assets
ALLOWED_ASSETS=               # Comma-separated addresses (empty = all)
DENIED_ASSETS=                # Comma-separated addresses to skip

# Network
RPC_URL=                      # Required for execution
WS_RPC_URL=                   # Required for real-time events
CHAIN_ID=8453                 # Base mainnet

# Contracts
AAVE_POOL=0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
AAVE_PROTOCOL_DATA_PROVIDER=0xC4Fcf9893072d61Cc2899C0054877Cb752587981
AAVE_ORACLE=0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156
MULTICALL3_ADDRESS=0xca11bde05977b3631167028862be2a173976ca11
EXECUTOR_ADDRESS=             # Deployed executor contract

# Subgraph (optional background discovery)
USE_SUBGRAPH_DISCOVERY=false  # Optional candidate seeding
SUBGRAPH_URL=
SUBGRAPH_REFRESH_INTERVAL_MS=1800000  # 30 minutes
```

### Operation Modes

#### Mode 1: Recognize-Only (Default)
```bash
EXECUTE=false
```
Pipeline discovers and logs liquidatable users but does not execute.

#### Mode 2: Dry-Run Execution
```bash
EXECUTE=true
DRY_RUN_EXECUTION=true
```
Full pipeline with execution simulation (no on-chain transactions).

#### Mode 3: Real Execution
```bash
EXECUTE=true
DRY_RUN_EXECUTION=false
RPC_URL=https://mainnet.base.org
EXECUTOR_ADDRESS=0x...
EXECUTION_PRIVATE_KEY=0x...
```
⚠️ **Full execution mode. Use with caution.**

## Observability

### Structured Logging

All decisions include structured context:

```json
{
  "timestamp": "2025-01-04T13:00:00.000Z",
  "level": "info",
  "message": "Candidate verified",
  "stage": "verified",
  "userAddress": "0x1234...",
  "blockNumber": 123456,
  "healthFactor": 0.95,
  "debtUsd": 10000,
  "latencyMs": 150
}
```

### Skip Reasons

Every skipped candidate includes a reason code:

- `duplicate_block` - Already processed this block
- `cooldown` - User in cooldown period
- `zero_debt` - User has no debt
- `below_min_debt_usd` - Debt below threshold
- `price_missing` - Price unavailable for debt or collateral asset (critical failure)
- `hf_ok` - Health factor ≥ 1.0
- `no_valid_assets` - No liquidatable assets
- `not_profitable` - Net profit < MIN_PROFIT_USD
- `gas_too_high` - Gas price > ceiling
- `execution_disabled` - EXECUTE=false
- `tx_failed` - Transaction failed

**Important**: `price_missing` is distinct from `below_min_debt_usd`. It indicates a critical pricing failure where the asset price could not be fetched from any source (Chainlink, ratio composition, Aave oracle, or stub). This prevents silent zero-value repay calculations.

### Metrics (Prometheus)

```
# Funnel metrics
pipeline_candidates_discovered_total{trigger_type}
pipeline_candidates_verified_total
pipeline_candidates_profitable_total
pipeline_candidates_executed_total

# Skip reasons
pipeline_candidates_skipped_total{reason}

# Latency
pipeline_verification_latency_ms
pipeline_profitability_latency_ms
pipeline_execution_latency_ms

# Results
pipeline_execution_success_total
pipeline_execution_failure_total{reason}
pipeline_realized_pnl_usd

# Dedup
pipeline_duplicates_dropped_total
```

Access at `http://localhost:3000/metrics`

### Health Checks

```bash
curl http://localhost:3000/health
```

Returns pipeline status:
```json
{
  "status": "ok",
  "pipeline": {
    "mode": "recognize-only",
    "candidatesTracked": 150,
    "minHealthFactor": 0.95,
    "lastProcessedBlock": 123456
  }
}
```

## Safety Controls

### Circuit Breakers

1. **Asset allow/deny lists**: Skip specific tokens
2. **Max gas price**: Skip execution if gas too high
3. **Min profit threshold**: Only execute if profitable
4. **Max slippage**: Conservative slippage bounds
5. **Per-user cooldown**: Prevent rapid re-execution

### Risk Checks

Before execution:
- ✅ HF < 1.0 verified at current block
- ✅ Debt ≥ MIN_DEBT_USD
- ✅ Net profit ≥ MIN_PROFIT_USD
- ✅ Gas price ≤ GAS_PRICE_CEILING_GWEI
- ✅ Assets not frozen/paused
- ✅ Assets not in deny list

### Deterministic Replay

Pipeline decisions are deterministic. Re-running the same block with the same config yields identical logs and decisions.

## Testing

### Unit Tests

```bash
cd backend
npm test -- tests/unit/RiskEngine.test.ts
npm test -- tests/unit/ProfitEngine.test.ts
npm test -- tests/unit/SameBlockVerifier.test.ts
```

Validates:
- BigInt calculations for 6/8/18 decimal tokens
- Seize amount computation with correct scaling
- Health factor computation
- Profit estimation with slippage/gas

### Integration Tests (Fork)

```bash
export RPC_URL=https://mainnet.base.org
npm test -- tests/integration/pipeline.fork.test.ts
```

Validates:
- Full pipeline on historical liquidation blocks
- Multicall verification
- Oracle price reads
- Contract interactions

## Migration from Subgraph

### Old Flow
```
Subgraph Poll → HF from subgraph → Decision
```
Issues:
- Stale data (up to 15s delay)
- Subgraph HF not atomic
- Race conditions

### New Flow
```
On-Chain Events → Same-Block Verification → Decision
```
Benefits:
- Real-time (block latency)
- Atomic HF at single blockTag
- No race conditions

### Transition

1. Enable both systems:
   ```bash
   USE_SUBGRAPH_DISCOVERY=true  # Background seeding only
   USE_REALTIME_HF=true          # Primary trigger
   ```

2. Monitor metrics for 48-72h:
   - Compare detection rates
   - Validate false positive reduction
   - Check for missed liquidations

3. Disable subgraph triggers:
   ```bash
   USE_SUBGRAPH_DISCOVERY=false
   ```

## Troubleshooting

### High False Positives

Check:
- MIN_DEBT_USD threshold (increase to filter dust)
- Verification latency (should be < 200ms)
- Block lag (events should process within 1-2 blocks)

### Missed Liquidations

Check:
- Event subscription status
- Head sweep cadence (HEAD_SWEEP_INTERVAL_MS)
- Candidate limit (MAX_CANDIDATES)

### Verification Errors

Check:
- RPC provider rate limits
- Multicall3 deployment on chain
- Aave Pool address configuration

## Performance Targets

- **Detection latency**: < 3s from event to decision
- **Verification latency**: < 200ms per candidate
- **Profitability latency**: < 100ms per simulation
- **Execution latency**: < 15s end-to-end

## Acceptance Criteria

✅ **Precision ≥ 95%**: Emitted candidates have HF < 1.0 and debt ≥ MIN_DEBT_USD  
✅ **Recall ≥ 90%**: Detect 90%+ of liquidations within scan cadence  
✅ **Deterministic**: Re-running same block yields identical decisions  
✅ **False positive reduction**: >70% reduction vs subgraph-only approach  
✅ **Duplicates**: Near-zero per user per block  

## Support

For issues or questions:
- GitHub Issues: [anassgono3-ctrl/LiquidBot](https://github.com/anassgono3-ctrl/LiquidBot/issues)
- Documentation: `/backend/docs/`
