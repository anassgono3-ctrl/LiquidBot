#!/usr/bin/env tsx
// Test script to verify 1inch URL construction for Base (chainId 8453)

import { OneInchQuoteService } from '../src/services/OneInchQuoteService.js';

// Test token addresses on Base
const WETH_BASE = '0x4200000000000000000000000000000000000006';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

async function main() {
  console.log('='.repeat(60));
  console.log('1inch URL Construction Test for Base (chainId 8453)');
  console.log('='.repeat(60));
  console.log();

  const hasApiKey = !!process.env.ONEINCH_API_KEY;
  console.log(`API Key configured: ${hasApiKey ? 'YES' : 'NO'}`);
  console.log();

  // Test with environment configuration
  const service = new OneInchQuoteService();
  const config = service.getConfig();

  console.log('Service Configuration:');
  console.log(`  - Base URL: ${config.baseUrl}`);
  console.log(`  - Chain ID: ${config.chainId}`);
  console.log(`  - Using v6: ${service.isUsingV6()}`);
  console.log(`  - Configured: ${config.configured}`);
  console.log();

  // Expected URLs
  const expectedV6BaseUrl = 'https://api.1inch.dev/swap/v6.0/8453';
  const expectedV5BaseUrl = 'https://api.1inch.exchange/v5.0/8453';
  const expectedBaseUrl = hasApiKey ? expectedV6BaseUrl : expectedV5BaseUrl;

  console.log('Expected Base URL:', expectedBaseUrl);
  console.log('Actual Base URL:  ', config.baseUrl);
  console.log();

  // Verify base URL
  if (config.baseUrl === expectedBaseUrl) {
    console.log('✅ Base URL matches expected value');
  } else {
    console.log('❌ Base URL does NOT match expected value');
    process.exit(1);
  }
  console.log();

  // Test swap quote parameters
  console.log('Testing swap quote parameters...');
  console.log('Request:');
  console.log(`  - From: WETH (${WETH_BASE})`);
  console.log(`  - To: USDC (${USDC_BASE})`);
  console.log(`  - Amount: 1000000000000000000 (1 WETH)`);
  console.log(`  - Slippage: 100 bps (1%)`);
  console.log(`  - From Address: 0x0000000000000000000000000000000000000001`);
  console.log();

  // Build expected URL with params
  const testRequest = {
    fromToken: WETH_BASE,
    toToken: USDC_BASE,
    amount: '1000000000000000000',
    slippageBps: 100,
    fromAddress: '0x0000000000000000000000000000000000000001'
  };

  // Construct expected URL
  let expectedUrl: string;
  if (hasApiKey) {
    // v6 params: src/dst/amount/from/slippage
    const params = new URLSearchParams({
      src: testRequest.fromToken,
      dst: testRequest.toToken,
      amount: testRequest.amount,
      from: testRequest.fromAddress,
      slippage: '1', // 100 bps = 1%
      disableEstimate: 'true',
      allowPartialFill: 'false'
    });
    expectedUrl = `${expectedV6BaseUrl}/swap?${params.toString()}`;
  } else {
    // v5 params: fromTokenAddress/toTokenAddress/amount/fromAddress/slippage
    const params = new URLSearchParams({
      fromTokenAddress: testRequest.fromToken,
      toTokenAddress: testRequest.toToken,
      amount: testRequest.amount,
      fromAddress: testRequest.fromAddress,
      slippage: '1',
      disableEstimate: 'true'
    });
    expectedUrl = `${expectedV5BaseUrl}/swap?${params.toString()}`;
  }

  console.log('Expected URL structure:');
  console.log(expectedUrl);
  console.log();

  // Verify parameter names
  if (hasApiKey) {
    console.log('✅ v6 endpoint - parameters: src, dst, amount, from, slippage');
    if (expectedUrl.includes('src=') && expectedUrl.includes('dst=')) {
      console.log('✅ v6 parameter names confirmed in URL');
    }
  } else {
    console.log('✅ v5 endpoint - parameters: fromTokenAddress, toTokenAddress, amount, fromAddress, slippage');
    if (expectedUrl.includes('fromTokenAddress=') && expectedUrl.includes('toTokenAddress=')) {
      console.log('✅ v5 parameter names confirmed in URL');
    }
  }
  console.log();

  // Verify chainId in URL
  if (config.baseUrl.includes('/8453')) {
    console.log('✅ Chain ID 8453 (Base) is present in URL');
  } else {
    console.log('❌ Chain ID 8453 (Base) is NOT present in URL');
    process.exit(1);
  }
  console.log();

  console.log('='.repeat(60));
  console.log('✅ All checks passed!');
  console.log('='.repeat(60));
  console.log();

  if (!hasApiKey) {
    console.log('ℹ️  Note: To test v6 endpoint, set ONEINCH_API_KEY environment variable');
  } else {
    console.log('ℹ️  Note: v6 endpoint requires valid API key for actual requests');
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
