// Test script to demonstrate shadow execution functionality
// This script manually triggers shadow execution to show the log output format

// Set required environment variables before importing modules
process.env.API_KEY = 'test_key';
process.env.JWT_SECRET = 'test_secret';
process.env.SHADOW_EXECUTE_ENABLED = 'true';
process.env.SHADOW_EXECUTE_THRESHOLD = '1.005';
process.env.GAS_TIP_GWEI_FAST = '3';
process.env.GAS_BUMP_FACTOR = '1.25';
process.env.TX_SUBMIT_MODE = 'public';

import { maybeShadowExecute, type ShadowExecCandidate } from '../src/exec/shadowExecution.js';

console.log('=== Shadow Execution Test ===\n');
console.log('Configuration:');
console.log(`  SHADOW_EXECUTE_ENABLED: ${process.env.SHADOW_EXECUTE_ENABLED}`);
console.log(`  SHADOW_EXECUTE_THRESHOLD: ${process.env.SHADOW_EXECUTE_THRESHOLD}`);
console.log(`  GAS_TIP_GWEI_FAST: ${process.env.GAS_TIP_GWEI_FAST}`);
console.log(`  GAS_BUMP_FACTOR: ${process.env.GAS_BUMP_FACTOR}`);
console.log(`  TX_SUBMIT_MODE: ${process.env.TX_SUBMIT_MODE}\n`);

console.log('Test Case 1: User with HF below threshold (should trigger shadow execution)');
const candidate1: ShadowExecCandidate = {
  user: '0x1234567890123456789012345678901234567890',
  healthFactor: 0.98,
  blockTag: 12345678,
  debtAsset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
  collateralAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
  debtAmountWei: BigInt('1000000000'), // 1000 USDC (6 decimals)
  collateralAmountWei: BigInt('500000000000000000') // 0.5 WETH
};
console.log(`  User: ${candidate1.user}`);
console.log(`  Health Factor: ${candidate1.healthFactor}`);
console.log(`  Block: ${candidate1.blockTag}`);
console.log('  Expected: Should produce SHADOW_EXECUTE JSON log\n');
maybeShadowExecute(candidate1);

console.log('\n---\n');

console.log('Test Case 2: User with HF above threshold (should NOT trigger)');
const candidate2: ShadowExecCandidate = {
  user: '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
  healthFactor: 1.05,
  blockTag: 12345679,
  debtAsset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  collateralAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  debtAmountWei: BigInt('2000000000'),
  collateralAmountWei: BigInt('1000000000000000000')
};
console.log(`  User: ${candidate2.user}`);
console.log(`  Health Factor: ${candidate2.healthFactor}`);
console.log(`  Block: ${candidate2.blockTag}`);
console.log('  Expected: No output (HF above threshold)\n');
maybeShadowExecute(candidate2);

console.log('\n---\n');

console.log('Test Case 3: User with pending blockTag');
const candidate3: ShadowExecCandidate = {
  user: '0x9876543210987654321098765432109876543210',
  healthFactor: 0.995,
  blockTag: 'pending',
  debtAsset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  collateralAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  debtAmountWei: BigInt('5000000000'),
  collateralAmountWei: BigInt('2500000000000000000')
};
console.log(`  User: ${candidate3.user}`);
console.log(`  Health Factor: ${candidate3.healthFactor}`);
console.log(`  Block: ${candidate3.blockTag}`);
console.log('  Expected: Should produce SHADOW_EXECUTE JSON log with blockTag="pending"\n');
maybeShadowExecute(candidate3);

console.log('\n---\n');

console.log('Test Case 4: Shadow execution disabled');
process.env.SHADOW_EXECUTE_ENABLED = 'false';
console.log('  Set SHADOW_EXECUTE_ENABLED=false');
const candidate4: ShadowExecCandidate = {
  user: '0xFEDCBA0987654321FEDCBA0987654321FEDCBA09',
  healthFactor: 0.90,
  blockTag: 12345680,
  debtAsset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  collateralAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  debtAmountWei: BigInt('10000000000'),
  collateralAmountWei: BigInt('5000000000000000000')
};
console.log(`  User: ${candidate4.user}`);
console.log(`  Health Factor: ${candidate4.healthFactor}`);
console.log(`  Block: ${candidate4.blockTag}`);
console.log('  Expected: No output (shadow execution disabled)\n');
maybeShadowExecute(candidate4);

console.log('\n=== Test Complete ===');
console.log('\nTo grep for shadow execution logs in production:');
console.log('  grep "SHADOW_EXECUTE" app.log');
console.log('  grep "SHADOW_EXECUTE" app.log | jq "."');
console.log('  grep "\\[metrics\\] shadow_execute_count" app.log');
