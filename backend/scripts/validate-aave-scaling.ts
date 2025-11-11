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
  const result: { rpc?: string; users: string[]; raw?: boolean } = { users: [] };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--rpc' && i + 1 < args.length) {
      result.rpc = args[++i];
    } else if ((arg === '--user' || arg === '--users') && i + 1 < args.length) {
      const value = args[++i];
      // Support comma-separated addresses
      const addresses = value.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0);
      result.users.push(...addresses);
    } else if (arg === '--raw') {
      result.raw = true;
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

// Get dust threshold from environment or use default
const DUST_THRESHOLD_WEI = BigInt(process.env.VALIDATOR_DUST_WEI || '1000000000000'); // 1e12 wei by default

// Format USD value with adaptive precision
function formatUsdAdaptive(value: number): string {
  if (value < 0.01) {
    return value.toFixed(6);
  }
  return value.toFixed(2);
}

// Format ETH base amount without scientific notation
function formatEthBase(value: bigint): string {
  const valueStr = ethers.formatEther(value);
  // Trim trailing zeros but keep at least one decimal place
  return parseFloat(valueStr).toString();
}

async function validateUser(
  userAddress: string,
  pool: ethers.Contract,
  protocolDataProvider: ethers.Contract,
  oracle: ethers.Contract,
  uiPoolDataProvider: ethers.Contract,
  ethUsdFeed: ethers.Contract,
  showRaw: boolean
): Promise<{ success: boolean; realIssue: boolean }> {
  console.log('='.repeat(80));
  console.log(`Validating User: ${userAddress}`);
  console.log('='.repeat(80));
  console.log('');
  
  try {
    // Step 1: Get canonical user account data
    console.log('Step 1: Fetching canonical user account data...');
    console.log('-'.repeat(80));
    
    const accountData = await pool.getUserAccountData(userAddress);
    const totalCollateralBase = accountData[0];
    const totalDebtBase = accountData[1];
    const healthFactor = accountData[5];
    
    console.log(`Total Collateral Base (ETH): ${formatEthBase(totalCollateralBase)} ETH`);
    console.log(`Total Debt Base (ETH):       ${formatEthBase(totalDebtBase)} ETH`);
    
    // Display health factor as "INF" when debt == 0
    let hfDisplay: string;
    if (totalDebtBase === 0n) {
      hfDisplay = 'INF';
    } else {
      hfDisplay = (Number(healthFactor) / 1e18).toFixed(6);
    }
    console.log(`Health Factor:               ${hfDisplay}`);
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
    
    console.log(`Total Collateral USD: $${formatUsdAdaptive(totalCollateralUsd)}`);
    console.log(`Total Debt USD:       $${formatUsdAdaptive(totalDebtUsd)}`);
    
    // Add reason for HF < 1 if applicable
    if (healthFactor < BigInt(1e18) && totalDebtBase > 0n) {
      console.log('');
      console.log(`⚠️  Reason for HF<1: collateralUSD=$${formatUsdAdaptive(totalCollateralUsd)}, debtUSD=$${formatUsdAdaptive(totalDebtUsd)}`);
    }
    console.log('');
    
    // Step 4: Get all reserves and validate per-asset breakdown
    console.log('Step 4: Validating per-asset breakdown...');
    console.log('-'.repeat(80));
    
    const reserves = await uiPoolDataProvider.getReservesList(BASE_ADDRESSES.addressesProvider);
    console.log(`Found ${reserves.length} reserves`);
    console.log('');
    
    let totalDebtRecomputedUsd = 0;
    let totalCollateralRecomputedUsd = 0;
    let smallestNonZeroDebt = Number.POSITIVE_INFINITY;
    let smallestNonZeroCollateral = Number.POSITIVE_INFINITY;
    const validatedAssets: Array<{
      symbol: string;
      debt: string;
      collateral: string;
      debtUsd: number;
      collateralUsd: number;
      warnings: string[];
      isDust: boolean;
      rawDebt?: bigint;
      rawCollateral?: bigint;
    }> = [];
    
    for (const asset of reserves) {
      try {
        // Get asset metadata
        const token = new ethers.Contract(asset, ERC20_ABI, pool.runner);
        const symbol = await token.symbol();
        const decimals = Number(await token.decimals());
        const totalSupply = await token.totalSupply();
        
        // Get user reserve data
        const userData = await protocolDataProvider.getUserReserveData(asset, userAddress);
        const aTokenBalance = userData[0];
        const currentStableDebt = userData[1];
        const currentVariableDebt = userData[2];
        const scaledVariableDebt = userData[4];
        
        // Check if position exists (include any non-zero raw values)
        const hasPosition = aTokenBalance > 0n || currentStableDebt > 0n || currentVariableDebt > 0n || scaledVariableDebt > 0n;
        
        if (!hasPosition) {
          continue;
        }
        
        const warnings: string[] = [];
        let isDust = false;
        
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
        
        // Check dust threshold
        if (totalDebt < DUST_THRESHOLD_WEI && aTokenBalance < DUST_THRESHOLD_WEI) {
          isDust = true;
        }
        
        // Track smallest non-zero values
        if (debtUsd > 0 && debtUsd < smallestNonZeroDebt) {
          smallestNonZeroDebt = debtUsd;
        }
        if (collateralUsd > 0 && collateralUsd < smallestNonZeroCollateral) {
          smallestNonZeroCollateral = collateralUsd;
        }
        
        totalDebtRecomputedUsd += debtUsd;
        totalCollateralRecomputedUsd += collateralUsd;
        
        const assetInfo: {
          symbol: string;
          debt: string;
          collateral: string;
          debtUsd: number;
          collateralUsd: number;
          warnings: string[];
          isDust: boolean;
          rawDebt?: bigint;
          rawCollateral?: bigint;
        } = {
          symbol,
          debt: formatTokenAmount(totalDebt, decimals),
          collateral: formatTokenAmount(aTokenBalance, decimals),
          debtUsd,
          collateralUsd,
          warnings,
          isDust
        };
        
        if (showRaw) {
          assetInfo.rawDebt = totalDebt;
          assetInfo.rawCollateral = aTokenBalance;
        }
        
        validatedAssets.push(assetInfo);
        
      } catch (error) {
        // Skip assets that error
        continue;
      }
    }
    
    // Display per-asset results
    console.log('Per-Asset Breakdown:');
    console.log('');
    for (const asset of validatedAssets) {
      const dustTag = asset.isDust ? ' (dust)' : '';
      console.log(`${asset.symbol}${dustTag}:`);
      console.log(`  Debt:       ${asset.debt} ($${formatUsdAdaptive(asset.debtUsd)})`);
      console.log(`  Collateral: ${asset.collateral} ($${formatUsdAdaptive(asset.collateralUsd)})`);
      if (showRaw) {
        console.log(`  Raw Debt:       ${asset.rawDebt?.toString() || '0'} wei`);
        console.log(`  Raw Collateral: ${asset.rawCollateral?.toString() || '0'} wei`);
      }
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
    
    // Summary line for smallest non-zero values
    if (smallestNonZeroDebt !== Number.POSITIVE_INFINITY || smallestNonZeroCollateral !== Number.POSITIVE_INFINITY) {
      console.log('Smallest Non-Zero Values:');
      if (smallestNonZeroDebt !== Number.POSITIVE_INFINITY) {
        console.log(`  Debt:       $${formatUsdAdaptive(smallestNonZeroDebt)}`);
      }
      if (smallestNonZeroCollateral !== Number.POSITIVE_INFINITY) {
        console.log(`  Collateral: $${formatUsdAdaptive(smallestNonZeroCollateral)}`);
      }
      console.log('');
    }
    
    // Step 5: Validate consistency
    console.log('Step 5: Consistency Check');
    console.log('-'.repeat(80));
    
    console.log(`Canonical Total Debt (USD):       $${formatUsdAdaptive(totalDebtUsd)}`);
    console.log(`Recomputed Total Debt (USD):      $${formatUsdAdaptive(totalDebtRecomputedUsd)}`);
    
    const debtDiff = Math.abs(totalDebtUsd - totalDebtRecomputedUsd);
    let debtDiffPct: number;
    let debtCheckPassed = false;
    
    // Handle zero/zero case properly
    if (totalDebtUsd === 0 && totalDebtRecomputedUsd === 0) {
      debtDiffPct = 0;
      debtCheckPassed = true;
    } else if (totalDebtUsd > 0) {
      debtDiffPct = (debtDiff / totalDebtUsd) * 100;
      debtCheckPassed = debtDiffPct <= 0.5;
    } else {
      debtDiffPct = 100;
      debtCheckPassed = false;
    }
    
    console.log(`Debt Difference:                  $${formatUsdAdaptive(debtDiff)} (${debtDiffPct.toFixed(2)}%)`);
    
    if (debtCheckPassed) {
      console.log(`✓ Debt consistency check passed`);
    } else {
      console.log(`⚠️  WARNING: Debt difference exceeds 0.5% tolerance`);
    }
    console.log('');
    
    console.log(`Canonical Total Collateral (USD): $${formatUsdAdaptive(totalCollateralUsd)}`);
    console.log(`Recomputed Total Collateral (USD):$${formatUsdAdaptive(totalCollateralRecomputedUsd)}`);
    
    const collateralDiff = Math.abs(totalCollateralUsd - totalCollateralRecomputedUsd);
    let collateralDiffPct: number;
    let collateralCheckPassed = false;
    
    // Handle zero/zero case properly
    if (totalCollateralUsd === 0 && totalCollateralRecomputedUsd === 0) {
      collateralDiffPct = 0;
      collateralCheckPassed = true;
    } else if (totalCollateralUsd > 0) {
      collateralDiffPct = (collateralDiff / totalCollateralUsd) * 100;
      collateralCheckPassed = collateralDiffPct <= 0.5;
    } else {
      collateralDiffPct = 100;
      collateralCheckPassed = false;
    }
    
    console.log(`Collateral Difference:            $${formatUsdAdaptive(collateralDiff)} (${collateralDiffPct.toFixed(2)}%)`);
    
    if (collateralCheckPassed) {
      console.log(`✓ Collateral consistency check passed`);
    } else {
      console.log(`⚠️  WARNING: Collateral difference exceeds 0.5% tolerance`);
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
    console.log(`Debt Consistency:     ${debtCheckPassed ? '✓ PASS' : '⚠️  FAIL'}`);
    console.log(`Collateral Consistency: ${collateralCheckPassed ? '✓ PASS' : '⚠️  FAIL'}`);
    console.log('');
    
    // Determine if there's a real issue (not just dust)
    const realIssue = (totalWarnings > 0 || !debtCheckPassed || !collateralCheckPassed) && 
                      (totalDebtUsd > 0.01 || totalCollateralUsd > 0.01);
    
    if (totalWarnings === 0 && debtCheckPassed && collateralCheckPassed) {
      console.log('✓ All validation checks passed!');
      return { success: true, realIssue: false };
    } else if (!realIssue) {
      console.log('✓ Only dust-level inconsistencies detected (not actionable)');
      return { success: true, realIssue: false };
    } else {
      console.log('⚠️  Some validation checks failed. Review warnings above.');
      return { success: false, realIssue: true };
    }
    
  } catch (error) {
    console.error('Error during validation:', error);
    return { success: false, realIssue: true };
  }
}

async function main() {
  const args = parseArgs();
  
  if (!args.rpc || args.users.length === 0) {
    console.error('Usage: tsx scripts/validate-aave-scaling.ts --rpc <RPC_URL> --user <USER_ADDRESS> [--user <USER_ADDRESS2>] [--raw]');
    console.error('   or: tsx scripts/validate-aave-scaling.ts --rpc <RPC_URL> --users <ADDR1>,<ADDR2>,... [--raw]');
    console.error('');
    console.error('Options:');
    console.error('  --rpc <URL>          RPC endpoint URL');
    console.error('  --user <ADDRESS>     User address to validate (can be repeated)');
    console.error('  --users <ADDRESSES>  Comma-separated list of user addresses');
    console.error('  --raw                Show raw bigint values for debugging');
    console.error('');
    console.error('Environment Variables:');
    console.error('  VALIDATOR_DUST_WEI   Dust threshold in wei (default: 1e12)');
    process.exit(1);
  }
  
  console.log('='.repeat(80));
  console.log('Aave V3 Accounting Pipeline Validation');
  console.log('='.repeat(80));
  console.log(`RPC URL: ${args.rpc}`);
  console.log(`User Addresses: ${args.users.join(', ')}`);
  console.log(`Dust Threshold: ${DUST_THRESHOLD_WEI.toString()} wei`);
  if (args.raw) {
    console.log('Raw values: enabled');
  }
  console.log('');
  
  // Initialize provider and contracts
  const provider = new ethers.JsonRpcProvider(args.rpc);
  const pool = new ethers.Contract(BASE_ADDRESSES.pool, POOL_ABI, provider);
  const protocolDataProvider = new ethers.Contract(BASE_ADDRESSES.protocolDataProvider, PROTOCOL_DATA_PROVIDER_ABI, provider);
  const oracle = new ethers.Contract(BASE_ADDRESSES.oracle, ORACLE_ABI, provider);
  const uiPoolDataProvider = new ethers.Contract(BASE_ADDRESSES.uiPoolDataProvider, UI_POOL_DATA_PROVIDER_ABI, provider);
  const ethUsdFeed = new ethers.Contract(BASE_ADDRESSES.ethUsdFeed, CHAINLINK_AGGREGATOR_ABI, provider);
  
  // Validate each user
  let anyRealIssue = false;
  for (let i = 0; i < args.users.length; i++) {
    const user = args.users[i];
    
    if (i > 0) {
      console.log('\n\n');
    }
    
    const result = await validateUser(
      user,
      pool,
      protocolDataProvider,
      oracle,
      uiPoolDataProvider,
      ethUsdFeed,
      args.raw || false
    );
    
    if (result.realIssue) {
      anyRealIssue = true;
    }
  }
  
  // Exit with appropriate code
  if (anyRealIssue) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main();
