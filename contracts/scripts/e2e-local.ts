import { ethers } from "hardhat";
import { expect } from "chai";

/**
 * E2E Local Test Script
 * 
 * This script performs a complete end-to-end liquidation test using mock contracts.
 * It validates the entire flow: flash loan -> liquidation -> swap -> repay -> profit.
 * 
 * Run: npm run e2e:local
 */

async function main() {
  console.log("=".repeat(80));
  console.log("E2E Local Test: LiquidationExecutor Full Flow");
  console.log("=".repeat(80));
  console.log();

  // Deploy mock contracts
  console.log("📦 Step 1: Deploying mock contracts...");
  const [deployer, user, payout] = await ethers.getSigners();
  console.log("  Deployer:", deployer.address);
  console.log("  Test User:", user.address);
  console.log("  Payout Address:", payout.address);
  console.log();

  // Deploy mock tokens
  console.log("  Deploying MockERC20 tokens...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const collateralToken = await MockERC20.deploy("Wrapped Ether", "WETH", 18);
  await collateralToken.waitForDeployment();
  const debtToken = await MockERC20.deploy("USD Coin", "USDC", 6);
  await debtToken.waitForDeployment();
  
  const collateralAddress = await collateralToken.getAddress();
  const debtAddress = await debtToken.getAddress();
  
  console.log("    ✓ Collateral Token (WETH):", collateralAddress);
  console.log("    ✓ Debt Token (USDC):", debtAddress);

  // Deploy mock protocols
  console.log("  Deploying mock protocol contracts...");
  const MockBalancerVault = await ethers.getContractFactory("MockBalancerVault");
  const mockVault = await MockBalancerVault.deploy();
  await mockVault.waitForDeployment();
  const vaultAddress = await mockVault.getAddress();
  console.log("    ✓ Balancer Vault:", vaultAddress);

  const MockAavePool = await ethers.getContractFactory("MockAavePool");
  const mockAave = await MockAavePool.deploy();
  await mockAave.waitForDeployment();
  const aaveAddress = await mockAave.getAddress();
  console.log("    ✓ Aave Pool:", aaveAddress);

  const MockOneInchRouter = await ethers.getContractFactory("MockOneInchRouter");
  const mockRouter = await MockOneInchRouter.deploy();
  await mockRouter.waitForDeployment();
  const routerAddress = await mockRouter.getAddress();
  console.log("    ✓ 1inch Router:", routerAddress);
  console.log();

  // Deploy LiquidationExecutor
  console.log("🚀 Step 2: Deploying LiquidationExecutor...");
  const LiquidationExecutor = await ethers.getContractFactory("LiquidationExecutor");
  const executor = await LiquidationExecutor.deploy(
    vaultAddress,
    aaveAddress,
    routerAddress,
    deployer.address
  );
  await executor.waitForDeployment();
  const executorAddress = await executor.getAddress();
  console.log("  ✓ LiquidationExecutor:", executorAddress);
  console.log();

  // Configure executor
  console.log("⚙️  Step 3: Configuring executor (whitelisting assets)...");
  await executor.setWhitelist(collateralAddress, true);
  await executor.setWhitelist(debtAddress, true);
  console.log("  ✓ Whitelisted WETH (collateral)");
  console.log("  ✓ Whitelisted USDC (debt)");
  console.log();

  // Setup liquidatable position
  console.log("💰 Step 4: Setting up liquidatable position...");
  const debtToCover = ethers.parseUnits("1000", 6); // 1000 USDC
  const liquidationBonus = 500; // 5% bonus
  const collateralReceived = debtToCover + (debtToCover * BigInt(liquidationBonus) / BigInt(10000));
  
  console.log("  Debt to cover:", ethers.formatUnits(debtToCover, 6), "USDC");
  console.log("  Liquidation bonus:", (liquidationBonus / 100).toFixed(2) + "%");
  console.log("  Expected collateral:", ethers.formatUnits(collateralReceived, 6), "WETH (value in USDC)");
  
  // Fund mock vault with debt tokens (for flash loan)
  await debtToken.mint(vaultAddress, debtToCover);
  console.log("  ✓ Funded Balancer Vault with", ethers.formatUnits(debtToCover, 6), "USDC");
  
  // Fund Aave pool with collateral (to simulate liquidation reward)
  await collateralToken.mint(aaveAddress, collateralReceived);
  console.log("  ✓ Funded Aave Pool with", ethers.formatUnits(collateralReceived, 6), "WETH");
  
  // Configure router for swap (1:1 exchange rate)
  await mockRouter.setTokenPair(collateralAddress, debtAddress);
  await mockRouter.setExchangeRate(10000); // 1:1 (basis points)
  await debtToken.mint(routerAddress, collateralReceived);
  console.log("  ✓ Configured 1inch Router (1:1 exchange rate)");
  console.log("  ✓ Funded Router with", ethers.formatUnits(collateralReceived, 6), "USDC");
  console.log();

  // Execute liquidation
  console.log("⚡ Step 5: Executing liquidation...");
  const params = {
    user: user.address,
    collateralAsset: collateralAddress,
    debtAsset: debtAddress,
    debtToCover: debtToCover,
    oneInchCalldata: "0x", // Empty for mock
    minOut: debtToCover, // Expect at least debtToCover back
    payout: payout.address
  };

  const payoutBalanceBefore = await debtToken.balanceOf(payout.address);
  console.log("  Payout balance before:", ethers.formatUnits(payoutBalanceBefore, 6), "USDC");

  const tx = await executor.initiateLiquidation(params);
  const receipt = await tx.wait();
  
  console.log("  ✓ Transaction mined:", receipt?.hash);

  // Verify LiquidationExecuted event
  const event = receipt?.logs.find((log: any) => {
    try {
      const parsed = executor.interface.parseLog(log);
      return parsed?.name === "LiquidationExecuted";
    } catch {
      return false;
    }
  });

  if (!event) {
    throw new Error("❌ LiquidationExecuted event not found");
  }

  const parsedEvent = executor.interface.parseLog(event);
  const profit = parsedEvent?.args.profit;
  
  console.log("  ✓ LiquidationExecuted event emitted");
  console.log("    - User:", parsedEvent?.args.user);
  console.log("    - Collateral Asset:", parsedEvent?.args.collateralAsset);
  console.log("    - Debt Asset:", parsedEvent?.args.debtAsset);
  console.log("    - Profit:", ethers.formatUnits(profit, 6), "USDC");
  console.log();

  // Verify profit calculation
  console.log("✅ Step 6: Verifying results...");
  const expectedProfit = collateralReceived - debtToCover; // Since 1:1 swap
  console.log("  Expected profit:", ethers.formatUnits(expectedProfit, 6), "USDC");
  console.log("  Actual profit:", ethers.formatUnits(profit, 6), "USDC");
  
  if (profit !== expectedProfit) {
    throw new Error(`❌ Profit mismatch! Expected ${expectedProfit}, got ${profit}`);
  }
  console.log("  ✓ Profit calculation correct");

  // Verify payout received profit
  const payoutBalanceAfter = await debtToken.balanceOf(payout.address);
  const payoutReceived = payoutBalanceAfter - payoutBalanceBefore;
  console.log("  Payout received:", ethers.formatUnits(payoutReceived, 6), "USDC");
  
  if (payoutReceived !== profit) {
    throw new Error(`❌ Payout mismatch! Expected ${profit}, got ${payoutReceived}`);
  }
  console.log("  ✓ Payout address received correct profit");

  // Verify flash loan repayment (executor should have 0 balance)
  const executorDebtBalance = await debtToken.balanceOf(executorAddress);
  const executorCollateralBalance = await collateralToken.balanceOf(executorAddress);
  console.log("  Executor debt balance:", ethers.formatUnits(executorDebtBalance, 6), "USDC");
  console.log("  Executor collateral balance:", ethers.formatUnits(executorCollateralBalance, 18), "WETH");
  
  if (executorDebtBalance !== 0n || executorCollateralBalance !== 0n) {
    throw new Error("❌ Executor has leftover tokens (flash loan not fully repaid)");
  }
  console.log("  ✓ Flash loan fully repaid, no leftover tokens");
  console.log();

  // Summary
  console.log("=".repeat(80));
  console.log("✨ E2E Test PASSED");
  console.log("=".repeat(80));
  console.log();
  console.log("Summary:");
  console.log("  • Flash loan obtained: ✓");
  console.log("  • Liquidation executed: ✓");
  console.log("  • Collateral swapped: ✓");
  console.log("  • Flash loan repaid: ✓");
  console.log("  • Profit calculated correctly: ✓");
  console.log("  • Payout transferred: ✓");
  console.log();
  console.log(`Profit: ${ethers.formatUnits(profit, 6)} USDC (${((Number(profit) / Number(debtToCover)) * 100).toFixed(2)}% of debt covered)`);
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error();
    console.error("❌ E2E Test FAILED");
    console.error("=".repeat(80));
    console.error(error);
    process.exit(1);
  });
