# DEX Aggregator Integration

This document describes the DEX aggregator integration system for LiquidBot's execution engine.

## Overview

The aggregator system provides a unified interface for obtaining swap quotes from multiple DEX aggregators with automatic fallback support. This ensures the bot can always execute liquidations even if one aggregator is unavailable.

## Supported Aggregators

### 1inch (Primary)
- **API Version**: v6 (with API key) with fallback to v5 (public)
- **Base URL**: `https://api.1inch.dev/swap/v6.0/8453` (v6) or `https://api.1inch.io/v5.0/8453` (v5)
- **API Key**: Required for v6, optional for v5
- **Rate Limits**: Higher with API key
- **Configuration**:
  ```bash
  ONEINCH_API_KEY=your_api_key_here
  ONEINCH_BASE_URL=https://api.1inch.dev/swap/v6.0/8453
  ```

### 0x (Fallback)
- **API Version**: v1
- **Base URL**: `https://base.api.0x.org`
- **API Key**: Optional (public API available)
- **Rate Limits**: 50 requests/minute (public), higher with API key
- **Configuration**:
  ```bash
  ZEROX_API_KEY=your_api_key_here  # Optional
  ```

## Architecture

### Token Address Resolution

The system includes a token mapping utility (`src/config/tokens.ts`) that resolves token symbols to Base network addresses:

```typescript
import { resolveTokenAddress } from '../config/tokens.js';

// Resolve symbol to address
const usdcAddress = resolveTokenAddress('USDC');
// Returns: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

// Pass through addresses unchanged
const address = resolveTokenAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
// Returns: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```

### Supported Tokens on Base

| Symbol | Address | Type | Decimals |
|--------|---------|------|----------|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Stablecoin | 6 |
| USDbC | `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA` | Stablecoin | 6 |
| USDT | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` | Stablecoin | 6 |
| DAI | `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb` | Stablecoin | 18 |
| WETH | `0x4200000000000000000000000000000000000006` | Wrapped ETH | 18 |
| cbETH | `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22` | Coinbase ETH | 18 |
| WBTC | `0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` | Wrapped BTC | 8 |
| AERO | `0x940181a94A35A4569E4529A3CDfB74e38FD98631` | Aerodrome | 18 |

### AggregatorService

The `AggregatorService` provides automatic fallback between aggregators:

```typescript
import { AggregatorService } from './services/AggregatorService.js';

const aggregator = new AggregatorService();

// Get swap quote with automatic fallback
const quote = await aggregator.getSwapCalldata({
  fromToken: 'USDC',  // Can use symbol or address
  toToken: 'WETH',    // Can use symbol or address
  amount: '1000000',  // Amount in smallest unit (6 decimals for USDC)
  slippageBps: 100,   // 1% slippage
  fromAddress: '0x...' // Caller address for the swap
});

console.log(quote.aggregator); // '1inch' or '0x'
console.log(quote.to);         // Router address
console.log(quote.data);       // Calldata
console.log(quote.minOut);     // Minimum output amount
```

## Execution Flow

1. **Token Resolution**: Symbols are resolved to addresses
2. **Address Validation**: All addresses are validated (0x + 40 hex chars)
3. **Primary Attempt**: Try 1inch v6 (if API key configured)
4. **v5 Fallback**: If v6 fails, try 1inch v5 public API
5. **0x Fallback**: If 1inch fails completely, try 0x
6. **Error**: If all aggregators fail, throw detailed error

## Error Handling

The system provides detailed error messages including which aggregator failed and why:

```typescript
try {
  const quote = await aggregator.getSwapCalldata(request);
} catch (error) {
  // Error message includes details from all attempted aggregators
  console.error(error.message);
  // Example: "All aggregators failed. 1inch: API rate limit, 0x: Network timeout"
}
```

## Address Validation

All token addresses are validated before making API calls:

```typescript
// Valid format: 0x followed by 40 hexadecimal characters
const valid = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Invalid formats will throw before API call
const invalid1 = '0x1';           // Too short
const invalid2 = 'USDC';          // Symbol (must be resolved first)
const invalid3 = '0xINVALID...';  // Non-hex characters
```

## Stablecoin Price Handling

The system includes special handling for stablecoin prices when Chainlink feeds are stale:

- If Chainlink price is older than 1 hour but within 5% of $1.00, the price is accepted
- If deviation exceeds 5%, falls back to $1.00
- Prevents blocking liquidations due to stale Chainlink feeds for stable assets

## Integration with ExecutionService

The `ExecutionService` uses `AggregatorService` automatically:

```typescript
import { ExecutionService } from './services/ExecutionService.js';

const executor = new ExecutionService();

// Execution flow includes:
// 1. Calculate debt to cover (respecting close factor)
// 2. Get swap quote via AggregatorService (with automatic fallback)
// 3. Build liquidation parameters
// 4. Submit transaction to LiquidationExecutor contract
```

## Testing

Comprehensive tests are provided for all aggregator components:

```bash
# Test token resolution
npm test -- tokens.test

# Test 1inch service
npm test -- OneInchQuoteService.test

# Test aggregator fallback
npm test -- AggregatorService.test
```

## Configuration Best Practices

### Production Setup

```bash
# Primary aggregator (1inch v6)
ONEINCH_API_KEY=your_production_api_key
ONEINCH_BASE_URL=https://api.1inch.dev/swap/v6.0/8453

# Fallback aggregator (0x)
ZEROX_API_KEY=your_0x_api_key  # Optional but recommended

# Slippage tolerance (1% = 100 bps)
MAX_SLIPPAGE_BPS=100
```

### Development/Testing Setup

```bash
# No API keys needed - will use public APIs
# 1inch v5 public API
# 0x public API

# Higher slippage for testing
MAX_SLIPPAGE_BPS=200
```

## Rate Limits

### 1inch
- **v6 with API key**: 1 request/second per endpoint
- **v5 public**: Varies by endpoint, generally more restrictive

### 0x
- **Public API**: 50 requests/minute
- **With API key**: 100+ requests/minute

## Monitoring

The aggregator system logs all operations:

```
[aggregator] Resolving swap: USDC -> WETH
[aggregator] Addresses: 0x833... -> 0x4200...
[aggregator] Attempting 1inch...
[aggregator] 1inch successful
```

Monitor logs for:
- Fallback frequency (indicates primary aggregator issues)
- Error patterns (network, rate limits, etc.)
- Response times

## Troubleshooting

### Issue: "Invalid fromToken address" error

**Cause**: Token symbol not in mapping or invalid address format

**Solution**: 
- Check if token is in `src/config/tokens.ts`
- If using address directly, ensure it's a valid Ethereum address (0x + 40 hex chars)
- Add new tokens to the mapping if needed

### Issue: "All aggregators failed"

**Cause**: Network issues, rate limits, or invalid swap parameters

**Solution**:
- Check network connectivity
- Verify API keys are valid
- Ensure swap parameters are reasonable (amount, slippage, etc.)
- Check aggregator status pages

### Issue: Stale price blocking execution

**Cause**: Chainlink feed older than 1 hour and price deviation > 5%

**Solution**:
- For stablecoins: System automatically falls back to $1.00
- For other tokens: Check Chainlink feed health or add alternative price source

## Future Enhancements

- Additional aggregator support (Paraswap, Kyberswap, etc.)
- Dynamic slippage based on market conditions
- Price impact analysis before execution
- Gas cost optimization by comparing aggregator quotes
- Support for multi-hop swaps
