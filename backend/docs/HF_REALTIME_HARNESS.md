# HF Real-time Harness - Test Utility

## Overview

The HF Real-time Harness (`hf-realtime-harness.ts`) is a **test-only** utility script that validates low-latency health factor detection without affecting the main bot's behavior. It connects to a WebSocket provider (Flashblocks if available, otherwise standard `newHeads`), batches Aave health factor checks via Multicall3, and reports liquidatable candidates using a configurable HF threshold.

**Important:** This script does NOT execute any transactions or modify any contract state. It is purely for monitoring and validation purposes.

## Purpose

- **Validate real-time detection**: Test WebSocket subscriptions and event-driven health factor monitoring
- **Benchmark latency**: Measure response times for block notifications and Aave Pool log events
- **Verify Multicall3 batching**: Confirm batch health factor checks work correctly
- **Identify liquidatable positions**: Monitor candidate users and report when they become liquidatable
- **Test infrastructure**: Validate WebSocket providers, RPC endpoints, and contract configurations before integrating into the main bot

## Prerequisites

1. **Node.js** >= 18.18.0
2. **Backend dependencies** installed (`npm install`)
3. **Environment configuration** (see Environment Variables below)
4. **WebSocket RPC URL** or HTTP fallback for Base network
5. **Candidate users** to monitor (either manually specified or seeded from subgraph)

## Environment Variables

Configure these variables in your `.env` file:

### Required Variables

```bash
# WebSocket RPC URL (required unless using Flashblocks)
WS_RPC_URL=wss://mainnet.base.org

# OR use Flashblocks (if supported by your provider)
USE_FLASHBLOCKS=true
FLASHBLOCKS_WS_URL=wss://your-flashblocks-provider.com

# HTTP RPC fallback (used if WebSocket fails)
RPC_URL=https://mainnet.base.org

# Candidate users (choose one method):
# Method 1: Manually specify addresses
CANDIDATE_USERS=0x123...,0x456...,0x789...

# Method 2: Seed from subgraph (requires both)
GRAPH_API_KEY=your_api_key_here
SUBGRAPH_DEPLOYMENT_ID=GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF
SUBGRAPH_URL=https://gateway.thegraph.com/api/subgraphs/id/GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF
SEED_LIMIT=50  # Number of users to fetch from subgraph (default: 50)
```

### Optional Variables

```bash
# Multicall3 address (default: 0xca11bde05977b3631167028862be2a173976ca11)
MULTICALL3_ADDRESS=0xca11bde05977b3631167028862be2a173976ca11

# Aave Pool address (default: Base V3 Pool)
AAVE_POOL=0xA238Dd80C259a72e81d7e4664a9801593F98d1c5

# Health factor threshold in basis points (default: 9800 = 0.98)
EXECUTION_HF_THRESHOLD_BPS=9800

# Duration to run harness in seconds (default: 60)
HARNESS_DURATION_SEC=60

# Chainlink price feeds for price-triggered rechecks (optional)
# Format: TOKEN:FEED_ADDRESS,TOKEN:FEED_ADDRESS
CHAINLINK_FEEDS=ETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,USDC:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B
```

## How to Run

### Basic Usage

```bash
cd backend
npm run hf:harness
```

### With Custom Duration

```bash
cd backend
HARNESS_DURATION_SEC=120 npm run hf:harness
```

### Using Specific Candidates

```bash
cd backend
CANDIDATE_USERS=0xUser1,0xUser2 npm run hf:harness
```

### Example Configurations

#### 1. Test with Manual Candidate List (Recommended for Testing)

```bash
# Quick 30-second test with two specific addresses
export WS_RPC_URL=wss://mainnet.base.org
export RPC_URL=https://mainnet.base.org
export CANDIDATE_USERS=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb,0x8BDf3F4F6F3Ff37E2A4E8AA6e9e23E7A8C4C5B3D
export HARNESS_DURATION_SEC=30
npm run hf:harness
```

#### 2. Production-Like Test with Subgraph Seeding

```bash
# Requires valid Graph API credentials
export WS_RPC_URL=wss://mainnet.base.org
export RPC_URL=https://mainnet.base.org
export GRAPH_API_KEY=your_api_key
export SUBGRAPH_DEPLOYMENT_ID=GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF
export SUBGRAPH_URL=https://gateway.thegraph.com/api/subgraphs/id/GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF
export SEED_LIMIT=30
export HARNESS_DURATION_SEC=60
npm run hf:harness
```

#### 3. With Chainlink Price Feed Monitoring

```bash
export WS_RPC_URL=wss://mainnet.base.org
export RPC_URL=https://mainnet.base.org
export CANDIDATE_USERS=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
export CHAINLINK_FEEDS=ETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,USDC:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B
export HARNESS_DURATION_SEC=120
npm run hf:harness
```

#### 4. HTTP Fallback Mode (No WebSocket)

```bash
# Only HTTP RPC configured - will poll every 10 seconds
export RPC_URL=https://mainnet.base.org
export CANDIDATE_USERS=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
export HARNESS_DURATION_SEC=60
npm run hf:harness
```

### HTTP Fallback Mode (No WebSocket)

If WebSocket connection fails, the harness automatically falls back to HTTP RPC mode with periodic polling (every 10 seconds).

## Sample Output

### Startup

```
[harness] HF Real-time Harness - Test Utility (does not affect bot behavior)
[harness] Starting real-time HF harness
[harness] Configuration:
[harness]   USE_FLASHBLOCKS: false
[harness]   MULTICALL3_ADDRESS: 0xca11bde05977b3631167028862be2a173976ca11
[harness]   AAVE_POOL: 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
[harness]   HF_THRESHOLD: 9800 bps (0.98)
[harness]   DURATION: 60s
[harness] Using standard WebSocket: wss://mainnet.base.org
[harness] WebSocket connected successfully
[harness] Multicall3 code detected at 0xca11bde05977b3631167028862be2a173976ca11
[harness] Aave Pool code detected at 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
[harness] Seeded 25 candidates with debt from subgraph
[harness] Subscribed to newHeads
[harness] Subscribed to Aave Pool logs (Borrow, Repay, Supply, Withdraw)
[harness] Initialization complete, monitoring started
```

### During Monitoring

```
[harness] Block 12345678 - running health checks
[harness] Health check complete: minHF=1.0523 (0xabc...), liquidatable=false
[harness] Borrow event for candidate 0xdef...
[harness] Health check complete: minHF=0.9654 (0xdef...), liquidatable=true (1 candidates)
```

### Shutdown

```
[harness] Duration reached, shutting down...
[harness] Shutting down...
[harness] Final Statistics:
[harness]   Duration: 60.1s
[harness]   Blocks received: 30
[harness]   Aave logs received: 7
[harness]   Price updates received: 0
[harness]   Health checks performed: 780
[harness]   Candidates monitored: 25
[harness]   Lowest HF: 0.9654 (0xdef...)
[harness]   Liquidatable candidates: 1
[harness]   Liquidatable addresses:
[harness]     0xdef... (HF: 0.9654)
```

## How It Works

### 1. Provider Setup

- **Flashblocks mode**: If `USE_FLASHBLOCKS=true` and `FLASHBLOCKS_WS_URL` is set, attempts to use Flashblocks WebSocket
- **Standard mode**: Uses `WS_RPC_URL` for standard WebSocket subscriptions
- **HTTP fallback**: Falls back to `RPC_URL` if WebSocket connection fails (polling mode every 10 seconds)

### 2. Feature Detection

The harness attempts to detect Flashblocks support by calling `flashblocks_subscribe`. If unsupported, it logs a message and uses standard `newHeads` subscription.

### 3. Subscriptions

- **newHeads**: Always subscribed for canonical block notifications and batch rechecks
- **Aave Pool logs**: Subscribes to `Borrow`, `Repay`, `Supply`, `Withdraw` events to trigger targeted rechecks for affected users
- **Chainlink feeds** (optional): Subscribes to `AnswerUpdated` events for configured price feeds to trigger rechecks on price changes

### 4. Health Factor Checks

- **Multicall3 batching**: Uses `aggregate3` to batch-call `getUserAccountData` for all candidates
- **Single checks**: Individual calls when specific user events are detected
- **Threshold comparison**: Compares HF to `EXECUTION_HF_THRESHOLD_BPS` (default 0.98) to identify liquidatable positions

### 5. Candidate Seeding

- **Manual**: Parse `CANDIDATE_USERS` as comma-separated addresses
- **Subgraph**: Query users with debt using `SubgraphService.getUsersPage(SEED_LIMIT)` and filter by debt presence

## Common Errors

### "No WebSocket URL configured"

**Cause**: Neither `WS_RPC_URL` nor `FLASHBLOCKS_WS_URL` is set

**Solution**: Set `WS_RPC_URL` in your `.env` file:
```bash
WS_RPC_URL=wss://mainnet.base.org
```

### "No code at Multicall3 address"

**Cause**: Incorrect `MULTICALL3_ADDRESS` or wrong network

**Solution**: Verify you're using the correct Base network RPC and Multicall3 address (default: `0xca11bde05977b3631167028862be2a173976ca11`)

### "No code at Aave Pool address"

**Cause**: Incorrect `AAVE_POOL` address or wrong network

**Solution**: Verify the Aave V3 Pool address for Base (default: `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`)

### "No candidates configured"

**Cause**: Neither `CANDIDATE_USERS` nor subgraph credentials are set

**Solution**: Either:
1. Set `CANDIDATE_USERS=0xaddr1,0xaddr2,...` in `.env`
2. Configure `GRAPH_API_KEY` and `SUBGRAPH_DEPLOYMENT_ID` for subgraph seeding

### "Cannot seed from subgraph with USE_MOCK_SUBGRAPH=true"

**Cause**: Mock subgraph mode is enabled

**Solution**: Set `USE_MOCK_SUBGRAPH=false` in `.env`

### WebSocket Connection Fails

**Cause**: Invalid WebSocket URL, network issues, or provider rate limiting

**Solution**: The harness automatically falls back to HTTP RPC mode. Verify:
1. `WS_RPC_URL` is correct
2. `RPC_URL` is set for fallback
3. Provider is accessible and not rate limiting

## Exit Codes

- **0**: Success - harness ran for the configured duration and exited gracefully
- **1**: Failure - setup error, missing configuration, or unhandled exception

## Performance Notes

- **WebSocket mode**: Real-time event notifications with minimal latency
- **HTTP mode**: 10-second polling interval (higher latency but more reliable)
- **Multicall3 batching**: Single RPC call for all candidates (efficient)
- **Event-driven checks**: Targeted rechecks only for affected users (optimal)

## Integration Notes

This harness is designed to test infrastructure before integrating real-time monitoring into the main bot. Key findings:

1. **Latency measurements**: Track block notification delays and event propagation times
2. **Provider reliability**: Identify WebSocket disconnections and RPC failures
3. **Batch efficiency**: Verify Multicall3 can handle the expected candidate set size
4. **Threshold tuning**: Observe HF distributions to calibrate `EXECUTION_HF_THRESHOLD_BPS`

**Important**: Once validated, these patterns can be integrated into the main bot's monitoring pipeline, but this script itself should remain a standalone testing utility.

## Limitations

- **Test-only**: Does NOT execute liquidations or any transactions
- **No persistence**: Statistics are not saved; only logged to console
- **Fixed duration**: Runs for configured time and exits (not a daemon)
- **No alerting**: Does not send notifications (use main bot for that)
- **Single network**: Designed for Base network only (Aave V3)

## Troubleshooting

### High Memory Usage

If monitoring many candidates (>200), consider:
1. Reducing `SEED_LIMIT`
2. Using manual `CANDIDATE_USERS` with fewer addresses
3. Increasing polling interval in HTTP mode

### Missing Events

If Aave Pool events are not detected:
1. Verify `AAVE_POOL` address is correct
2. Check WebSocket connection is stable
3. Ensure candidate users are actually active (have recent transactions)

### Incorrect Health Factors

If HF calculations seem wrong:
1. Verify `AAVE_POOL` is the correct V3 Pool for Base
2. Check RPC endpoint is fully synced
3. Compare with Aave UI or direct contract calls

## Further Reading

- [Aave V3 Documentation](https://docs.aave.com/developers/core-contracts/pool)
- [Multicall3 Documentation](https://www.multicall3.com/)
- [ethers.js v6 Documentation](https://docs.ethers.org/v6/)
- [Base Network RPC Endpoints](https://docs.base.org/network-information)

## Support

For issues or questions about this harness:
1. Check the Common Errors section above
2. Review the sample output for expected behavior
3. Verify all environment variables are correctly set
4. Open an issue in the repository with detailed logs
