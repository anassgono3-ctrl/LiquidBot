# Borrowers Index Hotfix Summary

## Problem Statement

The BorrowersIndexService was causing repetitive Redis ECONNREFUSED errors even when attempts were made to disable it via environment variables. The root causes were:

1. **Boolean parsing bug**: Any non-empty string (including `"false"`) was treated as truthy
2. **No config gating**: Service initialization happened regardless of intent to disable
3. **Aggressive reconnection**: Redis client retried indefinitely, spamming error logs

## Solution Overview

This hotfix implements:
1. Robust environment variable parsing utilities
2. Proper configuration gating with safe defaults
3. Graceful fallback to memory-only mode
4. Single Redis connection attempt with no retry spam

## Changes Made

### New Files

1. **`backend/src/config/parseEnv.ts`**
   - `parseBoolEnv()`: Properly handles "false", "0", "", "true", "1", "yes"
   - `parseIntEnv()`: Safe integer parsing with defaults
   - `getEnv()`: Safe environment variable getter

2. **Test Files**
   - `backend/tests/unit/parseEnv.test.ts` (22 tests)
   - `backend/tests/unit/BorrowersIndexService.test.ts` (7 tests)
   - `backend/tests/unit/BorrowersIndexGating.test.ts` (4 tests)

3. **`backend/scripts/test-borrowers-index-modes.ts`**
   - Demonstration script showing all four mode scenarios

### Modified Files

1. **`backend/src/config/envSchema.ts`**
   - Added 4 new environment variables for borrowers index configuration

2. **`backend/src/config/index.ts`**
   - Added `config.borrowersIndex` namespace with enabled/backfillBlocks/chunkBlocks/redisUrl

3. **`backend/src/services/BorrowersIndexService.ts`**
   - Added mode detection (memory/redis)
   - Single Redis connection attempt with `reconnectStrategy: false`
   - Graceful fallback to memory mode on connection failure
   - Clear logging of active mode

4. **`backend/src/services/RealTimeHFService.ts`**
   - Added documentation comments for borrowersIndex field

5. **`backend/.env.example`**
   - Documented new environment variables with examples

6. **`backend/README.md`**
   - Added Borrowers Index section with behavior matrix

## Environment Variables

### New Configuration

```bash
# Borrowers Index (optional - disabled by default)
BORROWERS_INDEX_ENABLED=false
BORROWERS_INDEX_BACKFILL_BLOCKS=50000
BORROWERS_INDEX_CHUNK_BLOCKS=2000
# BORROWERS_INDEX_REDIS_URL=redis://localhost:6379  # Optional: defaults to REDIS_URL
```

### Behavior Matrix

| BORROWERS_INDEX_ENABLED | Redis URL | Result | Logs |
|-------------------------|-----------|--------|------|
| `false` or `0` (default) | any | **disabled** | No logs, service not instantiated |
| `true` or `1` | not set | **memory mode** | `[borrowers-index] memory mode (no Redis URL configured)` |
| `true` or `1` | valid & connects | **redis mode** | `[borrowers-index] redis mode` |
| `true` or `1` | invalid / ECONNREFUSED | **memory fallback** | `[borrowers-index] Redis connection failed, switching to memory mode` |

## Testing

### Test Coverage
- **Total tests**: 723 (33 new)
- **Test files**: 60 (3 new)
- **All tests passing**: ✅
- **CodeQL security scan**: 0 alerts ✅

### Test Categories

1. **Boolean Parsing** (22 tests)
   - Handles "false", "FALSE", "0", "" → false
   - Handles "true", "TRUE", "1", "yes", "YES" → true
   - Respects default values
   - Trims whitespace

2. **Integer Parsing** (tests included)
   - Valid integers parsed correctly
   - Invalid values use defaults
   - Undefined values use defaults

3. **BorrowersIndexService** (7 tests)
   - Memory mode initialization
   - Memory-only operations
   - Redis connection failure handling
   - No error spam on connection failure
   - Clean shutdown

4. **Config Integration** (4 tests)
   - Service not instantiated when disabled
   - RealTimeHFService functions without borrowers index
   - Config namespace structure
   - Redis URL fallback to REDIS_URL

### Running Tests

```bash
cd backend

# Run all tests
npm test

# Run specific test suites
npm test tests/unit/parseEnv.test.ts
npm test tests/unit/BorrowersIndexService.test.ts
npm test tests/unit/BorrowersIndexGating.test.ts

# Run demonstration
npx tsx scripts/test-borrowers-index-modes.ts
```

## Verification

### Example Scenarios

**Scenario 1: Disabled (default)**
```bash
# .env
BORROWERS_INDEX_ENABLED=false

# Result: No service instantiation, no Redis connection, no logs
```

**Scenario 2: Memory mode**
```bash
# .env
BORROWERS_INDEX_ENABLED=true
# REDIS_URL not set

# Logs:
# [borrowers-index] memory mode (no Redis URL configured)
# [borrowers-index] Initializing with N reserves (mode=memory)
# [borrowers-index] Initialization complete (mode=memory)
```

**Scenario 3: Redis mode**
```bash
# .env
BORROWERS_INDEX_ENABLED=true
REDIS_URL=redis://localhost:6379

# Logs (if Redis running):
# [borrowers-index] redis mode
# [borrowers-index] Initializing with N reserves (mode=redis)
# [borrowers-index] Initialization complete (mode=redis)
```

**Scenario 4: Fallback on connection error**
```bash
# .env
BORROWERS_INDEX_ENABLED=true
REDIS_URL=redis://localhost:6379

# Logs (if Redis NOT running):
# [borrowers-index] Redis connection failed, switching to memory mode
# [borrowers-index] Initializing with N reserves (mode=memory)
# [borrowers-index] Initialization complete (mode=memory)
```

## Impact Assessment

### Zero Impact on Production
- **Default behavior**: Service disabled (BORROWERS_INDEX_ENABLED=false)
- **No changes to liquidation logic**: All changes isolated to BorrowersIndexService
- **RealTimeHFService unchanged**: Service already declared but never instantiated
- **Backward compatible**: All existing configurations continue to work

### Risk Level: Low
- Changes are isolated and well-tested
- Feature is not currently used in production code paths
- Graceful fallback ensures service continues even if configuration is incorrect
- Comprehensive test coverage validates all scenarios

## Rollback Plan

If issues arise, simply revert this PR:
```bash
git revert <commit-hash>
```

No data migrations or configuration changes are required for rollback.

## Future Enhancements (Out of Scope)

The following were considered but marked as non-goals for this hotfix:
- Metrics/gauges for mode tracking
- Integration with RealTimeHFService for reserve-triggered checks
- Performance tuning of backfill logic
- Advanced retry/backoff strategies

These can be addressed in future PRs if needed.

## Related Documentation

- Environment Variables: `backend/.env.example`
- Configuration Guide: `backend/README.md` (Borrowers Index section)
- API Reference: `backend/src/config/parseEnv.ts` (JSDoc comments)

## Acceptance Criteria

✅ Setting `BORROWERS_INDEX_ENABLED=false` produces no Redis connection attempts
✅ Setting `BORROWERS_INDEX_ENABLED=0` produces no Redis connection attempts  
✅ With `BORROWERS_INDEX_ENABLED=true` and no Redis URL, index runs in memory
✅ With bad Redis URL, only a single warning is logged (no spam)
✅ All 723 tests pass
✅ CodeQL security scan passes with 0 alerts
✅ Existing functionality untouched
✅ Build succeeds
✅ Lint passes

## Deployment Notes

1. **No configuration changes required** for existing deployments
2. Service remains disabled by default
3. To enable (optional): Set `BORROWERS_INDEX_ENABLED=true` in `.env`
4. Redis persistence is optional - service works in memory-only mode
5. No database migrations needed
6. No restart required for config-only changes (if service was already disabled)

---

**Implementation Date**: 2025-11-13  
**Author**: GitHub Copilot  
**Status**: Complete ✅
