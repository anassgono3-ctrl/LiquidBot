# Smart Contracts

Solidity contracts for LiquidBot liquidation protection and execution system on Aave V3 Base.

## Implemented Contracts

### LiquidationExecutor.sol ✅
Production-ready on-chain liquidation executor for Base.

**Features**:
- Balancer V2 flash loan integration (0% fee)
- Aave V3 liquidation call
- 1inch swap integration for collateral → debt
- Safety controls: Ownable, Pausable, asset whitelist
- Slippage protection via minOut parameter
- Emergency withdraw function

**Status**: ✅ Implemented and tested

**Deployment**:
```bash
npm install
npm run build:contracts
npm run deploy:executor
```

See deployment section below for details.

## Core System Contracts (Planned)

### FlashLoanOrchestrator.sol
Executes flash loan powered adjustments for position protection.

**Key Functions**:
- Execute refinancing operations
- Coordinate collateral swaps
- Manage partial deleveraging
- Handle emergency closures

**Status**: 🔜 Planned

### PositionManager.sol
Manages user enrollment and position registry.

**Key Functions**:
- User enrollment and unenrollment
- Position preference management
- Subscription tier tracking
- Position status queries

**Status**: 🔜 Planned

### CollateralOptimizer.sol
Handles collateral rebalancing and asset strategy optimization.

**Key Functions**:
- Calculate optimal collateral allocation
- Execute collateral swaps
- Minimize slippage on trades
- Support multi-asset strategies

**Status**: 🔜 Planned

### FeeCollector.sol
Aggregates fees and manages revenue distribution.

**Key Functions**:
- Collect subscription fees
- Collect intervention fees
- Distribute revenue to stakeholders
- Multi-sig controlled withdrawals

**Status**: 🔜 Planned

### EmergencyPause.sol
Circuit breaker for emergency situations.

**Key Functions**:
- System-wide pause mechanism
- Time-delayed unpause
- Multi-sig governance
- Selective feature pausing

**Status**: 🔜 Planned

## Development Setup

### Prerequisites
- Node.js 18+
- Hardhat
- Solidity 0.8.19+

### Installation
```bash
npm install
```

### Build
```bash
npm run build:contracts
```

This compiles all Solidity contracts using Hardhat.

### Testing

#### Unit Tests (Deterministic)

Run deterministic unit tests with mock contracts:

```bash
npm run test
# or
npm run contracts:test
```

These tests use mock contracts (MockERC20, MockBalancerVault, MockAavePool, MockOneInchRouter) to provide deterministic, fast test execution with no external dependencies.

**Test Coverage:**
- ✅ Happy path: Full liquidation flow (flashLoan → liquidate → swap → repay → profit)
- ✅ Slippage guard: Revert if swap output < minOut
- ✅ Pause functionality: Block execution when paused
- ✅ Whitelist enforcement: Only whitelisted collateral/debt pairs
- ✅ Approval flows: Correct ERC20 approvals
- ✅ Event assertions: LiquidationExecuted with exact profit (within 1 wei)
- ✅ Access control: Owner-only operations
- ✅ Configuration management: Address setters with validation
- ✅ Input validation: Zero address checks

#### E2E Local Test

Run a complete end-to-end test with mock contracts:

```bash
npm run e2e:local
```

This script deploys all mocks (Balancer Vault, Aave Pool, 1inch Router, ERC20 tokens), deploys the executor, creates a liquidatable position, and executes the full liquidation flow. It asserts:
- ✅ LiquidationExecuted event emitted
- ✅ Exact profit calculation (5% liquidation bonus)
- ✅ Flash loan fully repaid
- ✅ Profit transferred to payout address
- ✅ No leftover tokens in executor

This is the **recommended one-command test** for validating the entire system locally.

#### Fork Tests (Optional)

Run Base mainnet fork tests to validate protocol integrations:

```bash
export RPC_URL=https://mainnet.base.org  # or your Base RPC URL
npm run test:fork
# or
npm run contracts:test:fork
```

Fork tests **auto-skip** if `RPC_URL` is not configured. They validate:
- ✅ Deployment on Base fork
- ✅ Protocol address validation (Balancer, Aave, 1inch are contracts)
- ✅ Contract configuration and state management
- ✅ Whitelist operations on fork
- ✅ Pause/unpause on fork
- ✅ Call path preparation (no real execution)

**Note:** Fork tests do NOT execute real liquidations or rely on real liquidity. They only validate the wiring and call paths with actual protocol contracts.

#### E2E Fork Test

Run an end-to-end integration test with real Base protocol addresses:

```bash
export RPC_URL=https://mainnet.base.org  # or your Base RPC URL
npm run e2e:fork
```

This script:
- Deploys the executor to a forked Base network
- Verifies real protocol contracts exist (Balancer, Aave, 1inch)
- Validates configuration and state management
- Tests whitelist and pause functionality

**Auto-skips** if `RPC_URL` is not set. Useful for validating call-path wiring with real Base addresses.

#### Run All Tests

```bash
npm run test:all
```

Runs both unit tests and fork tests (fork tests auto-skip if no RPC_URL).

#### Environment Setup

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
# Edit .env and add your configuration
```

Example `.env`:
```bash
# RPC URL for fork tests and deployment
RPC_URL=https://mainnet.base.org
# Or use a provider like Alchemy:
# RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR-API-KEY

# Private key for deployment (without 0x prefix)
EXECUTION_PRIVATE_KEY=your_private_key_here

# Basescan API key for contract verification
ETHERSCAN_API_KEY=your_basescan_api_key

# Optional: Override protocol addresses (defaults to Base mainnet)
BALANCER_VAULT_ADDRESS=0xBA12222222228d8Ba445958a75a0704d566BF2C8
AAVE_V3_POOL_ADDRESS=0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
ONEINCH_ROUTER_ADDRESS=0x1111111254EEB25477B68fb85Ed929f73A960582

# Payout default address (for verification helper)
PAYOUT_DEFAULT=0xYourPayoutAddress
```

### Deployment

Deploy the LiquidationExecutor to Base:

```bash
# Configure environment
export RPC_URL=https://mainnet.base.org
export EXECUTION_PRIVATE_KEY=0x...

# Deploy to Base mainnet
npm run deploy:executor
```

The deployment script outputs:
- Deployed contract address
- Protocol addresses (Balancer, Aave, 1inch)
- Next steps for configuration

### Verification on Basescan

After deployment, verify your contract on Basescan:

```bash
# Set your Basescan API key
export ETHERSCAN_API_KEY=your_basescan_api_key

# Verify with auto-detected constructor args
npm run verify:executor -- --network base --address 0xYourDeployedAddress --payout-default 0xYourPayoutAddress
```

**Options:**
- `--network <network>` - Network to verify on (default: base)
- `--address <address>` - Contract address to verify (required)
- `--balancer-vault <address>` - Override Balancer Vault address
- `--aave-pool <address>` - Override Aave Pool address  
- `--oneinch-router <address>` - Override 1inch Router address
- `--payout-default <address>` - Payout default address (required)
- `--contract <path>` - Contract path for disambiguation

**Environment Variables:**
- `ETHERSCAN_API_KEY` or `BASESCAN_API_KEY` - API key for verification
- `BALANCER_VAULT_ADDRESS` - Default Balancer Vault address
- `AAVE_V3_POOL_ADDRESS` - Default Aave Pool address
- `ONEINCH_ROUTER_ADDRESS` - Default 1inch Router address
- `PAYOUT_DEFAULT` - Default payout address

**Troubleshooting Verification:**

1. **Missing constructor args**: The helper script auto-infers constructor arguments from environment variables or uses Base mainnet defaults. Ensure `--payout-default` matches the address used during deployment.

2. **API key issues**: Get your API key from [Basescan](https://basescan.org/myapikey) and set it in your `.env` file:
   ```bash
   ETHERSCAN_API_KEY=your_basescan_api_key
   ```

3. **Contract disambiguation**: If you have multiple contracts with the same name, use the `--contract` flag:
   ```bash
   npm run verify:executor -- --network base --address 0x... --payout-default 0x... --contract contracts/src/LiquidationExecutor.sol:LiquidationExecutor
   ```

4. **Already verified**: If the contract is already verified, Basescan will return an error. This is expected behavior.

## Contract Addresses (Base)

### External Protocols
- **Balancer Vault**: `0xBA12222222228d8Ba445958a75a0704d566BF2C8`
- **Aave V3 Pool**: `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`
- **1inch Aggregation Router V6**: `0x1111111254EEB25477B68fb85Ed929f73A960582`

### Configuration After Deployment

```solidity
// 1. Whitelist assets
executor.setWhitelist(WETH, true);
executor.setWhitelist(USDC, true);
executor.setWhitelist(DAI, true);

// 2. Fund executor with gas
// Send 0.1+ ETH to executor address

// 3. Set EXECUTOR_ADDRESS in backend .env
EXECUTOR_ADDRESS=0x...deployed_address
```

## Security

### LiquidationExecutor Safety Features

1. **Access Control**: Only owner can initiate liquidations and configure
2. **Pausable**: Owner can pause all operations via circuit breaker
3. **Asset Whitelist**: Only whitelisted collateral/debt assets allowed
4. **Slippage Protection**: Enforces minimum output from swaps (minOut)
5. **Atomic Execution**: Transaction reverts on any failure
6. **Emergency Withdraw**: Owner can recover stuck tokens

### Best Practices

- Contract owner should be a secure multisig or hardware wallet
- Test thoroughly in dry-run mode before enabling real execution
- Monitor executor balance and transactions
- Keep whitelist updated as protocol assets change
- Use pause function during maintenance or emergencies

### Security Considerations

All contracts should undergo:
- Comprehensive unit testing (95%+ coverage target)
- Integration testing with Aave V3 contracts
- External security audit before mainnet deployment
- Bug bounty program post-launch

## Documentation

Smart contracts will include:
- NatSpec comments for all public functions
- Detailed inline comments for complex logic
- Architecture diagrams
- Integration guides

## References

- [Aave V3 Technical Paper](https://github.com/aave/aave-v3-core/blob/master/techpaper/Aave_V3_Technical_Paper.pdf)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
- [Solidity Best Practices](https://consensys.github.io/smart-contract-best-practices/)

## License

See [LICENSE](../LICENSE) in the root directory.
