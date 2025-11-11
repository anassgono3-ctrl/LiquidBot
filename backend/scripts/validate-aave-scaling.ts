#!/usr/bin/env tsx
/**
 * Validation script for Aave V3 accounting pipeline.
 * Fetches on-chain data and validates decimal conversions.
 * 
 * Usage:
 *   tsx scripts/validate-aave-scaling.ts --rpc <RPC_URL> --user <USER_ADDRESS>
 *   
 * Example:
 *   tsx scripts/validate-aave-scaling.ts \
 *     --rpc https://mainnet.base.org \
 *     --user 0x1234567890123456789012345678901234567890
 */

import { ethers } from 'ethers';

import { applyRay, usdValue, formatTokenAmount, baseToUsd, validateAmount } from '../src/utils/decimals.js';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const result: { rpc?: string; user?: string } = {};
  
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    
    if (key === '--rpc') {
      result.rpc = value;
    } else if (key === '--user') {
      result.user = value;
    }
  }
  
  return result;
}

// Aave Pool ABI
const POOL_ABI = [
  'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function getReserveData(address asset) external view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))'
];

// Aave Protocol Data Provider ABI
const PROTOCOL_DATA_PROVIDER_ABI = [
  'function getUserReserveData(address asset, address user) external view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)',
  'function getReserveConfigurationData(address asset) external view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)',
  'function getReserveTokensAddresses(address asset) external view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)'
];

// Aave Oracle ABI
const ORACLE_ABI = [
  'function getAssetPrice(address asset) external view returns (uint256)'
];

// UI Pool Data Provider ABI
const UI_POOL_DATA_PROVIDER_ABI = [
  'function getReservesList(address provider) external view returns (address[] memory)'
];

// ERC20 ABI
const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
  'function totalSupply() external view returns (uint256)'
];

// Chainlink Aggregator ABI
const CHAINLINK_AGGREGATOR_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)'
];

// Base mainnet addresses
const BASE_ADDRESSES = {
  pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  addressesProvider: '0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D',
  protocolDataProvider: '0xC4Fcf9893072d61Cc2899C0054877Cb752587981',
  oracle: '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156',
  uiPoolDataProvider: '0x68100bD5345eA474D93577127C11F39FF8463e93',
  ethUsdFeed: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70' // Chainlink ETH/USD on Base
};

async function main() {
  const args = parseArgs();
  
  if (!args.rpc || !args.user) {
    console.error('Usage: tsx scripts/validate-aave-scaling.ts --rpc <RPC_URL> --user <USER_ADDRESS>');
    process.exit(1);
  }
  
  console.log('='.repeat(80));
  console.log('Aave V3 Accounting Pipeline Validation');
  console.log('='.repeat(80));
  console.log(`RPC URL: ${args.rpc}`);
  console.log(`User Address: ${args.user}`);
  console.log('');
  
  // Initialize provider and contracts
  const provider = new ethers.JsonRpcProvider(args.rpc);
  const pool = new ethers.Contract(BASE_ADDRESSES.pool, POOL_ABI, provider);
  const protocolDataProvider = new ethers.Contract(BASE_ADDRESSES.protocolDataProvider, PROTOCOL_DATA_PROVIDER_ABI, provider);
  const oracle = new ethers.Contract(BASE_ADDRESSES.oracle, ORACLE_ABI, provider);
  const uiPoolDataProvider = new ethers.Contract(BASE_ADDRESSES.uiPoolDataProvider, UI_POOL_DATA_PROVIDER_ABI, provider);
  const ethUsdFeed = new ethers.Contract(BASE_ADDRESSES.ethUsdFeed, CHAINLINK_AGGREGATOR_ABI, provider);
  
  try {
    // Step 1: Get canonical user account data
    console.log('Step 1: Fetching canonical user account data...');
    console.log('-'.repeat(80));
    
    const accountData = await pool.getUserAccountData(args.user);
    const totalCollateralBase = accountData[0];
    const totalDebtBase = accountData[1];
    // const availableBorrowsBase = accountData[2];
    // const currentLiquidationThreshold = accountData[3];
    // const ltv = accountData[4];
    const healthFactor = accountData[5];
    
    console.log(`Total Collateral Base (ETH): ${ethers.formatEther(totalCollateralBase)} ETH`);
    console.log(`Total Debt Base (ETH):       ${ethers.formatEther(totalDebtBase)} ETH`);
    console.log(`Health Factor:               ${(Number(healthFactor) / 1e18).toFixed(6)}`);
    console.log('');
    
    // Step 2: Get ETH/USD price
    console.log('Step 2: Fetching ETH/USD price from Chainlink...');
    console.log('-'.repeat(80));
    
    const roundData = await ethUsdFeed.latestRoundData();
    const ethPrice = roundData[1];
    const ethPriceDecimals = Number(await ethUsdFeed.decimals());
    const ethPriceHuman = Number(ethPrice) / (10 ** ethPriceDecimals);
    
    console.log(`ETH/USD Price: $${ethPriceHuman.toFixed(2)} (${ethPriceDecimals} decimals)`);
    console.log('');
    
    // Step 3: Convert base amounts to USD
    console.log('Step 3: Converting base amounts to USD...');
    console.log('-'.repeat(80));
    
    const totalCollateralUsd = baseToUsd(totalCollateralBase, ethPrice, ethPriceDecimals);
    const totalDebtUsd = baseToUsd(totalDebtBase, ethPrice, ethPriceDecimals);
    
    console.log(`Total Collateral USD: $${totalCollateralUsd.toFixed(2)}`);
    console.log(`Total Debt USD:       $${totalDebtUsd.toFixed(2)}`);
    console.log('');
    
    // Step 4: Get all reserves and validate per-asset breakdown
    console.log('Step 4: Validating per-asset breakdown...');
    console.log('-'.repeat(80));
    
    const reserves = await uiPoolDataProvider.getReservesList(BASE_ADDRESSES.addressesProvider);
    console.log(`Found ${reserves.length} reserves`);
    console.log('');
    
    // let totalDebtRecomputed = 0n;
    // let totalCollateralRecomputed = 0n;
    let totalDebtRecomputedUsd = 0;
    let totalCollateralRecomputedUsd = 0;
    const validatedAssets: Array<{
      symbol: string;
      debt: string;
      collateral: string;
      debtUsd: number;
      collateralUsd: number;
      warnings: string[];
    }> = [];
    
    for (const asset of reserves) {
      try {
        // Get asset metadata
        const token = new ethers.Contract(asset, ERC20_ABI, provider);
        const symbol = await token.symbol();
        const decimals = Number(await token.decimals());
        const totalSupply = await token.totalSupply();
        
        // Get user reserve data
        const userData = await protocolDataProvider.getUserReserveData(asset, args.user);
        const aTokenBalance = userData[0];
        const currentStableDebt = userData[1];
        const currentVariableDebt = userData[2];
        const scaledVariableDebt = userData[4];
        
        // Skip if no position
        if (aTokenBalance === 0n && currentStableDebt === 0n && currentVariableDebt === 0n) {
          continue;
        }
        
        const warnings: string[] = [];
        
        // Get reserve data for borrow index
        const reserveData = await pool.getReserveData(asset);
        const variableBorrowIndex = BigInt(reserveData[0][3]); // currentVariableBorrowIndex
        
        // Expand scaled variable debt
        let principalVariableDebt = currentVariableDebt;
        if (scaledVariableDebt > 0n) {
          principalVariableDebt = applyRay(scaledVariableDebt, variableBorrowIndex);
          
          // Check consistency
          if (currentVariableDebt > 0n) {
            const diff = principalVariableDebt > currentVariableDebt 
              ? principalVariableDebt - currentVariableDebt 
              : currentVariableDebt - principalVariableDebt;
            const tolerance = principalVariableDebt / 1000n; // 0.1%
            
            if (diff > tolerance) {
              warnings.push(`Variable debt mismatch: reconstructed=${formatTokenAmount(principalVariableDebt, decimals)} vs current=${formatTokenAmount(currentVariableDebt, decimals)}`);
            }
          }
        }
        
        const totalDebt = principalVariableDebt + currentStableDebt;
        
        // Validate amounts
        const humanDebt = Number(totalDebt) / (10 ** decimals);
        const humanCollateral = Number(aTokenBalance) / (10 ** decimals);
        
        const debtValidation = validateAmount(humanDebt, symbol);
        if (!debtValidation.valid) {
          warnings.push(`SCALING ERROR: ${debtValidation.reason}`);
        }
        
        const collateralValidation = validateAmount(humanCollateral, symbol);
        if (!collateralValidation.valid) {
          warnings.push(`SCALING ERROR: ${collateralValidation.reason}`);
        }
        
        // Check against total supply
        const maxReasonable = (totalSupply * 105n) / 100n;
        if (totalDebt > maxReasonable) {
          warnings.push(`SCALING ERROR: Debt exceeds 105% of total supply`);
        }
        if (aTokenBalance > maxReasonable) {
          warnings.push(`SCALING ERROR: Collateral exceeds 105% of total supply`);
        }
        
        // Get price and calculate USD values
        const price = await oracle.getAssetPrice(asset);
        const debtUsd = usdValue(totalDebt, decimals, price, 8);
        const collateralUsd = usdValue(aTokenBalance, decimals, price, 8);
        
        // totalDebtRecomputed += totalDebt;
        // totalCollateralRecomputed += aTokenBalance;
        totalDebtRecomputedUsd += debtUsd;
        totalCollateralRecomputedUsd += collateralUsd;
        
        validatedAssets.push({
          symbol,
          debt: formatTokenAmount(totalDebt, decimals),
          collateral: formatTokenAmount(aTokenBalance, decimals),
          debtUsd,
          collateralUsd,
          warnings
        });
        
      } catch (error) {
        // Skip assets that error
        continue;
      }
    }
    
    // Display per-asset results
    console.log('Per-Asset Breakdown:');
    console.log('');
    for (const asset of validatedAssets) {
      console.log(`${asset.symbol}:`);
      console.log(`  Debt:       ${asset.debt} ($${asset.debtUsd.toFixed(2)})`);
      console.log(`  Collateral: ${asset.collateral} ($${asset.collateralUsd.toFixed(2)})`);
      if (asset.warnings.length > 0) {
        console.log(`  ⚠️  Warnings:`);
        for (const warning of asset.warnings) {
          console.log(`    - ${warning}`);
        }
      } else {
        console.log(`  ✓ No issues detected`);
      }
      console.log('');
    }
    
    // Step 5: Validate consistency
    console.log('Step 5: Consistency Check');
    console.log('-'.repeat(80));
    
    console.log(`Canonical Total Debt (USD):       $${totalDebtUsd.toFixed(2)}`);
    console.log(`Recomputed Total Debt (USD):      $${totalDebtRecomputedUsd.toFixed(2)}`);
    
    const debtDiff = Math.abs(totalDebtUsd - totalDebtRecomputedUsd);
    const debtDiffPct = totalDebtUsd > 0 ? (debtDiff / totalDebtUsd) * 100 : 0;
    console.log(`Debt Difference:                  $${debtDiff.toFixed(2)} (${debtDiffPct.toFixed(2)}%)`);
    
    if (debtDiffPct > 0.5) {
      console.log(`⚠️  WARNING: Debt difference exceeds 0.5% tolerance`);
    } else {
      console.log(`✓ Debt consistency check passed`);
    }
    console.log('');
    
    console.log(`Canonical Total Collateral (USD): $${totalCollateralUsd.toFixed(2)}`);
    console.log(`Recomputed Total Collateral (USD):$${totalCollateralRecomputedUsd.toFixed(2)}`);
    
    const collateralDiff = Math.abs(totalCollateralUsd - totalCollateralRecomputedUsd);
    const collateralDiffPct = totalCollateralUsd > 0 ? (collateralDiff / totalCollateralUsd) * 100 : 0;
    console.log(`Collateral Difference:            $${collateralDiff.toFixed(2)} (${collateralDiffPct.toFixed(2)}%)`);
    
    if (collateralDiffPct > 0.5) {
      console.log(`⚠️  WARNING: Collateral difference exceeds 0.5% tolerance`);
    } else {
      console.log(`✓ Collateral consistency check passed`);
    }
    console.log('');
    
    // Summary
    console.log('='.repeat(80));
    console.log('Validation Summary');
    console.log('='.repeat(80));
    
    const totalWarnings = validatedAssets.reduce((sum, a) => sum + a.warnings.length, 0);
    const assetsWithIssues = validatedAssets.filter(a => a.warnings.length > 0).length;
    
    console.log(`Assets Validated:     ${validatedAssets.length}`);
    console.log(`Assets with Issues:   ${assetsWithIssues}`);
    console.log(`Total Warnings:       ${totalWarnings}`);
    console.log(`Debt Consistency:     ${debtDiffPct <= 0.5 ? '✓ PASS' : '⚠️  FAIL'}`);
    console.log(`Collateral Consistency: ${collateralDiffPct <= 0.5 ? '✓ PASS' : '⚠️  FAIL'}`);
    console.log('');
    
    if (totalWarnings === 0 && debtDiffPct <= 0.5 && collateralDiffPct <= 0.5) {
      console.log('✓ All validation checks passed!');
      process.exit(0);
    } else {
      console.log('⚠️  Some validation checks failed. Review warnings above.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('Error during validation:', error);
    process.exit(1);
  }
}

main();
