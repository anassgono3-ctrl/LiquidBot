import { ethers } from "hardhat";

/**
 * E2E Fork Test Script
 * 
 * Validates executor deployment and call path preparation on Base fork.
 * Skips gracefully if RPC_URL is not configured.
 * 
 * This script:
 * 1. Checks if RPC_URL is available
 * 2. Deploys executor on Base fork
 * 3. Verifies protocol addresses are valid contracts
 * 4. Validates call path preparation (without execution)
 */

async function main() {
  console.log("\n🔱 Starting Base Fork E2E Test\n");
  console.log("=" .repeat(60));
  
  // Check if RPC_URL is configured
  if (!process.env.RPC_URL) {
    console.log("⏭️  Skipping fork test: RPC_URL not configured");
    console.log();
    console.log("To run this test, set RPC_URL in your environment:");
    console.log("  export RPC_URL=https://mainnet.base.org");
    console.log("  # or use a provider like Alchemy/Infura/QuickNode");
    console.log();
    return;
  }
  
  console.log("✅ RPC_URL configured:", process.env.RPC_URL);
  console.log();
  
  const [deployer] = await ethers.getSigners();
  console.log("👤 Deployer:", deployer.address);
  
  // Check deployer balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Deployer balance:", ethers.formatEther(balance), "ETH");
  console.log();
  
  // Base protocol addresses
  const BALANCER_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
  const AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
  const ONEINCH_ROUTER = "0x1111111254EEB25477B68fb85Ed929f73A960582";
  
  console.log("📍 Base Protocol Addresses:");
  console.log("   Balancer Vault:", BALANCER_VAULT);
  console.log("   Aave Pool:", AAVE_POOL);
  console.log("   1inch Router:", ONEINCH_ROUTER);
  console.log();
  
  // ========================================================================
  // Step 1: Verify Protocol Addresses
  // ========================================================================
  console.log("🔍 Step 1: Verifying protocol addresses on Base...");
  
  const vaultCode = await ethers.provider.getCode(BALANCER_VAULT);
  const aaveCode = await ethers.provider.getCode(AAVE_POOL);
  const routerCode = await ethers.provider.getCode(ONEINCH_ROUTER);
  
  if (vaultCode === "0x" || vaultCode === "0x0") {
    throw new Error("❌ Balancer Vault not found at address");
  }
  console.log("   ✅ Balancer Vault is a valid contract");
  
  if (aaveCode === "0x" || aaveCode === "0x0") {
    throw new Error("❌ Aave Pool not found at address");
  }
  console.log("   ✅ Aave Pool is a valid contract");
  
  if (routerCode === "0x" || routerCode === "0x0") {
    throw new Error("❌ 1inch Router not found at address");
  }
  console.log("   ✅ 1inch Router is a valid contract");
  console.log();
  
  // ========================================================================
  // Step 2: Deploy LiquidationExecutor
  // ========================================================================
  console.log("📦 Step 2: Deploying LiquidationExecutor on Base fork...");
  
  const LiquidationExecutor = await ethers.getContractFactory("LiquidationExecutor");
  const executor = await LiquidationExecutor.deploy(
    BALANCER_VAULT,
    AAVE_POOL,
    ONEINCH_ROUTER,
    deployer.address
  );
  await executor.waitForDeployment();
  const executorAddress = await executor.getAddress();
  
  console.log("   ✅ Executor deployed at:", executorAddress);
  console.log();
  
  // ========================================================================
  // Step 3: Verify Configuration
  // ========================================================================
  console.log("🔍 Step 3: Verifying executor configuration...");
  
  const owner = await executor.owner();
  const vault = await executor.balancerVault();
  const pool = await executor.aavePool();
  const router = await executor.oneInchRouter();
  const paused = await executor.paused();
  
  if (owner !== deployer.address) {
    throw new Error("❌ Owner mismatch");
  }
  console.log("   ✅ Owner:", owner);
  
  if (vault !== BALANCER_VAULT) {
    throw new Error("❌ Balancer Vault mismatch");
  }
  console.log("   ✅ Balancer Vault:", vault);
  
  if (pool !== AAVE_POOL) {
    throw new Error("❌ Aave Pool mismatch");
  }
  console.log("   ✅ Aave Pool:", pool);
  
  if (router !== ONEINCH_ROUTER) {
    throw new Error("❌ 1inch Router mismatch");
  }
  console.log("   ✅ 1inch Router:", router);
  
  if (paused) {
    throw new Error("❌ Executor is paused");
  }
  console.log("   ✅ Executor is not paused");
  console.log();
  
  // ========================================================================
  // Step 4: Test Whitelist Operations
  // ========================================================================
  console.log("🔍 Step 4: Testing whitelist operations...");
  
  // Base USDC address
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  
  await executor.setWhitelist(USDC, true);
  const isWhitelisted = await executor.whitelistedAssets(USDC);
  
  if (!isWhitelisted) {
    throw new Error("❌ Whitelist operation failed");
  }
  console.log("   ✅ USDC whitelisted successfully");
  
  await executor.setWhitelist(USDC, false);
  const isStillWhitelisted = await executor.whitelistedAssets(USDC);
  
  if (isStillWhitelisted) {
    throw new Error("❌ Whitelist removal failed");
  }
  console.log("   ✅ USDC removed from whitelist successfully");
  console.log();
  
  // ========================================================================
  // Step 5: Test Pause/Unpause
  // ========================================================================
  console.log("🔍 Step 5: Testing pause/unpause operations...");
  
  await executor.pause();
  const isPaused = await executor.paused();
  
  if (!isPaused) {
    throw new Error("❌ Pause operation failed");
  }
  console.log("   ✅ Executor paused successfully");
  
  await executor.unpause();
  const isUnpaused = !(await executor.paused());
  
  if (!isUnpaused) {
    throw new Error("❌ Unpause operation failed");
  }
  console.log("   ✅ Executor unpaused successfully");
  console.log();
  
  // ========================================================================
  // Step 6: Validate Call Path Preparation
  // ========================================================================
  console.log("🔍 Step 6: Validating call path preparation...");
  console.log("   (No actual execution - just verifying wiring)");
  console.log();
  
  // This validates that the contract interface is correct
  // We don't execute a real liquidation as that requires:
  // - Real liquidatable position
  // - Real 1inch calldata
  // - Sufficient funding
  
  // Just verify we can prepare the parameters
  const dummyParams = {
    user: deployer.address,
    collateralAsset: USDC,
    debtAsset: USDC,
    debtToCover: ethers.parseUnits("1", 6),
    oneInchCalldata: "0x",
    minOut: ethers.parseUnits("1", 6),
    payout: deployer.address
  };
  
  // Encode the call (but don't send it)
  const calldata = executor.interface.encodeFunctionData(
    "initiateLiquidation",
    [dummyParams]
  );
  
  if (calldata.length < 10) {
    throw new Error("❌ Failed to encode call");
  }
  
  console.log("   ✅ Call path validated (calldata encoded successfully)");
  console.log("   Calldata length:", calldata.length, "bytes");
  console.log();
  
  // ========================================================================
  // Summary
  // ========================================================================
  console.log("=" .repeat(60));
  console.log("🎉 Base Fork E2E Test PASSED");
  console.log("=" .repeat(60));
  console.log();
  console.log("Summary:");
  console.log("  • Protocol addresses verified on Base");
  console.log("  • Executor deployed successfully");
  console.log("  • Configuration verified");
  console.log("  • Whitelist operations working");
  console.log("  • Pause/unpause operations working");
  console.log("  • Call path preparation validated");
  console.log();
  console.log("Note: This test validates wiring without executing real liquidations.");
  console.log("      Real execution requires liquidatable positions and funding.");
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Base Fork E2E Test FAILED");
    console.error(error);
    process.exit(1);
  });
