# LiquidBot Backend

Backend services for the Aave V3 Base liquidation protection service.

## Overview

The LiquidBot backend provides:
- Real-time position monitoring via Aave V3 Base subgraph
- Health factor calculation and risk detection
- Flash loan orchestration for position protection
- Subscription management and protection logging
- WebSocket alerts for at-risk positions
- RESTful API with authentication

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis 7+

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev
```

### Development

```bash
# Start in development mode
npm run dev
```

## API Endpoints

All endpoints require authentication via:
- **API Key**: `x-api-key: <your-api-key>` header
- **JWT Token**: `Authorization: Bearer <token>` header

### `GET /api/v1/health`
Health check endpoint.

### `GET /api/v1/positions`
Get list of monitored positions with health factors.

### `POST /api/v1/protect`
Queue a protection request for a user.

### WebSocket: `ws://localhost:3000/ws`
Real-time risk alerts for HF < 1.1.

## Health Factor Formula

$$
HF = \frac{\sum (collateral\_value \times liquidationThreshold)}{\sum (debt\_value)}
$$

**Risk Thresholds:**
- `HF > 1.5`: Healthy
- `1.1 < HF < 1.5`: Moderate risk
- `1.05 < HF < 1.1`: High risk (alert)
- `HF < 1.05`: Critical (emergency)
- `HF < 1.0`: Liquidation eligible

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Lint
npm run lint

# Type check
npm run typecheck

# Build
npm run build
```

## Services

- **SubgraphService**: Fetch Aave V3 data from The Graph
- **HealthCalculator**: Calculate health factors
- **FlashLoanService**: Plan and execute refinancing (stub)
- **SubscriptionService**: Manage user subscriptions

## Documentation

- [OpenAPI Spec](docs/openapi.yaml)
- [GraphQL Examples](examples/)
- [Monitoring Setup](monitoring/)
- [Deployment](deploy/)

## License

MIT
