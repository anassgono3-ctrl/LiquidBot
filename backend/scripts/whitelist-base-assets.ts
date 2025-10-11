#!/usr/bin/env tsx
/**
 * Whitelist Base Assets Script
 * Whitelists WETH and USDC on Base in the LiquidationExecutor contract
 * 
 * Usage: npm run whitelist:base
 * 
 * Required environment variables:
 * - EXECUTOR_ADDRESS: Deployed LiquidationExecutor contract address
 * - EXECUTION_PRIVATE_KEY: Private key for execution (must be owner)
 * - RPC_URL: Base network RPC endpoint
 */

// Load environment variables
import 'dotenv/config';

import { ethers } from 'ethers';

// Base mainnet asset addresses
const WETH_BASE = '0x4200000000000000000000000000000000000006';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f61A6B2fcEca34';

// Minimal ABI for LiquidationExecutor
const EXECUTOR_ABI = [
  'function setWhitelist(address asset, bool status) external',
  'function whitelistedAssets(address asset) external view returns (bool)'
];

async function main() {
  console.log('='.repeat(80));
  console.log('Whitelist Base Assets Script');
  console.log('='.repeat(80));
  console.log();

  // Validate required environment variables
  const executorAddress = process.env.EXECUTOR_ADDRESS;
  const privateKey = process.env.EXECUTION_PRIVATE_KEY;
  const rpcUrl = process.env.RPC_URL;

  if (!executorAddress) {
    console.error('❌ Error: EXECUTOR_ADDRESS environment variable is not set');
    process.exit(1);
  }

  if (!privateKey) {
    console.error('❌ Error: EXECUTION_PRIVATE_KEY environment variable is not set');
    process.exit(1);
  }

  if (!rpcUrl) {
    console.error('❌ Error: RPC_URL environment variable is not set');
    process.exit(1);
  }

  console.log('Configuration:');
  console.log(`  Executor Address: ${executorAddress}`);
  console.log(`  RPC URL: ${rpcUrl}`);
  console.log(`  WETH (Base): ${WETH_BASE}`);
  console.log(`  USDC (Base): ${USDC_BASE}`);
  console.log();

  try {
    // Connect to provider and create wallet
    console.log('📡 Connecting to Base network...');
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    console.log(`✅ Connected as: ${wallet.address}`);
    console.log();

    // Create contract instance
    const executor = new ethers.Contract(executorAddress, EXECUTOR_ABI, wallet);

    // Whitelist WETH
    console.log('Processing WETH...');
    const wethWhitelistedBefore = await executor.whitelistedAssets(WETH_BASE);
    console.log(`  Current status: ${wethWhitelistedBefore}`);

    if (!wethWhitelistedBefore) {
      console.log('  Sending setWhitelist transaction...');
      const wethTx = await executor.setWhitelist(WETH_BASE, true);
      console.log(`  Transaction hash: ${wethTx.hash}`);
      console.log('  Waiting for confirmation...');
      await wethTx.wait();
      console.log('  ✅ Transaction confirmed');
    } else {
      console.log('  ℹ️  WETH already whitelisted, skipping');
    }

    // Verify WETH whitelisting
    const wethWhitelistedAfter = await executor.whitelistedAssets(WETH_BASE);
    console.log(`  WETH whitelisted: ${wethWhitelistedAfter}`);
    console.log();

    if (!wethWhitelistedAfter) {
      console.error('❌ Error: WETH whitelisting failed');
      process.exit(1);
    }

    // Whitelist USDC
    console.log('Processing USDC...');
    const usdcWhitelistedBefore = await executor.whitelistedAssets(USDC_BASE);
    console.log(`  Current status: ${usdcWhitelistedBefore}`);

    if (!usdcWhitelistedBefore) {
      console.log('  Sending setWhitelist transaction...');
      const usdcTx = await executor.setWhitelist(USDC_BASE, true);
      console.log(`  Transaction hash: ${usdcTx.hash}`);
      console.log('  Waiting for confirmation...');
      await usdcTx.wait();
      console.log('  ✅ Transaction confirmed');
    } else {
      console.log('  ℹ️  USDC already whitelisted, skipping');
    }

    // Verify USDC whitelisting
    const usdcWhitelistedAfter = await executor.whitelistedAssets(USDC_BASE);
    console.log(`  USDC whitelisted: ${usdcWhitelistedAfter}`);
    console.log();

    if (!usdcWhitelistedAfter) {
      console.error('❌ Error: USDC whitelisting failed');
      process.exit(1);
    }

    // Summary
    console.log('='.repeat(80));
    console.log('✅ Whitelisting Complete');
    console.log('='.repeat(80));
    console.log(`  WETH whitelisted: ${wethWhitelistedAfter}`);
    console.log(`  USDC whitelisted: ${usdcWhitelistedAfter}`);
    console.log();
    console.log('The LiquidationExecutor is now ready to process liquidations with WETH and USDC.');
    console.log();

    process.exit(0);
  } catch (error) {
    console.error('❌ Error during whitelisting:');
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
      if ('code' in error) {
        console.error(`   Code: ${(error as { code?: string }).code}`);
      }
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

main();
