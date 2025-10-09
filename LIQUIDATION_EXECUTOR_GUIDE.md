# On-Chain Liquidation Executor - Quick Start Guide

This guide provides a quick overview of the on-chain liquidation executor implementation for LiquidBot.

## Overview

The executor atomically performs liquidations using:
1. **Balancer V2 flash loans** (0% fee) - Borrow debt asset
2. **Aave V3 liquidation** - Liquidate undercollateralized position
3. **1inch swap** - Convert seized collateral back to debt asset
4. **Profit distribution** - Repay loan and transfer profit

## Architecture

```
┌──────────────┐      ┌──────────────────┐      ┌──────────────┐
│   Backend    │─────▶│ LiquidationExecutor│◀────│ Balancer V2 │
│ ExecutionSvc │      │    (Contract)      │     │   Vault     │
└──────────────┘      └──────────────────┘      └──────────────┘
       │                      │                          
       │                      ├──────▶ Aave V3 Pool     
       │                      │                          
       ▼                      └──────▶ 1inch Router     
┌──────────────┐                                        
│ 1inch API    │                                        
│ (Swap Quote) │                                        
└──────────────┘                                        
```

## Files Added

### Smart Contracts (`contracts/`)
- `src/LiquidationExecutor.sol` - Main executor contract
- `src/interfaces/IBalancerVault.sol` - Balancer flash loan interface
- `src/interfaces/IFlashLoanRecipient.sol` - Flash loan callback interface
- `src/interfaces/IAavePool.sol` - Aave liquidation interface
- `src/interfaces/IAggregationRouterV6.sol` - 1inch router interface
- `src/interfaces/IERC20.sol` - Standard token interface
- `scripts/deploy-executor.ts` - Deployment script
- `test/LiquidationExecutor.test.ts` - Unit tests
- `hardhat.config.ts` - Hardhat configuration
- `package.json` - Dependencies and scripts

### Backend Services (`backend/`)
- `src/services/OneInchQuoteService.ts` - 1inch API integration
- `src/services/ExecutionService.ts` - Updated with real execution
- `tests/unit/OneInchQuoteService.test.ts` - Unit tests

### Configuration
- `backend/.env.example` - Updated with 11 new variables
- `backend/src/config/envSchema.ts` - Schema validation for new vars

### Documentation
- `README.md` - Added "On-Chain Executor" section
- `contracts/README.md` - Updated with implementation details
- `LIQUIDATION_EXECUTOR_GUIDE.md` - This guide

## Quick Deployment

### 1. Deploy Contract

```bash
cd contracts
npm install
npm run build:contracts

export RPC_URL=https://mainnet.base.org
export EXECUTION_PRIVATE_KEY=0x...

npm run deploy:executor
# Note the deployed address
```

### 2. Configure Backend

Add to `backend/.env`:

```bash
# Contract address from deployment
EXECUTOR_ADDRESS=0x...

# Execution credentials
EXECUTION_PRIVATE_KEY=0x...
RPC_URL=https://mainnet.base.org
CHAIN_ID=8453

# 1inch API (get from https://portal.1inch.dev)
ONEINCH_API_KEY=your_api_key

# Execution controls
EXECUTION_ENABLED=true
DRY_RUN_EXECUTION=true  # Test first!
MAX_SLIPPAGE_BPS=100    # 1%
```

### 3. Whitelist Assets

```bash
# Using cast (Foundry)
cast send $EXECUTOR_ADDRESS \
  "setWhitelist(address,bool)" \
  0x4200000000000000000000000000000000000006 \
  true \
  --private-key $EXECUTION_PRIVATE_KEY

# Whitelist common Base assets:
# WETH: 0x4200000000000000000000000000000000000006
# USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
# USDbC: 0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA
```

### 4. Fund Executor

```bash
# Send gas tokens (0.1 ETH recommended)
cast send $EXECUTOR_ADDRESS \
  --value 0.1ether \
  --private-key $EXECUTION_PRIVATE_KEY
```

### 5. Test in Dry-Run

```bash
cd backend
npm start

# Monitor logs - should see:
# [execution] DRY RUN simulation: ...
```

### 6. Enable Real Execution (When Ready)

```bash
# In backend/.env
DRY_RUN_EXECUTION=false
```

## Safety Features

### Smart Contract
- ✅ Owner-only execution
- ✅ Pausable circuit breaker
- ✅ Per-asset whitelist
- ✅ Slippage protection (minOut)
- ✅ Atomic transaction (reverts on failure)
- ✅ Emergency withdraw

### Backend
- ✅ Token blacklist
- ✅ Position size limits
- ✅ Daily loss limits
- ✅ After-gas profit threshold
- ✅ Gas price gating
- ✅ Dry-run testing mode

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `EXECUTOR_ADDRESS` | Yes | Deployed contract address |
| `EXECUTION_PRIVATE_KEY` | Yes | Private key for transactions |
| `RPC_URL` | Yes | Base RPC endpoint |
| `ONEINCH_API_KEY` | Yes | 1inch API key |
| `CHAIN_ID` | No | Chain ID (default: 8453) |
| `ONEINCH_BASE_URL` | No | 1inch API URL |
| `MAX_SLIPPAGE_BPS` | No | Max slippage (default: 100 = 1%) |
| `CLOSE_FACTOR_MODE` | No | auto or fixed (default: auto) |
| `EXECUTION_ENABLED` | No | Enable execution (default: false) |
| `DRY_RUN_EXECUTION` | No | Dry-run only (default: true) |
| `PRIVATE_BUNDLE_RPC` | No | Optional MEV relay URL |

## Testing

### Contract Tests
```bash
cd contracts
npm run test:contracts
```

Tests cover:
- Access control
- Whitelist management
- Pause functionality
- Configuration updates
- Input validation

### Backend Tests
```bash
cd backend
npm test
```

184 tests covering:
- OneInchQuoteService (swap quotes, error handling)
- ExecutionService (execution flow, dry-run)
- Risk management
- All other services

## Monitoring

### Check Executor Status
```bash
# Balance
cast balance $EXECUTOR_ADDRESS

# Owner
cast call $EXECUTOR_ADDRESS "owner()(address)"

# Paused?
cast call $EXECUTOR_ADDRESS "paused()(bool)"

# Is asset whitelisted?
cast call $EXECUTOR_ADDRESS "whitelistedAssets(address)(bool)" $ASSET
```

### Watch Logs
```bash
cd backend
npm start | tee logs/executor.log

# In another terminal
tail -f logs/executor.log | grep execution
```

### View Transactions
```bash
# Get transaction details
cast tx $TX_HASH --rpc-url $RPC_URL

# Get transaction receipt
cast receipt $TX_HASH --rpc-url $RPC_URL
```

## Troubleshooting

### Contract won't deploy
- Check RPC_URL is accessible
- Verify EXECUTION_PRIVATE_KEY has ETH for gas
- Ensure using correct network (Base mainnet = 8453)

### Execution fails with "1inch API key not configured"
- Set ONEINCH_API_KEY in .env
- Get key from https://portal.1inch.dev

### Execution fails with "AssetNotWhitelisted"
- Whitelist both collateral and debt assets
- Use setWhitelist(asset, true) from owner

### Transaction reverts
- Check executor has gas tokens (ETH)
- Verify minOut is reasonable (not too high)
- Ensure flash loan amount doesn't exceed available liquidity
- Check Aave liquidation is valid (user is actually liquidatable)

### Dry-run shows opportunity but real execution doesn't trigger
- Verify EXECUTION_ENABLED=true
- Verify DRY_RUN_EXECUTION=false
- Check risk controls (position size, profit threshold, gas price)
- Review logs for rejection reasons

## Production Checklist

Before enabling real execution:

- [ ] Contract deployed and verified on Base
- [ ] Owner is secure multisig or hardware wallet
- [ ] All expected assets whitelisted
- [ ] Executor funded with gas (0.1+ ETH)
- [ ] 1inch API key configured and tested
- [ ] Tested in dry-run mode with real opportunities
- [ ] Risk controls configured appropriately
- [ ] Gas cap set (MAX_GAS_PRICE_GWEI)
- [ ] Monitoring and alerting in place
- [ ] Emergency pause procedure documented
- [ ] Team trained on emergency response

## Support

For issues or questions:
1. Check logs for error messages
2. Review this guide and main README
3. Check contract test suite for examples
4. Review Solidity contract source code for details

## Protocol Addresses (Base)

- Balancer Vault: `0xBA12222222228d8Ba445958a75a0704d566BF2C8`
- Aave V3 Pool: `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`
- 1inch Router V6: `0x1111111254EEB25477B68fb85Ed929f73A960582`

## Resources

- [1inch API Documentation](https://docs.1inch.io/)
- [Balancer V2 Documentation](https://docs.balancer.fi/)
- [Aave V3 Documentation](https://docs.aave.com/developers/)
- [Base Network Documentation](https://docs.base.org/)
