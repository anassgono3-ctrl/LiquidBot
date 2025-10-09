# LiquidBot - Aave V3 Base Liquidation Protection Service

A production-grade liquidation protection service for Aave V3 on the Base Network. This project focuses on providing value-added user protection through refinancing, rebalancing, and emergency intervention rather than competing for MEV.

## Overview

Liquidations are costly, stressful, and often preventable for leveraged DeFi users. LiquidBot provides an end-to-end service architecture to:

- Monitor positions in near real time
- Intervene before liquidation occurs
- Optimize collateral composition
- Offer tiered monetization options
- Provide enterprise reliability, observability, and security

## Key Features

### Protection Actions
1. **Refinance**: Flash loan debt restructure
2. **Collateral Swap**: Move to more stable assets
3. **Partial Deleverage**: Reduce position risk
4. **Emergency Close**: Graceful unwind
5. **Cross-Protocol Migration**: Evaluate alternatives (Compound, Morpho)

### Monitoring Logic
- **Alert Threshold**: Health Factor < 1.10
- **Critical Threshold**: Health Factor < 1.05 (trigger protection)
- Batch subgraph polling (1k positions per cycle)
- Live price deltas via oracles to reduce query load
- Adjustable risk models per subscription tier

## Revenue Model

| Component | Details |
|-----------|---------|
| Subscription | Basic $10/mo, Premium $50/mo, Enterprise $200/mo |
| Refinancing Fee | 0.15% of position value per intervention |
| Emergency Fee | 0.5% (last-minute prevention) |
| Performance Bonus | 0.1% (if liquidation avoided within 30m window) |
| Gas Cost Sharing | User pays 50% (logged & itemized) |
| Exposure Limits | $500K per user / $50M system total |

## Key Performance Indicators (KPIs)

- 50+ paying subscribers in 3 months
- 98%+ liquidation prevention success
- <0.1% false positive risk triggers
- $500K ARR by month 18
- 15% MoM recurring revenue growth
- 85%+ annual retention

## Architecture

### Smart Contracts (✅ MVP Implemented)
```
contracts/src/
├── FlashLoanOrchestrator.sol   # Aave V3 Base integration (0xA238...98d1c5)
├── PositionManager.sol         # User enrollment & subscription tiers
├── CollateralOptimizer.sol     # Rebalancing strategy interface (stubs)
├── FeeCollector.sol            # Fee collection (15 bps / 50 bps)
├── EmergencyPause.sol          # Guardian-controlled circuit breaker
└── interfaces/                 # Separated for upgrade safety
```

All contracts include NatSpec documentation and event emission for off-chain indexing.

### Backend / Infrastructure (✅ MVP Implemented)
- Node.js 18+ (TypeScript), Express REST API with auth middleware
- GraphQL client for Aave V3 Base subgraph
- PostgreSQL (Prisma ORM for subscriptions & protection logs)
- Redis (BullMQ queues, rate limiting)
- Prometheus metrics endpoint + Grafana dashboard stubs
- Docker + Kubernetes deployment configurations
- WebSocket server for real-time risk alerts (HF < 1.1)
- Services: SubgraphService, HealthCalculator, FlashLoanService, SubscriptionService

## Performance Targets

- Risk detection latency: <3s
- Protection execution: <15s from trigger
- API p99 latency: <100ms (cached reads)
- Gas budget per intervention: <$3 (Base L2 assumptions)
- Uptime target: 99.9% (≤8.76h annual downtime)

## Security & Risk Controls

- 95%+ contract test coverage (Hardhat + Foundry)
- Slippage guard: max 2% on swaps
- Exposure caps enforced at contract + orchestration layers
- Multisig (3/5) for admin + fee collector
- Semi-annual audits + bug bounty
- Insurance: Nexus Mutual (evaluation phase)
- Circuit breaker: EmergencyPause.sol w/ staged disable rules

## MVP Status (✅ Complete)

The MVP implementation includes all core functionality for liquidation protection:

**Smart Contracts (5/5)**
- ✅ FlashLoanOrchestrator with Aave V3 Base integration
- ✅ PositionManager for user subscriptions
- ✅ CollateralOptimizer with rebalance events
- ✅ FeeCollector with revenue logic (0.15% / 0.5% fees)
- ✅ EmergencyPause circuit breaker

**Backend Services (4/4)**
- ✅ SubgraphService (liquidation calls, reserves, users with debt)
- ✅ HealthCalculator (HF formula with edge case handling)
- ✅ FlashLoanService (simulation + validation)
- ✅ SubscriptionService (Prisma-backed CRUD)

**API & Real-Time (3/3)**
- ✅ Express REST API (/health, /positions, /protect)
- ✅ Auth middleware (API key + JWT)
- ✅ WebSocket server (/ws) for risk alerts

**Tests & CI (19/19 passing)**
- ✅ Unit tests (HealthCalculator, FlashLoanService)
- ✅ Integration tests (API routes, WebSocket)
- ✅ GitHub Actions workflow (lint, typecheck, test, build)

**Documentation & Deployment**
- ✅ OpenAPI 3.0 spec
- ✅ GraphQL query examples
- ✅ Dockerfile + docker-compose.yml
- ✅ Kubernetes deployment manifests
- ✅ Prometheus + Grafana configurations

### Health Factor Formula (Implemented)
```
HF = (Σ collateral_value × liquidationThreshold) / Σ debt_value
```

**Thresholds:**
- Alert: HF < 1.10 (WebSocket event)
- Emergency: HF < 1.05 (protection trigger)

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis 7+
- Docker & Docker Compose

### Installation
```bash
# Clone the repository
git clone https://github.com/anassgono3-ctrl/LiquidBot.git
cd LiquidBot/backend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Build the project
npm run build

# Run tests
npm test
```

## Execution (Scaffold)

The bot includes an **opt-in execution pipeline scaffold** with MEV/gas controls and risk management. This is a safe framework for future liquidation execution — **disabled by default** and currently in dry-run mode.

### ⚠️ Safety First

- **Execution is OFF by default**: `EXECUTION_ENABLED=false`
- **Dry-run mode enabled by default**: `DRY_RUN_EXECUTION=true`
- **No auto-execution from scanner**: Detection and execution are separate concerns
- **Comprehensive risk controls**: Position limits, daily loss limits, blacklists, gas caps

### How It Works

When enabled, the execution pipeline:
1. Takes profitable opportunities from the detection pipeline
2. Applies risk management rules (blacklists, position size, profit threshold)
3. Checks current gas price against configured cap
4. In dry-run mode: logs simulated execution without broadcasting
5. In real mode: executes liquidations (implementation pending)

### Configuration

Add to `.env`:

```bash
# Execution Controls (all optional - defaults are safe)
EXECUTION_ENABLED=false              # Master switch (default: false)
DRY_RUN_EXECUTION=true               # Simulate only (default: true)
MAX_GAS_PRICE_GWEI=50                # Skip if gas too high (default: 50)
MIN_PROFIT_AFTER_GAS_USD=10          # Min profit threshold (default: 10)

# Risk Management
MAX_POSITION_SIZE_USD=5000           # Per-liquidation cap (default: 5000)
DAILY_LOSS_LIMIT_USD=1000            # Daily loss limit (default: 1000)
BLACKLISTED_TOKENS=                  # Comma-separated, e.g., WBTC,XYZ

# Optional MEV Protection
PRIVATE_BUNDLE_RPC=                  # e.g., https://rpc.flashbots.net
```

### Enabling Execution (Staged Approach)

**Stage 1: Dry-Run Testing**
```bash
EXECUTION_ENABLED=true
DRY_RUN_EXECUTION=true
```
This logs execution decisions without broadcasting transactions. Monitor logs to verify logic.

**Stage 2: Real Execution (Future)**
```bash
EXECUTION_ENABLED=true
DRY_RUN_EXECUTION=false
```
⚠️ **Only enable when flash-loan implementation is complete**. Current implementation returns placeholder results.

### Risk Controls

The `RiskManager` enforces:
- **Token blacklist**: Skip liquidations involving specific tokens
- **Position size cap**: Reject liquidations exceeding `MAX_POSITION_SIZE_USD`
- **After-gas profit threshold**: Only execute if profit ≥ `MIN_PROFIT_AFTER_GAS_USD`
- **Daily loss limit**: Stop executing if daily losses exceed `DAILY_LOSS_LIMIT_USD`

### MEV & Gas Controls

The `ExecutionService`:
- Checks current gas price and skips execution if above `MAX_GAS_PRICE_GWEI`
- Supports private bundle submission via `PRIVATE_BUNDLE_RPC` (stub)
- Defaults to dry-run simulation for safety

### Implementation Status

✅ **Complete (Scaffold)**
- Risk management framework
- Gas price gating
- Configuration management
- Dry-run simulation
- Unit & integration tests

⏳ **Pending (Future Work)**
- Flash loan orchestration (Aave/Balancer)
- Aave V3 liquidation call
- DEX router integration for collateral swaps
- Private bundle submission
- On-chain simulation

### Notes

- `PROFIT_MIN_USD` gates profitable opportunity *detection*
- `MIN_PROFIT_AFTER_GAS_USD` gates actual *execution*
- Scanner continues detecting/notifying regardless of execution settings
- All execution results are logged with structured output

## On-Chain Executor (Balancer + Aave + 1inch)

The bot now includes a **production-ready on-chain liquidation executor** that atomically executes liquidations using flash loans, Aave V3 liquidation calls, and 1inch swaps on Base.

### Architecture

The executor consists of:
1. **Smart Contract** (`LiquidationExecutor.sol`): Handles flash loan callback, liquidation, and swap
2. **Backend Service** (`OneInchQuoteService.ts`): Fetches swap quotes and calldata from 1inch API
3. **Execution Pipeline** (`ExecutionService.ts`): Orchestrates the full liquidation flow

### Smart Contract Features

- **Flash Loan Provider**: Balancer V2 Vault (0% fee on Base)
- **Liquidation**: Aave V3 Pool integration
- **Swap Router**: 1inch Aggregation Router V6
- **Safety Controls**:
  - Owner-only execution
  - Pausable circuit breaker
  - Per-asset whitelist
  - Slippage protection via `minOut` parameter
  - Emergency withdraw function

### Deployment

#### 1. Deploy the Contract

```bash
cd contracts
npm install
npm run build:contracts

# Set environment variables
export RPC_URL=https://mainnet.base.org
export EXECUTION_PRIVATE_KEY=0x...your_private_key

# Deploy to Base
npm run deploy:executor
```

This deploys `LiquidationExecutor.sol` with the following addresses (Base):
- Balancer Vault: `0xBA12222222228d8Ba445958a75a0704d566BF2C8`
- Aave V3 Pool: `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`
- 1inch Router: `0x1111111254EEB25477B68fb85Ed929f73A960582`

#### 2. Configure the Backend

Add to `backend/.env`:

```bash
# On-Chain Executor
EXECUTOR_ADDRESS=0x...deployed_contract_address
EXECUTION_PRIVATE_KEY=0x...your_private_key
RPC_URL=https://mainnet.base.org
CHAIN_ID=8453

# 1inch API (required for swaps)
ONEINCH_API_KEY=your_1inch_api_key_here
ONEINCH_BASE_URL=https://api.1inch.dev/swap/v6.0/8453

# Execution Settings
MAX_SLIPPAGE_BPS=100                 # 1% slippage tolerance
CLOSE_FACTOR_MODE=auto               # auto or fixed (50%)

# Enable execution
EXECUTION_ENABLED=true
DRY_RUN_EXECUTION=false              # ⚠️ Set to false only when ready!
```

#### 3. Whitelist Assets

Before executing liquidations, whitelist the assets:

```solidity
// Call from executor owner
executor.setWhitelist(WETH_ADDRESS, true);
executor.setWhitelist(USDC_ADDRESS, true);
executor.setWhitelist(DAI_ADDRESS, true);
// ... add other collateral/debt assets
```

#### 4. Fund the Executor

Send some ETH to the executor contract for gas:

```bash
# Send 0.1 ETH for gas
cast send $EXECUTOR_ADDRESS --value 0.1ether --private-key $EXECUTION_PRIVATE_KEY
```

### How It Works

When a liquidation opportunity is detected:

1. **Backend prepares parameters**:
   - Calculates `debtToCover` based on close factor
   - Fetches swap calldata from 1inch API
   - Applies slippage protection with `minOut`

2. **Backend calls `executor.initiateLiquidation()`**:
   - Passes user, collateral, debt, amounts, swap calldata

3. **Contract requests Balancer flash loan**:
   - Borrows `debtToCover` amount of debt asset

4. **Contract executes in `receiveFlashLoan()` callback**:
   - Approves Aave Pool for debt token
   - Calls `Pool.liquidationCall()` to liquidate user
   - Receives collateral from liquidation
   - Approves 1inch router for collateral
   - Swaps collateral → debt token using provided calldata
   - Verifies output ≥ `minOut`
   - Repays flash loan (principal + fee)
   - Transfers profit to payout address

5. **Backend receives transaction receipt**:
   - Logs profit and gas used
   - Updates execution metrics

### Safety Checklist

Before enabling real execution:

- [ ] Contract deployed and verified on Base
- [ ] Owner address is secure multisig or hardware wallet
- [ ] All expected collateral and debt assets whitelisted
- [ ] Executor funded with sufficient gas (0.1+ ETH)
- [ ] 1inch API key configured and tested
- [ ] `DRY_RUN_EXECUTION=true` tested first with real opportunities
- [ ] Risk controls configured (`MAX_POSITION_SIZE_USD`, `DAILY_LOSS_LIMIT_USD`)
- [ ] Gas cap set appropriately (`MAX_GAS_PRICE_GWEI`)
- [ ] Monitoring and alerting in place
- [ ] Emergency pause mechanism tested

### Risk Controls

The executor enforces multiple layers of protection:

**Smart Contract:**
- Owner-only execution
- Asset whitelist
- Pausable circuit breaker
- Slippage protection
- Atomic transaction (reverts on failure)

**Backend:**
- Token blacklist
- Position size limits
- Daily loss limits
- After-gas profit threshold
- Gas price gating

### Monitoring

Monitor executor activity:

```bash
# Watch executor logs
tail -f logs/executor.log

# Check executor balance
cast balance $EXECUTOR_ADDRESS

# View recent transactions
cast tx --rpc-url $RPC_URL <txhash>
```

### Contract Testing

Run Solidity tests:

```bash
cd contracts
npm run test:contracts
```

The test suite validates:
- Access control (only owner can execute)
- Whitelist enforcement
- Pause functionality
- Configuration setters
- Ownership transfer

### Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `EXECUTOR_ADDRESS` | - | Deployed contract address |
| `EXECUTION_PRIVATE_KEY` | - | Private key for signing txs |
| `RPC_URL` | - | Base RPC endpoint |
| `CHAIN_ID` | 8453 | Base chain ID |
| `ONEINCH_API_KEY` | - | 1inch API key |
| `ONEINCH_BASE_URL` | `https://api.1inch.dev/swap/v6.0/8453` | 1inch API URL |
| `MAX_SLIPPAGE_BPS` | 100 | Max slippage (1%) |
| `CLOSE_FACTOR_MODE` | auto | Close factor: auto or fixed |
| `PRIVATE_BUNDLE_RPC` | - | Optional MEV relay URL |

### Notes

- Balancer flash loans have 0% fee on most networks including Base
- Close factor auto mode uses full debt amount from opportunity
- Close factor fixed mode uses 50% of total debt
- Private bundle RPC support is a placeholder (not fully implemented)
- 1inch API key can be obtained from https://portal.1inch.dev/
- Always test in dry-run mode first before enabling real execution

## At-Risk Position Scanner

The bot includes an at-risk scanner that proactively detects users approaching liquidation by computing health factors locally.

### How It Works

The scanner:
- Queries a configurable number of users from the Aave V3 Base subgraph
- Computes health factors locally (no dependency on subgraph `healthFactor` field)
- Classifies users into risk tiers: NO_DEBT, DUST, OK, WARN, CRITICAL
- Optionally sends Telegram notifications for at-risk users

**Important:** `AT_RISK_SCAN_LIMIT` controls how many users the bot requests from the subgraph `users(...)` query each poll. It is **not** a filter for "recent users" — ordering is not guaranteed without an explicit `orderBy` clause. We keep it as a small, fixed sample per poll to stay rate-limit friendly since we compute health factors locally.

### Running Modes

#### 1. Continuous Monitoring (Recommended)
```bash
npm start
```
When `AT_RISK_SCAN_LIMIT > 0`, the bot automatically scans for at-risk users during each poll cycle. This is the **normal operation mode** for production use.

Configuration in `.env`:
```bash
AT_RISK_SCAN_LIMIT=50              # Number of users to scan per poll (0 disables)
AT_RISK_WARN_THRESHOLD=1.05        # HF threshold for warning tier
AT_RISK_LIQ_THRESHOLD=1.0          # HF threshold for critical tier
AT_RISK_NOTIFY_CRITICAL=true       # Send alerts for CRITICAL users
AT_RISK_NOTIFY_WARN=false          # Send alerts for WARN users (usually false)
```

#### 2. One-Off Manual Scan
```bash
npm run risk:scan                  # Display results only
npm run risk:scan -- --notify      # Display results + send Telegram alerts
```
This is a **standalone diagnostic script** useful for:
- Manual health checks outside the main bot
- Testing the scanner configuration
- Ad-hoc risk assessments

**Not required for normal operation** — the main bot (`npm start`) already scans when configured.

## Documentation

- [Project Specification](./docs/SPEC.md) - Comprehensive project specification
- [Architecture](./docs/ARCHITECTURE.md) - Detailed architecture documentation
- [Subgraph Queries](./docs/SUBGRAPH_QUERIES.md) - Aave V3 Base subgraph queries
- [Security](./docs/SECURITY.md) - Security practices and risk mitigation

## Roadmap

### Current Phase: Specification & Planning
- [x] Requirements documented
- [x] Revenue model defined
- [x] Architecture outlined
- [x] Corrected subgraph query validated
- [x] KPIs & success metrics enumerated
- [x] Security + compliance considerations included

### Next Phase: Implementation Scaffolding
- [ ] Repository structure setup
- [ ] Backend API scaffolding
- [ ] Smart contract prototypes
- [ ] Subgraph polling module
- [ ] Health factor calculation engine

### Future Phases
- [ ] Flash loan orchestration logic
- [ ] Dashboard UI
- [ ] Integration tests & simulation
- [ ] Private Beta (25 Base ecosystem users)
- [ ] Public Launch
- [ ] Multi-L2 Expansion

## Go-To-Market Phases

1. **Private Beta**: 25 Base ecosystem users
2. **Public Launch**: Co-marketing with Base partners
3. **Partner Integrations**: Aggregators, wallets, protocol frontends
4. **Multi-L2 Expansion**: Arbitrum, Optimism, Blast (analysis driven)

## Contributing

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## Contact

- GitHub: [@anassgono3-ctrl](https://github.com/anassgono3-ctrl)
- Repository: [LiquidBot](https://github.com/anassgono3-ctrl/LiquidBot)

## Acknowledgments

- Aave Protocol for V3 architecture
- The Graph for subgraph infrastructure
- Base Network for L2 infrastructure
- QuickNode for monitoring examples
