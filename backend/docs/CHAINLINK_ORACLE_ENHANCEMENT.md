# Chainlink Price Oracle Enhancement Summary

## Problem Statement

The Chainlink verification script (`backend/scripts/verify-chainlink-prices.ts`) had runtime errors due to BigInt arithmetic issues, and PriceService assumed all feeds use 8 decimals, which could lead to price mis-scaling.

## Issues Fixed

### 1. BigInt Arithmetic Errors
**Problem**: Script performed arithmetic directly on BigInt with Number operands (`rawAnswer / 10 ** decimals`)
**Solution**: 
- Created `normalizeChainlinkPrice()` utility in `src/utils/chainlinkMath.ts`
- Converts BigInt safely: splits into integer and fractional parts
- Used in both verification script and PriceService

### 2. Hard-Coded Decimals Assumption
**Problem**: PriceService assumed all feeds use 8 decimals (`price = Number(answer) / 1e8`)
**Solution**:
- Added `feedDecimals` Map to store per-feed decimals
- Fetch decimals on PriceService initialization via `initializeFeedDecimals()`
- Log each feed's decimals: `[price] Feed WETH decimals=8 address=0x...`
- Use correct scaling: `normalizeChainlinkPrice(answer, decimals)`

### 3. Silent Fallback Issues
**Problem**: Stub fallback could mask oracle failures without warnings or metrics
**Solution**:
- Added warning logs when falling back to stub prices
- Added Prometheus metrics:
  - `liquidbot_price_oracle_chainlink_requests_total{status, symbol}`
  - `liquidbot_price_oracle_chainlink_stale_total{symbol}`
  - `liquidbot_price_oracle_stub_fallback_total{symbol, reason}`

## Implementation Details

### New Utility: `chainlinkMath.ts`
- `normalizeChainlinkPrice(answer, decimals)`: High-precision BigInt-to-Number conversion
- `safeNormalizeChainlinkPrice(answer, decimals)`: Returns null instead of throwing
- `formatChainlinkPrice(answer, decimals, displayDecimals)`: Format for display
- 17 comprehensive test cases covering edge cases

### Enhanced Verification Script
**Before**:
```typescript
const normalized = Number(rawAnswer) / 10 ** decimals; // BigInt error!
console.log(`✅ ${feed.symbol}: raw=${rawAnswer} decimals=${decimals} normalized=${normalized}`);
```

**After**:
```typescript
const normalized = normalizeChainlinkPrice(rawAnswer, decimals);
console.log(`✅ ${feed.symbol}: price=${normalized.toFixed(8)} decimals=${decimals} roundId=${roundId} updatedAt=${updatedAt}${ageWarning}`);
```

**New Diagnostics**:
- Stale data detection: `answeredInRound < roundId`
- Age warnings: Price older than 1 hour
- Detailed output: roundId, updatedAt, age metrics

### Enhanced PriceService
**Before**:
```typescript
const price = Number(answer) / 1e8; // Hard-coded 8 decimals
```

**After**:
```typescript
const decimals = this.feedDecimals.get(symbol) ?? 8;
const price = normalizeChainlinkPrice(answer, decimals);
priceOracleChainlinkRequestsTotal.inc({ status: 'success', symbol });
```

**Initialization Logging**:
```
[price] Chainlink feeds enabled for 2 symbols
[price] Feed WETH decimals=8 address=0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70
[price] Feed USDC decimals=8 address=0x7e860098F58bBFC8648a4311b374B1D669a2bc6B
```

## Acceptance Criteria Met

✅ **Script runs without BigInt errors**: Uses `normalizeChainlinkPrice()` for safe conversion
✅ **Enhanced diagnostics**: Shows roundId, updatedAt age, stale detection
✅ **Per-feed decimals logging**: Logs at startup: `[price] Feed WETH decimals=8 address=...`
✅ **Stale data warnings**: Detects `answeredInRound < roundId`
✅ **Invalid answer detection**: Checks `answer <= 0`
✅ **Metrics added**: 
  - `price_oracle_chainlink_requests_total{status, symbol}`
  - `price_oracle_chainlink_stale_total{symbol}`
  - `price_oracle_stub_fallback_total{symbol, reason}`
✅ **Fallback warnings**: Logs when Chainlink fails and stub prices are used
✅ **README documentation**: Comprehensive section on Chainlink configuration

## Configuration

Add to `.env`:
```bash
# Optional Chainlink price feeds
CHAINLINK_RPC_URL=https://mainnet.base.org
CHAINLINK_FEEDS=ETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,USDC:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B
```

## Verification

Run the verification script:
```bash
npm run verify:chainlink
```

Expected output:
```
verify-chainlink-prices: Starting verification...
RPC: https://mainnet.base.org
Feeds: ETH, USDC

✅ ETH: price=3000.50000000 decimals=8 roundId=123456 updatedAt=1234567890 (120s old)
✅ USDC: price=1.00000000 decimals=8 roundId=789012 updatedAt=1234567890 (120s old)

Verification complete.
All feeds verified successfully.
```

## Testing

- **477 tests pass** (including 17 new chainlinkMath tests)
- **Zero lint errors** for new code
- **Type checking passes**
- **Build successful**

## Prior Behavior vs Current

### Prior Behavior
- Hard-coded 8 decimals for all feeds
- No per-feed decimals fetching or caching
- BigInt arithmetic errors in verification script
- Silent stub fallback without metrics

### Current Behavior
- Dynamic decimals per feed (fetched at initialization)
- Cached in `feedDecimals` map
- Safe BigInt normalization via `chainlinkMath` utility
- Comprehensive metrics and logging for monitoring

### Risk Assessment
- **Low historical risk**: Most Base mainnet feeds use 8 decimals
- **Future-proof**: Now handles any decimal configuration
- **No breaking changes**: Graceful fallback maintains compatibility
- **Improved observability**: Metrics enable proactive monitoring

## Files Changed

1. `backend/scripts/verify-chainlink-prices.ts` - Fixed BigInt errors, added diagnostics
2. `backend/src/services/PriceService.ts` - Dynamic decimals, metrics, logging
3. `backend/src/utils/chainlinkMath.ts` - New high-precision utility
4. `backend/src/metrics/index.ts` - Added price oracle metrics
5. `backend/tests/unit/chainlinkMath.test.ts` - 17 new test cases
6. `backend/README.md` - Comprehensive Chainlink documentation
