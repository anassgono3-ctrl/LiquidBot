# TWAP Pool Discovery Guide

This guide explains how to use the `discover-twap-pools.mjs` script to find optimal Uniswap V3 pools for TWAP-based price sanity checking on Base.

## Overview

The discovery script:
- Queries the Uniswap V3 Factory on Base for pools matching your target assets
- Checks multiple quote tokens (USDC, WETH) and fee tiers (0.05%, 0.3%, 1%)
- Ranks pools by liquidity to identify the most reliable price sources
- Outputs a ready-to-paste `TWAP_POOLS` configuration string

## Prerequisites

- **RPC Access**: You need a Base RPC endpoint (e.g., `https://mainnet.base.org`)
- **Node.js**: Version 18.18.0 or higher
- **Dependencies**: Run `npm install` in the `backend` directory first

## Basic Usage

### Default Discovery (Base-Native Assets)

The script defaults to discovering pools for Base-native assets: WETH, cbETH, cbBTC, and weETH.

```bash
cd backend
RPC_URL=https://mainnet.base.org node scripts/discover-twap-pools.mjs
```

### Custom Asset Discovery

Use the `--assets` flag to specify custom assets:

```bash
RPC_URL=https://mainnet.base.org node scripts/discover-twap-pools.mjs --assets WETH,cbETH,WBTC
```

### Custom Quote Tokens

By default, the script checks USDC and WETH as quote tokens. Override with `--quotes`:

```bash
RPC_URL=https://mainnet.base.org node scripts/discover-twap-pools.mjs --quotes USDC,WETH,DAI
```

### Custom Fee Tiers

Override fee tiers with `--feeTiers` (values in basis points):

```bash
RPC_URL=https://mainnet.base.org node scripts/discover-twap-pools.mjs --feeTiers 500,3000
```

### Combining Options

You can combine multiple options:

```bash
RPC_URL=https://mainnet.base.org node scripts/discover-twap-pools.mjs \
  --assets WETH,cbETH \
  --quotes USDC \
  --feeTiers 500,3000 \
  --timeoutMs 15000
```

## Environment Variables

The script supports the following environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `RPC_URL` | Base RPC endpoint | **(required)** |
| `TWAP_TARGETS` | Comma-separated asset symbols | `WETH,cbETH,cbBTC,weETH` |
| `AAVE_PROTOCOL_DATA_PROVIDER` | Address for Aave reserve token resolution | `0xC4Fcf9893072d61Cc2899C0054877Cb752587981` |
| `MIN_LIQUIDITY` | Minimum pool liquidity threshold | `0` |

## Understanding the Output

The script produces two types of output:

### 1. Discovery Summary

During execution, you'll see verbose progress logs:

```
📊 Discovering pools for WETH...
------------------------------------------------------------
Token Address: 0x4200000000000000000000000000000000000006
  Checking WETH/USDC pools...
    ✅ Fee 500: Found pool 0x4C36388bE6... (liquidity: 123456789)
    Fee 3000: No pool found
    Fee 10000: No pool found

  🏆 Best pool for WETH:
     Address: 0x4C36388bE6F416A29C8d8Eee81C771cE6bE14B18
     Quote: USDC
     Fee: 500
     Liquidity: 123456789
     Observation Cardinality: 1000
```

### 2. Ready-to-Paste Configuration

At the end, you'll get a `TWAP_POOLS` configuration string:

```
✅ Ready-to-paste TWAP_POOLS configuration:

TWAP_POOLS='[{"symbol":"WETH","pool":"0x4C36388bE6F416A29C8d8Eee81C771cE6bE14B18","dex":"uniswap_v3","fee":500,"quote":"USDC"},{"symbol":"cbETH","pool":"0x...","dex":"uniswap_v3","fee":3000,"quote":"WETH"}]'
```

## Using the Output

### Step 1: Copy the Configuration

Copy the entire `TWAP_POOLS='...'` line from the script output.

### Step 2: Add to .env File

Paste it into your backend `.env` file:

```bash
# TWAP Sanity Check Configuration
TWAP_ENABLED=true
TWAP_WINDOW_SEC=300
TWAP_DELTA_PCT=0.012
TWAP_POOLS='[{"symbol":"WETH","pool":"0x4C36388bE6F416A29C8d8Eee81C771cE6bE14B18","dex":"uniswap_v3","fee":500,"quote":"USDC"}]'
```

### Step 3: Restart the Service

Restart your liquidation bot to load the new TWAP configuration:

```bash
npm run dev
# or
npm run start
```

## Common Pitfalls

### 1. RPC Rate Limits

**Problem**: The script makes multiple RPC calls and may hit rate limits on public endpoints.

**Solution**: 
- Use a dedicated RPC provider (Alchemy, Infura, QuickNode)
- Increase `--timeoutMs` to handle slower responses
- Reduce the number of assets/fee tiers being queried

### 2. Token Resolution Case Sensitivity

**Problem**: Token symbols are case-insensitive in the script but may not match exactly in the Aave data provider.

**Solution**: The script automatically converts symbols to uppercase. If resolution fails:
1. Check the exact symbol in the Aave UI or contract
2. Verify the token is listed on Base
3. Add the token address manually to the `BASE_TOKENS` object in the script

### 3. No Pools Found

**Problem**: The script reports "No pools found" for your target asset.

**Possible Causes**:
- The asset doesn't have a Uniswap V3 pool on Base
- The pool exists but with a different fee tier (try `--feeTiers 100,500,3000,10000`)
- The pool exists but with a different quote token (try `--quotes USDC,WETH,DAI,USDbC`)

**Solution**:
1. Verify the asset has liquidity on Uniswap V3 Base using the Uniswap analytics page
2. Expand your search with more fee tiers and quote tokens
3. If no pool exists, consider using Chainlink or Pyth price feeds instead

### 4. BigInt Serialization Errors

**Problem**: Older versions of the script fail with `TypeError: Do not know how to serialize a BigInt`.

**Solution**: This has been fixed in the current version. The script now uses `safeStringify()` to handle BigInt values correctly. Update to the latest version if you encounter this error.

### 5. Pool Has Low Liquidity

**Problem**: The discovered pool has very low liquidity and may not provide reliable prices.

**Solution**:
- Set `MIN_LIQUIDITY` environment variable to filter out low-liquidity pools:
  ```bash
  MIN_LIQUIDITY=1000000000000 RPC_URL=https://mainnet.base.org node scripts/discover-twap-pools.mjs
  ```
- Check alternative quote tokens or fee tiers for deeper pools
- Consider using multiple price sources (Chainlink + TWAP) for validation

### 6. Observation Cardinality Too Low

**Problem**: The pool's observation cardinality is insufficient for TWAP calculations.

**Observation**: The script displays the cardinality in the summary. Uniswap V3 TWAPs require sufficient observations for the desired time window. For a 5-minute TWAP window with 12-second blocks (typical on Ethereum mainnet), you need approximately 300 seconds / 12 seconds = 25 observations. Base has faster blocks (~2 seconds), so a 5-minute window needs ~150 observations. A cardinality of at least 1000 provides a good buffer.

**Solution**:
- If cardinality is too low, the pool owner needs to increase it on-chain (not something you can do)
- Look for alternative pools with higher cardinality
- Reduce `TWAP_WINDOW_SEC` in your `.env` to match available observations

## Advanced Usage

### Filtering by Minimum Liquidity

Only include pools with at least 1M units of liquidity:

```bash
MIN_LIQUIDITY=1000000 RPC_URL=https://mainnet.base.org node scripts/discover-twap-pools.mjs
```

### Using a Custom Aave Data Provider

If you need to resolve tokens from a different Aave deployment:

```bash
AAVE_PROTOCOL_DATA_PROVIDER=0x... RPC_URL=https://mainnet.base.org node scripts/discover-twap-pools.mjs
```

### Discovering Pools for Testnets

The script can be adapted for Base Sepolia or other testnets by:
1. Using a testnet RPC URL
2. Updating the `UNISWAP_V3_FACTORY` address in the script
3. Updating the `BASE_TOKENS` addresses for testnet tokens

## Troubleshooting

### Enable Verbose Logging

The script already includes verbose logging by default. Each query shows:
- Token address resolution
- Pool discovery per quote/fee combination
- Pool metrics (liquidity, cardinality)
- Final ranking and selection

### Verify RPC Connectivity

Test your RPC connection:

```bash
curl -X POST https://mainnet.base.org \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### Check Factory Address

Verify the Uniswap V3 Factory address is correct for Base:

```bash
# Expected: 0x33128a8fC17869897dcE68Ed026d694621f6FDfD
```

## Best Practices

1. **Run discovery periodically**: Pool liquidity changes over time. Re-run the script monthly to ensure you're using the most liquid pools.

2. **Validate pool cardinality**: Always check that `observationCardinality` is sufficient for your TWAP window (typically ≥1000 is good).

3. **Compare multiple sources**: Use TWAP as a sanity check alongside Chainlink and Pyth, not as the primary price source.

4. **Monitor for anomalies**: Set `TWAP_DELTA_PCT` conservatively (1-2%) to catch oracle manipulation attempts.

5. **Document your configuration**: Keep a record of when you last ran discovery and which pools you selected.

## Example Workflow

Here's a complete workflow for setting up TWAP:

```bash
# 1. Navigate to backend directory
cd backend

# 2. Run discovery for your target assets
RPC_URL=https://mainnet.base.org node scripts/discover-twap-pools.mjs \
  --assets WETH,cbETH,cbBTC \
  --quotes USDC,WETH

# 3. Copy the output to your .env file
# Output: TWAP_POOLS='[...]'

# 4. Enable TWAP in .env
echo "TWAP_ENABLED=true" >> .env
echo "TWAP_WINDOW_SEC=300" >> .env
echo "TWAP_DELTA_PCT=0.012" >> .env

# 5. Restart the service
npm run dev

# 6. Monitor logs for TWAP sanity check results
```

## Additional Resources

- [Uniswap V3 Factory on Base](https://basescan.org/address/0x33128a8fC17869897dcE68Ed026d694621f6FDfD)
- [Uniswap V3 Pool Documentation](https://docs.uniswap.org/contracts/v3/reference/core/UniswapV3Pool)
- [TWAP Oracle Guide](https://docs.uniswap.org/contracts/v3/guides/oracle/oracle)
- [Base Network Documentation](https://docs.base.org)

## Support

If you encounter issues not covered in this guide:
1. Check the script's console output for error messages
2. Verify all prerequisites are met
3. Review the RPC provider's status and rate limits
4. Consult the main `.env.example` for reference configurations
