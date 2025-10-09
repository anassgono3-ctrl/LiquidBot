# Testing Guide for LiquidBot Contracts

This document provides detailed information about testing the smart contracts.

## Prerequisites

- Node.js 18+
- npm 9+
- Internet connection (for initial Solidity compiler download)

## Quick Start

```bash
# Install dependencies
npm install

# Compile contracts
npm run build

# Run unit tests (deterministic, no external dependencies)
npm run test

# Run fork tests (requires RPC_URL)
export RPC_URL=https://mainnet.base.org
npm run test:fork
```

## Test Suite Overview

### 1. Unit Tests with Mocks

**Files:**
- `test/LiquidationExecutor.test.ts` - Original basic tests
- `test/LiquidationExecutor.unit.test.ts` - Comprehensive unit tests
- `test/mocks/*.sol` - Mock contracts (ERC20, Balancer, Aave, 1inch)

**Coverage:**
- ✅ **Happy Path**: Complete liquidation flow
  - Flash loan from Balancer Vault
  - Liquidation call to Aave V3
  - Swap via 1inch
  - Flash loan repayment
  - Profit transfer to payout address
  
- ✅ **Slippage Protection**: Reverts when swap output < minOut
  
- ✅ **Pause Functionality**: Blocks execution when paused
  
- ✅ **Whitelist Enforcement**: Only whitelisted assets allowed
  
- ✅ **Approval Flows**: Correct ERC20 approvals for Aave and 1inch
  
- ✅ **Event Assertions**: LiquidationExecuted emits with exact profit (within 1 wei tolerance)
  
- ✅ **Access Control**: Owner-only operations enforced
  
- ✅ **Configuration**: Address setters with zero-address validation

**Mock Contracts:**

All mocks are deterministic and self-contained:

- `MockERC20`: Simple ERC20 with mint, transfer, approve
- `MockBalancerVault`: Flash loan with 0% fee (Balancer standard)
- `MockAavePool`: Liquidation with configurable bonus (default 5%)
- `MockOneInchRouter`: Swap with configurable exchange rate (default 1:1)

### 2. Fork Tests (Optional)

**Files:**
- `test/LiquidationExecutor.fork.test.ts` - Base mainnet fork tests

**Purpose:**
- Validate contract deployment on Base fork
- Verify protocol addresses are contracts
- Test configuration operations on fork
- Validate call paths (no real execution)

**Auto-Skip Behavior:**
Fork tests automatically skip if `RPC_URL` is not configured. You'll see:
```
⏭️  Skipping fork tests: RPC_URL not configured
```

**Running Fork Tests:**

```bash
# Option 1: Environment variable
export RPC_URL=https://mainnet.base.org
npm run test:fork

# Option 2: Using .env file
cp .env.example .env
# Edit .env and set RPC_URL
npm run test:fork
```

**Important Notes:**
- Fork tests do NOT rely on real liquidity
- Fork tests do NOT execute actual liquidations
- Fork tests only validate wiring and call paths
- Fork tests use timeouts of 60s to handle RPC latency

## Environment Configuration

### Local Development

Create a `.env` file:

```bash
# For fork tests
RPC_URL=https://mainnet.base.org

# For deployment (not needed for tests)
PRIVATE_KEY=0x...
EXECUTION_PRIVATE_KEY=0x...
BASESCAN_API_KEY=...
```

### CI/CD

Fork tests in CI are controlled by the `BASE_FORK_URL` secret:
- If set: Fork tests run
- If not set: Fork tests are skipped

No configuration needed for unit tests in CI.

## Test Execution

### Run All Tests

```bash
npm test
```

This runs both `LiquidationExecutor.test.ts` and `LiquidationExecutor.unit.test.ts`.

### Run Specific Test File

```bash
npx hardhat test test/LiquidationExecutor.unit.test.ts
```

### Run Specific Test Case

```bash
npx hardhat test test/LiquidationExecutor.unit.test.ts --grep "Happy Path"
```

### Verbose Output

```bash
HARDHAT_VERBOSE=1 npm test
```

## Troubleshooting

### Compiler Download Issues

If you see "Couldn't download compiler version list", this is a network issue. Hardhat needs to download the Solidity compiler on first compile.

**Solutions:**
1. Check your internet connection
2. Try using a VPN if the download site is blocked
3. Clear Hardhat cache: `rm -rf cache/ artifacts/`
4. Pre-download compiler: The compiler is downloaded automatically on first compile

### Fork Tests Not Running

**Symptom:** Tests are skipped even with RPC_URL set

**Check:**
1. Is RPC_URL exported? `echo $RPC_URL`
2. Is the URL valid and accessible?
3. Does your RPC provider support forking?

### Test Failures

**Mock-related failures:**
- Ensure mocks are compiled: `npm run build`
- Check that test setup properly mints tokens to mocks

**Fork test failures:**
- Verify RPC_URL is for Base mainnet (chain ID 8453)
- Check protocol addresses are correct
- Ensure RPC provider has historical state access

## Test Structure Best Practices

Our tests follow these principles:

1. **Determinism**: Unit tests use mocks for 100% deterministic results
2. **Isolation**: Each test is independent with fresh setup
3. **Clarity**: Test names describe exact behavior being tested
4. **Coverage**: Happy path, error cases, edge cases all covered
5. **Speed**: Unit tests run in seconds without network calls
6. **Documentation**: Tests serve as executable specifications

## Adding New Tests

### Adding a Unit Test

1. Add test case to `test/LiquidationExecutor.unit.test.ts`
2. Use existing mocks or create new ones in `test/mocks/`
3. Follow the existing pattern: setup → execute → assert
4. Ensure test is deterministic (no external dependencies)

Example:
```typescript
it("should test new behavior", async function () {
  // Setup: Prepare mocks and state
  await debtToken.mint(await mockVault.getAddress(), amount);
  
  // Execute: Call contract function
  await executor.someFunction(params);
  
  // Assert: Verify expected outcome
  expect(await executor.someState()).to.equal(expectedValue);
});
```

### Adding a Fork Test

1. Add test case to `test/LiquidationExecutor.fork.test.ts`
2. Use increased timeout: `this.timeout(60000)`
3. Test contract interactions with real protocol addresses
4. Do NOT rely on real liquidity or execute real liquidations

## Continuous Integration

Our CI workflow:
1. Installs dependencies
2. Compiles contracts
3. Runs unit tests (always)
4. Runs fork tests (if BASE_FORK_URL secret is set)

Fork tests are optional in CI - they provide additional confidence but are not required for merge.

## Coverage Goals

Target coverage levels:
- Unit tests: 95%+ statement coverage
- Branch coverage: 90%+
- All critical paths tested (happy path, errors, edge cases)
- All events verified with exact parameter assertions

Current coverage:
- ✅ All critical functions tested
- ✅ All error conditions tested
- ✅ All events asserted
- ✅ Profit calculations verified (within 1 wei)

## Related Documentation

- [Main README](../README.md) - Overall project documentation
- [Contracts README](./README.md) - Contract-specific information
- [Backend Tests](../backend/tests/) - Backend service tests
- [CI Workflow](../.github/workflows/ci.yml) - CI configuration
