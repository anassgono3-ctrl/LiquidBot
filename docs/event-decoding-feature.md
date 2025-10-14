# On-Chain Event Decoding & Targeted Candidate Refresh

## Overview

This feature adds structured decoding for Aave V3 Pool and Chainlink feed events to the real-time HF pipeline. It enables:

1. **Human-readable event logging** - See detailed event parameters instead of raw hex data
2. **Targeted user identification** - Automatically extract affected users from events
3. **Efficient HF checks** - Only recheck affected users instead of full batch on every event

## Activation

The feature automatically activates when `USE_REALTIME_HF=true` is set in your environment variables. No additional configuration required.

## Supported Events

### Aave V3 Pool Events

- **Borrow** - User borrows assets
- **Repay** - User repays debt
- **Supply** - User supplies collateral
- **Withdraw** - User withdraws collateral
- **LiquidationCall** - Liquidation executed (logged for monitoring)
- **ReserveDataUpdated** - Reserve parameters changed (triggers batch recheck of low HF users)
- **FlashLoan** - Flash loan executed (logged for monitoring)

### Chainlink Events

- **AnswerUpdated** - Price feed updated (triggers batch recheck of low HF users)

## How It Works

### 1. Event Detection

When the RealTimeHFService receives a log from the WebSocket subscription:

```typescript
// Old behavior: Generic log with raw data
console.log(`[realtime-hf] Aave event detected for user ${userAddress}`);

// New behavior: Structured decoded event
console.log(`[realtime-hf] [Borrow] block=12345 user=0x123... onBehalfOf=0x456... reserve=0xABC... amount=1000000`);
```

### 2. User Extraction

The decoder automatically identifies all affected users:

```typescript
// Borrow event: user + onBehalfOf (if different)
const users = extractUserFromAaveEvent(decoded);
// Returns: ['0x123...', '0x456...']

// Repay event: user + repayer (if different)
// Supply event: user + onBehalfOf (if different)
// Withdraw event: user
// LiquidationCall event: user (the liquidated user)
```

### 3. Targeted HF Recheck

Instead of checking all candidates on every event:

```typescript
// Old: Check all candidates (expensive)
await this.checkAllCandidates('event');

// New: Check only affected users (efficient)
for (const user of users) {
  this.candidateManager.add(user);
  await this.checkCandidate(user, 'event');
}
```

## Architecture

### EventRegistry

Maps event topic hashes (topic0) to decoder functions:

```typescript
const registry = new EventRegistry();
registry.get(borrowTopicHash); // Returns decoder for Borrow event
```

### Decoder Flow

1. **Receive log** from WebSocket
2. **Check topic0** in EventRegistry
3. **Decode event** using ethers.js Interface.parseLog
4. **Extract params** (user, reserve, amount)
5. **Format log** for human-readable output
6. **Trigger action** (targeted recheck or batch recheck)

## Benefits

### Performance

- **Reduced RPC calls**: Only check affected users, not all candidates
- **Lower latency**: Faster response to user actions
- **Better resource usage**: Less CPU/memory for batch operations

### Observability

- **Clear logs**: See exactly what events are happening
- **Debugging**: Easier to trace liquidation opportunities
- **Monitoring**: Track specific user actions

### Maintainability

- **Type-safe**: Full TypeScript types for all events
- **Extensible**: Easy to add new event types
- **Testable**: Comprehensive unit tests (30 tests)

## Usage Example

### Running the Test Script

```bash
cd backend
npx tsx scripts/test-event-decoding.ts
```

This demonstrates:
- Event encoding and decoding
- User extraction
- Reserve identification
- Logging format

### In Production

The feature runs automatically in the RealTimeHFService when enabled:

```bash
# Enable real-time HF monitoring
USE_REALTIME_HF=true

# Start the service
npm start
```

You'll see logs like:

```
[realtime-hf] [Borrow] block=12345 user=0x123... reserve=0xABC... amount=1000000
[realtime-hf] Aave event detected for user 0x123...
[realtime-hf] Batch check complete: 1 candidates, minHF=1.05, trigger=event
```

## Safety

✅ **Read-only operations**: Event decoding doesn't modify blockchain state
✅ **No changes to liquidation logic**: Existing liquidation execution unchanged
✅ **Backwards compatible**: Falls back to legacy user extraction if decode fails
✅ **Well tested**: 318 tests passing, including 30 new tests for event decoding

## Testing

Run the test suite:

```bash
cd backend
npm test                                    # All tests
npm test tests/unit/aaveV3PoolEvents.test.ts  # Event decoding tests only
```

## Files Added/Modified

### New Files

- `backend/src/abi/aaveV3PoolEvents.ts` - Event definitions and decoder
- `backend/tests/unit/aaveV3PoolEvents.test.ts` - Comprehensive tests
- `backend/scripts/test-event-decoding.ts` - Manual verification script

### Modified Files

- `backend/src/services/RealTimeHFService.ts` - Integrated event decoding

## Future Enhancements

Potential improvements:

1. **Event aggregation** - Batch events within a block before rechecking
2. **Priority queue** - Prioritize users by HF proximity to threshold
3. **Event metrics** - Track event frequency and types in Prometheus
4. **Custom handlers** - Per-event type custom logic
5. **Historical analysis** - Analyze past events for patterns

## References

- [Aave V3 Pool Events](https://docs.aave.com/developers/core-contracts/pool#events)
- [Chainlink Price Feeds](https://docs.chain.link/data-feeds/price-feeds)
- [Ethers.js Event Parsing](https://docs.ethers.org/v6/api/contract/#Interface)
