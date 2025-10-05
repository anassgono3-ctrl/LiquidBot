# Backend Services

This directory will contain the backend services for the LiquidBot liquidation protection system.

## Planned Services

### API Service
Express-based REST API for user interactions and data queries.

**Features**:
- User authentication (JWT + wallet signature)
- Position enrollment and management
- Intervention history queries
- Fee tracking and reporting
- WebSocket support for real-time updates

**Status**: 🔜 Planned

### Position Monitor Worker
Background worker that polls the Aave V3 subgraph and monitors positions.

**Features**:
- Batch subgraph queries (500-1000 positions per cycle)
- Position data caching (Redis)
- Health factor calculation
- Risk detection and flagging

**Status**: 🔜 Planned

### Risk Analyzer Worker
Analyzes at-risk positions and determines optimal protection actions.

**Features**:
- Real-time health factor calculation
- Risk assessment and prioritization
- Action strategy selection
- Execution task queuing

**Status**: 🔜 Planned

### Action Executor Worker
Executes protection transactions on the Base network.

**Features**:
- Smart contract interaction
- Transaction retry logic
- Gas price optimization
- Fee collection
- Event logging and notifications

**Status**: 🔜 Planned

## Technology Stack

- **Runtime**: Node.js 18+ LTS
- **Language**: TypeScript 5.0+
- **API Framework**: Express 4.18+
- **Blockchain**: Ethers.js v6
- **Database**: PostgreSQL 14+ (via Prisma ORM)
- **Cache/Queue**: Redis 7+
- **WebSocket**: Socket.io
- **Monitoring**: Prometheus client
- **Testing**: Jest

## Directory Structure (Planned)

```
backend/
├── src/
│   ├── api/              # REST API endpoints
│   ├── workers/          # Background job workers
│   ├── services/         # Business logic services
│   ├── models/           # Data models and schemas
│   ├── utils/            # Utility functions
│   ├── config/           # Configuration management
│   └── types/            # TypeScript type definitions
├── tests/
│   ├── unit/             # Unit tests
│   ├── integration/      # Integration tests
│   └── e2e/              # End-to-end tests
├── prisma/
│   ├── schema.prisma     # Database schema
│   └── migrations/       # Database migrations
├── scripts/              # Utility scripts
├── Dockerfile            # Container definition
├── docker-compose.yml    # Local development stack
├── package.json
└── tsconfig.json
```

## Development Setup (Future)

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis 7+
- Docker & Docker Compose

### Installation
```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Start local services
docker-compose up -d postgres redis

# Run database migrations
npm run migrate

# Start development server
npm run dev
```

### Running Tests
```bash
# Run all tests
npm test

# Run specific test suite
npm test -- position-monitor

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

### Linting and Formatting
```bash
# Check code style
npm run lint

# Auto-fix style issues
npm run lint:fix

# Format code
npm run format
```

## API Endpoints (Planned)

```
Authentication
POST   /api/v1/auth/connect         # Wallet authentication
POST   /api/v1/auth/verify           # Verify JWT token

Positions
GET    /api/v1/positions             # List user positions
POST   /api/v1/positions/enroll      # Enroll new position
GET    /api/v1/positions/:id         # Get position details
PUT    /api/v1/positions/:id         # Update position preferences
DELETE /api/v1/positions/:id         # Unenroll position

Interventions
GET    /api/v1/interventions         # List interventions
GET    /api/v1/interventions/:id     # Get intervention details

Fees
GET    /api/v1/fees                  # List fees
GET    /api/v1/fees/summary          # Fee summary

Health
GET    /api/v1/health                # Service health check
GET    /api/v1/metrics               # Prometheus metrics
```

## Environment Variables (Future)

```bash
# Application
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/liquidbot

# Redis
REDIS_URL=redis://localhost:6379

# Blockchain
BASE_RPC_URL=https://mainnet.base.org
BASE_CHAIN_ID=8453
WALLET_PRIVATE_KEY=0x...

# Subgraph
AAVE_V3_BASE_SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/aave/protocol-v3-base

# Smart Contracts
POSITION_MANAGER_ADDRESS=0x...
FLASH_LOAN_ORCHESTRATOR_ADDRESS=0x...
FEE_COLLECTOR_ADDRESS=0x...

# Security
JWT_SECRET=your-secret-key
JWT_EXPIRY=7d

# Monitoring
PROMETHEUS_PORT=9090
```

## Architecture

```
┌─────────────────┐
│   API Service   │  ← User requests
└────────┬────────┘
         │
         ├─────────────┐
         │             │
┌────────▼────────┐ ┌──▼───────────┐
│   PostgreSQL    │ │    Redis     │
│   (Metadata)    │ │ (Cache/Queue)│
└─────────────────┘ └──────┬───────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
┌────────▼────────┐ ┌──────▼──────┐ ┌───────▼────────┐
│Position Monitor │ │Risk Analyzer│ │Action Executor │
│    Worker       │ │   Worker    │ │    Worker      │
└────────┬────────┘ └──────┬──────┘ └───────┬────────┘
         │                 │                 │
         └─────────────────┴─────────────────┘
                           │
                    ┌──────▼──────┐
                    │ Base Network│
                    │ (Aave V3)   │
                    └─────────────┘
```

## Performance Targets

- API p99 latency: <100ms (cached reads)
- Risk detection latency: <3 seconds
- Protection execution: <15 seconds from trigger
- Worker cycle time: 30 seconds (position monitor)
- Database query time: <50ms average

## Monitoring

Key metrics to track:
- API request rate and latency
- Worker job processing rates
- Database connection pool usage
- Redis cache hit rates
- Position monitoring cycle time
- Health factor calculation accuracy
- Intervention success rate

## Documentation

For detailed architecture and implementation details, see:
- [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
- [../docs/SPEC.md](../docs/SPEC.md)

## License

See [LICENSE](../LICENSE) in the root directory.
