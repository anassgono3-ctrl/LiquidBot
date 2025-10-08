# On-Demand Health Factor Resolution

## Overview

This document describes the transition from bulk health monitoring to strictly on-demand health factor resolution, implemented to eliminate unnecessary subgraph API consumption and reduce operational costs.

## Problem Statement

### Previous Approach (Bulk Monitoring)

The legacy implementation used `HealthMonitor` to perform periodic bulk health snapshots:

- **Query**: `getUserHealthSnapshot(500)` - fetched ALL users with debt
- **Frequency**: Every 2× polling interval (typically 30 seconds)
- **API Cost**: ~500 user queries every 30 seconds = massive quota consumption
- **Side Effect**: Thousands of Zod parsing logs for large user arrays
- **Inefficiency**: Most users fetched were not involved in any liquidation events

**Example**: With 500 users and 15-second polling, this resulted in ~1000 user queries per minute, exhausting API quotas quickly.

## New Approach (On-Demand Resolution)

Health factors are now computed **only** when new liquidation events are detected, on a strictly per-user basis.

### Architecture

```
┌──────────────────┐
│ Subgraph Poller  │
│                  │
│ 1. Poll for new  │
│    liquidations  │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────┐
│ Liquidation Tracker      │
│                          │
│ 2. Determine NEW events  │
│    (delta detection)     │
└────────┬─────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ Extract Unique User IDs     │
│                             │
│ 3. Get unique borrowers     │
│    from NEW events only     │
└────────┬────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│ OnDemandHealthFactor Service │
│                              │
│ 4. For EACH unique user:     │
│    - Query single user       │
│    - Calculate health factor │
│    - Attach to event         │
└──────────────────────────────┘
```

### Key Changes

#### 1. SubgraphService Methods

**Disabled (throw errors)**:
- `getUsersWithDebt(limit)` - bulk query disabled
- `getUserHealthSnapshot(limit)` - bulk snapshot disabled

**New**:
- `getSingleUserWithDebt(userId)` - fetch one user by ID

**Schema Updates**:
- Accept `number | string` for numeric fields (decimals, reserveLiquidationThreshold, borrowedReservesCount)
- Prevents Zod parsing errors from subgraph string numbers

#### 2. OnDemandHealthFactor Service

New service replacing `HealthFactorResolver`:

```typescript
class OnDemandHealthFactor {
  async getHealthFactor(userId: string): Promise<number | null>
}
```

**Features**:
- Single-user query only
- No caching (simplicity over optimization)
- No batching (sequential queries)
- Returns `null` for users with zero debt or errors

**GraphQL Query**:
```graphql
query SingleUserWithDebt($id: ID!) {
  user(id: $id) {
    id
    borrowedReservesCount
    reserves {
      currentATokenBalance
      currentVariableDebt
      currentStableDebt
      reserve {
        id symbol name decimals
        reserveLiquidationThreshold
        usageAsCollateralEnabled
        price { priceInEth }
      }
    }
  }
}
```

#### 3. HealthMonitor Stub

`HealthMonitor` is now a no-op stub for compatibility:

```typescript
class HealthMonitor {
  async updateAndDetectBreaches(): Promise<[]> { return []; }
  async getHealthSnapshotMap(): Promise<Map<string, HealthSnapshot>> { return new Map(); }
  getStats() { 
    return { 
      mode: 'disabled',
      message: 'Bulk health monitoring disabled - using on-demand resolution'
    };
  }
}
```

**Removed**:
- Scheduled health monitoring interval
- Breach detection logic
- Health factor caching in memory

#### 4. Polling Integration

When new liquidations are detected:

```typescript
// Extract unique users from NEW events only
const uniqueUserIds = [...new Set(newEvents.map(e => e.user.toLowerCase()))];

// Fetch health factor individually for each user
for (const userId of uniqueUserIds) {
  const hf = await onDemandHealthFactor.getHealthFactor(userId);
  
  // Attach to all events for this user
  for (const event of newEvents) {
    if (event.user.toLowerCase() === userId) {
      event.healthFactor = hf;
    }
  }
}
```

**No batching**: Each user is queried individually, sequentially. This is acceptable because:
- New liquidations are rare (typically 0-5 per poll)
- Sequential queries are predictable and debuggable
- No cache coherency issues

## Performance Impact

### API Quota Reduction

**Before**:
- Bulk snapshot: 500 users × 30 polls/min = 15,000 user queries/min
- Plus individual liquidation queries

**After**:
- Only liquidation-triggered queries
- Typical: 0-5 users per new liquidation batch
- With 2 new liquidations per minute: ~4 user queries/min

**Savings**: ~99.97% reduction in health factor queries

### No More Zod Spam

**Before**:
```
[subgraph] ZodError: Invalid input at users[234].reserves[1].decimals
[subgraph] ZodError: Invalid input at users[456].borrowedReservesCount
... (hundreds of lines per poll)
```

**After**:
- Single-user schemas are simple
- String/number union accepts both formats
- Clean logs, no parsing spam

## Configuration

### Environment Variables

Removed:
- `HEALTH_USER_CACHE_TTL_MS` (no caching)
- `HEALTH_MAX_BATCH` (no batching)
- `HEALTH_MONITOR_MODE` (monitoring disabled)

Kept (for reference):
- `HEALTH_ALERT_THRESHOLD=1.10` (not actively used)
- `HEALTH_EMERGENCY_THRESHOLD=1.05` (not actively used)
- `HEALTH_QUERY_MODE=on_demand` (always on_demand now)

### Health Endpoint

The `/health` endpoint now returns:

```json
{
  "healthMonitoring": {
    "mode": "disabled",
    "message": "Bulk health monitoring disabled - using on-demand resolution"
  },
  "onDemandHealthFactor": true
}
```

## Testing

### Unit Tests

**HealthMonitor Tests**:
- Updated to expect empty results (disabled state)
- `getStats()` returns `{ mode: 'disabled', message: '...' }`
- `updateAndDetectBreaches()` returns `[]`
- `getHealthSnapshotMap()` returns empty `Map()`

**SubgraphService Tests**:
- Replaced `getUsersWithDebt` tests with `getSingleUserWithDebt` tests
- Tests for single-user query success, not found, and error cases

**Poller Tests**:
- Updated to use `OnDemandHealthFactor` instead of `HealthFactorResolver`
- Mock `getHealthFactor(userId)` instead of `getHealthFactorsForUsers(userIds)`

### Integration Verification

To verify on-demand resolution is working:

1. Check logs for liquidation polling:
   ```
   [subgraph] liquidation snapshot size=10 new=2 totalSeen=523 hfResolved=2
   ```

2. Verify no bulk queries in logs:
   - No "getUsersWithDebt" or "getUserHealthSnapshot" calls
   - Only "getSingleUserWithDebt" or "singleUserWithDebt" operations

3. Check API quota usage:
   - Should see dramatic reduction (>95%) in user queries
   - Metrics: only `liquidbot_subgraph_requests_total{operation="singleUserWithDebt"}`

## Migration Notes

### For Existing Deployments

1. **No database changes required** - this is purely application logic
2. **Metrics change**: Remove health breach dashboards (no longer tracked)
3. **Notifications**: Health breach alerts are no longer sent (only opportunity alerts)
4. **API quota**: Expect immediate 95%+ reduction in subgraph API usage

### Rollback Plan

If rollback is needed:
1. Revert to previous commit
2. Restore `HEALTH_USER_CACHE_TTL_MS` and `HEALTH_MAX_BATCH` in `.env`
3. Redeploy

However, rollback is **not recommended** due to:
- High API quota consumption
- Zod parsing spam in logs
- Unnecessary bulk queries

## Future Enhancements

### Optional: Add Caching

If needed for high-traffic scenarios:

```typescript
class OnDemandHealthFactor {
  private cache: Map<string, { hf: number | null; ts: number }>;
  
  async getHealthFactor(userId: string): Promise<number | null> {
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.ts < 60000) {
      return cached.hf;
    }
    // ... fetch and cache
  }
}
```

### Optional: Add Batching

For handling bursts of liquidations (>10 users):

```typescript
async getHealthFactorsForUsers(userIds: string[]): Promise<Map<string, number | null>> {
  // Batch query with max 25 users per request
  // Similar to old HealthFactorResolver logic
}
```

**Note**: Current implementation intentionally avoids these optimizations for simplicity and debuggability.

## Conclusion

The on-demand health factor resolution approach:
- ✅ Eliminates bulk snapshot queries (500 users → 0)
- ✅ Reduces API quota consumption by >95%
- ✅ Removes Zod parsing spam from logs
- ✅ Maintains accurate health factors for liquidation opportunities
- ✅ Simpler codebase (no caching, no batching complexity)

This design prioritizes **precision** (health factors only when needed) over **proactive monitoring** (bulk snapshots), aligning with the event-driven nature of liquidation detection.
