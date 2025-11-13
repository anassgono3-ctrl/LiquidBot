# LiquidBot Quick Start Guide

This guide helps you get started with LiquidBot quickly, focusing on the essential configuration options.

## Prerequisites

- Node.js 18+ and npm
- (Optional) PostgreSQL for database persistence
- (Optional) Redis for caching and job queues

## Installation

```bash
# Install dependencies
npm install

# Build the project
cd backend && npm run build
```

## Environment Configuration

Create a `.env` file in the `backend` directory with your configuration. Below are common configuration scenarios.

### Minimal Setup (No External Dependencies)

This is the simplest setup that works without any external services:

```bash
# Required
API_KEY=your-api-key-here
JWT_SECRET=your-jwt-secret-here

# Subgraph (mock mode for testing)
USE_MOCK_SUBGRAPH=true
USE_SUBGRAPH=false

# Real-time HF detection (disabled for minimal setup)
USE_REALTIME_HF=false

# Borrowers Index (disabled by default)
BORROWERS_INDEX_ENABLED=false
```

### Development Setup with Memory-Only Borrowers Index

Enable borrower tracking without external dependencies:

```bash
# Required
API_KEY=your-api-key-here
JWT_SECRET=your-jwt-secret-here

# Subgraph configuration
USE_MOCK_SUBGRAPH=false
USE_SUBGRAPH=true
GRAPH_API_KEY=your-graph-api-key
SUBGRAPH_DEPLOYMENT_ID=your-deployment-id

# Real-time HF detection
USE_REALTIME_HF=true
WS_RPC_URL=wss://base-mainnet.g.alchemy.com/v2/your-key

# Borrowers Index (memory mode - no persistence)
BORROWERS_INDEX_ENABLED=true
BORROWERS_INDEX_MODE=memory
BORROWERS_INDEX_MAX_USERS_PER_RESERVE=3000
BORROWERS_INDEX_BACKFILL_BLOCKS=50000
BORROWERS_INDEX_CHUNK_BLOCKS=2000
```

### Production Setup with PostgreSQL Persistence

For production environments with PostgreSQL:

```bash
# Required
API_KEY=your-api-key-here
JWT_SECRET=your-jwt-secret-here

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/liquidbot

# Subgraph configuration
USE_MOCK_SUBGRAPH=false
USE_SUBGRAPH=true
GRAPH_API_KEY=your-graph-api-key
SUBGRAPH_DEPLOYMENT_ID=your-deployment-id

# Real-time HF detection
USE_REALTIME_HF=true
WS_RPC_URL=wss://base-mainnet.g.alchemy.com/v2/your-key

# Borrowers Index (Postgres mode)
BORROWERS_INDEX_ENABLED=true
BORROWERS_INDEX_MODE=postgres
BORROWERS_INDEX_MAX_USERS_PER_RESERVE=3000
BORROWERS_INDEX_BACKFILL_BLOCKS=50000
BORROWERS_INDEX_CHUNK_BLOCKS=2000
```

**Important**: Run the database migration before starting:
```bash
psql $DATABASE_URL < backend/migrations/20251113_add_borrowers_index.sql
```

### Production Setup with Redis Persistence

For production environments with Redis:

```bash
# Required
API_KEY=your-api-key-here
JWT_SECRET=your-jwt-secret-here

# Redis
REDIS_URL=redis://localhost:6379

# Subgraph configuration
USE_MOCK_SUBGRAPH=false
USE_SUBGRAPH=true
GRAPH_API_KEY=your-graph-api-key
SUBGRAPH_DEPLOYMENT_ID=your-deployment-id

# Real-time HF detection
USE_REALTIME_HF=true
WS_RPC_URL=wss://base-mainnet.g.alchemy.com/v2/your-key

# Borrowers Index (Redis mode)
BORROWERS_INDEX_ENABLED=true
BORROWERS_INDEX_MODE=redis
BORROWERS_INDEX_REDIS_URL=redis://localhost:6379
BORROWERS_INDEX_MAX_USERS_PER_RESERVE=3000
BORROWERS_INDEX_BACKFILL_BLOCKS=50000
BORROWERS_INDEX_CHUNK_BLOCKS=2000
```

## Per-Asset Price Trigger Configuration

Fine-tune price drop thresholds and debounce windows per asset:

```bash
# Global defaults
PRICE_TRIGGER_DROP_BPS=30          # 30 basis points = 0.3%
PRICE_TRIGGER_DEBOUNCE_SEC=60      # 60 seconds

# Per-asset overrides (more sensitive for major assets)
PRICE_TRIGGER_BPS_BY_ASSET=WETH:8,WBTC:10,USDC:20
PRICE_TRIGGER_DEBOUNCE_BY_ASSET=WETH:3,WBTC:3,USDC:5
```

## Borrowers Index Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `BORROWERS_INDEX_ENABLED` | `false` | Enable borrower tracking |
| `BORROWERS_INDEX_MODE` | `memory` | Storage mode: `memory`, `redis`, or `postgres` |
| `BORROWERS_INDEX_REDIS_URL` | - | Redis URL (required for redis mode) |
| `BORROWERS_INDEX_MAX_USERS_PER_RESERVE` | `3000` | Max borrowers tracked per reserve |
| `BORROWERS_INDEX_BACKFILL_BLOCKS` | `50000` | Historical blocks to scan on startup |
| `BORROWERS_INDEX_CHUNK_BLOCKS` | `2000` | Block chunk size for backfill |

### Storage Mode Comparison

| Mode | Persistence | External Dependencies | Use Case |
|------|-------------|----------------------|----------|
| `memory` | No | None | Development, testing, or when restarts are acceptable |
| `redis` | Yes | Redis server | Production with Redis infrastructure |
| `postgres` | Yes | PostgreSQL database | Production with existing PostgreSQL setup |

## Running the Bot

```bash
# Development mode (with hot reload)
cd backend && npm run dev

# Production mode
cd backend && npm start

# Test borrowers index configuration
cd backend && npx tsx scripts/test-borrowers-index-modes.ts
```

## Testing

```bash
# Run all tests
cd backend && npm test

# Run specific test file
cd backend && npm test -- parseEnv.test.ts
```

## Common Issues

### Build Errors

If you see TypeScript compilation errors:
```bash
cd backend && npm run clean && npm run build
```

### Borrowers Index Postgres Mode Issues

If you see "Table borrowers_index does not exist":
```bash
# Run the migration
psql $DATABASE_URL < backend/migrations/20251113_add_borrowers_index.sql
```

The service will automatically fall back to memory mode if the table doesn't exist.

### Redis Connection Issues

If Redis connection fails, the service will automatically fall back to memory mode with a warning.

## Next Steps

- Review the full [README.md](./README.md) for comprehensive documentation
- Configure price oracle settings for your use case
- Set up Telegram notifications for alerts
- Configure execution settings for automated liquidation protection

## Getting Help

- Check the [README.md](./README.md) for detailed documentation
- Review the [CONTRIBUTING.md](./CONTRIBUTING.md) guide
- Open an issue on GitHub for bugs or feature requests
