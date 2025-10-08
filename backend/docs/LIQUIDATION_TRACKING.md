# Incremental Liquidation Detection

## Overview

The liquidation tracking system implements incremental (delta) detection of liquidation calls, ensuring that each poll only reports and processes **new** liquidation events rather than always logging the full snapshot. This reduces log noise and enables real-time downstream features like WebSocket broadcasts.

## Architecture

### Components

1. **LiquidationTracker** (`src/polling/liquidationTracker.ts`)
   - Maintains an in-memory Set of seen liquidation IDs
   - Implements FIFO pruning to bound memory usage
   - Returns diff results identifying new events

2. **SubgraphPoller** (`src/polling/subgraphPoller.ts`)
   - Integrates the tracker to detect new events each poll
   - Updates Prometheus metrics
   - Invokes callbacks for both raw snapshots and new events only

3. **Metrics** (`src/metrics/index.ts`)
   - `liquidation_new_events_total` - Counter of new events detected
   - `liquidation_snapshot_size` - Current snapshot size
   - `liquidation_seen_total` - Total unique IDs tracked

## Configuration

### Environment Variables

```bash
# Maximum number of liquidations to fetch per poll (default: 5)
# Note: This was reduced from 50 to minimize subgraph load
POLL_LIMIT=5

# Legacy variable (use POLL_LIMIT instead)
# LIQUIDATION_POLL_LIMIT=5

# Maximum number of unique IDs to track (default: 5000)
# Oldest IDs are pruned when this limit is exceeded
LIQUIDATION_TRACK_MAX=5000

# Ignore first (bootstrap) batch for notifications (default: true)
IGNORE_BOOTSTRAP_BATCH=true
```

### Configuration in Code

```typescript
import { config } from './config/index.js';

const pollLimit = config.pollLimit;             // 5 (new default)
const trackMax = config.liquidationTrackMax;    // 5000
const ignoreBootstrap = config.ignoreBootstrapBatch; // true
```

## Usage

### Starting the Poller with Tracking

```typescript
import { startSubgraphPoller } from './polling/subgraphPoller.js';
import { SubgraphService } from './services/SubgraphService.js';

const service = new SubgraphService();

const poller = startSubgraphPoller({
  service,
  intervalMs: 15000,
  pollLimit: 5,  // Reduced from 50 to minimize load
  trackMax: 5000,
  
  // Called with full snapshot (optional)
  onLiquidations: (snapshot) => {
    console.log(`Received ${snapshot.length} liquidations`);
  },
  
  // Called only with NEW events (optional)
  onNewLiquidations: (newEvents) => {
    console.log(`Detected ${newEvents.length} new liquidations`);
    // Broadcast to WebSocket, store in DB, etc.
  }
});

// Get tracker stats
const stats = poller.getTrackerStats();
console.log(`Tracking ${stats.seenTotal} unique IDs (limit: ${stats.pollLimit})`);

// Stop the poller
poller.stop();
```

## Log Format

The poller now logs with a structured format showing:
- **snapshot size**: Number of liquidations in current poll
- **new**: Number of new (previously unseen) liquidations
- **totalSeen**: Total unique liquidation IDs tracked

```
[subgraph] liquidation snapshot size=50 new=3 totalSeen=1247
[subgraph] new liquidation IDs: 0x123abc..., 0x456def..., 0x789ghi...
```

## WebSocket Integration

New liquidations are automatically broadcast via WebSocket with the following message format:

```json
{
  "type": "liquidation.new",
  "liquidations": [
    {
      "id": "0x123abc...",
      "timestamp": 1234567890,
      "user": "0xUser...",
      "liquidator": "0xLiquidator..."
    }
  ],
  "timestamp": "2024-01-15T12:00:00.000Z"
}
```

## Health Endpoint

The `/health` endpoint now includes liquidation tracker statistics:

```json
{
  "status": "ok",
  "app": { "uptimeSeconds": 3600, "version": "0.1.0" },
  "liquidationTracker": {
    "seenTotal": 1247,
    "pollLimit": 50
  }
}
```

## Metrics

Query Prometheus metrics at `/metrics`:

```
# HELP liquidbot_liquidation_new_events_total Total number of new liquidation events detected
# TYPE liquidbot_liquidation_new_events_total counter
liquidbot_liquidation_new_events_total 127

# HELP liquidbot_liquidation_snapshot_size Size of the most recent liquidation snapshot
# TYPE liquidbot_liquidation_snapshot_size gauge
liquidbot_liquidation_snapshot_size 50

# HELP liquidbot_liquidation_seen_total Total number of unique liquidation IDs tracked
# TYPE liquidbot_liquidation_seen_total gauge
liquidbot_liquidation_seen_total 1247
```

## Memory Management

The tracker uses a FIFO queue to prune oldest IDs when `LIQUIDATION_TRACK_MAX` is exceeded:

1. New liquidations are added to both the Set and queue
2. When Set size > max, oldest IDs from queue are removed
3. Pruned IDs will be detected as "new" if they reappear

**Example**: With `LIQUIDATION_TRACK_MAX=5000`, the tracker keeps the 5000 most recently seen IDs. Older IDs are automatically pruned.

## Testing

### Unit Tests

```bash
npm test tests/unit/liquidationTracker.test.ts
npm test tests/unit/subgraphPoller.test.ts
```

### Manual Testing

```typescript
import { createLiquidationTracker } from './polling/liquidationTracker.js';

const tracker = createLiquidationTracker({ max: 100 });

// First poll: all new
const result1 = tracker.diff([{ id: 'a' }, { id: 'b' }]);
console.log(result1.newEvents.length); // 2

// Second poll: overlapping
const result2 = tracker.diff([{ id: 'b' }, { id: 'c' }]);
console.log(result2.newEvents.length); // 1 (only 'c' is new)
```

## Best Practices

1. **Set appropriate poll limits**: Balance between detecting all events and API rate limits
2. **Monitor metrics**: Track `liquidation_new_events_total` to understand event frequency
3. **Adjust trackMax**: Increase if you see the same IDs repeatedly detected as new
4. **Use onNewLiquidations**: For real-time actions (alerts, broadcasts, storage)
5. **Keep onLiquidations for analytics**: If you need the full snapshot for analysis

## Limitations

- **In-memory only**: Tracker state is lost on restart (first poll after restart sees all as new)
- **No persistence**: Not suitable for critical historical tracking across restarts
- **FIFO pruning**: Very old liquidations may be re-detected as new if they exceed trackMax

## Future Enhancements

- [ ] Optional Redis-backed persistence for tracker state
- [ ] Configurable pruning strategies (LRU, TTL-based)
- [ ] Database integration for historical liquidation storage
- [ ] Backfill mechanism for draining older unprocessed events
