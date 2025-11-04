# Liquidation Pipeline Quick Start

Get the real-time liquidation pipeline running in 5 minutes.

## Prerequisites

- Node.js 18+
- Base RPC endpoint (Alchemy, Infura, or public)
- (Optional) WebSocket RPC for real-time events
- (Optional) Deployed LiquidationExecutor contract for execution mode

## Installation

```bash
# Clone repository
git clone https://github.com/anassgono3-ctrl/LiquidBot.git
cd LiquidBot/backend

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate
```

## Configuration

### Option 1: Recognize-Only Mode (Recommended for Testing)

```bash
# Copy example config
cp .env.pipeline.example .env

# Edit .env - minimal required config:
cat > .env << 'EOF'
# Operation mode
EXECUTE=false

# RPC (required)
RPC_URL=https://mainnet.base.org

# Thresholds
MIN_DEBT_USD=200
MIN_PROFIT_USD=15

# Observability
LOG_LEVEL=info
METRICS_ENABLED=true

# Server
PORT=3000
API_KEY=dev_key
JWT_SECRET=dev_secret
EOF
```

### Option 2: Real-Time Events (Recommended for Production)

```bash
# Add WebSocket RPC for event-driven detection
cat >> .env << 'EOF'
# WebSocket for events
WS_RPC_URL=wss://mainnet.base.org
USE_REALTIME_HF=true
EOF
```

### Option 3: Execution Mode (Advanced)

```bash
# Deploy executor contract first
cd ../contracts
export RPC_URL=https://mainnet.base.org
export EXECUTION_PRIVATE_KEY=0x...
npm run deploy:executor

# Configure execution
cd ../backend
cat >> .env << 'EOF'
# Execution mode
EXECUTE=true
DRY_RUN_EXECUTION=false  # ⚠️ Real transactions!

# Executor
EXECUTOR_ADDRESS=0x...deployed_address
EXECUTION_PRIVATE_KEY=0x...your_private_key

# 1inch (for swaps)
ONEINCH_API_KEY=your_api_key
EOF
```

## Running

### Start the Pipeline

```bash
npm start
```

You should see:
```
[info] LiquidBot backend listening on port 3000
[info] Pipeline Configuration:
  Mode: RECOGNIZE-ONLY
  Min Debt: $200
  Min Profit: $15
  Max Slippage: 0.8%
  ...
```

### Check Health

```bash
curl http://localhost:3000/health | jq
```

Expected response:
```json
{
  "status": "ok",
  "app": {
    "uptimeSeconds": 123,
    "version": "0.1.0"
  },
  "pipeline": {
    "mode": "recognize-only",
    "candidatesTracked": 0,
    "minHealthFactor": 0
  }
}
```

### View Metrics

```bash
curl http://localhost:3000/metrics
```

Key metrics:
```
pipeline_candidates_discovered_total{trigger_type="event"} 0
pipeline_candidates_verified_total 0
pipeline_candidates_profitable_total 0
pipeline_candidates_executed_total 0
```

## Monitoring

### Watch Logs

```bash
# All logs
npm start | tee logs/pipeline.log

# Only liquidatable candidates
npm start | grep "Candidate verified"

# Only executions
npm start | grep "Candidate executed"
```

### Example Log Output

When a liquidatable user is found:
```json
{
  "timestamp": "2025-01-04T13:00:00.000Z",
  "level": "info",
  "message": "Candidate discovered",
  "stage": "discovery",
  "userAddress": "0x1234...",
  "blockNumber": 123456,
  "triggerType": "event"
}
{
  "timestamp": "2025-01-04T13:00:00.150Z",
  "level": "info",
  "message": "Candidate verified",
  "stage": "verified",
  "userAddress": "0x1234...",
  "blockNumber": 123456,
  "healthFactor": 0.95,
  "debtUsd": 10000,
  "latencyMs": 150
}
```

### Grafana Dashboard (Optional)

```bash
# Start Grafana
docker-compose up -d grafana

# Import dashboard
open http://localhost:3001
# Import: backend/monitoring/grafana-dashboard.json
```

## Testing

### Unit Tests

```bash
# Run all tests
npm test

# Run pipeline tests only
npm test -- tests/unit/RiskEngine.test.ts
npm test -- tests/unit/ProfitEngine.test.ts
npm test -- tests/unit/SameBlockVerifier.test.ts
```

### Integration Tests (Fork)

```bash
# Requires RPC_URL
export RPC_URL=https://mainnet.base.org
npm test -- tests/integration/pipeline.fork.test.ts
```

## Common Tasks

### Add Asset Deny List

```bash
# Add to .env
echo "DENIED_ASSETS=0xBadToken,0xScamToken" >> .env

# Restart
npm start
```

### Increase Min Debt Threshold

```bash
# Edit .env
sed -i 's/MIN_DEBT_USD=200/MIN_DEBT_USD=500/' .env

# Restart
npm start
```

### Enable Telegram Notifications

```bash
# Get bot token from @BotFather
# Get chat ID from @userinfobot

cat >> .env << 'EOF'
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_CHAT_ID=123456789
EOF

# Restart
npm start
```

### Enable Execution (Testnet First!)

```bash
# 1. Test on testnet (Sepolia/Goerli)
cat > .env.testnet << 'EOF'
EXECUTE=true
DRY_RUN_EXECUTION=false
RPC_URL=https://sepolia.base.org
EXECUTOR_ADDRESS=0x...testnet_executor
EXECUTION_PRIVATE_KEY=0x...testnet_key
CHAIN_ID=84532
MIN_DEBT_USD=10  # Lower for testnet
MIN_PROFIT_USD=1
EOF

# 2. Run on testnet
NODE_ENV=test npm start

# 3. Verify execution works

# 4. Switch to mainnet only after testing
cp .env.testnet .env
# Update RPC_URL, EXECUTOR_ADDRESS, CHAIN_ID for mainnet
```

## Troubleshooting

### "No candidates discovered"

Check:
- [ ] RPC_URL is accessible
- [ ] WS_RPC_URL is configured (for real-time mode)
- [ ] USE_REALTIME_HF=true (for event-driven)
- [ ] Aave events are being emitted on Base

### "Candidates skipped: hf_ok"

This is normal. Users with HF ≥ 1.0 are not liquidatable.

Check metrics:
```bash
curl -s http://localhost:3000/metrics | grep skipped
# pipeline_candidates_skipped_total{reason="hf_ok"} 123
```

### "Verification failed"

Check:
- [ ] Multicall3 is deployed at MULTICALL3_ADDRESS
- [ ] AAVE_POOL address is correct
- [ ] RPC rate limits not exceeded

### "Not profitable"

Increase MIN_PROFIT_USD or decrease MIN_DEBT_USD:
```bash
echo "MIN_PROFIT_USD=5" >> .env
echo "MIN_DEBT_USD=100" >> .env
```

### High CPU/Memory Usage

Reduce tracked candidates:
```bash
echo "MAX_CANDIDATES=100" >> .env
```

## Next Steps

1. **Run in shadow mode** for 24-48h to validate detection
2. **Monitor false positive rate** (should be < 5%)
3. **Compare with historical liquidations** on Base
4. **Enable execution** only after validation
5. **Set up alerting** for execution failures
6. **Scale horizontally** if needed (multiple instances with shared Redis)

## Support

- Documentation: `/backend/docs/`
- Issues: [GitHub Issues](https://github.com/anassgono3-ctrl/LiquidBot/issues)
- Architecture: See `/backend/docs/LIQUIDATION_PIPELINE.md`
