import { ethers } from "hardhat";

async function main() {
  console.log("Deploying LiquidationExecutor to Base...");

  // Base addresses
  const BALANCER_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
  const AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
  const ONEINCH_ROUTER = "0x1111111254EEB25477B68fb85Ed929f73A960582";
  
  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  
  // Use deployer as default payout address (can be changed later)
  const payoutDefault = deployer.address;
  
  // Deploy
  const LiquidationExecutor = await ethers.getContractFactory("LiquidationExecutor");
  const executor = await LiquidationExecutor.deploy(
    BALANCER_VAULT,
    AAVE_POOL,
    ONEINCH_ROUTER,
    payoutDefault
  );
  
  await executor.waitForDeployment();
  const address = await executor.getAddress();
  
  console.log("LiquidationExecutor deployed to:", address);
  console.log("Balancer Vault:", BALANCER_VAULT);
  console.log("Aave Pool:", AAVE_POOL);
  console.log("1inch Router:", ONEINCH_ROUTER);
  console.log("Payout Default:", payoutDefault);
  console.log("\nNext steps:");
  console.log("1. Set EXECUTOR_ADDRESS=" + address + " in backend .env");
  console.log("2. Whitelist assets using setWhitelist(asset, true)");
  console.log("3. Fund the executor with gas tokens");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
