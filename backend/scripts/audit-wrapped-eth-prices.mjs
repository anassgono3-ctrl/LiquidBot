#!/usr/bin/env node
/**
 * audit-wrapped-eth-prices.mjs
 * 
 * Validates wrapped ETH (wstETH, weETH) pricing on Base by:
 * 1. Fetching ratio feed (TOKEN/ETH) from Chainlink
 * 2. Fetching ETH/USD from Chainlink
 * 3. Computing composed USD price
 * 4. Comparing to Aave oracle price
 * 5. Reporting mismatch percentage
 * 
 * Usage:
 *   npm run audit:wrapped
 */

import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

// Chainlink Aggregator V3 Interface ABI
const AGGREGATOR_V3_ABI = [
  'function decimals() external view returns (uint8)',
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function description() external view returns (string)'
];

// Aave Oracle ABI
const AAVE_ORACLE_ABI = [
  'function getAssetPrice(address asset) external view returns (uint256)'
];

// Base currency unit for Aave oracle (8 decimals)
const BASE_CURRENCY_UNIT = 10n ** 8n;

// Configuration
const RPC_URL = process.env.CHAINLINK_RPC_URL || process.env.RPC_URL || 'https://mainnet.base.org';
const AAVE_ORACLE = process.env.AAVE_ORACLE || '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156';

// Feed addresses on Base (from .env.example)
const FEEDS = {
  WETH: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
  WSTETH_ETH: '0x43a5C292A453A3bF3606fa856197f09D7B74251a',
  WEETH_ETH: '0xFC1415403EbB0c693f9a7844b92aD2Ff24775C65'
};

// Token addresses for Aave oracle queries
const TOKENS = {
  WSTETH: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452',
  WEETH: '0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A'
};

/**
 * Fetch price from Chainlink feed
 */
async function fetchChainlinkPrice(provider, feedAddress, symbol) {
  try {
    const aggregator = new ethers.Contract(feedAddress, AGGREGATOR_V3_ABI, provider);
    
    const [decimals, roundData, description] = await Promise.all([
      aggregator.decimals(),
      aggregator.latestRoundData(),
      aggregator.description().catch(() => symbol)
    ]);
    
    const [roundId, answer, , updatedAt, answeredInRound] = roundData;
    
    if (answer <= 0n) {
      throw new Error(`Invalid answer: ${answer}`);
    }
    
    if (answeredInRound < roundId) {
      console.warn(`⚠️  Stale data for ${symbol}: answeredInRound=${answeredInRound} < roundId=${roundId}`);
    }
    
    const divisor = 10n ** BigInt(decimals);
    const integerPart = answer / divisor;
    const fractionalPart = answer % divisor;
    const price = Number(integerPart) + Number(fractionalPart) / Number(divisor);
    
    const now = Math.floor(Date.now() / 1000);
    const age = now - Number(updatedAt);
    
    return {
      price,
      decimals: Number(decimals),
      updatedAt: Number(updatedAt),
      age,
      description,
      roundId: Number(roundId)
    };
  } catch (error) {
    console.error(`❌ Failed to fetch ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Fetch price from Aave oracle
 */
async function fetchAaveOraclePrice(provider, tokenAddress, symbol) {
  try {
    const oracle = new ethers.Contract(AAVE_ORACLE, AAVE_ORACLE_ABI, provider);
    const priceRaw = await oracle.getAssetPrice(tokenAddress);
    
    if (priceRaw <= 0n) {
      throw new Error(`Invalid oracle price: ${priceRaw}`);
    }
    
    // Aave oracle returns price in base currency units (8 decimals)
    const price = Number(priceRaw) / Number(BASE_CURRENCY_UNIT);
    
    return { price, priceRaw };
  } catch (error) {
    console.error(`❌ Failed to fetch Aave oracle price for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Audit a wrapped ETH asset
 */
async function auditWrappedAsset(provider, assetSymbol, ratioFeedAddress, tokenAddress) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Auditing ${assetSymbol}`);
  console.log('='.repeat(60));
  
  // Fetch ratio feed (TOKEN/ETH)
  console.log(`\n1️⃣  Fetching ${assetSymbol}/ETH ratio...`);
  const ratioData = await fetchChainlinkPrice(provider, ratioFeedAddress, `${assetSymbol}/ETH`);
  if (!ratioData) {
    console.log(`❌ Failed to fetch ratio feed for ${assetSymbol}`);
    return;
  }
  
  console.log(`   ✅ Ratio: ${ratioData.price.toFixed(6)}`);
  console.log(`   📊 Decimals: ${ratioData.decimals}`);
  console.log(`   🕐 Age: ${ratioData.age}s`);
  console.log(`   📝 Description: ${ratioData.description}`);
  
  // Fetch ETH/USD feed
  console.log(`\n2️⃣  Fetching ETH/USD price...`);
  const ethData = await fetchChainlinkPrice(provider, FEEDS.WETH, 'ETH/USD');
  if (!ethData) {
    console.log(`❌ Failed to fetch ETH/USD feed`);
    return;
  }
  
  console.log(`   ✅ ETH/USD: $${ethData.price.toFixed(2)}`);
  console.log(`   📊 Decimals: ${ethData.decimals}`);
  console.log(`   🕐 Age: ${ethData.age}s`);
  console.log(`   📝 Description: ${ethData.description}`);
  
  // Compose price
  const composedPrice = ratioData.price * ethData.price;
  console.log(`\n3️⃣  Composed ${assetSymbol}/USD price:`);
  console.log(`   ✅ ${assetSymbol}/USD: $${composedPrice.toFixed(2)}`);
  console.log(`   📐 Formula: ${ratioData.price.toFixed(6)} × $${ethData.price.toFixed(2)} = $${composedPrice.toFixed(2)}`);
  
  // Fetch Aave oracle price
  console.log(`\n4️⃣  Fetching Aave oracle price...`);
  const aaveData = await fetchAaveOraclePrice(provider, tokenAddress, assetSymbol);
  if (!aaveData) {
    console.log(`❌ Failed to fetch Aave oracle price for ${assetSymbol}`);
    return;
  }
  
  console.log(`   ✅ Aave oracle: $${aaveData.price.toFixed(2)}`);
  
  // Calculate mismatch
  const mismatchPct = ((composedPrice - aaveData.price) / aaveData.price) * 100;
  const absMismatch = Math.abs(mismatchPct);
  
  console.log(`\n5️⃣  Price comparison:`);
  console.log(`   Chainlink composed: $${composedPrice.toFixed(2)}`);
  console.log(`   Aave oracle:        $${aaveData.price.toFixed(2)}`);
  console.log(`   Mismatch:           ${mismatchPct >= 0 ? '+' : ''}${mismatchPct.toFixed(2)}%`);
  
  // Verdict
  if (absMismatch <= 1.0) {
    console.log(`   ✅ PASS: Mismatch within ±1% threshold`);
  } else if (absMismatch <= 5.0) {
    console.log(`   ⚠️  WARNING: Mismatch between 1-5% (investigate)`);
  } else {
    console.log(`   ❌ FAIL: Mismatch exceeds 5% (critical)`);
  }
  
  return {
    symbol: assetSymbol,
    composedPrice,
    aavePrice: aaveData.price,
    mismatchPct,
    pass: absMismatch <= 1.0
  };
}

/**
 * Main execution
 */
async function main() {
  console.log('🔍 Wrapped ETH Price Audit on Base Network\n');
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Aave Oracle: ${AAVE_ORACLE}\n`);
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  // Test connection
  try {
    const network = await provider.getNetwork();
    console.log(`✅ Connected to chain ID: ${network.chainId}\n`);
  } catch (error) {
    console.error('❌ Failed to connect to RPC:', error.message);
    process.exit(1);
  }
  
  // Audit each wrapped asset
  const results = [];
  
  if (FEEDS.WSTETH_ETH && TOKENS.WSTETH) {
    const result = await auditWrappedAsset(provider, 'wstETH', FEEDS.WSTETH_ETH, TOKENS.WSTETH);
    if (result) results.push(result);
  }
  
  if (FEEDS.WEETH_ETH && TOKENS.WEETH) {
    const result = await auditWrappedAsset(provider, 'weETH', FEEDS.WEETH_ETH, TOKENS.WEETH);
    if (result) results.push(result);
  }
  
  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('Summary');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  
  console.log(`\n✅ Passed: ${passed}/${total}`);
  
  if (passed === total) {
    console.log('\n🎉 All wrapped ETH assets have accurate pricing!\n');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some assets have price discrepancies. Review above.\n');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
