# Dirty User Set Diagnostic Tool

## Overview

`diagnose-dirty-users.ts` is a comprehensive diagnostic script designed to help debug why the dirty user set might remain at size 0 in the RealTimeHFService. The dirty user set is crucial for prioritizing health factor checks on users who have recently interacted with the Aave protocol or been affected by price changes.

## Purpose

This tool exercises all known pathways for marking users dirty and provides detailed instrumentation to identify:

- Configuration issues that prevent dirty marking
- Provider connectivity problems
- Price trigger misconfiguration
- Event handling failures
- Debounce timing issues
- TTL expiration problems

## Usage

### Basic Usage

```bash
npm run diagnose:dirty
```

### With Environment Variables

```bash
# Minimal test mode (most features will be skipped)
API_KEY=test-key JWT_SECRET=test-secret USE_MOCK_SUBGRAPH=true npm run diagnose:dirty

# Full test with price triggers enabled
USE_REALTIME_HF=true \
PRICE_TRIGGER_ENABLED=true \
CHAINLINK_FEEDS=ETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70 \
WS_RPC_URL=wss://mainnet.base.org \
API_KEY=test-key \
JWT_SECRET=test-secret \
npm run diagnose:dirty
```

## Test Phases

### Phase A: Environment Validation

Validates and prints all relevant configuration:
- `USE_REALTIME_HF`
- `WS_RPC_URL`
- `CHAINLINK_FEEDS`
- `PRICE_TRIGGER_*` settings
- `EXECUTION_HF_THRESHOLD_BPS`
- `CANDIDATE_MAX`
- Head check paging configuration

**Warnings:** Identifies common misconfigurations that prevent dirty marking.

### Phase B: Provider Identity Instrumentation

Identifies which provider is used for subscriptions:
- Provider type (WebSocketProvider, JsonRpcProvider, etc.)
- WebSocket URL (if applicable)
- Connection status

**Note:** The service uses `this.provider` (from `WS_RPC_URL`) for both Aave events and Chainlink feeds, NOT `CHAINLINK_RPC_URL`.

### Phase C: Synthetic Chainlink Events

Tests price trigger pathway by injecting synthetic `AnswerUpdated` events:
- Baseline price establishment
- Price drop simulation (30 bps by default)
- Verification of dirty user marking via price trigger

**Skipped when:** `PRICE_TRIGGER_ENABLED=false` or `CHAINLINK_FEEDS` not configured.

### Phase D: Synthetic Aave Events

Tests event-based dirty marking by injecting a synthetic `Borrow` event:
- Creates realistic Borrow event log
- Verifies user is added to dirty set
- Checks dirty set size before/after

**Expected:** User should be marked dirty after event is processed.

### Phase E: Debounce Testing

Tests the price trigger debounce mechanism:
- Rapid price drops within debounce window (should be suppressed)
- Price drop after debounce window (should trigger)

**Skipped when:** Price trigger not enabled.

### Phase F: Cumulative Mode Testing

Tests cumulative price drop tracking mode:
- Sequential small drops that accumulate
- Baseline reset after trigger

**Skipped when:** `PRICE_TRIGGER_CUMULATIVE=false` or price trigger disabled.

### Phase G: Final Report

Generates summary report with:
- Final dirty user set size and contents
- Service metrics (blocks received, logs processed, etc.)
- Candidate count

## Output

### Console Output

The script provides color-coded console output:
- ✓ Green: Test passed
- ✗ Red: Test failed
- ○ Blue: Test skipped
- ⚠ Yellow: Warning

### JSON Output

The script outputs a structured JSON summary at the end:

```json
{
  "env": { /* environment configuration */ },
  "providerUrl": "wss://...",
  "chainlinkEventsTest": { "status": "PASS", "message": "...", "details": [...] },
  "aaveEventsTest": { "status": "PASS", "message": "...", "details": [...] },
  "priceTriggerTest": { "status": "SKIP", "message": "..." },
  "debounceTest": { "status": "SKIP", "message": "..." },
  "ttlTest": { "status": "SKIP", "message": "..." },
  "final": {
    "dirtyCount": 1,
    "metrics": { /* service metrics */ }
  }
}
```

### Exit Codes

- `0`: All executed tests passed
- `1`: One or more tests failed

## Common Issues & Solutions

### Issue: "USE_REALTIME_HF is disabled"

**Solution:** Set `USE_REALTIME_HF=true` in your environment.

### Issue: "WS_RPC_URL is not configured"

**Solution:** Provide a WebSocket RPC URL:
```bash
WS_RPC_URL=wss://mainnet.base.org
```

### Issue: "EXECUTION_HF_THRESHOLD_BPS=10000"

**Problem:** Setting this to 10000 (100%) causes inconsistent logic.

**Solution:** Use default value (9800) or adjust to your needs:
```bash
EXECUTION_HF_THRESHOLD_BPS=9800
```

### Issue: Price trigger tests skipped

**Solution:** Enable price trigger and configure feeds:
```bash
PRICE_TRIGGER_ENABLED=true
CHAINLINK_FEEDS=ETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,USDC:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B
```

### Issue: Dirty users not persisting

**Possible causes:**
1. Dirty set is cleared immediately after head checks complete
2. No head checks are running (check `USE_REALTIME_HF`)
3. TTL expiration (not yet implemented in diagnostic)

**Check logs for:**
```
[diagnostics] User marked dirty: 0x... via_event=Borrow dirty_set_size=1
[diagnostics] Dirty set cleared after head check: cleared_count=1 block=...
```

## Integration with RealTimeHFService

The diagnostic tool uses the actual `RealTimeHFService` class with `skipWsConnection: true` to avoid real network calls. This means:
- It tests the same code paths used in production
- Event handling logic is identical
- Dirty user marking works exactly as in production

## Metrics

The service tracks dirty user set size via Prometheus metric:
```
liquidbot_realtime_dirty_user_count
```

Monitor this metric in production to observe dirty user set behavior in real-time.

## See Also

- `RealTimeHFService.ts`: Main service implementation
- `diagnose-all.ts`: General diagnostic script for all services
- `.env.example`: Example environment configuration
