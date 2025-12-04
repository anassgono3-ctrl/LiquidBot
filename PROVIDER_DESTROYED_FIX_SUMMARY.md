# Provider Destroyed Error Fix - Implementation Summary

## Problem
WebSocket provider disconnections caused cascading `UNSUPPORTED_OPERATION: provider destroyed` errors when `eth_call` operations were routed through destroyed WebSocket connections. This occurred when `PredictiveOrchestrator.maybeRunFallbackEvaluation` scheduled `buildUserReserves` while the WS provider was down.

## Solution Overview
Implemented dual-provider architecture with automatic HTTP fallback for static calls when WebSocket provider is unhealthy.

## Changes Made

### 1. AaveDataService Provider Hygiene (src/services/AaveDataService.ts)
- **Dual Provider Setup**: Maintains both `wsProvider` (WebSocket) and `httpProvider` (HTTP)
- **Health Tracking**: `wsHealthy` flag tracked via WebSocket event listeners:
  - `open` event → sets `wsHealthy = true`, logs `[provider] ws_recovered`
  - `close` event → sets `wsHealthy = false`, logs `[provider] ws_unhealthy; routing eth_call via http`
  - `error` event → sets `wsHealthy = false`, logs error details
- **Public API**: `isWsHealthy(): boolean` method exposes health status

### 2. Static Call Routing with Fallback
Implemented `callWithFallback<T>()` helper method that:
- Routes directly to HTTP if `wsHealthy === false`
- Attempts WebSocket call first when healthy
- On `UNSUPPORTED_OPERATION` or `provider destroyed` error, retries via HTTP
- Logs `[provider] ws_unhealthy; routing eth_call via http (${method} retry after error)`

Updated methods to use fallback routing:
- `getReserveTokenAddresses()`
- `getReserveConfigurationData()`
- `getUserReserveData()`
- `getAssetPrice()`
- `getUserAccountData()`
- `getReserveData()`
- `getReservesList()`

### 3. Orchestrator Guard (src/index.ts)
Added diagnostic logging in `buildUserReserves()`:
```typescript
if (!aaveDataService.isWsHealthy()) {
  console.log(`[provider] ws_unhealthy; buildUserReserves will use http fallback for ${userAddress}`);
}
```
The service automatically routes through HTTP when needed.

### 4. Tests (tests/unit/AaveDataService.providerFallback.test.ts)
Created comprehensive test suite covering:
- `isWsHealthy()` method behavior
- Dual provider initialization
- Error handling for `UNSUPPORTED_OPERATION` errors
- Error handling for `provider destroyed` messages
- Fallback retry logic

## Acceptance Criteria Met

✅ **Provider destroyed errors disappear**: Automatic fallback prevents errors from reaching callers
✅ **Static calls continue through HTTP when WS down**: `callWithFallback()` routes to HTTP
✅ **Automatic WS recovery**: Event listeners detect WS reconnection and restore routing
✅ **No rate-limit or RPC changes**: Only routing logic changed, no throughput modifications
✅ **Diagnostic logging**: Clear logs show provider state transitions

## Test Results
- All 1150 tests passing
- Build successful with no TypeScript errors
- New provider fallback tests verify:
  - Health status tracking
  - Error detection and retry
  - HTTP fallback routing

## Configuration Required
Set `RPC_URL` environment variable to enable HTTP fallback:
```bash
RPC_URL=https://mainnet.base.org
```

When `RPC_URL` is set and a WebSocket provider is used, the service automatically sets up dual-provider mode with fallback.

## Minimal Changes Approach
- No changes to rate limiting or concurrency
- No changes to batch sizes
- Only 1 retry per failed call (WebSocket → HTTP)
- Existing contract instances reused
- No new dependencies added
