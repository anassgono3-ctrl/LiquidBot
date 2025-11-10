#!/usr/bin/env node
/**
 * e2e-repay-sanity.mjs
 * 
 * End-to-end repay calculation sanity test.
 * Given debt asset parameters, validates that repayUsd > 0.
 * 
 * Usage:
 *   npm run test:repay -- --debtAsset=WSTETH --scaledDebt=1000000000000000000 \
 *                         --borrowIndex=1050000000000000000000000000 --decimals=18 \
 *                         --liquidationBonus=500 --closeFactor=5000
 * 
 * Or with environment:
 *   DEBT_ASSET=WSTETH SCALED_DEBT=1000000000000000000 \
 *   BORROW_INDEX=1050000000000000000000000000 DECIMALS=18 \
 *   LIQUIDATION_BONUS=500 CLOSE_FACTOR=5000 npm run test:repay
 */

import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

// Parse CLI arguments
function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      args[key] = value;
    }
  });
  return args;
}

// Chainlink Aggregator V3 Interface ABI
const AGGREGATOR_V3_ABI = [
  'function decimals() external view returns (uint8)',
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
];

// Aave Oracle ABI
const AAVE_ORACLE_ABI = [
  'function getAssetPrice(address asset) external view returns (uint256)'
];

// Configuration from environment or args
function getConfig(args) {
  return {
    rpcUrl: process.env.CHAINLINK_RPC_URL || process.env.RPC_URL || 'https://mainnet.base.org',
    debtAsset: args.debtAsset || process.env.DEBT_ASSET || 'WSTETH',
    scaledDebt: args.scaledDebt || process.env.SCALED_DEBT || '1000000000000000000', // 1 token in wei
    borrowIndex: args.borrowIndex || process.env.BORROW_INDEX || '1050000000000000000000000000', // 1.05 ray
    decimals: parseInt(args.decimals || process.env.DECIMALS || '18'),
    liquidationBonus: parseInt(args.liquidationBonus || process.env.LIQUIDATION_BONUS || '500'), // 5%
    closeFactor: parseInt(args.closeFactor || process.env.CLOSE_FACTOR || '5000'), // 50%
    aaveOracle: process.env.AAVE_ORACLE || '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156',
    chainlinkFeeds: process.env.CHAINLINK_FEEDS || 'WETH:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70,WSTETH_ETH:0x43a5C292A453A3bF3606fa856197f09D7B74251a,WEETH_ETH:0xFC1415403EbB0c693f9a7844b92aD2Ff24775C65'
  };
}

// Parse Chainlink feeds configuration
function parseFeeds(feedsStr) {
  const feeds = new Map();
  const ratioFeeds = new Map();
  
  feedsStr.split(',').forEach(pair => {
    const [symbol, address] = pair.split(':').map(s => s.trim());
    if (symbol && address) {
      const upperSymbol = symbol.toUpperCase();
      feeds.set(upperSymbol, address);
      
      // Detect ratio feeds
      if (upperSymbol.endsWith('_ETH')) {
        const underlyingSymbol = upperSymbol.replace(/_ETH$/, '');
        ratioFeeds.set(underlyingSymbol, upperSymbol);
      }
    }
  });
  
  return { feeds, ratioFeeds };
}

// Fetch price from Chainlink (with ratio composition support)
async function fetchPrice(provider, symbol, feeds, ratioFeeds) {
  const upperSymbol = symbol.toUpperCase();
  
  // Try direct USD feed first
  if (feeds.has(upperSymbol)) {
    return await fetchDirectPrice(provider, upperSymbol, feeds.get(upperSymbol));
  }
  
  // Try ratio feed composition
  if (ratioFeeds.has(upperSymbol)) {
    return await fetchRatioPrice(provider, upperSymbol, ratioFeeds.get(upperSymbol), feeds);
  }
  
  throw new Error(`No price feed configured for ${symbol}`);
}

// Fetch direct USD price from Chainlink
async function fetchDirectPrice(provider, symbol, feedAddress) {
  const aggregator = new ethers.Contract(feedAddress, AGGREGATOR_V3_ABI, provider);
  
  const [decimals, roundData] = await Promise.all([
    aggregator.decimals(),
    aggregator.latestRoundData()
  ]);
  
  const answer = roundData[1];
  
  if (answer <= 0n) {
    throw new Error(`Invalid answer for ${symbol}: ${answer}`);
  }
  
  const divisor = 10n ** BigInt(decimals);
  const integerPart = answer / divisor;
  const fractionalPart = answer % divisor;
  const price = Number(integerPart) + Number(fractionalPart) / Number(divisor);
  
  return { price, source: 'direct', feedAddress };
}

// Fetch ratio-composed price
async function fetchRatioPrice(provider, symbol, ratioFeedKey, feeds) {
  const ratioFeedAddress = feeds.get(ratioFeedKey);
  const ethFeedAddress = feeds.get('WETH') || feeds.get('ETH');
  
  if (!ratioFeedAddress || !ethFeedAddress) {
    throw new Error(`Missing feeds for ratio composition: ${symbol}`);
  }
  
  // Fetch ratio (TOKEN/ETH)
  const ratioAggregator = new ethers.Contract(ratioFeedAddress, AGGREGATOR_V3_ABI, provider);
  const [ratioDecimals, ratioRoundData] = await Promise.all([
    ratioAggregator.decimals(),
    ratioAggregator.latestRoundData()
  ]);
  
  const ratioAnswer = ratioRoundData[1];
  if (ratioAnswer <= 0n) {
    throw new Error(`Invalid ratio answer for ${symbol}: ${ratioAnswer}`);
  }
  
  // Fetch ETH/USD
  const ethAggregator = new ethers.Contract(ethFeedAddress, AGGREGATOR_V3_ABI, provider);
  const [ethDecimals, ethRoundData] = await Promise.all([
    ethAggregator.decimals(),
    ethAggregator.latestRoundData()
  ]);
  
  const ethAnswer = ethRoundData[1];
  if (ethAnswer <= 0n) {
    throw new Error(`Invalid ETH answer: ${ethAnswer}`);
  }
  
  // Compose price
  const ratioDivisor = 10n ** BigInt(ratioDecimals);
  const ethDivisor = 10n ** BigInt(ethDecimals);
  
  const numerator = BigInt(ratioAnswer.toString()) * BigInt(ethAnswer.toString());
  const denominator = ratioDivisor * ethDivisor;
  
  const integerPart = numerator / denominator;
  const fractionalPart = numerator % denominator;
  const price = Number(integerPart) + Number(fractionalPart) / Number(denominator);
  
  return { price, source: 'ratio', ratioFeedAddress, ethFeedAddress };
}

// Calculate repay amount
function calculateRepay(scaledDebt, borrowIndex, decimals, closeFactor) {
  // Convert to BigInt
  const scaledDebtBigInt = BigInt(scaledDebt);
  const borrowIndexBigInt = BigInt(borrowIndex);
  const closeFactorBigInt = BigInt(closeFactor);
  
  // Calculate total debt: scaledDebt * borrowIndex / 1e27 (ray)
  const RAY = 10n ** 27n;
  const totalDebt = (scaledDebtBigInt * borrowIndexBigInt) / RAY;
  
  // Apply close factor: totalDebt * closeFactor / 10000 (bps)
  const BPS = 10000n;
  const debtToCover = (totalDebt * closeFactorBigInt) / BPS;
  
  return { totalDebt, debtToCover };
}

// Calculate USD value
function calculateUsdValue(amount, decimals, priceUsd) {
  const amountBigInt = BigInt(amount);
  const decimalsUnit = 10n ** BigInt(decimals);
  
  // Convert to float with proper scaling
  const amountFloat = Number(amountBigInt) / Number(decimalsUnit);
  const usdValue = amountFloat * priceUsd;
  
  return usdValue;
}

// Calculate expected profit
function calculateProfit(repayUsd, liquidationBonus) {
  const bonusPct = liquidationBonus / 100; // Convert bps to percentage
  const profit = repayUsd * bonusPct;
  return profit;
}

// Main execution
async function main() {
  const args = parseArgs();
  const config = getConfig(args);
  
  console.log('🧪 E2E Repay Sanity Test\n');
  console.log('Configuration:');
  console.log(`  Debt Asset:        ${config.debtAsset}`);
  console.log(`  Scaled Debt:       ${config.scaledDebt}`);
  console.log(`  Borrow Index:      ${config.borrowIndex}`);
  console.log(`  Decimals:          ${config.decimals}`);
  console.log(`  Liquidation Bonus: ${config.liquidationBonus} bps`);
  console.log(`  Close Factor:      ${config.closeFactor} bps`);
  console.log(`  RPC URL:           ${config.rpcUrl}`);
  console.log();
  
  // Initialize provider
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  
  // Test connection
  try {
    const network = await provider.getNetwork();
    console.log(`✅ Connected to chain ID: ${network.chainId}\n`);
  } catch (error) {
    console.error('❌ Failed to connect to RPC:', error.message);
    process.exit(1);
  }
  
  // Parse feeds
  const { feeds, ratioFeeds } = parseFeeds(config.chainlinkFeeds);
  console.log(`📊 Parsed ${feeds.size} price feeds (${ratioFeeds.size} ratio feeds)\n`);
  
  // Fetch price
  console.log(`1️⃣  Fetching ${config.debtAsset} price...`);
  let priceData;
  try {
    priceData = await fetchPrice(provider, config.debtAsset, feeds, ratioFeeds);
    console.log(`   ✅ Price: $${priceData.price.toFixed(2)}`);
    console.log(`   📡 Source: ${priceData.source}`);
    if (priceData.source === 'ratio') {
      console.log(`   🔗 Ratio feed: ${priceData.ratioFeedAddress}`);
      console.log(`   🔗 ETH feed: ${priceData.ethFeedAddress}`);
    } else {
      console.log(`   🔗 Feed: ${priceData.feedAddress}`);
    }
  } catch (error) {
    console.error(`   ❌ Failed to fetch price: ${error.message}`);
    process.exit(1);
  }
  
  // Calculate repay amount
  console.log(`\n2️⃣  Calculating repay amount...`);
  const { totalDebt, debtToCover } = calculateRepay(
    config.scaledDebt,
    config.borrowIndex,
    config.decimals,
    config.closeFactor
  );
  
  const totalDebtFloat = Number(totalDebt) / Number(10n ** BigInt(config.decimals));
  const debtToCoverFloat = Number(debtToCover) / Number(10n ** BigInt(config.decimals));
  
  console.log(`   Total Debt:     ${totalDebtFloat.toFixed(6)} ${config.debtAsset}`);
  console.log(`   Debt to Cover:  ${debtToCoverFloat.toFixed(6)} ${config.debtAsset} (${config.closeFactor / 100}%)`);
  
  // Calculate USD value
  console.log(`\n3️⃣  Calculating USD value...`);
  const repayUsd = calculateUsdValue(debtToCover, config.decimals, priceData.price);
  
  console.log(`   Repay USD:      $${repayUsd.toFixed(2)}`);
  
  // Calculate expected profit
  console.log(`\n4️⃣  Calculating expected profit...`);
  const expectedProfit = calculateProfit(repayUsd, config.liquidationBonus);
  
  console.log(`   Liquidation Bonus: ${config.liquidationBonus / 100}%`);
  console.log(`   Expected Profit:   $${expectedProfit.toFixed(2)}`);
  
  // Validation
  console.log(`\n5️⃣  Validation:`);
  
  let exitCode = 0;
  
  if (repayUsd <= 0) {
    console.log(`   ❌ FAIL: repayUsd is ${repayUsd} (must be > 0)`);
    exitCode = 1;
  } else {
    console.log(`   ✅ PASS: repayUsd > 0`);
  }
  
  if (expectedProfit <= 0) {
    console.log(`   ⚠️  WARNING: expectedProfit is ${expectedProfit.toFixed(2)}`);
  } else {
    console.log(`   ✅ PASS: expectedProfit > 0`);
  }
  
  if (priceData.price <= 0) {
    console.log(`   ❌ FAIL: price is ${priceData.price} (must be > 0)`);
    exitCode = 1;
  } else {
    console.log(`   ✅ PASS: price > 0`);
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  if (exitCode === 0) {
    console.log('✅ All validations passed!\n');
  } else {
    console.log('❌ Some validations failed!\n');
  }
  
  process.exit(exitCode);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
