# Health Monitoring, Profit Simulation & Telegram Alerts

## Overview

LiquidBot includes comprehensive liquidation opportunity detection, borrower health factor monitoring, profit estimation, and real-time alerting via both WebSocket and Telegram.

## Features

### 1. Liquidation Opportunity Detection

When new liquidation calls are detected, the system:
- Fetches current borrower health factors
- Estimates profit potential for the liquidation
- Broadcasts structured events via WebSocket
- Sends Telegram notifications for profitable opportunities

### 2. Health Factor Monitoring

Continuously monitors user health factors and:
- Tracks state transitions (crossing below threshold)
- Broadcasts alerts when HF drops below configured threshold
- Sends Telegram notifications for critical health factor breaches
- Avoids spam by only alerting on threshold crossings (not continuous alerts)

### 3. Profit Estimation

Calculates estimated profit for liquidation opportunities:
```
collateralValueUsd = (collateralAmount / 10^decimals) × price(symbol)
principalValueUsd  = (principalAmount / 10^decimals) × price(symbol)
rawSpread = collateralValueUsd - principalValueUsd
bonusValue = collateralValueUsd × bonusPct  // 5% placeholder
gross = rawSpread + bonusValue
fees = gross × (PROFIT_FEE_BPS / 10_000)
profitEstimateUsd = gross - fees
```

## Configuration

### Environment Variables

Add these to your `.env` file (see `.env.example` for template):

```bash
# Telegram Notifications (optional - disabled if not set)
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here

# Health Monitoring
HEALTH_ALERT_THRESHOLD=1.10        # Broadcast when HF crosses below this
HEALTH_EMERGENCY_THRESHOLD=1.05    # Optional severity level

# Profit Estimation
PROFIT_FEE_BPS=30                  # Assumed execution + gas overhead (basis points)
PROFIT_MIN_USD=10                  # Minimum profit threshold to alert

# Price Oracle (placeholder for future integration)
PRICE_ORACLE_MODE=coingecko
```

### Getting Telegram Credentials

1. Create a bot via [@BotFather](https://t.me/botfather) on Telegram
2. Save the bot token (e.g., `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
3. Get your chat ID:
   - Message your bot
   - Visit `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   - Find your chat ID in the response
4. Add both to `.env`

**⚠️ Security Note:** Never commit real tokens to the repository. Use `.env` (gitignored) for real credentials, and `.env.example` for placeholders.

## WebSocket Events

The system broadcasts three event types via WebSocket at `ws://localhost:3000/ws`:

### 1. Liquidation Events

Emitted when new liquidation calls are detected (already existing):

```json
{
  "type": "liquidation.new",
  "liquidations": [
    {
      "id": "0x123abc...",
      "timestamp": 1234567890,
      "user": "0xUser...",
      "liquidator": "0xLiquidator..."
    }
  ],
  "timestamp": "2024-01-15T12:00:00.000Z"
}
```

### 2. Opportunity Events (NEW)

Emitted when new profitable liquidation opportunities are detected:

```json
{
  "type": "opportunity.new",
  "opportunities": [
    {
      "id": "0x123abc...",
      "user": "0xUser...",
      "profitEstimateUsd": 50.25,
      "healthFactor": 0.98,
      "timestamp": 1234567890
    }
  ],
  "timestamp": "2024-01-15T12:00:00.000Z"
}
```

### 3. Health Breach Events (NEW)

Emitted when a user's health factor crosses below the alert threshold:

```json
{
  "type": "health.breach",
  "user": "0xUser...",
  "healthFactor": 1.08,
  "threshold": 1.10,
  "timestamp": "2024-01-15T12:00:00.000Z"
}
```

## Telegram Notifications

### Opportunity Notification

Example message format:

```
🚨 Liquidation Opportunity

👤 User: 0xabc...def
💰 Collateral: 123.45 USDC (~$123.45)
📉 Debt: 100.00 WETH (value ~$300,000)
📊 Health Factor: 0.98
💵 Est. Profit: $12.34
🔗 Tx: https://basescan.org/tx/0x...

⏰ 2024-01-15T12:00:00.000Z
```

### Health Breach Notification

Example message format:

```
⚠️ Health Factor Breach

👤 User: 0xabc...def
📉 Health Factor: 0.98
⚡ Threshold: 1.10

🔴 Position now at risk of liquidation

⏰ 2024-01-15T12:00:00.000Z
```

## Metrics

New Prometheus metrics available at `/metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `liquidbot_opportunities_generated_total` | Counter | Total liquidation opportunities detected |
| `liquidbot_opportunity_profit_estimate` | Histogram | Profit estimate distribution (buckets: 1, 5, 10, 25, 50, 100, 250, 500, 1000 USD) |
| `liquidbot_health_breach_events_total` | Counter | Total health factor breach events |

## Health Endpoint

The `/health` endpoint now includes additional monitoring stats:

```json
{
  "status": "ok",
  "app": { "uptimeSeconds": 1234, "version": "0.1.0" },
  "subgraph": { "mode": "live", ... },
  "liquidationTracker": { "seenTotal": 150, "pollLimit": 50 },
  "opportunity": {
    "lastBatchSize": 3,
    "totalOpportunities": 45,
    "lastProfitSampleUsd": 25.50
  },
  "healthMonitoring": {
    "trackedUsers": 128,
    "lastSnapshotTs": 1736892345678
  },
  "notifications": {
    "telegramEnabled": true
  }
}
```

## Architecture

### Services

#### PriceService
- Provides USD price lookups for tokens
- Current implementation uses hardcoded prices for common tokens
- Structured for future Coingecko or oracle integration
- Includes 1-minute price cache

#### OpportunityService
- Transforms liquidation calls into enriched opportunities
- Calculates collateral/principal values in USD
- Estimates profit with 5% liquidation bonus and configurable fees
- Filters opportunities by minimum profit threshold

#### NotificationService
- Lazy-initializes Telegram bot if credentials configured
- Formats and sends opportunity and health breach notifications
- Gracefully handles errors without throwing
- Sanitizes addresses and formats values for readability

#### HealthMonitor
- Tracks user health factors over time
- Detects threshold crossing events (not continuous alerts)
- Maintains in-memory state for efficient breach detection
- Runs on configurable interval (default: 2x poll interval)

### Integration Flow

1. **Subgraph Poller** detects new liquidation calls
2. **HealthMonitor** fetches current health snapshot
3. **OpportunityService** builds opportunities with profit estimates
4. **Metrics** updated with opportunity counts and profit distribution
5. **WebSocket** broadcasts opportunity events to connected clients
6. **NotificationService** sends Telegram alerts for profitable opportunities
7. **HealthMonitor** (on interval) detects health factor breaches and broadcasts/notifies

## Profit Estimation Assumptions

### Limitations

1. **Stub Pricing**: Uses hardcoded prices (not live oracle data)
   - Stablecoins: $1.00
   - WETH: $3,000
   - WBTC: $60,000
   - Other tokens have placeholder prices

2. **Fixed Liquidation Bonus**: 5% assumed (actual may vary by reserve)

3. **Gas Costs**: Not included in current estimation
   - Only execution fee (PROFIT_FEE_BPS) is deducted

4. **Slippage**: Not modeled
   - Assumes exact amounts can be swapped at estimated prices

5. **Network Conditions**: Not considered
   - Gas price volatility not factored in

### Future Enhancements

- [ ] Real-time price feeds (Coingecko, Chainlink, etc.)
- [ ] Per-reserve liquidation bonus lookup from Aave pool config
- [ ] Gas oracle integration for realistic net profit
- [ ] Historical profitability tracking and analytics
- [ ] ML-based opportunity scoring

## Testing

Comprehensive test coverage for all new services:

```bash
# Run all tests
npm test

# Run specific test suites
npm test PriceService.test.ts
npm test OpportunityService.test.ts
npm test NotificationService.test.ts
npm test HealthMonitor.test.ts
```

Test coverage includes:
- Price lookups and caching
- Profit calculation accuracy
- Notification formatting
- Health breach detection logic
- Error handling and edge cases

## Troubleshooting

### Telegram Notifications Not Working

1. **Check credentials**: Ensure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set correctly
2. **Verify bot setup**: Make sure you've messaged the bot at least once
3. **Check logs**: Look for `[notification]` log messages indicating status
4. **Test manually**: Use Telegram API to verify credentials work

### No Opportunities Detected

1. **Check thresholds**: Lower `PROFIT_MIN_USD` for testing
2. **Review price stub**: Ensure token symbols match expected values
3. **Monitor logs**: Look for `[opportunity]` messages showing counts
4. **Check subgraph**: Verify liquidation calls are being detected

### Health Breach Not Alerting

1. **Verify threshold**: Check `HEALTH_ALERT_THRESHOLD` is set appropriately
2. **Understand behavior**: Alerts only fire on *crossing* below threshold
3. **Check monitoring interval**: Health checks run every 2x poll interval
4. **Review logs**: Look for `[health-monitor]` messages

## Production Considerations

1. **Secret Management**: Use environment-specific secrets, never commit tokens
2. **Rate Limiting**: Telegram has rate limits (~30 msg/second to same chat)
3. **Price Feed**: Integrate real oracle before production use
4. **Gas Estimation**: Add gas oracle for realistic profitability
5. **Monitoring**: Set up alerts for notification failures
6. **Scaling**: Consider message queuing for high-volume scenarios

## API Usage Example

```javascript
// Connect to WebSocket
const ws = new WebSocket('ws://localhost:3000/ws');

ws.on('message', (data) => {
  const event = JSON.parse(data);
  
  switch (event.type) {
    case 'opportunity.new':
      console.log(`New opportunities: ${event.opportunities.length}`);
      event.opportunities.forEach(opp => {
        console.log(`  - ${opp.id}: $${opp.profitEstimateUsd} profit`);
      });
      break;
      
    case 'health.breach':
      console.log(`Health breach: ${event.user} HF=${event.healthFactor}`);
      break;
      
    case 'liquidation.new':
      console.log(`New liquidations: ${event.liquidations.length}`);
      break;
  }
});
```

## License

MIT
