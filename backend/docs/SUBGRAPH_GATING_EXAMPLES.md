# Subgraph Gating Feature - Example Logs

This document shows example log outputs for both USE_SUBGRAPH modes to illustrate the implementation.

## Mode 1: USE_SUBGRAPH=false (Default - On-Chain Discovery)

### Startup Logs
```
[realtime-hf] Starting real-time HF detection service
[realtime-hf] Configuration: {
  useFlashblocks: false,
  multicall3: 0xca11bde05977b3631167028862be2a173976ca11,
  aavePool: 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5,
  hfThresholdBps: 9800,
  seedInterval: 45,
  candidateMax: 300,
  useSubgraph: false,
  backfillEnabled: true,
  headCheckPageStrategy: paged,
  headCheckPageSize: 250
}

[realtime-hf] Initial seeding from on-chain backfill...
[backfill] Scanning blocks 14950000 to 15000000 (50000 blocks) in chunks of 2000
[backfill] Progress: 20%, scanned 4532 logs, found 342 unique users
[backfill] Progress: 40%, scanned 8891 logs, found 589 unique users
[backfill] Progress: 60%, scanned 12456 logs, found 743 unique users
[backfill] Complete: logs_scanned=15234 unique_users=892 duration_ms=12456
[realtime-hf] seed_source=onchain_backfill candidates_total=300 new=300

[subgraph] Service disabled (USE_SUBGRAPH=false) - relying on on-chain discovery
[subgraph-poller] Disabled (USE_SUBGRAPH=false or in mock mode)
```

### Runtime Logs
```
[realtime-hf] New block 15000123
[realtime-hf] head_page=0..250 size=252 total=300 lowHf=2
[realtime-hf] Batch check complete: 252 candidates, minHF=0.9843, trigger=head

[realtime-hf] emit liquidatable user=0x123... hf=0.9843 reason=safe_to_liq block=15000123

[notify] skip user=0x456... reason=no_debt
[notify] skip user=0x789... reason=below_min_usd details=3.45 < 5

[realtime-hf] notify actionable user=0xabc... debtAsset=USDC collateral=WETH debtToCover=$1234.56 bonusBps=500

[realtime-hf] Aave event detected for user 0xdef... (legacy)
[realtime-hf] seed_source=event candidates_total=301 new=1
```

## Mode 2: USE_SUBGRAPH=true (Optional Subgraph Mode)

### Startup Logs
```
[subgraph] Service enabled (USE_SUBGRAPH=true)
[subgraph] Using gateway URL: https://gateway.thegraph.com/api/subgraphs/id/GQF... (auth-mode=header, header=yes, instance=1)
[subgraph] warmup ok block=15000100

[realtime-hf] Starting real-time HF detection service
[realtime-hf] Configuration: {
  useFlashblocks: false,
  multicall3: 0xca11bde05977b3631167028862be2a173976ca11,
  aavePool: 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5,
  hfThresholdBps: 9800,
  seedInterval: 45,
  candidateMax: 300,
  useSubgraph: true,
  backfillEnabled: true,
  headCheckPageStrategy: paged,
  headCheckPageSize: 250
}

[realtime-hf] Initial seeding from subgraph...
[subgraph] Fetching users with paging: total=300 pageSize=100
[subgraph] seed_source=subgraph pages_fetched=3 total_candidates=300
[realtime-hf] seed_source=subgraph candidates_total=300 new=300

[subgraph-poller] starting poller (interval=15000ms, pollLimit=5, trackMax=5000)
```

### Runtime Logs (Periodic Seeding)
```
[realtime-hf] seed_source=subgraph candidates_total=300 new=0

[subgraph] poll start
[subgraph] liquidation snapshot size=5 new=1 totalSeen=1234 hfResolved=1
[subgraph] new liquidation IDs: abc123
[subgraph] processing latest event: id=abc123 timestamp=1704067200
```

## Skip Reason Examples

All skip reasons with example contexts:

```
[notify] skip user=0x111... reason=service_unavailable details=AaveDataService not initialized
[notify] skip user=0x222... reason=no_debt
[notify] skip user=0x333... reason=no_collateral
[notify] skip user=0x444... reason=below_min_usd details=4.23 < 5
[notify] skip user=0x555... reason=resolve_failed details=RPC timeout
```

## Configuration Examples

### Minimal Production Config (On-Chain Only)
```bash
USE_SUBGRAPH=false  # Default
USE_REALTIME_HF=true
WS_RPC_URL=wss://mainnet.base.org
REALTIME_INITIAL_BACKFILL_ENABLED=true
REALTIME_INITIAL_BACKFILL_BLOCKS=50000
HEAD_CHECK_PAGE_STRATEGY=paged
HEAD_CHECK_PAGE_SIZE=250
```

### Full Featured Config (With Subgraph)
```bash
USE_SUBGRAPH=true
GRAPH_API_KEY=your_key_here
SUBGRAPH_DEPLOYMENT_ID=GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF
SUBGRAPH_PAGE_SIZE=100
SUBGRAPH_POLL_INTERVAL_MS=15000

USE_REALTIME_HF=true
WS_RPC_URL=wss://mainnet.base.org
REALTIME_SEED_INTERVAL_SEC=45
HEAD_CHECK_PAGE_STRATEGY=paged
HEAD_CHECK_PAGE_SIZE=250
```

## Performance Impact

### RPC Load Reduction
- **Head Check Paging**: ~75% reduction in RPC calls per block
  - Before: 1000 candidates × 1 call each = 1000 calls/block
  - After: 250 candidates × 1 call each = 250 calls/block
  - Low-HF priority ensures critical users still checked every block

### Subgraph Independence
- **On-Chain Backfill**: No Graph API dependency for startup
- **Event Discovery**: Real-time user discovery via WebSocket events
- **Graceful Degradation**: System works fully without subgraph access

### Trade-offs
| Mode | Startup Time | User Coverage | External Deps | RPC Usage |
|------|--------------|---------------|---------------|-----------|
| On-Chain | ~10-30s | Active users in window | None | High (backfill) |
| Subgraph | ~2-5s | Comprehensive | Graph API | Low (startup) |

Both modes use the same head-check paging and real-time event monitoring for runtime efficiency.
