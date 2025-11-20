# Historical Replay Mode

## Overview

The historical replay mode allows you to evaluate the bot's detection performance against real liquidation events by replaying historical blockchain data and comparing bot detections with ground truth liquidation events from The Graph.

## Features

- **Authenticated Subgraph Access**: Properly configures `Authorization: Bearer <token>` and `x-api-key` headers for The Graph Gateway
- **Robust Pagination**: Automatically fetches all liquidation events across multiple pages with configurable page size and limits
- **Retry & Partial Data Handling**: Gracefully handles network errors and returns partial data when some pages fail
- **Graceful Fallback**: Continues replay even when ground truth data is unavailable (e.g., auth failures), enabling latency analysis without coverage metrics
- **Safety**: Forces `EXECUTE=false` regardless of environment configuration to prevent accidental transaction submission

## Architecture

### Components

1. **EventGroundTruthLoader** (`src/replay/EventGroundTruthLoader.ts`)
   - Loads liquidation events from The Graph with authentication
   - Implements pagination with `skip` and `first` parameters
   - Handles auth errors and network failures gracefully
   - Returns partial data when possible

2. **ReplayController** (`src/replay/ReplayController.ts`)
   - Orchestrates the replay process
   - Manages fallback behavior when ground truth is unavailable
   - Coordinates between loader, scanner, and reporter

3. **Reporter** (`src/replay/Reporter.ts`)
   - Generates summary reports with ground truth metadata
   - Tracks coverage metrics (when ground truth available)
   - Records latency metrics for detection performance
   - Outputs JSON summaries for analysis

4. **CLI Entry** (`src/cli/replay.ts`)
   - Command-line interface for running replays
   - Validates configuration and environment variables
   - Forces execution safety measures

## Configuration

### Environment Variables

All configuration reuses existing environment variables:

```bash
# Required for subgraph access (warning if missing, continues in fallback mode)
GRAPH_API_KEY=your_api_key_here

# Subgraph endpoint (optional, uses default if not set)
SUBGRAPH_URL=https://gateway.thegraph.com/api/subgraphs/id/GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF

# Pagination configuration (optional)
SUBGRAPH_PAGE_SIZE=1000              # Default: 1000 (max allowed by The Graph)
SUBGRAPH_MAX_PAGES=500               # Default: 500 (cap for safety)
SUBGRAPH_REQUEST_INTERVAL_MS=350    # Default: 350ms (politeness delay)

# Replay-specific options (optional)
REPLAY_SUBGRAPH_ABORT_ON_AUTH_ERROR=true  # Default: true (false enables fallback)
```

### Command Line Usage

```bash
# Basic usage (loads all available events)
npm run replay

# With block range
npm run replay <startBlock> <endBlock>

# With timestamp range (Unix timestamps)
npm run replay <startBlock> <endBlock> <startTimestamp> <endTimestamp>

# Example
npm run replay 10000000 10001000 1700000000 1700010000
```

## Authentication

### The Graph Gateway Authentication

The loader supports two authentication modes:

1. **Header Mode** (Recommended)
   - Set `GRAPH_API_KEY` environment variable
   - Use generic subgraph endpoint: `https://gateway.thegraph.com/api/subgraphs/id/<deployment_id>`
   - Headers automatically attached: `Authorization: Bearer <key>` and `x-api-key: <key>`

2. **Path-Embedded Mode**
   - API key embedded in URL: `https://gateway.thegraph.com/api/<key>/subgraphs/id/<deployment_id>`
   - Not recommended for replay mode (use header mode instead)

### Auth Error Handling

When authentication fails:
- **Default behavior** (`REPLAY_SUBGRAPH_ABORT_ON_AUTH_ERROR=true`): Returns partial data if any pages succeeded
- **Fallback mode** (`REPLAY_SUBGRAPH_ABORT_ON_AUTH_ERROR=false`): Continues replay without ground truth, logs warning

## Pagination

The loader automatically handles pagination:
- Fetches events in pages of `SUBGRAPH_PAGE_SIZE` (max 1000)
- Uses `skip` parameter to iterate through results
- Stops when:
  - Empty page received (no more events)
  - Short page detected (< pageSize events)
  - Max pages reached (`SUBGRAPH_MAX_PAGES`)
  - Error occurs (returns partial data)
- Adds politeness delay (`SUBGRAPH_REQUEST_INTERVAL_MS`) between requests

## Fallback Behavior

When ground truth is unavailable:
- Replay continues with full candidate scanning
- No coverage metrics computed (requires ground truth)
- Latency and detection metrics still available
- Summary includes `groundTruthAvailable: false` flag
- Error message logged for diagnostics

## Output Format

### Summary JSON

```json
{
  "startTimestamp": 1700000000,
  "endTimestamp": 1700010000,
  "startBlock": 10000000,
  "endBlock": 10001000,
  "totalBlocks": 1001,
  "totalCandidatesScanned": 1500,
  "totalOpportunitiesDetected": 25,
  "groundTruthAvailable": true,
  "groundTruthCount": 30,
  "groundTruthErrorMessage": null,
  "groundTruthPartial": false,
  "coverageMetrics": {
    "truePositives": 24,
    "falseNegatives": 6,
    "coverage": 80.0
  },
  "latencyMetrics": {
    "avgLeadTimeSeconds": 12.5,
    "medianLeadTimeSeconds": 10.0,
    "p95LeadTimeSeconds": 25.0
  },
  "durationMs": 45000,
  "timestamp": "2024-11-20T16:00:00.000Z"
}
```

### Fields

- **groundTruthAvailable**: Boolean indicating if ground truth data was loaded successfully
- **groundTruthCount**: Number of liquidation events loaded from subgraph
- **groundTruthErrorMessage**: Error message if loading failed (optional)
- **groundTruthPartial**: True if some pages failed but partial data available (optional)
- **coverageMetrics**: Only present when groundTruthAvailable=true
  - **truePositives**: Liquidations detected by bot
  - **falseNegatives**: Liquidations missed by bot
  - **coverage**: Percentage of liquidations detected (TP / (TP + FN) * 100)
- **latencyMetrics**: Detection lead time statistics
  - **avgLeadTimeSeconds**: Average time between detection and actual liquidation
  - **medianLeadTimeSeconds**: Median lead time
  - **p95LeadTimeSeconds**: 95th percentile lead time

## Safety Measures

1. **Forced Execution Disable**: CLI forcibly sets `EXECUTE=false` and `EXECUTION_ENABLED=false` regardless of environment
2. **Log Redaction**: Private keys not printed in logs
3. **Read-Only Operations**: Replay mode never signs or submits transactions

## Examples

### Successful Replay with Ground Truth

```bash
export GRAPH_API_KEY=your_api_key
npm run replay 10000000 10001000

# Output:
[Replay] Ground truth loaded: 50 events
[Replay] Processing blocks 10000000 to 10001000...
[REPLAY_SUMMARY] {"groundTruthAvailable":true,"groundTruthCount":50,...}
```

### Replay with Auth Error (Fallback Mode)

```bash
# Missing or invalid API key
export GRAPH_API_KEY=invalid
npm run replay 10000000 10001000

# Output:
[Replay] WARNING: Authentication error, proceeding in fallback mode
[Replay] Processing blocks 10000000 to 10001000...
[REPLAY_SUMMARY] {"groundTruthAvailable":false,"groundTruthCount":0,...}
```

### Partial Data Scenario

```bash
export GRAPH_API_KEY=your_api_key
npm run replay 10000000 10010000  # Large range

# Output:
[EventGroundTruthLoader] Page 25 failed: rate limit exceeded
[EventGroundTruthLoader] Returning partial data: 24000 events
[Replay] WARNING: Ground truth partially available
[REPLAY_SUMMARY] {"groundTruthAvailable":true,"groundTruthCount":24000,"groundTruthPartial":true,...}
```

## Future Enhancements (Out of Scope)

- **On-Chain Fallback**: Use `eth_getLogs` to fetch liquidation events when subgraph unavailable (stub prepared)
- **Advanced Analytics**: Visualizations and predictive modeling integration
- **Real-time Replay**: Stream historical blocks in real-time simulation mode

## Troubleshooting

### "Auth error: missing authorization header"

**Cause**: `GRAPH_API_KEY` not set or invalid

**Solution**: 
1. Set valid `GRAPH_API_KEY` environment variable
2. OR set `REPLAY_SUBGRAPH_ABORT_ON_AUTH_ERROR=false` to continue without ground truth

### "Reached maxPages limit"

**Cause**: Too many liquidation events for configured page limit

**Solution**: 
1. Increase `SUBGRAPH_MAX_PAGES` (default: 500)
2. OR narrow time/block range to fetch fewer events

### Partial data warnings

**Cause**: Some pages failed due to network or rate limit errors

**Impact**: Coverage metrics may be incomplete but replay continues

**Solution**: Check network connection, increase `SUBGRAPH_REQUEST_INTERVAL_MS`, or retry

## Testing

Comprehensive test coverage in `tests/unit/replay/`:

- **Auth error handling**: Verifies graceful fallback on authentication failures
- **Pagination**: Tests multi-page fetching, skip logic, and short-page detection
- **Partial failure**: Ensures partial data returned when mid-query errors occur
- **Controller fallback**: Validates replay continues when ground truth unavailable

Run tests:
```bash
npm test -- tests/unit/replay/
```
