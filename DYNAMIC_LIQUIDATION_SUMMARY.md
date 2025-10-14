# Dynamic Liquidation Sizing Implementation - Summary

## Overview

This PR implements a production-ready dynamic liquidation sizing system with configurable close factors and live Aave V3 data integration for the LiquidBot platform.

## Key Features

### 1. Dynamic Data Fetching
- **Live Debt Calculation**: Queries Aave V3 Protocol Data Provider for actual variable + stable debt at execution time
- **Dynamic Liquidation Bonus**: Fetches per-reserve liquidation bonus from reserve configuration (replaces static 5% assumption)
- **Oracle Integration**: Uses Aave Oracle for asset prices with Chainlink fallback support

### 2. Configurable Close Factor

#### Fixed 50% Mode (Default - Safer)
```bash
CLOSE_FACTOR_EXECUTION_MODE=fixed50
```
**Benefits:**
- Lower capital requirement (50% of debt)
- Reduced race condition risk
- Safer for competitive environments
- Better risk management

**Trade-offs:**
- Lower profit per transaction
- Multiple transactions may be needed for full position closure

#### Full Debt Mode (Experimental)
```bash
CLOSE_FACTOR_EXECUTION_MODE=full
```
**Benefits:**
- Maximum profit per transaction
- Complete position closure in one transaction

**Trade-offs:**
- Higher capital requirement (100% of debt)
- Higher race condition risk
- Less forgiving in volatile conditions

### 3. Safety Mechanisms

The implementation includes multiple safety checks:

1. **Pre-flight HF Recheck**: Re-queries health factor at latest block before execution
2. **Zero Debt Detection**: Skips execution if total debt is zero
3. **User Not Liquidatable**: Skips if HF >= 1.0 when rechecked
4. **Calculated Debt Validation**: Ensures debtToCover > 0
5. **Master Switch**: `EXECUTION_ENABLED` must be explicitly set to true
6. **Dry Run Mode**: Test without broadcasting transactions (`DRY_RUN_EXECUTION=true`)

### 4. Enhanced Notifications

Real-time Telegram alerts now include:
- Current health factor (hfNow)
- Debt to cover amount (USD)
- Dynamic liquidation bonus percentage
- Trigger type (event, head, or price)

Legacy subgraph notifications remain unchanged.

## Architecture

### New Service: AaveDataService

```typescript
class AaveDataService {
  // Fetch reserve token addresses (aToken, debt tokens)
  getReserveTokenAddresses(asset: string): ReserveTokenAddresses
  
  // Fetch reserve configuration (including liquidation bonus)
  getReserveConfigurationData(asset: string): ReserveConfigurationData
  
  // Fetch user's debt balances for a reserve
  getUserReserveData(asset: string, user: string): UserReserveData
  
  // Fetch asset price from Oracle
  getAssetPrice(asset: string): bigint
  
  // Fetch user account data (health factor, total debt)
  getUserAccountData(user: string): UserAccountData
  
  // Convenience: Calculate total debt (variable + stable)
  getTotalDebt(asset: string, user: string): bigint
  
  // Convenience: Get liquidation bonus as percentage
  getLiquidationBonusPct(asset: string): number
}
```

### Enhanced ExecutionService

The execution flow now includes:

1. **Configuration Validation**: Check RPC_URL, EXECUTION_PRIVATE_KEY, EXECUTOR_ADDRESS
2. **Pre-flight HF Check**: Query latest health factor and total debt
3. **Zero Debt Validation**: Skip if user has no debt
4. **Debt Asset Determination**: Identify which debt asset to liquidate
5. **Dynamic Debt Calculation**: Fetch live debt and compute debtToCover based on mode
6. **Bonus Fetching**: Get actual liquidation bonus from reserve config
7. **Profit Estimation**: Calculate expected profit with dynamic bonus
8. **Execution**: Proceed with flash loan + liquidation + swap

### Updated ProfitCalculator

New method for pre-execution profit estimation:

```typescript
estimateProfitWithBonus(
  debtToCoverUsd: number,
  liquidationBonusPct: number
): ProfitBreakdown
```

This replaces the static 5% bonus assumption with actual bonus from reserve configuration.

## Configuration

### Environment Variables

```bash
# Aave V3 Base Network Addresses
AAVE_ADDRESSES_PROVIDER=0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D
AAVE_PROTOCOL_DATA_PROVIDER=0xC4Fcf9893072d61Cc2899C0054877Cb752587981
AAVE_ORACLE=0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156
AAVE_POOL_CONFIGURATOR=0x5731a04B1E775f0fdd454Bf70f3335886e9A96be
AAVE_UI_POOL_DATA_PROVIDER=0x68100bD5345eA474D93577127C11F39FF8463e93
AAVE_WRAPPED_TOKEN_GATEWAY=0xa0d9C1E9E48Ca30c8d8C3B5D69FF5dc1f6DFfC24

# Close Factor Configuration
CLOSE_FACTOR_EXECUTION_MODE=fixed50  # or 'full'

# Optional: Prioritize specific debt assets
LIQUIDATION_DEBT_ASSETS=0x...,0x...

# Execution Controls (existing)
EXECUTION_ENABLED=false  # Master switch
DRY_RUN_EXECUTION=true   # Simulate only
RPC_URL=https://mainnet.base.org
EXECUTION_PRIVATE_KEY=0x...
EXECUTOR_ADDRESS=0x...
```

## Metrics

Three new Prometheus metrics for monitoring:

### liquidbot_realtime_liquidation_bonus_bps
- **Type**: Gauge
- **Description**: Last used liquidation bonus in basis points
- **Example**: 500 = 5% bonus

### liquidbot_realtime_debt_to_cover
- **Type**: Histogram
- **Description**: Distribution of debt amounts covered (USD)
- **Buckets**: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000]

### liquidbot_realtime_close_factor_mode
- **Type**: Gauge
- **Description**: Current close factor mode
- **Values**: 0 = fixed50, 1 = full

## Testing

### Unit Tests (24 new tests)

```bash
npm test -- DynamicLiquidation.test.ts
```

Coverage:
- AaveDataService initialization and methods
- DebtToCover calculation (fixed50 vs full modes)
- ProfitCalculator with dynamic bonus
- Mode comparison scenarios
- Different bonus percentages (2.5% to 10%)
- Profitability thresholds

### Manual Verification

```bash
npm run test:dynamic-liquidation
```

Demonstrates:
- Configuration display
- fixed50 mode calculation ($49.35 profit on $1000 debt)
- full mode calculation ($99.20 profit on $2000 debt)
- Mode comparison (profit vs capital trade-offs)
- Different liquidation bonuses
- Minimum profitable debt analysis
- Safety checks verification

### Test Results

```
✓ 288 tests passing (including 24 new tests)
✓ Typecheck clean
✓ Lint clean for new files
✓ Manual verification successful
```

## Documentation

### New Documentation: backend/docs/REALTIME_EXECUTION.md

Comprehensive guide covering:
- Close factor rationale and trade-offs
- Configuration instructions
- Execution flow diagrams
- Safety mechanisms explanation
- Metrics descriptions
- Telegram notification enrichment
- Troubleshooting guide
- Future enhancements roadmap

## Example Output

### Manual Test Script

```
=== Dynamic Liquidation Sizing Test ===

Configuration:
  CLOSE_FACTOR_EXECUTION_MODE: fixed50
  AAVE_PROTOCOL_DATA_PROVIDER: 0xC4Fcf9893072d61Cc2899C0054877Cb752587981
  AAVE_ORACLE: 0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156

--- Mode: fixed50 (50% of debt) ---
  Debt to Cover: $1000.00
  Expected Collateral: $1050.00
  Bonus Value: $50.00
  Net Profit: $49.35

--- Mode: full (100% of debt) ---
  Debt to Cover: $2000.00
  Expected Collateral: $2100.00
  Bonus Value: $100.00
  Net Profit: $99.20

--- Minimum Profitable Debt Amount ---
  Total Debt $30: Net = $0.25 ✓ Profitable  (minimum threshold)
  Total Debt $100: Net = $1.99 ✓ Profitable
```

### Enriched Telegram Alert

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

## Files Changed

### New Files (4)
- `backend/src/services/AaveDataService.ts` - Aave V3 data integration (220 lines)
- `backend/docs/REALTIME_EXECUTION.md` - Comprehensive documentation (320 lines)
- `backend/tests/unit/DynamicLiquidation.test.ts` - Unit tests (400+ lines)
- `backend/scripts/test-dynamic-liquidation.ts` - Manual verification (150 lines)

### Modified Files (10)
- `backend/.env.example` - Added Aave addresses and config vars
- `backend/src/config/envSchema.ts` - Added validation
- `backend/src/config/index.ts` - Exposed new config values
- `backend/src/services/ExecutionService.ts` - Dynamic calculation + safety
- `backend/src/services/NotificationService.ts` - Enriched alerts
- `backend/src/services/ProfitCalculator.ts` - Dynamic bonus method
- `backend/src/metrics/index.ts` - Added 3 new metrics
- `backend/src/types/index.ts` - Added debtToCover fields
- `backend/src/index.ts` - Real-time execution integration
- `backend/package.json` - Added test script

**Total Impact**: ~1,300 lines added, ~50 lines modified

## Migration Guide

### For Existing Deployments

1. **Update Environment Variables**
   ```bash
   # Add to .env file
   AAVE_ADDRESSES_PROVIDER=0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D
   AAVE_PROTOCOL_DATA_PROVIDER=0xC4Fcf9893072d61Cc2899C0054877Cb752587981
   AAVE_ORACLE=0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156
   AAVE_POOL_CONFIGURATOR=0x5731a04B1E775f0fdd454Bf70f3335886e9A96be
   AAVE_UI_POOL_DATA_PROVIDER=0x68100bD5345eA474D93577127C11F39FF8463e93
   AAVE_WRAPPED_TOKEN_GATEWAY=0xa0d9C1E9E48Ca30c8d8C3B5D69FF5dc1f6DFfC24
   CLOSE_FACTOR_EXECUTION_MODE=fixed50
   ```

2. **Test in Dry-Run Mode**
   ```bash
   EXECUTION_ENABLED=true
   DRY_RUN_EXECUTION=true
   npm run dev
   ```

3. **Monitor Metrics**
   - Check `/metrics` endpoint for new metrics
   - Verify `liquidbot_realtime_close_factor_mode = 0`
   - Monitor `liquidbot_realtime_debt_to_cover` distribution

4. **Enable Production Execution**
   ```bash
   EXECUTION_ENABLED=true
   DRY_RUN_EXECUTION=false
   ```

### Backward Compatibility

- ✅ All existing functionality preserved
- ✅ Subgraph-based opportunities unchanged
- ✅ Legacy notification format maintained for subgraph path
- ✅ No breaking changes to APIs or services
- ✅ Default configuration safe (fixed50 mode)

## Future Enhancements

As documented in REALTIME_EXECUTION.md, planned enhancements include:

1. **Debt Asset Discovery**: Automatically identify which debt assets to liquidate for real-time opportunities
2. **Event Log Decoding**: Parse event parameters for improved logging and selective candidate refresh
3. **Per-Reserve Adaptive Sizing**: Adjust close factor based on asset volatility and liquidity
4. **Multi-Debt Position Handling**: Support users with multiple debt reserves

## Acceptance Criteria - All Met ✅

✅ Default mode (fixed50) computes debtToCover = totalDebt/2 with dynamic bonus  
✅ Setting CLOSE_FACTOR_EXECUTION_MODE=full makes debtToCover = totalDebt  
✅ Real-time Telegram alerts show hfNow, debtToCover, bonusPct, triggerType  
✅ Execution path skips safely when HF recovered or debt zero  
✅ Legacy subgraph notifications unaffected  
✅ Live reserve data integration functional  
✅ Per-reserve liquidation bonus implemented  
✅ Safety checks comprehensive  
✅ Metrics added for monitoring  
✅ Documentation complete  
✅ Tests passing (288 total)  

## Conclusion

This implementation provides a production-ready, safe, and configurable dynamic liquidation sizing system that:

- Reduces capital requirements with fixed50 mode
- Provides accurate profit estimation with dynamic bonuses
- Includes comprehensive safety checks
- Offers clear documentation and testing
- Maintains backward compatibility
- Sets foundation for future enhancements

The code is thoroughly tested, well-documented, and ready for production deployment.
