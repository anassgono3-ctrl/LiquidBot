import { run } from "hardhat";

/**
 * Verify Executor Script
 * 
 * Wraps Hardhat verify command with environment validation.
 * 
 * Usage:
 *   npm run verify:executor -- --network base --address 0x...
 * 
 * Required environment variables:
 *   - BASESCAN_API_KEY: Basescan API key for verification
 * 
 * Optional arguments:
 *   --address: Address of deployed executor contract
 *   --vault: Balancer Vault address (default: Base address)
 *   --pool: Aave Pool address (default: Base address)
 *   --router: 1inch Router address (default: Base address)
 *   --payout: Payout address (default: deployer)
 */

async function main() {
  console.log("\n🔍 Verifying LiquidationExecutor Contract\n");
  console.log("=" .repeat(60));
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  
  let address: string | undefined;
  let vault: string | undefined;
  let pool: string | undefined;
  let router: string | undefined;
  let payout: string | undefined;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--address" && i + 1 < args.length) {
      address = args[i + 1];
    } else if (args[i] === "--vault" && i + 1 < args.length) {
      vault = args[i + 1];
    } else if (args[i] === "--pool" && i + 1 < args.length) {
      pool = args[i + 1];
    } else if (args[i] === "--router" && i + 1 < args.length) {
      router = args[i + 1];
    } else if (args[i] === "--payout" && i + 1 < args.length) {
      payout = args[i + 1];
    }
  }
  
  // Validate required arguments
  if (!address) {
    console.error("❌ Error: --address is required");
    console.log();
    console.log("Usage:");
    console.log("  npm run verify:executor -- --network base --address 0x...");
    console.log();
    console.log("Optional arguments:");
    console.log("  --vault 0x...    Balancer Vault address");
    console.log("  --pool 0x...     Aave Pool address");
    console.log("  --router 0x...   1inch Router address");
    console.log("  --payout 0x...   Payout address");
    console.log();
    process.exit(1);
  }
  
  // Default to Base addresses if not provided
  const BALANCER_VAULT = vault || "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
  const AAVE_POOL = pool || "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
  const ONEINCH_ROUTER = router || "0x1111111254EEB25477B68fb85Ed929f73A960582";
  
  // Payout defaults to deployer - user should provide if different
  if (!payout) {
    console.log("⚠️  Warning: --payout not provided, assuming deployer address was used");
    console.log("   If you used a different payout address, provide it with --payout");
    console.log();
  }
  
  console.log("📍 Contract Details:");
  console.log("   Address:", address);
  console.log("   Balancer Vault:", BALANCER_VAULT);
  console.log("   Aave Pool:", AAVE_POOL);
  console.log("   1inch Router:", ONEINCH_ROUTER);
  if (payout) {
    console.log("   Payout:", payout);
  }
  console.log();
  
  // Check environment variables
  if (!process.env.BASESCAN_API_KEY) {
    console.error("❌ Error: BASESCAN_API_KEY not configured");
    console.log();
    console.log("Set your Basescan API key in .env:");
    console.log("  BASESCAN_API_KEY=your_api_key_here");
    console.log();
    console.log("Get your API key at: https://basescan.org/myapikey");
    console.log();
    process.exit(1);
  }
  
  console.log("✅ BASESCAN_API_KEY configured");
  console.log();
  
  // Build constructor arguments
  const constructorArgs = payout 
    ? [BALANCER_VAULT, AAVE_POOL, ONEINCH_ROUTER, payout]
    : [BALANCER_VAULT, AAVE_POOL, ONEINCH_ROUTER];
  
  console.log("🚀 Starting verification...");
  console.log();
  
  try {
    await run("verify:verify", {
      address: address,
      constructorArguments: constructorArgs,
    });
    
    console.log();
    console.log("=" .repeat(60));
    console.log("🎉 Contract Verified Successfully!");
    console.log("=" .repeat(60));
    console.log();
    console.log("View on Basescan:");
    console.log(`  https://basescan.org/address/${address}#code`);
    console.log();
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log();
      console.log("=" .repeat(60));
      console.log("✅ Contract Already Verified");
      console.log("=" .repeat(60));
      console.log();
      console.log("View on Basescan:");
      console.log(`  https://basescan.org/address/${address}#code`);
      console.log();
    } else {
      throw error;
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Verification Failed");
    console.error(error);
    process.exit(1);
  });
