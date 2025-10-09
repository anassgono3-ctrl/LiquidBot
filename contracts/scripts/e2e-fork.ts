import { ethers, network } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

// Load env files
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../backend/.env") });

/**
 * E2E Fork Test Script
 * 
 * This script validates the call-path wiring with real Base addresses.
 * It deploys the executor to a forked Base network and verifies that
 * all contract interfaces are correctly connected.
 * 
 * Run: npm run e2e:fork
 * Requires: RPC_URL environment variable
 */

async function main() {
  console.log("=".repeat(80));
  console.log("E2E Fork Test: LiquidationExecutor Integration");
  console.log("=".repeat(80));
  console.log();

  // Check if RPC_URL is available
  if (!process.env.RPC_URL) {
    console.log("⏭️  Skipping fork test: RPC_URL not configured");
    console.log();
    console.log("To run this test, set RPC_URL in your .env file:");
    console.log("  RPC_URL=https://mainnet.base.org");
    console.log();
    console.log("Or use a provider service like Alchemy or Infura:");
    console.log("  RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY");
    console.log();
    return;
  }

  console.log("🔗 Network:", network.name);
  console.log("🌐 RPC URL:", process.env.RPC_URL);
  console.log();

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log("👤 Deployer:", deployer.address);
  
  // Check deployer balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Balance:", ethers.formatEther(balance), "ETH");
  console.log();

  // Real Base mainnet addresses
  const BALANCER_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
  const AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
  const ONEINCH_ROUTER = "0x1111111254EEB25477B68fb85Ed929f73A960582";

  console.log("📋 Using real Base mainnet addresses:");
  console.log("  Balancer Vault:", BALANCER_VAULT);
  console.log("  Aave Pool:", AAVE_POOL);
  console.log("  1inch Router:", ONEINCH_ROUTER);
  console.log();

  // Verify contracts exist at these addresses
  console.log("🔍 Verifying contract existence...");
  const vaultCode = await ethers.provider.getCode(BALANCER_VAULT);
  const aaveCode = await ethers.provider.getCode(AAVE_POOL);
  const routerCode = await ethers.provider.getCode(ONEINCH_ROUTER);

  if (vaultCode === "0x") {
    throw new Error("❌ Balancer Vault not found at expected address");
  }
  console.log("  ✓ Balancer Vault exists");

  if (aaveCode === "0x") {
    throw new Error("❌ Aave Pool not found at expected address");
  }
  console.log("  ✓ Aave Pool exists");

  if (routerCode === "0x") {
    throw new Error("❌ 1inch Router not found at expected address");
  }
  console.log("  ✓ 1inch Router exists");
  console.log();

  // Deploy LiquidationExecutor
  console.log("🚀 Deploying LiquidationExecutor...");
  const LiquidationExecutor = await ethers.getContractFactory("LiquidationExecutor");
  const executor = await LiquidationExecutor.deploy(
    BALANCER_VAULT,
    AAVE_POOL,
    ONEINCH_ROUTER,
    deployer.address
  );
  await executor.waitForDeployment();
  const executorAddress = await executor.getAddress();
  console.log("  ✓ Deployed at:", executorAddress);
  console.log();

  // Verify deployment and configuration
  console.log("✅ Verifying deployment...");
  const owner = await executor.owner();
  const balancerVault = await executor.balancerVault();
  const aavePool = await executor.aavePool();
  const oneInchRouter = await executor.oneInchRouter();
  const payoutDefault = await executor.payoutDefault();
  const paused = await executor.paused();

  console.log("  Owner:", owner);
  console.log("  Balancer Vault:", balancerVault);
  console.log("  Aave Pool:", aavePool);
  console.log("  1inch Router:", oneInchRouter);
  console.log("  Payout Default:", payoutDefault);
  console.log("  Paused:", paused);
  console.log();

  // Verify addresses match expected values
  if (balancerVault !== BALANCER_VAULT) {
    throw new Error(`❌ Balancer Vault mismatch: expected ${BALANCER_VAULT}, got ${balancerVault}`);
  }
  if (aavePool !== AAVE_POOL) {
    throw new Error(`❌ Aave Pool mismatch: expected ${AAVE_POOL}, got ${aavePool}`);
  }
  if (oneInchRouter !== ONEINCH_ROUTER) {
    throw new Error(`❌ 1inch Router mismatch: expected ${ONEINCH_ROUTER}, got ${oneInchRouter}`);
  }
  if (owner !== deployer.address) {
    throw new Error(`❌ Owner mismatch: expected ${deployer.address}, got ${owner}`);
  }
  if (paused !== false) {
    throw new Error("❌ Contract should not be paused on deployment");
  }

  console.log("  ✓ All addresses correctly configured");
  console.log("  ✓ Owner correctly set");
  console.log("  ✓ Contract not paused");
  console.log();

  // Test whitelist functionality
  console.log("🧪 Testing whitelist functionality...");
  const testAsset = "0x4200000000000000000000000000000000000006"; // WETH on Base
  
  const whitelistedBefore = await executor.whitelistedAssets(testAsset);
  console.log("  Initial whitelist status:", whitelistedBefore);
  
  await executor.setWhitelist(testAsset, true);
  const whitelistedAfter = await executor.whitelistedAssets(testAsset);
  console.log("  After whitelisting:", whitelistedAfter);
  
  if (!whitelistedAfter) {
    throw new Error("❌ Whitelist not updated correctly");
  }
  console.log("  ✓ Whitelist functionality working");
  console.log();

  // Test pause functionality
  console.log("🧪 Testing pause functionality...");
  await executor.pause();
  const pausedAfter = await executor.paused();
  console.log("  Paused status:", pausedAfter);
  
  if (!pausedAfter) {
    throw new Error("❌ Pause not working correctly");
  }
  
  await executor.unpause();
  const unpausedAfter = await executor.paused();
  console.log("  After unpause:", unpausedAfter);
  
  if (unpausedAfter) {
    throw new Error("❌ Unpause not working correctly");
  }
  console.log("  ✓ Pause functionality working");
  console.log();

  // Summary
  console.log("=".repeat(80));
  console.log("✨ E2E Fork Test PASSED");
  console.log("=".repeat(80));
  console.log();
  console.log("Summary:");
  console.log("  • Contract deployed successfully: ✓");
  console.log("  • Real protocol addresses verified: ✓");
  console.log("  • Configuration correctly set: ✓");
  console.log("  • Whitelist functionality works: ✓");
  console.log("  • Pause/unpause functionality works: ✓");
  console.log();
  console.log("Note: This test validates contract deployment and wiring.");
  console.log("      It does NOT execute actual liquidations (would require real positions).");
  console.log();
  console.log("Deployed executor address:", executorAddress);
  console.log();
  console.log("To verify on Basescan, run:");
  console.log(`  npm run verify:executor -- --network base --address ${executorAddress} --payout-default ${deployer.address}`);
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error();
    console.error("❌ E2E Fork Test FAILED");
    console.error("=".repeat(80));
    console.error(error);
    process.exit(1);
  });
