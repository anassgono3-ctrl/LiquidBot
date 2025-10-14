# HF Real-time Harness Quick Reference

## What is this?

A **test-only** utility script (`hf-realtime-harness.ts`) that validates low-latency health factor detection without affecting the main bot. It monitors Aave V3 positions in real-time using WebSocket subscriptions and reports liquidatable candidates.

**⚠️ Important:** This script does NOT execute any transactions. It's purely for testing and validation.

## Quick Start

```bash
cd backend

# 1. Configure environment (minimal setup)
export WS_RPC_URL=wss://mainnet.base.org
export RPC_URL=https://mainnet.base.org
export CANDIDATE_USERS=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
export HARNESS_DURATION_SEC=30

# 2. Run the harness
npm run hf:harness
```

## What You'll See

```
[harness] HF Real-time Harness - Test Utility (does not affect bot behavior)
[harness] Starting real-time HF harness
[harness] Configuration:
[harness]   USE_FLASHBLOCKS: false
[harness]   MULTICALL3_ADDRESS: 0xca11bde05977b3631167028862be2a173976ca11
[harness]   AAVE_POOL: 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
[harness]   HF_THRESHOLD: 9800 bps (0.98)
[harness]   DURATION: 30s
[harness] WebSocket connected successfully
[harness] Multicall3 code detected at 0xca11bde05977b3631167028862be2a173976ca11
[harness] Aave Pool code detected at 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
[harness] Seeded 1 candidates from CANDIDATE_USERS
[harness] Subscribed to newHeads
[harness] Subscribed to Aave Pool logs (Borrow, Repay, Supply, Withdraw)
[harness] Initialization complete, monitoring started

[harness] Block 12345678 - running health checks
[harness] Health check complete: minHF=1.0523 (0xabc...), liquidatable=false

[harness] Duration reached, shutting down...
[harness] Final Statistics:
[harness]   Duration: 30.1s
[harness]   Blocks received: 15
[harness]   Aave logs received: 3
[harness]   Health checks performed: 18
[harness]   Candidates monitored: 1
[harness]   Lowest HF: 1.0523 (0xabc...)
[harness]   Liquidatable candidates: 0
```

## Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `WS_RPC_URL` | WebSocket RPC endpoint | `wss://mainnet.base.org` |
| `RPC_URL` | HTTP RPC fallback | `https://mainnet.base.org` |
| `CANDIDATE_USERS` | Addresses to monitor (OR use subgraph) | `0x123...,0x456...` |

## Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_FLASHBLOCKS` | `false` | Enable Flashblocks WebSocket |
| `FLASHBLOCKS_WS_URL` | - | Flashblocks WebSocket URL |
| `MULTICALL3_ADDRESS` | `0xca11...ca11` | Multicall3 contract address |
| `AAVE_POOL` | `0xA238...d1c5` | Aave V3 Pool address (Base) |
| `EXECUTION_HF_THRESHOLD_BPS` | `9800` | HF threshold (0.98) |
| `SEED_LIMIT` | `50` | Max users from subgraph |
| `HARNESS_DURATION_SEC` | `60` | Auto-exit after N seconds |
| `CHAINLINK_FEEDS` | - | Optional price feed subscriptions |

## Common Use Cases

### 1. Test WebSocket Connection
```bash
export WS_RPC_URL=wss://your-provider.com
export CANDIDATE_USERS=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
export HARNESS_DURATION_SEC=10
npm run hf:harness
```

### 2. Monitor Specific High-Risk Users
```bash
export WS_RPC_URL=wss://mainnet.base.org
export CANDIDATE_USERS=0xUser1WithLowHF,0xUser2AtRisk,0xUser3
export HARNESS_DURATION_SEC=300  # 5 minutes
npm run hf:harness
```

### 3. Test Subgraph Integration
```bash
export WS_RPC_URL=wss://mainnet.base.org
export GRAPH_API_KEY=your_key
export SUBGRAPH_DEPLOYMENT_ID=GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF
export SUBGRAPH_URL=https://gateway.thegraph.com/api/subgraphs/id/...
export SEED_LIMIT=20
npm run hf:harness
```

### 4. Benchmark Different Providers
```bash
# Test Provider A
export WS_RPC_URL=wss://provider-a.com
npm run hf:harness

# Test Provider B
export WS_RPC_URL=wss://provider-b.com
npm run hf:harness

# Compare block latency and event delivery
```

## Features

- ✅ **WebSocket Subscriptions**: Real-time block notifications (`newHeads`)
- ✅ **Event Monitoring**: Aave Pool events (Borrow, Repay, Supply, Withdraw)
- ✅ **Multicall3 Batching**: Efficient batch health factor checks
- ✅ **Flashblocks Support**: Feature detection and fallback
- ✅ **HTTP Fallback**: Automatic fallback with polling
- ✅ **Chainlink Integration**: Optional price feed monitoring
- ✅ **Subgraph Seeding**: Dynamic candidate discovery
- ✅ **Graceful Shutdown**: Clean exit with statistics

## Exit Codes

- **0**: Success (completed duration)
- **1**: Error (missing config, setup failure)

## Troubleshooting

### "No WebSocket URL configured"
Set `WS_RPC_URL` in environment or `.env` file.

### "No candidates configured"
Set either `CANDIDATE_USERS` OR (`GRAPH_API_KEY` + `SUBGRAPH_DEPLOYMENT_ID`).

### "No code at Multicall3 address"
Verify you're using Base network RPC and correct Multicall3 address.

### WebSocket disconnects frequently
Try HTTP fallback mode or use a more reliable provider.

## Full Documentation

See [HF_REALTIME_HARNESS.md](../docs/HF_REALTIME_HARNESS.md) for:
- Complete environment variable reference
- Detailed setup instructions
- Sample output examples
- Advanced configuration options
- Integration notes

## Testing

The harness includes comprehensive unit tests:

```bash
npm test tests/unit/hf-harness.test.ts
```

29 tests validate:
- Script structure and imports
- Configuration handling
- Core functionality
- Error handling
- Safety checks (no transaction execution)

## Notes

- **Test-only**: Does not execute any transactions
- **Safe**: Read-only operations via Multicall3 and Aave Pool
- **Standalone**: Does not affect main bot behavior
- **Temporary**: Auto-exits after configured duration
- **Base-only**: Designed for Aave V3 on Base network

## Related Scripts

- `verify-data.ts` - Validate subgraph data consistency
- `hf-backfill.ts` - Recompute historical health factors
- `diagnose-all.ts` - Comprehensive system diagnostics

## Support

For issues or questions:
1. Check the [full documentation](../docs/HF_REALTIME_HARNESS.md)
2. Review the [troubleshooting section](#troubleshooting)
3. Open an issue with detailed logs
