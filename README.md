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
