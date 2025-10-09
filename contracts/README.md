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
```bash
npm run test:contracts
```

Runs the Hardhat test suite. Current test coverage includes:
- LiquidationExecutor access control
- Whitelist management
- Pause functionality
- Configuration management
- Input validation

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
