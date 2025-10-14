# Real-Time Execution with Dynamic Liquidation Sizing

This document explains the dynamic liquidation sizing implementation for real-time execution, including close factor configuration and integration with Aave V3 Protocol Data Provider.

## Overview

Dynamic liquidation sizing fetches live debt and reserve configuration data from Aave V3 at execution time, allowing for:

- **Accurate debt calculations**: Uses actual variable + stable debt balances from the protocol
- **Dynamic liquidation bonus**: Fetches per-reserve liquidation bonus instead of using a static 5% assumption
- **Configurable close factor**: Choose between fixed 50% (safer) or full debt liquidation

## Close Factor Modes

### Fixed 50% (Default) - `CLOSE_FACTOR_EXECUTION_MODE=fixed50`

**Rationale:**

- **Risk Mitigation**: Liquidating only 50% of the debt reduces exposure to price volatility during execution
- **Capital Efficiency**: Requires less upfront capital for flash loans (half the debt amount)
- **Race Condition Protection**: If multiple liquidators compete, partial liquidation reduces the risk of failed transactions
- **Gradual Position Closure**: Allows the borrower more time to add collateral or repay debt

**Use Case:** Recommended for production environments, especially when:
- Network congestion is common
- Multiple liquidation bots compete for the same opportunities
- Capital for flash loans is limited

### Full Debt (Experimental) - `CLOSE_FACTOR_EXECUTION_MODE=full`

**Rationale:**

- **Maximum Profit**: Captures the full liquidation bonus on the entire debt position
- **Complete Position Closure**: Fully liquidates the user's debt in one transaction

**Risks:**

- **Higher Capital Requirement**: Requires flash loan for full debt amount
- **Increased Race Risk**: More likely to fail if another liquidator executes first
- **Price Impact**: Larger swaps may experience more slippage

**Use Case:** Consider for scenarios where:
- You have exclusive access to liquidation opportunities (e.g., via MEV bundles)
- The debt position is small relative to collateral
- Network is uncongested

## Configuration

### Environment Variables

```bash
# Close factor execution mode (default: fixed50)
CLOSE_FACTOR_EXECUTION_MODE=fixed50  # or 'full'

# Aave V3 Base Data Provider Addresses
AAVE_ADDRESSES_PROVIDER=0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D
AAVE_PROTOCOL_DATA_PROVIDER=0xC4Fcf9893072d61Cc2899C0054877Cb752587981
AAVE_ORACLE=0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156
AAVE_POOL_CONFIGURATOR=0x5731a04B1E775f0fdd454Bf70f3335886e9A96be
AAVE_UI_POOL_DATA_PROVIDER=0x68100bD5345eA474D93577127C11F39FF8463e93
AAVE_WRAPPED_TOKEN_GATEWAY=0xa0d9C1E9E48Ca30c8d8C3B5D69FF5dc1f6DFfC24

# Optional: Prioritize specific debt assets (comma-separated addresses)
# If not set, will use the largest debt position
LIQUIDATION_DEBT_ASSETS=0x...,0x...
```

### Switching Between Modes

To switch from fixed 50% to full debt mode:

1. Update your `.env` file:
   ```bash
   CLOSE_FACTOR_EXECUTION_MODE=full
   ```

2. Restart the backend service

3. Monitor metrics to ensure execution success rates remain acceptable

**Recommendation:** Test in dry-run mode first:
```bash
DRY_RUN_EXECUTION=true
CLOSE_FACTOR_EXECUTION_MODE=full
```

## Execution Flow

### Real-Time Path (triggerSource='realtime')

When a user becomes liquidatable via real-time health factor monitoring:

1. **Pre-flight HF Check**: Re-query `getUserAccountData()` at latest block
   - Skip if HF >= 1.0 (reason: `user_not_liquidatable`)
   - Skip if total debt is zero (reason: `zero_debt`)

2. **Fetch Live Debt Data**: Query Protocol Data Provider
   - `getUserReserveData(asset, user)` → variable + stable debt
   - Calculate `totalDebt = variableDebt + stableDebt`

3. **Calculate debtToCover**:
   - If `CLOSE_FACTOR_EXECUTION_MODE=fixed50`: `debtToCover = totalDebt / 2`
   - If `CLOSE_FACTOR_EXECUTION_MODE=full`: `debtToCover = totalDebt`

4. **Fetch Reserve Configuration**:
   - `getReserveConfigurationData(collateralAsset)` → liquidation bonus, decimals
   - Bonus is expressed as basis points with 10000 offset (e.g., 10500 = 5% bonus)

5. **Fetch Oracle Prices**:
   - `getAssetPrice(asset)` from Aave Oracle (8 decimals USD)
   - Falls back to existing Chainlink price service if needed

6. **Calculate Expected Profit**:
   ```
   bonusPct = (liquidationBonus - 10000) / 10000
   expectedCollateral = debtToCover * (1 + bonusPct)
   estimatedProfitUsd = (expectedCollateral - debtToCover) * price - gasCost
   ```

7. **Execute Liquidation**: If all checks pass, proceed with flash loan + liquidation + swap

### Subgraph Path (triggerSource='subgraph')

For historical liquidation events from the subgraph:

- Uses debt amount from the LiquidationCall event (`principalAmountRaw`)
- No live data fetching (event already occurred)
- Notifications preserve legacy format (no real-time enrichment)

## Safety Checks

The execution pipeline includes multiple safety checks:

1. **Master Switch**: `EXECUTION_ENABLED=false` (default) disables all execution
2. **Dry Run Mode**: `DRY_RUN_EXECUTION=true` (default) simulates without broadcasting
3. **Gas Price Cap**: Skip execution if gas > `MAX_GAS_PRICE_GWEI`
4. **Min Profit**: Skip if estimated profit < `MIN_PROFIT_AFTER_GAS_USD`
5. **HF Recheck**: Re-read health factor at latest block before execution
6. **Zero Debt Check**: Skip if calculated debtToCover is zero
7. **Position Size**: Respect `MAX_POSITION_SIZE_USD` limit

## Metrics

New Prometheus metrics for monitoring:

### `liquidbot_realtime_liquidation_bonus_bps` (Gauge)
- Last used liquidation bonus in basis points
- Example: 500 = 5% bonus
- Updated on each real-time execution attempt

### `liquidbot_realtime_debt_to_cover` (Histogram)
- Distribution of debtToCover amounts (USD equivalent)
- Buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
- Helps understand typical liquidation sizes

### `liquidbot_realtime_close_factor_mode` (Gauge)
- Current mode: 0 = fixed50, 1 = full
- Set at service initialization based on config

## Telegram Notifications

### Real-Time Path Enrichment

Notifications for real-time opportunities include additional fields:

```
🚨 Liquidation Opportunity (Real-time: head)

👤 User: 0x1234...abcd
💰 Collateral: 2.5000 WETH (~$5000.00)
📉 Debt: 1.8000 USDC (~$1800.00)
📊 Health Factor: 0.9750
💳 Debt to Cover: $900.00
🎁 Liquidation Bonus: 5.00%
💵 Est. Profit: $45.00

⏰ 2025-10-14T16:00:00.000Z
```

Fields:
- **Debt to Cover**: USD value of debt being repaid (50% or 100% based on mode)
- **Liquidation Bonus**: Dynamic bonus fetched from reserve config
- **Trigger Type**: `event`, `head`, or `price` (what triggered detection)

### Subgraph Path (Unchanged)

Notifications for subgraph events preserve the original format without enrichment.

## Future Enhancements

### Planned (Not Yet Implemented)

1. **Per-Reserve Adaptive Sizing**
   - Adjust close factor based on reserve volatility
   - Consider asset liquidity when determining debt amount
   - Example: Use 30% for volatile assets, 50% for stablecoins

2. **Event Log Parameter Decoding**
   - Parse `LiquidationCall`, `Borrow`, `Repay` event parameters
   - Enable human-readable event-driven context in logs
   - Selective candidate refresh based on decoded event data
   - **Purpose**: Improved logging and targeted monitoring
   - **Timeline**: Subsequent PR (deferred from this implementation)

3. **Multi-Debt Position Handling**
   - Support users with multiple debt reserves
   - Prioritize based on `LIQUIDATION_DEBT_ASSETS` env var
   - Fall back to largest debt by USD value

4. **Oracle Price Fallback**
   - Primary: Aave Oracle (`getAssetPrice`)
   - Fallback: Existing Chainlink price service
   - Log when fallback is used for debugging

## Testing

### Unit Tests

```bash
npm test -- ExecutionService.test.ts
npm test -- AaveDataService.test.ts
```

### Integration Test (Dry-Run)

Simulate a real-time liquidation in dry-run mode:

```bash
# Set environment
export USE_REALTIME_HF=true
export EXECUTION_ENABLED=true
export DRY_RUN_EXECUTION=true
export CLOSE_FACTOR_EXECUTION_MODE=fixed50
export RPC_URL=https://mainnet.base.org

# Run backend
npm run dev
```

Monitor logs for:
- `[execution] Fetched live debt data`
- `[execution] Profit estimation` with dynamic bonus
- Metrics updates in `/metrics` endpoint

## Troubleshooting

### Issue: "AaveDataService not initialized"

**Cause**: Missing `RPC_URL` or `EXECUTION_PRIVATE_KEY` in environment

**Fix**: Ensure both are set in `.env` file:
```bash
RPC_URL=https://mainnet.base.org
EXECUTION_PRIVATE_KEY=0x...
```

### Issue: "Failed to fetch live debt data"

**Cause**: RPC provider issue or contract address mismatch

**Fix**:
1. Verify RPC URL is accessible
2. Confirm Aave addresses match Base network deployment
3. Check logs for specific error message

### Issue: Execution skipped with "zero_debt"

**Cause**: User repaid debt between detection and execution

**Expected Behavior**: This is a safety feature to prevent unnecessary transactions

### Issue: Lower profits than expected

**Cause**: Using fixed50 mode liquidates only half the debt

**Fix**: If comfortable with the risks, switch to full mode:
```bash
CLOSE_FACTOR_EXECUTION_MODE=full
```

## References

- [Aave V3 Liquidations](https://docs.aave.com/developers/core-contracts/pool#liquidationcall)
- [Protocol Data Provider](https://docs.aave.com/developers/core-contracts/aaveprotocoldataprovider)
- [Aave Oracle](https://docs.aave.com/developers/core-contracts/aaveoracle)
- [Base Network Deployments](https://docs.aave.com/developers/deployed-contracts/v3-mainnet/base)
