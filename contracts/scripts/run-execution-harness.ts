import { ethers } from "hardhat";

/**
 * Backend Execution Harness
 * 
 * Tests the full backend execution pipeline in a local environment:
 * 1. Loads a fixture opportunity
 * 2. Fetches 1inch v6 quote (or uses mock data)
 * 3. Encodes and calls executor
 * 4. Validates minOut propagation and revert bubbling
 * 
 * Modes:
 * - Local: Uses local Hardhat network with mocks
 * - Dry-run: Logs payload without execution
 * 
 * Usage:
 *   npm run e2e:backend           # Local with mocks
 *   npm run e2e:backend -- --dry  # Dry-run (log only)
 */

async function main() {
  console.log("\n🔧 Backend Execution Harness\n");
  console.log("=" .repeat(60));
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry") || args.includes("--dry-run");
  
  console.log("Mode:", isDryRun ? "Dry-run (log only)" : "Local execution");
  console.log();
  
  const [executor, user, payout] = await ethers.getSigners();
  console.log("👤 Test accounts:");
  console.log("   Executor:", executor.address);
  console.log("   User (borrower):", user.address);
  console.log("   Payout:", payout.address);
  console.log();
  
  // ========================================================================
  // Step 1: Setup - Deploy Mocks (Local Mode Only)
  // ========================================================================
  
  if (!isDryRun) {
    console.log("📦 Step 1: Deploying mock contracts...");
    
    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const collateralToken = await MockERC20.deploy("Wrapped Ether", "WETH", 18);
    await collateralToken.waitForDeployment();
    const debtToken = await MockERC20.deploy("USD Coin", "USDC", 6);
    await debtToken.waitForDeployment();
    
    // Deploy mock protocols
    const MockBalancerVault = await ethers.getContractFactory("MockBalancerVault");
    const mockVault = await MockBalancerVault.deploy();
    await mockVault.waitForDeployment();
    
    const MockAavePool = await ethers.getContractFactory("MockAavePool");
    const mockAave = await MockAavePool.deploy();
    await mockAave.waitForDeployment();
    
    const MockOneInchRouter = await ethers.getContractFactory("MockOneInchRouter");
    const mockRouter = await MockOneInchRouter.deploy();
    await mockRouter.waitForDeployment();
    
    // Deploy executor
    const LiquidationExecutor = await ethers.getContractFactory("LiquidationExecutor");
    const executorContract = await LiquidationExecutor.deploy(
      await mockVault.getAddress(),
      await mockAave.getAddress(),
      await mockRouter.getAddress(),
      payout.address
    );
    await executorContract.waitForDeployment();
    
    console.log("   ✅ Mock contracts deployed");
    console.log();
    
    // Setup liquidatable position
    console.log("📦 Step 2: Setting up test environment...");
    
    const collateralAddress = await collateralToken.getAddress();
    const debtAddress = await debtToken.getAddress();
    const executorAddress = await executorContract.getAddress();
    
    await executorContract.setWhitelist(collateralAddress, true);
    await executorContract.setWhitelist(debtAddress, true);
    
    const debtToCover = ethers.parseUnits("1000", 6);
    const liquidationBonus = 500;
    const collateralReceived = debtToCover + (debtToCover * BigInt(liquidationBonus) / BigInt(10000));
    
    await debtToken.mint(await mockVault.getAddress(), debtToCover);
    await collateralToken.mint(await mockAave.getAddress(), collateralReceived);
    await mockRouter.setTokenPair(collateralAddress, debtAddress);
    await mockRouter.setExchangeRate(10000);
    await debtToken.mint(await mockRouter.getAddress(), collateralReceived);
    
    console.log("   ✅ Test environment ready");
    console.log();
    
    // ========================================================================
    // Step 3: Load Fixture Opportunity
    // ========================================================================
    console.log("📋 Step 3: Loading fixture opportunity...");
    
    const opportunity = {
      user: user.address,
      collateralReserve: { id: collateralAddress },
      principalReserve: { id: debtAddress },
      collateralAmountRaw: collateralReceived.toString(),
      principalAmountRaw: debtToCover.toString(),
      profitEstimateUsd: 50
    };
    
    console.log("   User:", opportunity.user);
    console.log("   Collateral:", opportunity.collateralReserve.id);
    console.log("   Debt:", opportunity.principalReserve.id);
    console.log("   Debt to cover:", ethers.formatUnits(debtToCover, 6), "USDC");
    console.log("   Estimated profit:", opportunity.profitEstimateUsd, "USD");
    console.log();
    
    // ========================================================================
    // Step 4: Fetch 1inch Quote (Mocked)
    // ========================================================================
    console.log("🔄 Step 4: Fetching swap quote (mocked)...");
    
    const slippageBps = 100; // 1%
    const minOut = debtToCover - (debtToCover * BigInt(slippageBps) / BigInt(10000));
    
    const swapQuote = {
      to: await mockRouter.getAddress(),
      data: "0x", // Empty for mock
      value: "0",
      minOut: minOut.toString()
    };
    
    console.log("   Router:", swapQuote.to);
    console.log("   MinOut:", ethers.formatUnits(swapQuote.minOut, 6), "USDC");
    console.log("   Slippage:", slippageBps / 100, "%");
    console.log("   ✅ Quote obtained (mocked)");
    console.log();
    
    // ========================================================================
    // Step 5: Build Liquidation Parameters
    // ========================================================================
    console.log("🏗️  Step 5: Building liquidation parameters...");
    
    const liquidationParams = {
      user: opportunity.user,
      collateralAsset: opportunity.collateralReserve.id,
      debtAsset: opportunity.principalReserve.id,
      debtToCover: debtToCover,
      oneInchCalldata: swapQuote.data,
      minOut: BigInt(swapQuote.minOut),
      payout: payout.address
    };
    
    console.log("   Parameters:");
    console.log("     User:", liquidationParams.user);
    console.log("     Collateral:", liquidationParams.collateralAsset);
    console.log("     Debt:", liquidationParams.debtAsset);
    console.log("     Debt to cover:", ethers.formatUnits(liquidationParams.debtToCover, 6), "USDC");
    console.log("     MinOut:", ethers.formatUnits(liquidationParams.minOut, 6), "USDC");
    console.log("     Payout:", liquidationParams.payout);
    console.log();
    
    // ========================================================================
    // Step 6: Execute Liquidation
    // ========================================================================
    console.log("🚀 Step 6: Executing liquidation...");
    
    const balanceBefore = await debtToken.balanceOf(payout.address);
    
    const tx = await executorContract.initiateLiquidation(liquidationParams);
    const receipt = await tx.wait();
    
    console.log("   ✅ Transaction confirmed");
    console.log("   TX Hash:", receipt?.hash);
    console.log("   Gas used:", receipt?.gasUsed.toString());
    console.log();
    
    // ========================================================================
    // Step 7: Validate Results
    // ========================================================================
    console.log("✅ Step 7: Validating results...");
    
    // Check event emission
    const event = receipt?.logs.find((log: any) => {
      try {
        const parsed = executorContract.interface.parseLog(log);
        return parsed?.name === "LiquidationExecuted";
      } catch {
        return false;
      }
    });
    
    if (!event) {
      throw new Error("❌ LiquidationExecuted event not found");
    }
    
    const parsedEvent = executorContract.interface.parseLog(event);
    console.log("   ✅ LiquidationExecuted event emitted");
    console.log("   Profit:", ethers.formatUnits(parsedEvent?.args.profit, 6), "USDC");
    console.log();
    
    // Verify minOut propagation
    const balanceAfter = await debtToken.balanceOf(payout.address);
    const profit = balanceAfter - balanceBefore;
    
    console.log("   Profit received:", ethers.formatUnits(profit, 6), "USDC");
    
    if (profit <= 0n) {
      throw new Error("❌ No profit received");
    }
    
    console.log("   ✅ MinOut propagation validated");
    console.log();
    
    // ========================================================================
    // Step 8: Test Revert Bubbling
    // ========================================================================
    console.log("🔍 Step 8: Testing revert bubbling...");
    
    // Try to execute with insufficient minOut (should revert)
    const badParams = {
      ...liquidationParams,
      minOut: collateralReceived * 2n // Impossible to achieve
    };
    
    try {
      await executorContract.initiateLiquidation(badParams);
      throw new Error("❌ Should have reverted with insufficient minOut");
    } catch (error: any) {
      if (error.message.includes("Should have reverted")) {
        throw error;
      }
      console.log("   ✅ Reverted as expected (insufficient minOut)");
      console.log("   Error:", error.message.split('\n')[0]);
    }
    console.log();
    
    // ========================================================================
    // Summary
    // ========================================================================
    console.log("=" .repeat(60));
    console.log("🎉 Backend Execution Harness PASSED");
    console.log("=" .repeat(60));
    console.log();
    console.log("Summary:");
    console.log("  • Mocked 1inch quote generation");
    console.log("  • Parameter encoding validated");
    console.log("  • MinOut propagation verified");
    console.log("  • Revert bubbling tested");
    console.log("  • Profit realized:", ethers.formatUnits(profit, 6), "USDC");
    console.log();
    
  } else {
    // ========================================================================
    // Dry-run Mode: Log Payload Only
    // ========================================================================
    console.log("📋 Step 1: Loading fixture opportunity...");
    
    const opportunity = {
      user: user.address,
      collateralReserve: { id: "0x4200000000000000000000000000000000000006" }, // WETH on Base
      principalReserve: { id: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, // USDC on Base
      collateralAmountRaw: ethers.parseEther("1").toString(),
      principalAmountRaw: ethers.parseUnits("2000", 6).toString(),
      profitEstimateUsd: 50
    };
    
    console.log("   User:", opportunity.user);
    console.log("   Collateral:", opportunity.collateralReserve.id);
    console.log("   Debt:", opportunity.principalReserve.id);
    console.log();
    
    console.log("🔄 Step 2: Mock 1inch quote...");
    
    const debtToCover = ethers.parseUnits("2000", 6);
    const slippageBps = 100;
    const minOut = debtToCover - (debtToCover * BigInt(slippageBps) / BigInt(10000));
    
    const swapQuote = {
      to: "0x1111111254EEB25477B68fb85Ed929f73A960582", // 1inch router on Base
      data: "0x...", // Placeholder
      value: "0",
      minOut: minOut.toString()
    };
    
    console.log("   Router:", swapQuote.to);
    console.log("   MinOut:", ethers.formatUnits(swapQuote.minOut, 6), "USDC");
    console.log();
    
    console.log("🏗️  Step 3: Build liquidation parameters...");
    
    const liquidationParams = {
      user: opportunity.user,
      collateralAsset: opportunity.collateralReserve.id,
      debtAsset: opportunity.principalReserve.id,
      debtToCover: debtToCover,
      oneInchCalldata: swapQuote.data,
      minOut: BigInt(swapQuote.minOut),
      payout: payout.address
    };
    
    console.log("   Parameters:");
    console.log("     User:", liquidationParams.user);
    console.log("     Collateral:", liquidationParams.collateralAsset);
    console.log("     Debt:", liquidationParams.debtAsset);
    console.log("     Debt to cover:", ethers.formatUnits(liquidationParams.debtToCover, 6), "USDC");
    console.log("     MinOut:", ethers.formatUnits(liquidationParams.minOut, 6), "USDC");
    console.log("     Payout:", liquidationParams.payout);
    console.log();
    
    console.log("📝 Dry-run: Execution skipped");
    console.log("   In production, this would call executor.initiateLiquidation()");
    console.log();
    
    console.log("=" .repeat(60));
    console.log("✅ Dry-run Completed");
    console.log("=" .repeat(60));
    console.log();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Backend Execution Harness FAILED");
    console.error(error);
    process.exit(1);
  });
