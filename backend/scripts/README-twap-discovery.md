# TWAP Pool Discovery Tool

## Overview

The `discover-twap-pools.ts` script helps you discover and recommend Uniswap V3 pools on Base that are suitable for TWAP (Time-Weighted Average Price) validation. It queries the Uniswap V3 factory, filters pools by liquidity, and outputs ready-to-paste configuration for your `.env` file.

## Purpose

When enabling the Pyth + TWAP early-warning flow (introduced in PR #161), you need to configure TWAP pools to validate price feeds against on-chain DEX data. Manually finding suitable pools with sufficient liquidity is time-consuming. This tool automates that process.

## Usage

### Basic Usage

```bash
npm run discover:twap
```

This will discover TWAP pools for the default assets (`WETH`, `cbETH`, `cbBTC`, `weETH`) using default quote currencies (`USDC`, `WETH`) and fee tiers (0.05%, 0.30%, 1.00%).

### Custom Assets

```bash
npm run discover:twap -- --symbols WETH,cbETH,cbBTC,weETH
```

### Custom Quote Currencies

```bash
npm run discover:twap -- --quotes USDC,WETH
```

### Custom Fee Tiers

```bash
npm run discover:twap -- --fees 500,3000,10000
```

Fee tiers are specified in hundredths of a basis point:
- `500` = 0.05%
- `3000` = 0.30%
- `10000` = 1.00%

### Minimum Liquidity Filter

```bash
npm run discover:twap -- --min-liquidity 100000
```

This filters out pools with liquidity below the specified threshold.

### Verbose Output

```bash
npm run discover:twap -- --verbose
```

Shows detailed information about each pool discovery attempt, including pools that were filtered out.

## Output

The script outputs:

1. **Best Pool Per Asset**: Ranked by liquidity, showing pool address, quote currency, fee tier, and configuration.

2. **Ready-to-Paste Configuration**: A `TWAP_POOLS` JSON string that you can copy directly into your `.env` file.

3. **Missing Assets**: Lists assets for which no suitable pools were found, with suggestions to use Chainlink direct feeds instead.

### Example Output

```
🔍 TWAP Pool Discovery Tool

Assets: WETH, cbETH, cbBTC, weETH
Quote currencies: USDC, WETH
Fee tiers: 0.05%, 0.3%, 1%

✅ RPC connected: Block 12345678

Discovering pools...

━━━ TWAP Pool Recommendations ━━━

Best pools per asset:

WETH:
  Pool: 0xd0b53D9277642d899DF5C87A3966A349A798F224
  Quote: USDC
  Fee tier: 0.05%
  Liquidity: 1234567890
  Token0 is asset: true

cbETH:
  Pool: 0x...
  Quote: WETH
  Fee tier: 0.3%
  Liquidity: 987654321
  Token0 is asset: false

━━━ Ready-to-Paste Configuration ━━━

TWAP_POOLS='[{"symbol":"WETH","pool":"0xd0b53D9277642d899DF5C87A3966A349A798F224","dex":"uniswap_v3","token0IsAsset":true},{"symbol":"cbETH","pool":"0x...","dex":"uniswap_v3","token0IsAsset":false}]'

Add this to your .env file to enable TWAP validation.
```

## Configuration

The script reads these environment variables:

- **`RPC_URL`** (required): Base RPC endpoint for on-chain queries
- **`PYTH_ASSETS`**: Default assets to discover (if `--symbols` not provided)
- **`PRICE_TRIGGER_ASSETS`**: Fallback if `PYTH_ASSETS` not set

## How It Works

1. **Query Uniswap V3 Factory**: For each asset-quote-fee combination, queries the factory to get the pool address.

2. **Filter by Liquidity**: Fetches pool liquidity and filters out pools below the minimum threshold.

3. **Rank Pools**: Sorts pools by liquidity (higher is better) and quote preference (USDC preferred over WETH).

4. **Select Best**: Chooses the best pool per asset for the ready-to-paste configuration.

5. **Generate Output**: Formats the configuration as JSON for easy copy-paste into `.env`.

## Caveats

- **Liquidity != TVL**: The script uses raw liquidity as a proxy for pool quality. For production use, consider computing actual TVL using Chainlink price feeds.

- **No Manipulation Check**: The tool doesn't validate whether discovered pools are safe from manipulation. Always review pools manually before use.

- **Base Network Only**: Currently hardcoded for Base network. Token addresses are specific to Base.

- **Uniswap V3 Only**: Only discovers Uniswap V3 pools. Other DEXes (SushiSwap, Curve) are not supported.

## Troubleshooting

### No pools found

- Try lowering `--min-liquidity` threshold
- Try different quote currencies with `--quotes`
- Try different fee tiers with `--fees`
- Some assets may not have liquid pools; use Chainlink direct feeds instead

### RPC connection failed

- Ensure `RPC_URL` is set in `.env`
- Check that your RPC provider is accessible
- Verify your API key if using a paid provider (Alchemy, QuickNode, etc.)

### Unknown token address

- The script uses hardcoded token addresses for Base
- If you need to discover pools for unlisted tokens, add their addresses to `TOKEN_ADDRESSES` in the script

## Next Steps

After discovering pools:

1. Copy the `TWAP_POOLS` configuration to your `.env` file
2. Set `TWAP_ENABLED=true`
3. Configure `TWAP_WINDOW_SEC` (default: 300s = 5 minutes)
4. Configure `TWAP_DELTA_PCT` (default: 0.012 = 1.2% deviation threshold)
5. Run `npm run check:oracles` to validate the configuration
6. Monitor TWAP sanity check logs in production to detect anomalies

## See Also

- [Oracle Check Tool](./README-oracle-check.md): Validate Pyth, Chainlink, and TWAP wiring
- [params.md](../../docs/params.md): Full parameter documentation
- [PR #161](https://github.com/anassgono3-ctrl/LiquidBot/pull/161): Pre-submit liquidation pipeline
