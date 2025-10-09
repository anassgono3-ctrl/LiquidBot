# diagnose-all.ts - Comprehensive Diagnostic Script

## Overview

The `diagnose-all.ts` script is a comprehensive diagnostic tool that validates all critical subsystems of the LiquidBot backend in a single run. It performs end-to-end checks on connectivity, data integrity, and service functionality.

## Purpose

This script helps ensure system health by:
- Validating environment configuration
- Testing subgraph connectivity and data retrieval
- Verifying Chainlink price feed integration
- Testing health factor computation
- Validating opportunity building pipeline
- Checking notification services
- Verifying WebSocket and metrics availability

## Usage

### Run with npm script
```bash
npm run diagnose
```

### Run directly with tsx
```bash
tsx scripts/diagnose-all.ts
```

### Run with custom environment
```bash
NODE_ENV=production tsx scripts/diagnose-all.ts
```

## Checks Performed

### 1. Environment Validation
- Parses and validates `CHAINLINK_FEEDS` configuration
- Shows symbol->address mapping for Chainlink feeds
- Warns about invalid or placeholder addresses
- Displays `GAS_COST_USD` and `PROFIT_MIN_USD` settings
- Checks for mock mode and critical missing credentials

### 2. Subgraph Connectivity
- Tests basic connectivity to The Graph Gateway
- Fetches `_meta { block { number } }` to verify endpoint health
- Retrieves sample liquidation calls to validate query execution
- Skipped when `USE_MOCK_SUBGRAPH=true`

### 3. Users Page Sanity Check
- Fetches user data using `getUsersPage(limit)` where limit = min(AT_RISK_SCAN_LIMIT||5, 50)
- Computes health factors locally for up to 5 users
- Classifies users by risk level using dust epsilon threshold
- Prints a formatted table showing:
  - User address
  - Health factor
  - Risk classification (NO_DEBT, DUST, OK, WARN, CRITICAL)
  - Total debt in ETH
- Skipped when `USE_MOCK_SUBGRAPH=true`

### 4. Chainlink Price Feeds
- For each symbol configured in `CHAINLINK_FEEDS`:
  - Connects to Chainlink aggregator contract via ethers
  - Calls `decimals()` to get price decimals
  - Calls `latestRoundData()` to fetch current price data
  - Computes price = answer / 10^decimals
  - Warns if answer <= 0 (invalid price)
  - Checks data freshness (warns if >1 hour old)
- Skipped when Chainlink is not configured

### 5. Health Factor Computation
- Fetches a sample user from the subgraph
- Computes health factor using `HealthCalculator`
- Validates calculation logic (HF should be > 0 if debt exists)
- Displays computed values:
  - Health factor
  - Total collateral (ETH)
  - Total debt (ETH)
  - At-risk status

### 6. Opportunity Building
- Fetches a recent liquidation event
- Builds an opportunity using `OpportunityService`
- Validates profit estimation and health factor attachment
- Displays opportunity details:
  - Opportunity ID
  - User address
  - Estimated profit (USD)
  - Health factor

### 7. Telegram Notification
- Checks if Telegram bot is enabled and configured
- Validates bot token and chat ID presence
- Does not send test messages (read-only check)

### 8. WebSocket Server
- Verifies WebSocket module can be loaded
- Checks that `initWebSocketServer` function is available
- Does not actually start a server (module validation only)

### 9. Metrics Registry
- Accesses Prometheus metrics registry
- Validates metrics can be exported
- Shows number of metric lines available

## Exit Codes

- **0**: All checks passed or completed with warnings only
- **1**: One or more checks failed

## Output Format

### Status Indicators
- ✓ **PASS** (green): Check completed successfully
- ⚠ **WARN** (yellow): Check completed with warnings or was skipped
- ✗ **FAIL** (red): Check failed

### Example Output
```
═══════════════════════════════════════════════════════════════════════════════
  Environment Validation
═══════════════════════════════════════════════════════════════════════════════

✓ Env Validation: PASS
    • CHAINLINK_FEEDS configured: ETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70
    •   ETH -> 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70
    • GAS_COST_USD: 0.5
    • PROFIT_MIN_USD: 10
    • GRAPH_API_KEY configured
```

## Common Issues

### Mock Mode Warnings
If you see multiple "Skipped (mock mode enabled)" warnings, ensure:
- `USE_MOCK_SUBGRAPH=false` in your `.env`
- Valid `GRAPH_API_KEY` and `SUBGRAPH_DEPLOYMENT_ID` are set

### Chainlink Price Feed Errors
If Chainlink checks fail:
- Verify `CHAINLINK_RPC_URL` is a valid Base RPC endpoint
- Check that feed addresses in `CHAINLINK_FEEDS` are correct
- Ensure the RPC endpoint is accessible and not rate-limited

### Subgraph Connection Failures
If subgraph checks fail:
- Verify your `GRAPH_API_KEY` is valid
- Check that the gateway endpoint is accessible
- Ensure you're not hitting rate limits
- Try testing with the header-mode endpoint format

### No Users Found
If the users page check shows no users:
- The Base Aave V3 market may have no active positions with debt
- This is normal for new or inactive markets
- Consider using a different subgraph deployment ID for testing

## Best Practices

1. **Run Before Deployment**: Always run diagnostics before deploying to production
2. **Regular Health Checks**: Schedule periodic diagnostic runs to catch configuration drift
3. **Post-Update Validation**: Run after any configuration or dependency updates
4. **CI/CD Integration**: Consider adding to CI pipeline for automated validation

## Related Scripts

- `verify-data.ts`: Detailed verification of liquidation data and HF calculations
- `risk-scan.ts`: Proactive scanning for at-risk positions

## Environment Variables

See `.env.example` for all configuration options. Key variables for diagnostics:
- `USE_MOCK_SUBGRAPH`: Enable/disable mock mode
- `GRAPH_API_KEY`: The Graph Gateway API key
- `CHAINLINK_RPC_URL`: RPC endpoint for Chainlink price feeds
- `CHAINLINK_FEEDS`: Comma-separated list of symbol:address pairs
- `AT_RISK_SCAN_LIMIT`: Number of users to fetch for sanity check
- `GAS_COST_USD`: Gas cost for profit estimation
- `PROFIT_MIN_USD`: Minimum profit threshold
