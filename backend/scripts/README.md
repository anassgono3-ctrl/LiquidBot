# Oracle Validation & TWAP Discovery Tools

This directory contains utility scripts for validating and configuring the Pyth + TWAP early-warning flow introduced in PR #161.

## Available Scripts

### 1. Oracle Validation (`check-oracles.ts`)

Validates Pyth, Chainlink, and TWAP oracle wiring end-to-end.

**Quick Start:**
```bash
npm run check:oracles
```

**Documentation:** [README-oracle-check.md](./README-oracle-check.md)

**Use Cases:**
- Pre-deployment validation
- CI/CD health checks
- Scheduled monitoring
- Manual verification before mainnet

### 2. TWAP Pool Discovery (`discover-twap-pools.ts`)

Discovers and recommends Uniswap V3 pools for TWAP validation.

**Quick Start:**
```bash
npm run discover:twap
```

**Documentation:** [README-twap-discovery.md](./README-twap-discovery.md)

**Use Cases:**
- Finding liquid pools for TWAP validation
- Generating ready-to-paste TWAP_POOLS config
- Pool selection for new assets

## Workflow

1. **Discover Pools:**
   ```bash
   npm run discover:twap -- --symbols WETH,cbETH,cbBTC,weETH
   ```
   Copy the `TWAP_POOLS` output to your `.env`

2. **Validate Configuration:**
   ```bash
   npm run check:oracles
   ```
   Verify all oracle sources are healthy

3. **Enable Features:**
   ```bash
   PYTH_ENABLED=true
   TWAP_ENABLED=true
   PRE_SUBMIT_ENABLED=true
   ```

4. **Monitor:**
   - Watch logs for TWAP sanity failures
   - Schedule periodic `check:oracles` runs
   - Adjust thresholds based on observed behavior

## Related Documentation

- [params.md](../../docs/params.md) - Full configuration reference
- [PR #161](https://github.com/anassgono3-ctrl/LiquidBot/pull/161) - Pre-submit liquidation pipeline

## Other Scripts

This directory also contains various other utility scripts for:

- Chainlink feed validation: `check-ocr2-feeds.mjs`
- Chainlink aggregator auditing: `audit-chainlink-aggregators.mjs`
- Price trigger validation: See `README-price-trigger-validation.md`
- Health factor harness: See `README-hf-harness.md`
- Diagnostics: See `README-diagnose-all.md`

Run `npm run` to see all available scripts.
