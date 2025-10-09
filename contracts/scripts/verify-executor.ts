import { exec } from "child_process";
import { promisify } from "util";
import * as dotenv from "dotenv";
import * as path from "path";

const execAsync = promisify(exec);

// Load .env files
const contractsEnvPath = path.resolve(__dirname, "../.env");
const backendEnvPath = path.resolve(__dirname, "../../backend/.env");

dotenv.config({ path: contractsEnvPath });
dotenv.config({ path: backendEnvPath });

interface VerifyArgs {
  network: string;
  address: string;
  balancerVault?: string;
  aavePool?: string;
  oneInchRouter?: string;
  payoutDefault?: string;
  contract?: string;
}

function parseArgs(): VerifyArgs {
  const args = process.argv.slice(2);
  const result: VerifyArgs = {
    network: "base",
    address: "",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--network" && i + 1 < args.length) {
      result.network = args[++i];
    } else if (arg === "--address" && i + 1 < args.length) {
      result.address = args[++i];
    } else if (arg === "--balancer-vault" && i + 1 < args.length) {
      result.balancerVault = args[++i];
    } else if (arg === "--aave-pool" && i + 1 < args.length) {
      result.aavePool = args[++i];
    } else if (arg === "--oneinch-router" && i + 1 < args.length) {
      result.oneInchRouter = args[++i];
    } else if (arg === "--payout-default" && i + 1 < args.length) {
      result.payoutDefault = args[++i];
    } else if (arg === "--contract" && i + 1 < args.length) {
      result.contract = args[++i];
    }
  }

  return result;
}

async function main() {
  const args = parseArgs();

  if (!args.address) {
    console.error("Error: --address is required");
    console.log("\nUsage:");
    console.log("  npm run verify:executor -- --network base --address 0x...");
    console.log("\nOptions:");
    console.log("  --network <network>           Network to verify on (default: base)");
    console.log("  --address <address>           Contract address to verify (required)");
    console.log("  --balancer-vault <address>    Balancer Vault address (default: from env or Base mainnet)");
    console.log("  --aave-pool <address>         Aave V3 Pool address (default: from env or Base mainnet)");
    console.log("  --oneinch-router <address>    1inch Router address (default: from env or Base mainnet)");
    console.log("  --payout-default <address>    Payout default address (default: from env)");
    console.log("  --contract <path>             Contract path for disambiguation (optional)");
    console.log("\nEnvironment variables:");
    console.log("  BALANCER_VAULT_ADDRESS        Balancer Vault address");
    console.log("  AAVE_V3_POOL_ADDRESS          Aave V3 Pool address");
    console.log("  ONEINCH_ROUTER_ADDRESS        1inch Router address");
    console.log("  PAYOUT_DEFAULT                Default payout address");
    console.log("  ETHERSCAN_API_KEY             Etherscan API key for verification");
    process.exit(1);
  }

  // Get constructor arguments from CLI flags or environment variables
  // Base mainnet addresses as defaults
  const balancerVault = args.balancerVault || 
                        process.env.BALANCER_VAULT_ADDRESS || 
                        "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
  
  const aavePool = args.aavePool || 
                   process.env.AAVE_V3_POOL_ADDRESS || 
                   "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
  
  const oneInchRouter = args.oneInchRouter || 
                        process.env.ONEINCH_ROUTER_ADDRESS || 
                        "0x1111111254EEB25477B68fb85Ed929f73A960582";
  
  const payoutDefault = args.payoutDefault || 
                        process.env.PAYOUT_DEFAULT || 
                        "";

  if (!payoutDefault) {
    console.error("Error: --payout-default is required (or set PAYOUT_DEFAULT env variable)");
    console.log("This should be the address that was used during deployment.");
    process.exit(1);
  }

  console.log("Verifying LiquidationExecutor on", args.network);
  console.log("Contract address:", args.address);
  console.log("\nConstructor arguments:");
  console.log("  Balancer Vault:", balancerVault);
  console.log("  Aave Pool:", aavePool);
  console.log("  1inch Router:", oneInchRouter);
  console.log("  Payout Default:", payoutDefault);

  // Build hardhat verify command
  let cmd = `npx hardhat verify --network ${args.network} ${args.address} ${balancerVault} ${aavePool} ${oneInchRouter} ${payoutDefault}`;
  
  if (args.contract) {
    cmd += ` --contract ${args.contract}`;
  }

  console.log("\nExecuting:", cmd);
  console.log();

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        ETHERSCAN_API_KEY: process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY || "",
      }
    });

    if (stdout) {
      console.log(stdout);
    }
    if (stderr) {
      console.error(stderr);
    }

    console.log("\n✅ Verification complete!");
  } catch (error: any) {
    console.error("\n❌ Verification failed:");
    if (error.stdout) {
      console.log(error.stdout);
    }
    if (error.stderr) {
      console.error(error.stderr);
    }
    
    console.log("\nTroubleshooting:");
    console.log("1. Ensure ETHERSCAN_API_KEY is set in your .env file");
    console.log("2. Verify that constructor arguments match the deployment");
    console.log("3. If multiple contracts with same name exist, use --contract flag:");
    console.log("   --contract contracts/src/LiquidationExecutor.sol:LiquidationExecutor");
    console.log("4. Check that the contract is deployed on the specified network");
    
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
