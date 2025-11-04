# Timeout and Recovery Mechanisms

## Overview

This document describes the timeout and recovery mechanisms implemented to prevent indefinite hangs during real-time head scans. These features ensure the bot never waits indefinitely on hung JSON-RPC calls or stalled WebSocket streams.

## Problem Statement

The real-time HF detection service can experience rare but impactful freezes due to:
1. **Hung multicall chunks**: `aggregate3.staticCall` can hang without resolving/rejecting, causing the head run to await forever
2. **Stalled runs**: A run can make no progress and block future runs from starting
3. **Silent WS stalls**: WebSocket connections can stall without emitting errors, causing no new blocks to arrive

These issues result in the bot appearing frozen until a manual restart.

## Solution Components

### 1. Per-Chunk Hard Timeout + Retry

Each `aggregate3.staticCall` chunk is wrapped with a hard timeout using `Promise.race`:

```typescript
const results = await this.withTimeout(
  this.multicall3.aggregate3.staticCall(chunk, overrides),
  config.chunkTimeoutMs,  // default: 2000ms
  `Chunk ${chunkNum} timeout after ${config.chunkTimeoutMs}ms`
);
```

**Retry Logic:**
- On timeout: Log the event, increment metrics, retry with jittered exponential backoff
- Maximum retries: `CHUNK_RETRY_ATTEMPTS` (default: 2)
- Backoff: `baseDelay * 2^attempt ± 30% jitter`

**Secondary RPC Fallback:**
- If `SECONDARY_HEAD_RPC_URL` is configured, the first timeout or rate-limit error triggers a fallback attempt on the secondary provider
- If secondary succeeds, the primary is used for subsequent chunks
- If both fail, continues with synthetic failures to avoid blocking the run

**Graceful Degradation:**
- If all attempts fail, synthetic failure results are returned: `{ success: false, returnData: '0x' }`
- The run continues with remaining chunks rather than blocking indefinitely

### 2. Run-Level Watchdog

A run-level watchdog detects stalled runs and aborts them cleanly:

```typescript
private startRunWatchdog(blockNumber: number): void {
  const checkStall = () => {
    const timeSinceProgress = Date.now() - this.lastProgressAt;
    if (timeSinceProgress > config.runStallAbortMs) {  // default: 5000ms
      console.error(`run stalled after ${timeSinceProgress}ms; aborting`);
      this.abortCurrentRun(blockNumber);
    }
  };
  this.runWatchdogTimer = setTimeout(checkStall, config.runStallAbortMs);
}
```

**Progress Tracking:**
- `lastProgressAt` timestamp is updated on each successful chunk completion
- If no progress for `RUN_STALL_ABORT_MS`, the run is aborted

**Abort Behavior:**
- Stops the watchdog timer
- Pushes the pending block back to the queue for retry
- Releases `scanningHead` lock
- Logs abort event with run/block context
- Increments `run_aborts_total` metric
- Restarts the run loop if there's a pending block

### 3. WebSocket Heartbeat + Auto-Reconnect

A heartbeat monitor detects stalled WebSocket connections and triggers reconnection:

```typescript
private startWsHeartbeat(): void {
  const heartbeatCheck = () => {
    const timeSinceLastActivity = Date.now() - this.lastWsActivity;
    if (timeSinceLastActivity > config.wsHeartbeatMs) {  // default: 15000ms
      console.warn(`WS heartbeat timeout: no activity for ${timeSinceLastActivity}ms`);
      this.handleWsStall();
    }
  };
  this.wsHeartbeatTimer = setTimeout(heartbeatCheck, config.wsHeartbeatMs);
}
```

**Activity Tracking:**
- `lastWsActivity` is updated on every block notification
- Heartbeat checks run every `WS_HEARTBEAT_MS`

**Reconnection Process:**
1. Clean up existing provider (remove listeners, destroy)
2. Re-establish provider connection (`setupProvider()`)
3. Re-setup contract instances (`setupContracts()`)
4. Re-subscribe to all listeners (`setupRealtime()`):
   - Block listener
   - Aave Pool logs
   - Chainlink price feeds (if configured)
5. Restart pending block polling (if Flashblocks enabled)
6. Log `ws_reconnected` event
7. Increment `ws_reconnects_total` metric

## Configuration

All timeout parameters are configurable via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `CHUNK_TIMEOUT_MS` | 2000 | Hard timeout for each multicall chunk in milliseconds |
| `CHUNK_RETRY_ATTEMPTS` | 2 | Number of retry attempts after timeout (total attempts = 1 + retries) |
| `RUN_STALL_ABORT_MS` | 5000 | Run abort threshold - abort if no progress for this duration |
| `WS_HEARTBEAT_MS` | 15000 | WebSocket heartbeat interval - reconnect if no activity for this duration |
| `SECONDARY_HEAD_RPC_URL` | (optional) | Secondary RPC URL for fallback on timeout or rate-limit |

## Metrics

New metrics are exposed for monitoring:

| Metric | Type | Description |
|--------|------|-------------|
| `liquidbot_chunk_timeouts_total` | Counter | Total chunk timeouts during multicall operations |
| `liquidbot_run_aborts_total` | Counter | Total runs aborted due to stall detection |
| `liquidbot_ws_reconnects_total` | Counter | Total WebSocket reconnections due to heartbeat failures |
| `liquidbot_chunk_latency_seconds` | Histogram | Latency distribution of chunk execution |

Existing metrics also track recovery events:
- `liquidbot_realtime_reconnects_total`: Total WebSocket reconnection attempts (all causes)

## Logging

All timeout/retry/abort events are tagged with run and block context:

```
[realtime-hf] run=1699027320000-12345 block=12345 timeout chunk 1/3 after 2000ms (attempt 1/3)
[realtime-hf] run=1699027320000-12345 block=12345 Chunk 1/3 trying secondary provider
[realtime-hf] run=1699027320000-12345 block=12345 Chunk 1/3 complete via secondary (120 calls, 1.23s)
[realtime-hf] run=1699027320000-12345 block=12345 stalled after 5000ms; aborting
[realtime-hf] WS heartbeat timeout: no activity for 15000ms, triggering reconnect
[realtime-hf] ws_reconnected successfully after heartbeat failure
```

## Behavior with Secondary RPC

When `SECONDARY_HEAD_RPC_URL` is configured:

1. **First timeout or rate-limit**: Attempts the same chunk on secondary provider
2. **Secondary success**: Continues with primary for subsequent chunks
3. **Secondary failure**: Falls back to retry logic on primary
4. **No secondary configured**: All retries remain on primary provider

The secondary RPC is used narrowly per-chunk and does not affect the overall run strategy.

## Safety Considerations

- **Read-only operations**: All timeout logic applies only to read-only multicall operations; execution logic is untouched
- **Conservative defaults**: Default timeout values are chosen to be conservative and can be tuned per deployment
- **Graceful degradation**: Failed chunks return synthetic failures rather than blocking the run
- **No overlapping runs**: Serialization and coalescing behavior is preserved; watchdog ensures runs complete or abort
- **Idempotent reconnect**: WebSocket reconnection is idempotent and safe to trigger multiple times

## Validation

To validate the timeout and recovery mechanisms:

### Test Chunk Timeout
1. Configure a low `CHUNK_TIMEOUT_MS` (e.g., 100ms)
2. Observe chunk timeout logs
3. Verify retries with backoff
4. Confirm run completes with synthetic failures if all attempts time out

### Test Run Watchdog
1. Configure a low `RUN_STALL_ABORT_MS` (e.g., 1000ms)
2. Simulate a hung chunk (e.g., via network proxy that blackholes requests)
3. Observe run abort log after threshold
4. Verify subsequent runs proceed normally

### Test WS Heartbeat
1. Kill the WebSocket connection mid-run (e.g., network disruption)
2. Wait for `WS_HEARTBEAT_MS`
3. Observe reconnect log
4. Verify block events resume
5. Confirm all subscriptions are restored (blocks, Aave logs, Chainlink feeds)

### Test Secondary Fallback
1. Configure `SECONDARY_HEAD_RPC_URL`
2. Simulate rate-limit on primary (or timeout)
3. Observe secondary fallback attempt
4. Verify chunk completion via secondary
5. Confirm logs indicate fallback usage

## Integration with Existing Features

- **Adaptive chunking**: Timeout logic integrates with existing rate-limit handling and adaptive chunk sizing
- **Dirty-first prioritization**: Watchdog ensures dirty-first chunks are processed or aborted; never stuck
- **Flashblocks mode**: WS heartbeat works seamlessly with Flashblocks pending block polling
- **Edge triggering**: Timeout/recovery does not affect edge-trigger or hysteresis logic
- **Metrics**: New metrics complement existing real-time HF metrics

## Performance Impact

- **Minimal overhead**: Timeout wrapper adds negligible overhead (~1-2ms per chunk)
- **Reduced hang time**: Chunks time out within 2-3 seconds instead of hanging indefinitely
- **Improved throughput**: Runs complete or abort within ~5 seconds, enabling faster retry cycles
- **Lower latency**: WS reconnect within 15 seconds instead of requiring manual restart

## Future Enhancements

Possible future improvements:
- Adaptive timeout based on historical chunk latency percentiles
- Circuit breaker for repeatedly failing chunks
- Automatic primary/secondary provider rotation based on success rate
- Enhanced WS ping/pong mechanism using native WebSocket heartbeats
