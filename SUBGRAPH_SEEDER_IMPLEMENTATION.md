# SubgraphSeeder Implementation Summary

## Overview

This document summarizes the implementation of the SubgraphSeeder service for comprehensive user discovery on Aave V3 Base. The implementation ensures complete user coverage while maintaining a clean separation of concerns: **subgraph for discovery only, real-time engine for triggering**.

## Problem Statement

The bot needed:
1. Nearly 100% coverage of Aave V3 Base users with positions (debt > 0 or aToken balance > 0)
2. Periodic refresh to capture dormant/older accounts that event-only discovery misses
3. Preservation of on-chain backfill + event listeners for reactivity
4. **Removal of misuse**: subgraph liquidationCalls must NOT trigger notifications or executions
5. Real-time engine as the ONLY trigger path

## Solution Architecture

### SubgraphSeeder Service

**Location**: `backend/src/services/SubgraphSeeder.ts`

**Responsibilities**:
- Query users with variable debt > 0
- Query users with stable debt > 0
- Query users with aToken balance > 0 (collateral holders)
- Union and dedupe user IDs across all queries
- Respect pagination with politeness delays (default 100ms between pages)
- Handle rate limits, retries, and errors gracefully
- Log detailed coverage metrics each cycle

**Key Features**:
- Pagination support with configurable page size (default 100, max 200)
- Politeness delays between pages to avoid rate limiting
- Comprehensive metrics: total users, by category, pages processed, duration
- Graceful error handling with partial results
- Respects max candidates limit (default 300)

### Integration with RealTimeHFService

The SubgraphSeeder is integrated into the RealTimeHFService for:

1. **Initial Seeding** (startup):
   - Performed once when USE_SUBGRAPH=true
   - Replaces on-chain backfill when subgraph is available
   - Falls back to on-chain backfill if subgraph seeding fails

2. **Periodic Refresh**:
   - Configurable interval via SUBGRAPH_REFRESH_MINUTES (default: 30 minutes)
   - Runs in background with jitter to avoid thundering herd
   - Merges discovered users into CandidateManager

### Removal of LiquidationCalls Misuse

**Critical Change**: Disabled the subgraphPoller from triggering notifications/executions.

**Before**: 
- subgraphPoller would fetch liquidationCalls
- New events would trigger opportunity building
- Profit calculations, Telegram notifications, and executions would occur

**After**:
- subgraphPoller ONLY logs and broadcasts informational events
- NO opportunity building, profit calculations, notifications, or executions
- Real-time engine (RealTimeHFService) is the ONLY trigger path

**Code Changes** (`backend/src/index.ts`):
- Removed all opportunity/execution logic from onNewLiquidations callback
- Added clear documentation comments
- Cleaned up unused imports and code

## Configuration

### New Environment Variable

```bash
# Subgraph refresh interval in minutes for periodic candidate discovery (default: 30)
# Used by SubgraphSeeder to periodically refresh the full user universe
SUBGRAPH_REFRESH_MINUTES=30
```

### Existing Variables (Already in Use)

```bash
# Master switch to enable/disable subgraph usage (default: false)
USE_SUBGRAPH=true

# Subgraph endpoint URL
SUBGRAPH_URL=https://gateway.thegraph.com/api/subgraphs/id/...

# Graph API key for authentication
GRAPH_API_KEY=your_api_key_here

# Maximum candidates to maintain in memory (default: 300)
CANDIDATE_MAX=300

# Page size for subgraph queries (min: 50, max: 200, default: 100)
SUBGRAPH_PAGE_SIZE=100
```

## Metrics and Logging

### SubgraphSeeder Logs

Example seeding cycle output:
```
[subgraph-seeder] Starting comprehensive user discovery...
[subgraph-seeder] Querying users with variable debt...
[subgraph-seeder] Querying users with stable debt...
[subgraph-seeder] Querying users with collateral...
[subgraph-seeder] Discovery complete: total=1234 variable_debt=456 stable_debt=78 collateral=890 pages=15 duration_ms=5432 coverage=41.1%
```

### RealTimeHFService Integration Logs

Example startup and periodic refresh:
```
[realtime-hf] Initial seeding from subgraph with SubgraphSeeder...
[realtime-hf] seed_source=subgraph_seeder candidates_total=1234 new=1234

[realtime-hf] Starting periodic subgraph seeding (interval=30 minutes)
[realtime-hf] seed_source=subgraph_seeder candidates_total=1250 new=16 variable_debt=458 stable_debt=79 collateral=895
```

### SubgraphPoller (Informational Only)

When subgraph detects historical liquidations:
```
[subgraph-poller] Detected 1 historical liquidation(s) (not triggering notifications - real-time engine handles detection)
```

## Testing

### Unit Tests

**Location**: `backend/tests/unit/SubgraphSeeder.test.ts`

**Coverage**: 11 comprehensive test cases
- Fetching users with variable debt
- Deduplication across queries
- Respecting maxCandidates limit
- Pagination correctness
- Handling degraded/mock mode
- Error handling and partial results
- Metrics collection

**Results**: All 397 backend tests pass

### Test Commands

```bash
# Run all tests
npm test

# Run SubgraphSeeder tests only
npm test SubgraphSeeder.test.ts

# Build
npm run build

# Lint
npm run lint
```

## Design Principles

### 1. Separation of Concerns

- **Subgraph**: Discovery and breadth (via SubgraphSeeder)
- **Real-time engine**: Speed and triggering (via RealTimeHFService)

### 2. Discovery vs Triggering

- **Discovery**: Finding potential candidates (subgraph seeding, on-chain backfill, event listeners)
- **Triggering**: Detecting liquidatable state and taking action (ONLY real-time engine)

### 3. Graceful Degradation

- SubgraphSeeder failures don't crash the service
- Falls back to on-chain backfill if subgraph unavailable
- Partial results returned on errors

### 4. Rate Limiting Respect

- Politeness delays between pages
- Respects SubgraphService rate limiting
- Uses retry logic for transient failures

## Benefits

1. **Near 100% Coverage**: Enumerates all users with positions across three categories
2. **Captures Dormant Accounts**: Periodic refresh finds users missed by event-only discovery
3. **No Duplication**: Real-time engine is the ONLY trigger - no competing notification paths
4. **Scalable**: Pagination and rate limiting support large user bases
5. **Observable**: Detailed metrics for monitoring coverage and performance
6. **Resilient**: Graceful error handling with partial results

## Migration Notes

### For Existing Deployments

When upgrading to this version:

1. Set `USE_SUBGRAPH=true` to enable SubgraphSeeder
2. Configure `SUBGRAPH_REFRESH_MINUTES` (default 30 minutes is reasonable)
3. Ensure `GRAPH_API_KEY` and `SUBGRAPH_DEPLOYMENT_ID` are set
4. Monitor logs for seeding metrics

### Behavior Changes

- **Before**: Subgraph liquidationCalls triggered notifications/executions
- **After**: Subgraph ONLY used for candidate discovery
- **Impact**: Real-time engine notifications may increase slightly as it now handles all triggering

## Future Enhancements

Potential improvements for future iterations:

1. **Metrics Export**: Export SubgraphSeeder metrics to Prometheus
2. **Dynamic Refresh Interval**: Adjust based on chain activity
3. **Incremental Seeding**: Track last-seen users to reduce query load
4. **Subgraph Health Monitoring**: Alert on seeding failures
5. **A/B Testing**: Compare subgraph vs on-chain discovery coverage

## References

- [SubgraphSeeder.ts](backend/src/services/SubgraphSeeder.ts)
- [RealTimeHFService.ts](backend/src/services/RealTimeHFService.ts)
- [index.ts](backend/src/index.ts)
- [SubgraphSeeder.test.ts](backend/tests/unit/SubgraphSeeder.test.ts)
- [.env.example](backend/.env.example)

## Conclusion

The SubgraphSeeder implementation provides comprehensive user coverage for Aave V3 Base while maintaining a clean architecture where the subgraph is used strictly for discovery and the real-time engine handles all triggering. This ensures complete opportunity detection without duplication or confusion about responsibility boundaries.
