import { ethers } from "hardhat";

/**
 * E2E Local Test Script
 * 
 * Runs a complete end-to-end liquidation test on a local Hardhat network.
 * Uses mock contracts for deterministic testing without external dependencies.
 * 
 * Flow:
 * 1. Deploy mock tokens (WETH, USDC)
 * 2. Deploy mock protocols (Balancer Vault, Aave Pool, 1inch Router)
 * 3. Deploy LiquidationExecutor
 * 4. Setup liquidatable position (mint tokens, configure mocks)
 * 5. Execute full liquidation flow
 * 6. Assert: LiquidationExecuted event, profit correctness, flash loan repaid
 */

async function main() {
  console.log("\n🧪 Starting Local E2E Liquidation Test\n");
  console.log("=" .repeat(60));
  
  const [owner, borrower, payout] = await ethers.getSigners();
  console.log("👤 Test accounts:");
  console.log("   Owner:", owner.address);
  console.log("   Borrower:", borrower.address);
  console.log("   Payout:", payout.address);
  console.log();
  
  // ========================================================================
  // Step 1: Deploy Mock Tokens
  // ========================================================================
  console.log("📦 Step 1: Deploying mock tokens...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  
  const collateralToken = await MockERC20.deploy("Wrapped Ether", "WETH", 18);
  await collateralToken.waitForDeployment();
  const collateralAddress = await collateralToken.getAddress();
  
  const debtToken = await MockERC20.deploy("USD Coin", "USDC", 6);
  await debtToken.waitForDeployment();
  const debtAddress = await debtToken.getAddress();
  
  console.log("   ✅ WETH (collateral):", collateralAddress);
  console.log("   ✅ USDC (debt):", debtAddress);
  console.log();
  
  // ========================================================================
  // Step 2: Deploy Mock Protocols
  // ========================================================================
  console.log("📦 Step 2: Deploying mock protocols...");
  
  const MockBalancerVault = await ethers.getContractFactory("MockBalancerVault");
  const mockVault = await MockBalancerVault.deploy();
  await mockVault.waitForDeployment();
  const vaultAddress = await mockVault.getAddress();
  
  const MockAavePool = await ethers.getContractFactory("MockAavePool");
  const mockAave = await MockAavePool.deploy();
  await mockAave.waitForDeployment();
  const aaveAddress = await mockAave.getAddress();
  
  const MockOneInchRouter = await ethers.getContractFactory("MockOneInchRouter");
  const mockRouter = await MockOneInchRouter.deploy();
  await mockRouter.waitForDeployment();
  const routerAddress = await mockRouter.getAddress();
  
  console.log("   ✅ Balancer Vault:", vaultAddress);
  console.log("   ✅ Aave Pool:", aaveAddress);
  console.log("   ✅ 1inch Router:", routerAddress);
  console.log();
  
  // ========================================================================
  // Step 3: Deploy LiquidationExecutor
  // ========================================================================
  console.log("📦 Step 3: Deploying LiquidationExecutor...");
  
  const LiquidationExecutor = await ethers.getContractFactory("LiquidationExecutor");
  const executor = await LiquidationExecutor.deploy(
    vaultAddress,
    aaveAddress,
    routerAddress,
    payout.address
  );
  await executor.waitForDeployment();
  const executorAddress = await executor.getAddress();
  
  console.log("   ✅ LiquidationExecutor:", executorAddress);
  console.log();
  
  // Whitelist assets
  await executor.setWhitelist(collateralAddress, true);
  await executor.setWhitelist(debtAddress, true);
  console.log("   ✅ Assets whitelisted");
  console.log();
  
  // ========================================================================
  // Step 4: Setup Liquidatable Position
  // ========================================================================
  console.log("📦 Step 4: Setting up liquidatable position...");
  
  const debtToCover = ethers.parseUnits("1000", 6); // 1000 USDC
  const liquidationBonus = 500; // 5%
  const collateralReceived = debtToCover + (debtToCover * BigInt(liquidationBonus) / BigInt(10000));
  
  console.log("   Debt to cover:", ethers.formatUnits(debtToCover, 6), "USDC");
  console.log("   Liquidation bonus:", liquidationBonus / 100 + "%");
  console.log("   Collateral to receive:", ethers.formatUnits(collateralReceived, 6), "USDC-equivalent");
  console.log();
  
  // Fund vault with debt tokens for flash loan
  await debtToken.mint(vaultAddress, debtToCover);
  console.log("   ✅ Vault funded with", ethers.formatUnits(debtToCover, 6), "USDC");
  
  // Fund Aave pool with collateral (to give back during liquidation)
  await collateralToken.mint(aaveAddress, collateralReceived);
  console.log("   ✅ Aave pool funded with", ethers.formatUnits(collateralReceived, 18), "WETH");
  
  // Configure router to swap collateral -> debt at 1:1 rate
  await mockRouter.setTokenPair(collateralAddress, debtAddress);
  await mockRouter.setExchangeRate(10000); // 1:1 (basis points)
  await debtToken.mint(routerAddress, collateralReceived); // Fund router with output tokens
  console.log("   ✅ Router configured for 1:1 swap (WETH → USDC)");
  console.log();
  
  // ========================================================================
  // Step 5: Execute Full Liquidation Flow
  // ========================================================================
  console.log("🚀 Step 5: Executing liquidation flow...");
  console.log("   Flash loan → Liquidate → Swap → Repay → Profit");
  console.log();
  
  const minOut = debtToCover; // Expect at least debtToCover back from swap
  
  const params = {
    user: borrower.address,
    collateralAsset: collateralAddress,
    debtAsset: debtAddress,
    debtToCover: debtToCover,
    oneInchCalldata: "0x", // Empty for mock router
    minOut: minOut,
    payout: payout.address
  };
  
  const balanceBefore = await debtToken.balanceOf(payout.address);
  console.log("   Payout balance before:", ethers.formatUnits(balanceBefore, 6), "USDC");
  
  const tx = await executor.initiateLiquidation(params);
  const receipt = await tx.wait();
  
  console.log("   ✅ Transaction confirmed");
  console.log("   Gas used:", receipt?.gasUsed.toString());
  console.log();
  
  // ========================================================================
  // Step 6: Verify Results
  // ========================================================================
  console.log("✅ Step 6: Verifying results...");
  
  // Check that LiquidationExecuted event was emitted
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
  console.log("   ✅ LiquidationExecuted event emitted");
  console.log("   User:", parsedEvent?.args.user);
  console.log("   Collateral:", parsedEvent?.args.collateralAsset);
  console.log("   Debt:", parsedEvent?.args.debtAsset);
  console.log("   Profit:", ethers.formatUnits(parsedEvent?.args.profit, 6), "USDC");
  console.log();
  
  // Verify profit was transferred to payout address
  const balanceAfter = await debtToken.balanceOf(payout.address);
  const profit = balanceAfter - balanceBefore;
  
  console.log("   Payout balance after:", ethers.formatUnits(balanceAfter, 6), "USDC");
  console.log("   Actual profit received:", ethers.formatUnits(profit, 6), "USDC");
  console.log();
  
  // Expected profit = collateralReceived - debtToCover (since 1:1 swap rate)
  const expectedProfit = collateralReceived - debtToCover;
  const profitDiff = profit > expectedProfit ? profit - expectedProfit : expectedProfit - profit;
  
  console.log("   Expected profit:", ethers.formatUnits(expectedProfit, 6), "USDC");
  console.log("   Profit difference:", ethers.formatUnits(profitDiff, 6), "USDC");
  
  // Allow 1 wei difference due to rounding
  if (profitDiff > 1n) {
    throw new Error(`❌ Profit mismatch: expected ${expectedProfit}, got ${profit}`);
  }
  
  console.log("   ✅ Profit matches expected value (within 1 wei)");
  console.log();
  
  // Verify flash loan was repaid (vault should have received back its tokens)
  const vaultBalance = await debtToken.balanceOf(vaultAddress);
  if (vaultBalance < debtToCover) {
    throw new Error("❌ Flash loan not fully repaid");
  }
  console.log("   ✅ Flash loan repaid successfully");
  console.log("   Vault balance:", ethers.formatUnits(vaultBalance, 6), "USDC");
  console.log();
  
  // ========================================================================
  // Summary
  // ========================================================================
  console.log("=" .repeat(60));
  console.log("🎉 E2E Local Test PASSED");
  console.log("=" .repeat(60));
  console.log();
  console.log("Summary:");
  console.log("  • Flash loan of", ethers.formatUnits(debtToCover, 6), "USDC obtained");
  console.log("  • Liquidation executed (5% bonus received)");
  console.log("  • Collateral swapped at 1:1 rate");
  console.log("  • Flash loan repaid");
  console.log("  • Profit of", ethers.formatUnits(profit, 6), "USDC realized");
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ E2E Test FAILED");
    console.error(error);
    process.exit(1);
  });
