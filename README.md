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

### Smart Contracts (Planned)
```
contracts/
├── FlashLoanOrchestrator.sol   # Executes flash loan powered adjustments
├── PositionManager.sol         # User enrollment & position registry
├── CollateralOptimizer.sol     # Rebalancing & asset strategy
├── FeeCollector.sol            # Aggregates fees, revenue distribution
└── EmergencyPause.sol          # Circuit breaker (3/5 multisig gated)
```

### Backend / Infrastructure
- Node.js 18+ (TypeScript), Express REST API
- Ethers.js v6 (Base RPC optimized)
- PostgreSQL (persistent user + position metadata)
- Redis (caching, queues, rate limiting)
- Prometheus + Grafana (metrics + SLO dashboards)
- Docker + Kubernetes (scaling & deployment)
- WebSocket price + oracle aggregation (Chainlink feeds)
- Job workers for monitoring & rebalance triggers

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
cd LiquidBot

# Install dependencies (future)
npm install

# Set up environment variables
cp .env.example .env

# Run tests (future)
npm test
```

## Documentation

- [Project Specification](./docs/SPEC.md) - Comprehensive project specification
- [Architecture](./docs/ARCHITECTURE.md) - Detailed architecture documentation
- [Phase 2 Implementation](./docs/phase2-core-implementation.md) - MVP core features and requirements
- [PR Breakdown](./docs/PR_BREAKDOWN.md) - Detailed PR sequencing and implementation plan
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
