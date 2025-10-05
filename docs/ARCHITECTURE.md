# LiquidBot Architecture Documentation

## System Overview

LiquidBot is a distributed system designed to monitor Aave V3 positions on the Base network and provide automated liquidation protection services. The architecture prioritizes reliability, scalability, and security while maintaining low latency for critical protection actions.

## Architecture Principles

1. **Separation of Concerns**: Clear boundaries between monitoring, decision-making, and execution
2. **Fail-Safe Design**: Circuit breakers and graceful degradation
3. **Observable**: Comprehensive metrics and logging throughout
4. **Scalable**: Horizontal scaling for increased load
5. **Secure by Default**: Multi-sig controls, exposure limits, audited contracts

---

## High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         User Layer                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Web App    │  │ Mobile App   │  │  Partner Integrations│  │
│  │  (Dashboard) │  │  (Alerts)    │  │  (Wallets, Agg.)    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
└─────────┼──────────────────┼────────────────────┼───────────────┘
          │                  │                    │
          │ HTTPS/WSS        │ HTTPS/WSS         │ REST API
          │                  │                    │
┌─────────▼──────────────────▼────────────────────▼───────────────┐
│                      API Gateway                                 │
│              (nginx ingress, rate limiting)                      │
└─────────┬───────────────────────────────────────────────────────┘
          │
          │ Internal Network
          │
┌─────────▼──────────────────────────────────────────────────────┐
│                     Application Layer                           │
│  ┌────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │   API Service  │  │  WebSocket Svc   │  │  Admin Service │ │
│  │   (Express)    │  │   (Socket.io)    │  │   (Internal)   │ │
│  └────────┬───────┘  └────────┬─────────┘  └────────┬───────┘ │
└───────────┼──────────────────┼──────────────────────┼──────────┘
            │                  │                      │
            │                  │                      │
┌───────────▼──────────────────▼──────────────────────▼──────────┐
│                      Data Layer                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ PostgreSQL  │  │    Redis     │  │    Prometheus        │  │
│  │ (Positions, │  │ (Cache,      │  │    (Metrics)         │  │
│  │  Users, Tx) │  │  Queue)      │  │                      │  │
│  └──────┬──────┘  └──────┬───────┘  └──────────────────────┘  │
└─────────┼─────────────────┼────────────────────────────────────┘
          │                 │
┌─────────▼─────────────────▼────────────────────────────────────┐
│                     Worker Layer                                │
│  ┌────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │Position Monitor│  │  Risk Analyzer   │  │Action Executor │ │
│  │  (Subgraph)    │  │  (HF Calculator) │  │  (On-chain)    │ │
│  └────────┬───────┘  └────────┬─────────┘  └────────┬───────┘ │
└───────────┼──────────────────┼──────────────────────┼──────────┘
            │                  │                      │
            │                  │                      │
┌───────────▼──────────────────▼──────────────────────▼──────────┐
│                  External Services Layer                        │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Aave V3   │  │  The Graph   │  │   Chainlink Oracles  │  │
│  │  Subgraph   │  │   (Query)    │  │   (Price Feeds)      │  │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬───────────┘  │
└─────────┼─────────────────┼────────────────────┼───────────────┘
          │                 │                    │
┌─────────▼─────────────────▼────────────────────▼───────────────┐
│                      Base Network                               │
│  ┌────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │ Aave V3 Pool   │  │ Smart Contracts  │  │  Price Oracles │ │
│  │   Contract     │  │   (LiquidBot)    │  │                │ │
│  └────────────────┘  └──────────────────┘  └────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. API Service

**Responsibilities**:
- Handle user authentication (JWT)
- Position enrollment and management
- Query user data and intervention history
- Serve dashboard and mobile apps

**Technology Stack**:
- Node.js 18+ with TypeScript
- Express.js 4.18+
- Ethers.js v6 for blockchain interactions
- Prisma ORM for database access

**Key Endpoints**:
```
POST   /api/v1/auth/connect         # Wallet authentication
GET    /api/v1/positions            # List user positions
POST   /api/v1/positions/enroll     # Enroll new position
PUT    /api/v1/positions/:id        # Update preferences
DELETE /api/v1/positions/:id        # Unenroll position
GET    /api/v1/interventions        # Intervention history
GET    /api/v1/fees                 # Fee breakdown
GET    /api/v1/health               # Health check
```

**Scaling**:
- Horizontal scaling with Kubernetes (3+ replicas)
- Session-less design (JWT tokens)
- Read replicas for database queries

### 2. WebSocket Service

**Responsibilities**:
- Real-time position updates
- Live health factor streams
- Intervention notifications
- Price alerts

**Technology Stack**:
- Socket.io for WebSocket connections
- Redis adapter for multi-node support
- JWT authentication

**Events**:
```javascript
// Client -> Server
socket.emit('subscribe', { userId, positions: [...] });
socket.emit('unsubscribe', { userId });

// Server -> Client
socket.emit('position:update', { positionId, healthFactor, ... });
socket.emit('intervention:started', { positionId, action, ... });
socket.emit('intervention:completed', { positionId, txHash, ... });
socket.emit('price:alert', { asset, price, change });
```

**Scaling**:
- Redis Pub/Sub for broadcasting across instances
- Sticky sessions via nginx (optional)
- Connection pooling

### 3. Position Monitor Worker

**Responsibilities**:
- Poll Aave V3 subgraph for active positions
- Fetch reserve data and prices
- Update position cache in Redis
- Identify positions requiring analysis

**Polling Strategy**:
```javascript
// Primary cycle (30 seconds)
async function monitorPositions() {
  // 1. Query enrolled users from DB
  const enrolledUsers = await db.getEnrolledUsers();
  
  // 2. Batch query subgraph (500 users at a time)
  const batches = chunk(enrolledUsers, 500);
  
  for (const batch of batches) {
    const positions = await subgraph.getUserPositions(batch);
    
    // 3. Update cache with raw position data
    await redis.setPositions(positions, ttl=60);
    
    // 4. Queue positions for risk analysis
    for (const position of positions) {
      await redis.queueRiskAnalysis(position.id);
    }
  }
}

setInterval(monitorPositions, 30000); // Every 30s
```

**Error Handling**:
- Retry logic with exponential backoff
- Fallback to direct contract reads if subgraph fails
- Alert on consecutive failures (3+)

### 4. Risk Analyzer Worker

**Responsibilities**:
- Calculate health factors from cached positions
- Detect at-risk positions
- Determine optimal protection action
- Queue execution tasks

**Health Factor Calculation**:
```javascript
async function calculateHealthFactor(positionId) {
  // 1. Get position data from cache
  const position = await redis.getPosition(positionId);
  
  // 2. Get live prices from Chainlink oracles
  const prices = await oracle.getPrices(position.reserves);
  
  // 3. Calculate total collateral in ETH
  const totalCollateralETH = position.reserves
    .filter(r => r.usageAsCollateralEnabled)
    .reduce((sum, reserve) => {
      const balanceETH = (reserve.aTokenBalance / 10**reserve.decimals) 
                         * prices[reserve.symbol];
      return sum + balanceETH;
    }, 0);
  
  // 4. Calculate weighted liquidation threshold
  const weightedThreshold = position.reserves
    .filter(r => r.usageAsCollateralEnabled)
    .reduce((sum, reserve) => {
      const balanceETH = (reserve.aTokenBalance / 10**reserve.decimals) 
                         * prices[reserve.symbol];
      const threshold = reserve.liquidationThreshold / 10000;
      return sum + (balanceETH * threshold);
    }, 0) / totalCollateralETH;
  
  // 5. Calculate total debt in ETH
  const totalDebtETH = position.reserves.reduce((sum, reserve) => {
    const debt = reserve.variableDebt + reserve.stableDebt;
    const debtETH = (debt / 10**reserve.decimals) * prices[reserve.symbol];
    return sum + debtETH;
  }, 0);
  
  // 6. Calculate health factor
  const healthFactor = (totalCollateralETH * weightedThreshold) / totalDebtETH;
  
  return {
    healthFactor,
    totalCollateralETH,
    totalDebtETH,
    timestamp: Date.now()
  };
}
```

**Risk Assessment**:
```javascript
async function assessRisk(positionId) {
  const { healthFactor, totalCollateralETH, totalDebtETH } = 
    await calculateHealthFactor(positionId);
  
  const user = await db.getUserByPosition(positionId);
  const threshold = user.healthFactorThreshold || 1.10;
  
  if (healthFactor < 1.05) {
    // Critical: emergency intervention
    return {
      action: 'emergency_close',
      priority: 'critical',
      fee: 0.005 // 0.5%
    };
  } else if (healthFactor < threshold) {
    // At-risk: determine optimal action
    const action = await determineOptimalAction(
      positionId, 
      healthFactor,
      totalCollateralETH,
      totalDebtETH
    );
    return {
      action,
      priority: 'high',
      fee: 0.0015 // 0.15%
    };
  }
  
  // Healthy position
  return null;
}
```

**Action Selection**:
```javascript
async function determineOptimalAction(positionId, hf, collateral, debt) {
  // 1. Check available liquidity for flash loans
  const flashLoanAvailable = await checkFlashLoanAvailability(debt * 1.5);
  
  // 2. Evaluate refinancing (best for high APY debt)
  if (flashLoanAvailable && await hasHighAPYDebt(positionId)) {
    return 'refinance';
  }
  
  // 3. Evaluate collateral swap (if holding volatile assets)
  if (await hasVolatileCollateral(positionId)) {
    return 'collateral_swap';
  }
  
  // 4. Default to partial deleverage
  return 'partial_deleverage';
}
```

### 5. Action Executor Worker

**Responsibilities**:
- Execute protection transactions on-chain
- Interact with LiquidBot smart contracts
- Handle transaction failures and retries
- Collect fees and update state

**Execution Flow**:
```javascript
async function executeProtection(task) {
  const { positionId, action, user, priority } = task;
  
  try {
    // 1. Pre-flight checks
    await validatePosition(positionId);
    await checkGasPrice(); // Abort if too high
    await verifySmartContractState(); // Not paused
    
    // 2. Prepare transaction data
    const txData = await prepareTxData(action, user, positionId);
    
    // 3. Estimate gas
    const gasEstimate = await contract.estimateGas[action](txData);
    const gasPrice = await provider.getGasPrice();
    const estimatedCost = gasEstimate * gasPrice;
    
    // 4. Execute transaction
    const tx = await contract[action](txData, {
      gasLimit: gasEstimate * 1.2, // 20% buffer
      gasPrice: gasPrice
    });
    
    // 5. Wait for confirmation
    const receipt = await tx.wait(1); // 1 confirmation
    
    // 6. Log success
    await db.logIntervention({
      positionId,
      action,
      txHash: receipt.transactionHash,
      gasUsed: receipt.gasUsed,
      status: 'success',
      timestamp: Date.now()
    });
    
    // 7. Notify user
    await notifyUser(user, 'intervention_success', {
      action,
      txHash: receipt.transactionHash
    });
    
    return { success: true, txHash: receipt.transactionHash };
    
  } catch (error) {
    // Handle failures
    await handleExecutionFailure(task, error);
  }
}
```

**Retry Logic**:
```javascript
async function handleExecutionFailure(task, error) {
  task.attempts = (task.attempts || 0) + 1;
  
  if (task.attempts >= 3) {
    // Max retries exceeded
    await db.logIntervention({
      positionId: task.positionId,
      action: task.action,
      status: 'failed',
      error: error.message,
      attempts: task.attempts
    });
    
    // Notify user and support team
    await notifyUser(task.user, 'intervention_failed', {
      action: task.action,
      error: error.message
    });
    
    await alertSupport('intervention_failed', task);
    
    return;
  }
  
  // Retry with exponential backoff
  const delay = Math.pow(2, task.attempts) * 1000;
  await sleep(delay);
  await redis.queueExecution(task);
}
```

---

## Smart Contract Architecture

### Contract Interaction Flow

```
User                                    LiquidBot Contracts
 │                                              │
 │  1. Enroll Position                          │
 ├──────────────────────────────────────────────>
 │                                  PositionManager.enrollPosition()
 │                                              │
 │  2. Backend detects risk                     │
 │     (HF < threshold)                         │
 │                                              │
 │  3. Backend triggers protection              │
 ├──────────────────────────────────────────────>
 │                              FlashLoanOrchestrator.executeProtection()
 │                                              │
 │                                              │  4. Request flash loan
 │                                              ├────────────────────>
 │                                              │    Aave V3 Pool
 │                                              │
 │                                              │  5. Receive loan
 │                                              <────────────────────┤
 │                                              │
 │                                              │  6. Execute rebalance
 │                                              ├────────────────────>
 │                                              │  CollateralOptimizer
 │                                              │
 │                                              │  7. Repay loan + fee
 │                                              ├────────────────────>
 │                                              │    Aave V3 Pool
 │                                              │
 │                                              │  8. Collect service fee
 │                                              ├────────────────────>
 │                                              │    FeeCollector
 │                                              │
 │  9. Position protected                       │
 <────────────────────────────────────────────┤
```

### Contract Dependencies

```
PositionManager (entry point)
    │
    ├── References: User registry, subscription tiers
    │
    └── Calls: FlashLoanOrchestrator (for protection actions)
            │
            ├── Implements: IFlashLoanReceiver (Aave)
            │
            ├── Calls: Aave V3 Pool (flash loans)
            │
            ├── Calls: CollateralOptimizer (rebalancing)
            │       │
            │       └── Calls: DEX routers (swaps)
            │
            └── Calls: FeeCollector (fee distribution)
                    │
                    └── References: Multisig (withdrawals)

EmergencyPause (global state)
    │
    └── Checked by: All contracts before execution
```

---

## Data Architecture

### PostgreSQL Schema

```sql
-- Users table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) UNIQUE NOT NULL,
  subscription_tier SMALLINT DEFAULT 0, -- 0=basic, 1=premium, 2=enterprise
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Positions table
CREATE TABLE positions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  aave_user_address VARCHAR(42) NOT NULL,
  enrolled_at TIMESTAMP DEFAULT NOW(),
  unenrolled_at TIMESTAMP,
  health_factor_threshold DECIMAL(10, 4) DEFAULT 1.10,
  auto_intervention BOOLEAN DEFAULT TRUE,
  status VARCHAR(20) DEFAULT 'active', -- active, paused, closed
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Position snapshots (historical health factors)
CREATE TABLE position_snapshots (
  id SERIAL PRIMARY KEY,
  position_id INTEGER REFERENCES positions(id),
  health_factor DECIMAL(10, 4),
  total_collateral_eth DECIMAL(30, 18),
  total_debt_eth DECIMAL(30, 18),
  snapshot_at TIMESTAMP DEFAULT NOW()
);

-- Interventions table
CREATE TABLE interventions (
  id SERIAL PRIMARY KEY,
  position_id INTEGER REFERENCES positions(id),
  action VARCHAR(50) NOT NULL, -- refinance, collateral_swap, deleverage, emergency_close
  tx_hash VARCHAR(66),
  gas_used INTEGER,
  gas_price_gwei DECIMAL(20, 9),
  fee_amount DECIMAL(30, 18),
  status VARCHAR(20) NOT NULL, -- pending, success, failed
  error_message TEXT,
  attempts SMALLINT DEFAULT 1,
  executed_at TIMESTAMP DEFAULT NOW()
);

-- Fees table
CREATE TABLE fees (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  intervention_id INTEGER REFERENCES interventions(id),
  fee_type VARCHAR(30) NOT NULL, -- subscription, refinancing, emergency, performance
  amount_usd DECIMAL(10, 2),
  amount_eth DECIMAL(30, 18),
  collected_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_positions_user_id ON positions(user_id);
CREATE INDEX idx_positions_status ON positions(status);
CREATE INDEX idx_interventions_position_id ON interventions(position_id);
CREATE INDEX idx_interventions_status ON interventions(status);
CREATE INDEX idx_fees_user_id ON fees(user_id);
```

### Redis Data Structures

```javascript
// Position cache (60s TTL)
redis.set(`position:${positionId}`, JSON.stringify({
  userId: '0x...',
  reserves: [...],
  lastUpdated: Date.now()
}), 'EX', 60);

// Health factor cache (30s TTL)
redis.set(`hf:${positionId}`, healthFactor, 'EX', 30);

// Risk analysis queue
redis.lpush('queue:risk_analysis', positionId);

// Execution queue (priority queue)
redis.zadd('queue:execution', priority, JSON.stringify(task));

// Price cache (5min TTL)
redis.set(`price:${asset}`, priceInEth, 'EX', 300);

// Rate limiting (per user)
redis.incr(`ratelimit:${userId}:${minute}`, 'EX', 60);
```

---

## Security Architecture

### Defense in Depth

**Layer 1: Network**
- DDoS protection (Cloudflare)
- VPC isolation (production services)
- IP whitelisting (admin endpoints)

**Layer 2: Application**
- JWT authentication
- Rate limiting (per IP, per user)
- Input validation (all endpoints)
- CORS restrictions

**Layer 3: Smart Contracts**
- Access control (multi-sig)
- Exposure caps (per user, system-wide)
- Slippage protection (max 2%)
- Circuit breaker (EmergencyPause)

**Layer 4: Data**
- Encryption at rest (PostgreSQL, Redis)
- Encryption in transit (TLS 1.3)
- Secure credential storage (Vault)
- Regular backups (daily snapshots)

### Access Control Matrix

| Role | API | Smart Contracts | Database | Infrastructure |
|------|-----|----------------|----------|----------------|
| User | Read/Write (own data) | Enroll/Unenroll | - | - |
| Worker | Internal API | Execute (via backend key) | Read/Write | - |
| Admin | Full API | - | Read | Limited |
| Multisig | - | Pause, Fees, Upgrades | - | - |
| Ops | Monitoring only | - | Read-only replica | Full |

---

## Deployment Architecture

### Kubernetes Cluster

```yaml
# Namespace: liquidbot-production
apiVersion: v1
kind: Namespace
metadata:
  name: liquidbot-production

---
# API Service Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
  namespace: liquidbot-production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-service
  template:
    metadata:
      labels:
        app: api-service
    spec:
      containers:
      - name: api
        image: liquidbot/api:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: url
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: redis-credentials
              key: url
        resources:
          requests:
            cpu: 500m
            memory: 1Gi
          limits:
            cpu: 1000m
            memory: 2Gi
        livenessProbe:
          httpGet:
            path: /api/v1/health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/v1/health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5

---
# Service (LoadBalancer)
apiVersion: v1
kind: Service
metadata:
  name: api-service
  namespace: liquidbot-production
spec:
  type: LoadBalancer
  selector:
    app: api-service
  ports:
  - port: 443
    targetPort: 3000
    protocol: TCP
```

### CI/CD Pipeline

```yaml
# GitHub Actions workflow
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    - name: Install dependencies
      run: npm install
    - name: Run tests
      run: npm test
    - name: Run linter
      run: npm run lint
  
  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
    - name: Build Docker image
      run: docker build -t liquidbot/api:${{ github.sha }} .
    - name: Push to registry
      run: docker push liquidbot/api:${{ github.sha }}
  
  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
    - name: Deploy to Kubernetes
      run: |
        kubectl set image deployment/api-service \
          api=liquidbot/api:${{ github.sha }} \
          -n liquidbot-production
    - name: Wait for rollout
      run: |
        kubectl rollout status deployment/api-service \
          -n liquidbot-production
```

---

## Disaster Recovery

### Backup Strategy

**PostgreSQL**:
- Daily full backups (retained 30 days)
- Hourly incremental backups (retained 7 days)
- Replication to standby instance (warm standby)

**Redis**:
- AOF (Append-Only File) enabled
- Daily snapshots to S3
- Ephemeral data acceptable to lose (can rebuild)

**Smart Contracts**:
- Immutable on-chain (no backup needed)
- Source code in version control
- Deployment scripts in version control

### Incident Response

**Severity Levels**:
- **P0 (Critical)**: Service completely down, data loss risk
- **P1 (High)**: Major functionality broken, high error rates
- **P2 (Medium)**: Partial functionality degraded
- **P3 (Low)**: Minor issues, no immediate impact

**Response Procedures**:

**P0 Incident**:
1. Activate EmergencyPause (if necessary)
2. Alert all on-call engineers
3. Start incident war room
4. Investigate and resolve
5. Post-incident review within 48 hours

**P1 Incident**:
1. Alert on-call engineer
2. Investigate and assess impact
3. Implement fix or workaround
4. Post-incident review within 1 week

---

## Performance Optimization

### Caching Strategy

**Redis Caching Layers**:
```javascript
// L1: Position data (60s TTL)
const position = await redis.get(`position:${id}`) || 
                 await fetchFromSubgraph(id);

// L2: Health factors (30s TTL)
const hf = await redis.get(`hf:${id}`) || 
           await calculateHealthFactor(id);

// L3: Prices (5min TTL)
const price = await redis.get(`price:${asset}`) || 
              await fetchFromOracle(asset);

// L4: Reserve data (10min TTL)
const reserve = await redis.get(`reserve:${id}`) || 
                await fetchReserveData(id);
```

### Database Optimization

**Query Optimization**:
- Indexes on frequently queried columns
- Connection pooling (max 20 connections)
- Read replicas for analytics queries
- Materialized views for complex aggregations

**Example: Positions Query**:
```sql
-- Optimized query with index on (status, user_id)
SELECT p.*, u.wallet_address
FROM positions p
JOIN users u ON p.user_id = u.id
WHERE p.status = 'active'
  AND p.user_id = $1
ORDER BY p.created_at DESC
LIMIT 10;
```

### RPC Optimization

**Request Batching**:
```javascript
// Batch multiple contract calls
const [price1, price2, price3] = await Promise.all([
  oracle.getPrice('WETH'),
  oracle.getPrice('USDC'),
  oracle.getPrice('DAI')
]);
```

**Fallback Strategy**:
```javascript
async function queryWithFallback(query) {
  const endpoints = [PRIMARY_RPC, FALLBACK_RPC, PUBLIC_RPC];
  
  for (const endpoint of endpoints) {
    try {
      return await query(endpoint);
    } catch (error) {
      console.warn(`RPC failed: ${endpoint}`, error);
      // Try next endpoint
    }
  }
  
  throw new Error('All RPC endpoints failed');
}
```

---

## Monitoring & Alerting

### Key Metrics

**System Metrics**:
- API request rate (req/s)
- API latency (p50, p95, p99)
- Worker job processing rate
- Database connection pool usage
- Redis memory usage

**Business Metrics**:
- Positions monitored (count)
- Average health factor
- Interventions executed (count, success rate)
- Revenue collected (USD, ETH)
- Active subscribers (by tier)

**Alert Conditions**:
```yaml
alerts:
  - name: HighAPILatency
    condition: api_latency_p99 > 200ms
    severity: warning
    notification: slack
  
  - name: InterventionFailureRate
    condition: intervention_success_rate < 95%
    severity: critical
    notification: pagerduty
  
  - name: ServiceDown
    condition: uptime < 99.5%
    severity: critical
    notification: pagerduty
  
  - name: HighGasPrice
    condition: gas_price_gwei > 50
    severity: warning
    notification: slack
```

---

## Technology Decisions

### Why Node.js/TypeScript?
- Strong ecosystem for blockchain (ethers.js)
- Excellent async I/O for polling and monitoring
- Type safety with TypeScript
- Widely adopted, easy hiring

### Why PostgreSQL?
- ACID compliance for financial data
- Powerful query engine for analytics
- Excellent replication support
- Battle-tested reliability

### Why Redis?
- Fast in-memory caching
- Built-in pub/sub for WebSocket
- Queue support for job processing
- Simple deployment

### Why Kubernetes?
- Horizontal scaling
- Rolling deployments (zero downtime)
- Self-healing (auto-restart failed pods)
- Industry standard

---

## Future Enhancements

### Phase 2 (Post-Launch)
- Machine learning for risk prediction
- Advanced collateral optimization strategies
- Multi-protocol support (Compound, Morpho)
- Mobile app with push notifications

### Phase 3 (Expansion)
- Cross-chain position monitoring (Arbitrum, Optimism)
- DAO governance for protocol parameters
- Automated market making for fees
- Insurance product integration

---

**Document Version**: 1.0  
**Last Updated**: 2024-01-15  
**Status**: Living Document
