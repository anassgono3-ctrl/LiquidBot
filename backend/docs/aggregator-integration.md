# 1inch Aggregator Integration

## Overview

LiquidBot uses **1inch exclusively** for DEX aggregation and swap routing. The integration supports both v6 (with API key) and v5 (public fallback) endpoints.

## Architecture

### OneInchQuoteService

The `OneInchQuoteService` is the sole aggregator integration, providing swap calldata generation for liquidation execution.

**Features:**
- Automatic endpoint selection based on API key presence
- v6 endpoint (with API key) for higher rate limits and better routing
- v5 public endpoint fallback when no API key is configured
- Base network (chainId 8453) support

## API Endpoints

### v6 Endpoint (with API key)

**Base URL:** `https://api.1inch.dev/swap/v6.0/8453`

**Authentication:** Required via `Authorization: Bearer <API_KEY>` header

**Quote endpoint:**
```
GET /quote?src={tokenAddress}&dst={tokenAddress}&amount={wei}
```

**Swap endpoint:**
```
GET /swap?src={tokenAddress}&dst={tokenAddress}&amount={wei}&from={callerAddress}&slippage={percentage}
```

**Parameters:**
- `src` - Source token address
- `dst` - Destination token address  
- `amount` - Amount in wei (smallest token unit)
- `from` - Caller address (for swap only)
- `slippage` - Slippage tolerance as percentage (e.g., 1 for 1%)

### v5 Endpoint (public fallback)

**Base URL:** `https://api.1inch.exchange/v5.0/8453`

**Authentication:** None (public API)

**Quote endpoint:**
```
GET /quote?fromTokenAddress={address}&toTokenAddress={address}&amount={wei}
```

**Swap endpoint:**
```
GET /swap?fromTokenAddress={address}&toTokenAddress={address}&amount={wei}&fromAddress={address}&slippage={percentage}
```

**Parameters:**
- `fromTokenAddress` - Source token address
- `toTokenAddress` - Destination token address
- `amount` - Amount in wei (smallest token unit)
- `fromAddress` - Caller address (for swap only)
- `slippage` - Slippage tolerance as percentage (e.g., 1 for 1%)

## Configuration

### Environment Variables

```bash
# Optional: 1inch API key for v6 endpoint (recommended for production)
ONEINCH_API_KEY=your_api_key_here

# Chain ID for Base
CHAIN_ID=8453

# Optional: Override base URL (auto-configured if not set)
# ONEINCH_BASE_URL=https://api.1inch.dev/swap/v6.0/8453

# Maximum slippage in basis points (100 = 1%)
MAX_SLIPPAGE_BPS=100
```

### Automatic Endpoint Selection

The service automatically selects the appropriate endpoint:

```typescript
// With API key -> v6 endpoint
const service = new OneInchQuoteService({
  apiKey: 'your-key',
  chainId: 8453
});
// Uses: https://api.1inch.dev/swap/v6.0/8453

// Without API key -> v5 public fallback
const service = new OneInchQuoteService({
  chainId: 8453
});
// Uses: https://api.1inch.exchange/v5.0/8453
```

## Usage

### Basic Swap Quote

```typescript
import { OneInchQuoteService } from './services/OneInchQuoteService.js';

const service = new OneInchQuoteService();

const quote = await service.getSwapCalldata({
  fromToken: '0x4200000000000000000000000000000000000006', // WETH
  toToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',   // USDC
  amount: '1000000000000000000',                              // 1 WETH
  slippageBps: 100,                                           // 1% slippage
  fromAddress: '0xYourExecutorAddress'
});

console.log(quote);
// {
//   to: '0x1111111254EEB25477B68fb85Ed929f73A960582',  // 1inch router
//   data: '0x...',                                       // Calldata
//   value: '0',                                          // Native token value
//   minOut: '2500000000'                                 // Min output (2500 USDC)
// }
```

### Integration with ExecutionService

The `ExecutionService` uses `OneInchQuoteService` directly for liquidation swaps:

```typescript
// Step 1: Get 1inch swap quote
const swapQuote = await this.oneInchService.getSwapCalldata({
  fromToken: opportunity.collateralReserve.id,
  toToken: opportunity.principalReserve.id,
  amount: opportunity.collateralAmountRaw,
  slippageBps: Number(process.env.MAX_SLIPPAGE_BPS || 100),
  fromAddress: this.executorAddress
});

// Step 2: Build liquidation parameters
const liquidationParams = {
  user: opportunity.user,
  collateralAsset: opportunity.collateralReserve.id,
  debtAsset: opportunity.principalReserve.id,
  debtToCover: debtToCover,
  oneInchCalldata: swapQuote.data,
  minOut: swapQuote.minOut,
  payout: this.wallet.address
};

// Step 3: Execute on-chain
const tx = await executor.initiateLiquidation(liquidationParams);
```

## Token Address Resolution

**Important:** Always use token addresses, never symbols, when calling 1inch API.

The Base token addresses are:
- **WETH:** `0x4200000000000000000000000000000000000006`
- **USDC:** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- **USDbC:** `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA`
- **DAI:** `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb`
- **cbETH:** `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22`

Token addresses are preserved in the opportunity data from the subgraph, ensuring symbols are never sent to the API.

## Rate Limits

### v6 (with API key)
- Higher rate limits based on your 1inch subscription tier
- Better routing and gas optimization
- Priority support

### v5 (public)
- Subject to public API rate limits
- May be rate-limited under heavy load
- Suitable for development and testing

**Recommendation:** Use v6 (with API key) for production deployments.

## Testing

### Manual URL Verification

Run the test script to verify URL construction:

```bash
# Test with API key (v6)
ONEINCH_API_KEY=your_key npm run tsx scripts/test-1inch-url.ts

# Test without API key (v5 fallback)
npm run tsx scripts/test-1inch-url.ts
```

### Unit Tests

Run the URL construction tests:

```bash
npm test -- OneInchUrl.test.ts
```

This test suite verifies:
- Correct base URL for v6 and v5 endpoints
- Proper parameter naming (src/dst for v6, fromTokenAddress/toTokenAddress for v5)
- ChainId inclusion in URLs
- Authorization header presence/absence
- Slippage conversion from bps to percentage

## Error Handling

The service handles errors gracefully:

```typescript
try {
  const quote = await service.getSwapCalldata(request);
} catch (error) {
  // Error types:
  // - Validation: "fromToken and toToken are required"
  // - Validation: "amount must be greater than 0"
  // - Validation: "slippageBps must be between 0 and 5000"
  // - API Error: "1inch API error (400): ..."
  // - Network: "Failed to get 1inch quote: ..."
}
```

## Migration from Multiple Aggregators

**Previous State:** The system may have supported multiple aggregators (0x, Paraswap, etc.)

**Current State:** 1inch only - simplified, reliable, and well-supported on Base.

**Benefits:**
- Single integration point to maintain
- Consistent API patterns
- Battle-tested on Base network
- No need for aggregator selection logic
- Reduced complexity and potential failure points

## Monitoring

The service logs important events:

```typescript
// v5 fallback warning
console.warn('[1inch] API key not configured - using public v5 API (may have rate limits)');

// Execution service warning
console.warn('[execution] Using 1inch v5 public API - consider setting ONEINCH_API_KEY for v6');
```

Monitor these warnings in production to ensure you're using the optimal endpoint.

## Security Considerations

1. **API Key Storage:** Store `ONEINCH_API_KEY` securely in environment variables, never in code
2. **Rate Limiting:** Implement retry logic with exponential backoff for rate limit errors
3. **Slippage Protection:** Use conservative slippage values (1-3%) to prevent MEV attacks
4. **Address Validation:** Always validate token addresses before API calls
5. **Response Validation:** Verify `minOut` values meet minimum profit requirements

## Support

- **1inch Documentation:** https://docs.1inch.io/
- **1inch API Portal:** https://portal.1inch.dev/
- **Base Network:** https://docs.base.org/

## Future Enhancements

Potential improvements for the 1inch integration:

1. Add quote endpoint support (currently only swap endpoint)
2. Implement caching for quote results
3. Add retry logic with exponential backoff
4. Support for multiple chains (if expanding beyond Base)
5. Gas price optimization using 1inch gas price oracle
6. Permit2 integration for gasless approvals
