# Lean Environment Configuration

This guide provides a minimal `.env` configuration focused on enabling **predictive health factor monitoring** and **pre-submit liquidation pipeline** features. It strips out legacy and advanced options to help you get started quickly.

## Quick Start: Predictive + Pre-Submit Path

The following configuration enables the essential features for predictive monitoring and pre-submit liquidations on Base mainnet.

### Core Infrastructure

```bash
# Node environment
NODE_ENV=production
PORT=3000

# Database (required for candidate tracking)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/liquidbot

# Redis (required for caching and coordination)
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
# Or use: REDIS_URL=redis://127.0.0.1:6379

# Authentication
JWT_SECRET=your_secure_jwt_secret_here
API_KEY=your_api_key_here
```

### Base Network & Aave Addresses

```bash
# Base RPC endpoints
RPC_URL=https://mainnet.base.org
WS_RPC_URL=wss://mainnet.base.org
CHAIN_ID=8453

# Aave V3 Base Protocol Addresses
AAVE_POOL_ADDRESS=0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
AAVE_ADDRESSES_PROVIDER=0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D
AAVE_PROTOCOL_DATA_PROVIDER=0xC4Fcf9893072d61Cc2899C0054877Cb752587981
AAVE_ORACLE=0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156

# Multicall for batch operations
MULTICALL3_ADDRESS=0xca11bde05977b3631167028862be2a173976ca11
```

### Chainlink Price Feeds

```bash
# Chainlink price feed configuration
CHAINLINK_FEEDS=WETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,USDC:0x7e860098F58bBFC8648a4311b374B1D669a2bc6B,WSTETH_ETH:0x43a5C292A453A3bF3606fa856197f09D7B74251a,WEETH_ETH:0xFC1415403EbB0c693f9a7844b92aD2Ff24775C65
PRICE_STALENESS_SEC=900
RATIO_PRICE_ENABLED=true

# Price feed aliases and derived assets
PRICE_FEED_ALIASES=USDbC:USDC
DERIVED_RATIO_FEEDS=wstETH:WSTETH_ETH,weETH:WEETH_ETH

# Use Aave oracle for pricing
PRICES_USE_AAVE_ORACLE=true
```

### Pyth Network Integration (Optional)

Pyth provides early-warning price feeds for predictive monitoring.

```bash
# Enable Pyth for predictive price feeds
PYTH_ENABLED=true
PYTH_HTTP_URL=https://hermes.pyth.network
PYTH_WS_URL=wss://hermes.pyth.network/ws
PYTH_ASSETS=WETH,WBTC,cbETH,USDC
PYTH_STALE_SECS=10
```

### TWAP Sanity Check (Optional)

TWAP provides DEX-based price validation.

```bash
# Enable DEX TWAP sanity checking
TWAP_ENABLED=true
TWAP_WINDOW_SEC=300
TWAP_DELTA_PCT=0.012

# Discover pools using: node scripts/discover-twap-pools.mjs
# Example output:
TWAP_POOLS='[{"symbol":"WETH","pool":"0x4C36388bE6F416A29C8d8Eee81C771cE6bE14B18","dex":"uniswap_v3","fee":500,"quote":"USDC"}]'
```

### Predictive Health Factor Engine

```bash
# Enable predictive HF projection
PREDICTIVE_ENABLED=true
PREDICTIVE_HF_BUFFER_BPS=40
PREDICTIVE_MAX_USERS_PER_TICK=800
PREDICTIVE_HORIZON_SEC=180
PREDICTIVE_SCENARIOS=baseline,adverse,extreme
PREDICTIVE_FALLBACK_INTERVAL_BLOCKS=20
PREDICTIVE_FALLBACK_INTERVAL_MS=30000
FASTPATH_PREDICTIVE_ETA_CAP_SEC=45
```

### Pre-Submit Liquidation Pipeline

```bash
# Enable pre-submit liquidation transactions
PRE_SUBMIT_ENABLED=true
PRE_SUBMIT_ETA_MAX=90
HF_TRIGGER_BUFFER=1.02
GAS_PRICE_MARGIN=0.10
TTL_BLOCKS=40
TELEMETRY_PRE_SUBMIT_ENABLED=true
```

### Real-Time Monitoring

```bash
# Enable real-time health factor detection
USE_REALTIME_HF=true
REALTIME_INITIAL_BACKFILL_ENABLED=true
REALTIME_INITIAL_BACKFILL_BLOCKS=50000
REALTIME_INITIAL_BACKFILL_CHUNK_BLOCKS=2000

# Candidate management
CANDIDATE_MAX=300
HOTLIST_ENABLED=true
HOTLIST_MIN_HF=0.99
HOTLIST_MAX_HF=1.03
HOTLIST_MAX=2000
HOTLIST_REVISIT_SEC=5
```

### Execution Configuration (Optional)

Only configure if you're ready to execute liquidations.

```bash
# Execution scaffold (disabled by default)
EXECUTION_ENABLED=false
DRY_RUN_EXECUTION=true

# Executor configuration (when ready to execute)
# EXECUTOR_ADDRESS=0x...
# EXECUTION_PRIVATE_KEY=0x...
# ONEINCH_API_KEY=your_api_key_here

# Safety limits
MAX_GAS_PRICE_GWEI=50
MIN_PROFIT_AFTER_GAS_USD=10
MAX_POSITION_SIZE_USD=5000
DAILY_LOSS_LIMIT_USD=1000
MIN_REPAY_USD=50
```

---

## Optional Features

### Telegram Notifications

```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
```

### Liquidation Audit

```bash
LIQUIDATION_AUDIT_ENABLED=true
LIQUIDATION_AUDIT_NOTIFY=true
LIQUIDATION_AUDIT_PRICE_MODE=aave_oracle
```

### Low Health Factor Tracker

```bash
LOW_HF_TRACKER_ENABLED=true
LOW_HF_TRACKER_MAX=1000
LOW_HF_RECORD_MODE=all
LOW_HF_DUMP_ON_SHUTDOWN=true
LOW_HF_SUMMARY_INTERVAL_SEC=900
```

---

## Legacy/Advanced Features

The following features are optional and can be configured if needed:

- **Subgraph integration** (`USE_SUBGRAPH`, `SUBGRAPH_URL`, `GRAPH_API_KEY`)
- **Sprinter high-priority path** (`SPRINTER_ENABLED`, `PRESTAGE_HF_BPS`)
- **Optimistic execution** (`OPTIMISTIC_ENABLED`, `OPTIMISTIC_EPSILON_BPS`)
- **Multi-RPC write racing** (`WRITE_RPCS`, `WRITE_RACE_TIMEOUT_MS`)
- **Gas burst/RBF strategy** (`GAS_BURST_ENABLED`, `GAS_BURST_FIRST_MS`)
- **Critical lane fast path** (`CRITICAL_LANE_ENABLED`, `CRITICAL_LANE_LOAD_SHED`)
- **Priority sweep** (`PRIORITY_SWEEP_ENABLED`, `PRIORITY_SWEEP_INTERVAL_MIN`)

Refer to `.env.example` for the full list of available configuration options.

---

## Phased Enablement

### Phase 1: Monitoring Only

Start with monitoring to validate data quality:

```bash
EXECUTION_ENABLED=false
DRY_RUN_EXECUTION=true
PREDICTIVE_ENABLED=true
PRE_SUBMIT_ENABLED=false
```

### Phase 2: Pre-Submit (Dry Run)

Enable pre-submit in dry-run mode:

```bash
EXECUTION_ENABLED=false
DRY_RUN_EXECUTION=true
PREDICTIVE_ENABLED=true
PRE_SUBMIT_ENABLED=true
```

### Phase 3: Live Execution

Enable live execution with safety limits:

```bash
EXECUTION_ENABLED=true
DRY_RUN_EXECUTION=false
PREDICTIVE_ENABLED=true
PRE_SUBMIT_ENABLED=true
# Configure EXECUTOR_ADDRESS and EXECUTION_PRIVATE_KEY
```

---

## Validation

After configuring your `.env`, validate the setup:

```bash
# Check connectivity
npm run diag

# Verify Chainlink feeds
npm run verify:chainlink

# Monitor health factors
npm run dev:predictive
```

---

## Next Steps

1. **Discover TWAP pools**: Run `node scripts/discover-twap-pools.mjs` to populate `TWAP_POOLS`
2. **Test predictive monitoring**: Use `npm run dev:predictive` to validate predictions
3. **Review pre-submit logs**: Monitor telemetry output when `PRE_SUBMIT_ENABLED=true`
4. **Configure execution**: Set executor address and private key when ready for live liquidations

For detailed documentation on individual features, see:
- `docs/ARCHITECTURE.md` - System architecture overview
- `docs/SPEC.md` - Technical specification
- `docs/tools/discovery-notes.md` - TWAP pool discovery guide
