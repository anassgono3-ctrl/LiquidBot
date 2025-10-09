import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import * as path from "path";

// Load .env from contracts directory, with fallback to backend directory
const contractsEnvPath = path.resolve(__dirname, '.env');
const backendEnvPath = path.resolve(__dirname, '../backend/.env');

// Try contracts/.env first, then backend/.env
dotenv.config({ path: contractsEnvPath });
if (!process.env.RPC_URL) {
  dotenv.config({ path: backendEnvPath });
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  networks: {
    hardhat: {
      chainId: 8453, // Base chainId for local testing
      forking: process.env.RPC_URL ? {
        url: process.env.RPC_URL,
        enabled: true
      } : undefined
    },
    base: {
      url: process.env.RPC_URL || "https://mainnet.base.org",
      chainId: 8453,
      accounts: process.env.EXECUTION_PRIVATE_KEY ? [process.env.EXECUTION_PRIVATE_KEY] : []
    }
  },
  etherscan: {
    apiKey: {
      base: process.env.BASESCAN_API_KEY || ""
    }
  }
};

export default config;
