#!/usr/bin/env tsx
/**
 * Diagnostics script: Confirm variable debt scaling
 * 
 * Usage: node -r dotenv/config dist/scripts/diagnose-variable-debt.js [userAddress]
 * Or with tsx: tsx -r dotenv/config scripts/diagnose-variable-debt.ts [userAddress]
 * 
 * This script verifies that variable debt is properly expanded from scaled debt
 * using the reserve's variableBorrowIndex. It compares:
 * - Scaled variable debt (raw on-chain value)
 * - Principal variable debt (scaled * index / RAY)
 * - Current variable debt (from ProtocolDataProvider)
 */

import dotenv from 'dotenv';
import { ethers } from 'ethers';

import { AaveDataService } from '../src/services/AaveDataService.js';
import { AaveMetadata } from '../src/aave/AaveMetadata.js';
import { calculateUsdValue } from '../src/utils/usdMath.js';

dotenv.config();

const RAY = BigInt(10 ** 27);

interface DiagnosticResult {
  asset: string;
  symbol: string;
  decimals: number;
  scaledVariableDebt: bigint;
  variableBorrowIndex: bigint;
  calculatedPrincipalDebt: bigint;
  currentVariableDebt: bigint;
  stableDebt: bigint;
  totalDebt: bigint;
  debtUsd: number;
  priceRaw: bigint;
  indexExpansionFactor: number;
}

async function diagnoseUser(userAddress: string): Promise<DiagnosticResult[]> {
  console.log('\n=== Variable Debt Diagnostics ===');
  console.log(`User: ${userAddress}`);
  console.log(`Network: Base (Chain ID 8453)`);
  console.log(`RPC: ${process.env.RPC_URL?.substring(0, 50)}...`);
  console.log('');

  // Initialize provider
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  
  // Initialize services
  const aaveMetadata = new AaveMetadata(provider);
  await aaveMetadata.initialize();
  
  const aaveDataService = new AaveDataService(provider, aaveMetadata);
  
  // Get all reserves for user
  console.log('Fetching user reserves...');
  const reserves = await aaveDataService.getAllUserReserves(userAddress);
  
  // Filter to only reserves with debt
  const debtReserves = reserves.filter(r => r.totalDebt > 0n);
  
  if (debtReserves.length === 0) {
    console.log('✓ No debt found for this user');
    return [];
  }
  
  console.log(`Found ${debtReserves.length} reserve(s) with debt\n`);
  
  const results: DiagnosticResult[] = [];
  
  for (const reserve of debtReserves) {
    console.log(`--- ${reserve.symbol} (${reserve.asset}) ---`);
    
    // Get detailed user reserve data
    const userData = await aaveDataService.getUserReserveData(reserve.asset, userAddress);
    
    // Get reserve data for variableBorrowIndex
    const reserveData = await aaveDataService.getReserveData(reserve.asset);
    
    // Calculate principal from scaled debt
    const calculatedPrincipalDebt = userData.scaledVariableDebt > 0n
      ? (userData.scaledVariableDebt * reserveData.variableBorrowIndex) / RAY
      : 0n;
    
    // Calculate total debt using getTotalDebt (which uses our fix)
    const totalDebt = await aaveDataService.getTotalDebt(reserve.asset, userAddress);
    
    // Calculate USD value
    const debtUsd = calculateUsdValue(totalDebt, reserve.decimals, reserve.priceRaw);
    
    // Calculate expansion factor
    const indexExpansionFactor = Number(reserveData.variableBorrowIndex) / Number(RAY);
    
    results.push({
      asset: reserve.asset,
      symbol: reserve.symbol,
      decimals: reserve.decimals,
      scaledVariableDebt: userData.scaledVariableDebt,
      variableBorrowIndex: reserveData.variableBorrowIndex,
      calculatedPrincipalDebt,
      currentVariableDebt: userData.currentVariableDebt,
      stableDebt: userData.currentStableDebt,
      totalDebt,
      debtUsd,
      priceRaw: reserve.priceRaw,
      indexExpansionFactor
    });
    
    // Format numbers for display
    const formatAmount = (amount: bigint, decimals: number): string => {
      const divisor = BigInt(10 ** decimals);
      const integerPart = amount / divisor;
      const fractionalPart = amount % divisor;
      const fractionalStr = fractionalPart.toString().padStart(decimals, '0').substring(0, 6);
      return `${integerPart}.${fractionalStr}`;
    };
    
    console.log(`  Scaled Variable Debt:     ${formatAmount(userData.scaledVariableDebt, reserve.decimals)}`);
    console.log(`  Variable Borrow Index:    ${indexExpansionFactor.toFixed(6)} (${reserveData.variableBorrowIndex.toString()})`);
    console.log(`  Calculated Principal:     ${formatAmount(calculatedPrincipalDebt, reserve.decimals)}`);
    console.log(`  Current Variable Debt:    ${formatAmount(userData.currentVariableDebt, reserve.decimals)}`);
    console.log(`  Stable Debt:              ${formatAmount(userData.currentStableDebt, reserve.decimals)}`);
    console.log(`  Total Debt (expanded):    ${formatAmount(totalDebt, reserve.decimals)}`);
    console.log(`  Price (USD):              $${(Number(reserve.priceRaw) / 1e8).toFixed(4)}`);
    console.log(`  Total Debt Value (USD):   $${debtUsd.toFixed(2)}`);
    
    // Verification checks
    if (userData.scaledVariableDebt > 0n) {
      const diff = calculatedPrincipalDebt > userData.currentVariableDebt
        ? calculatedPrincipalDebt - userData.currentVariableDebt
        : userData.currentVariableDebt - calculatedPrincipalDebt;
      
      const tolerance = calculatedPrincipalDebt / 1000n; // 0.1% tolerance
      
      if (diff > tolerance) {
        console.log(`  ⚠️  Warning: Significant difference between calculated and current variable debt`);
        console.log(`      Diff: ${formatAmount(diff, reserve.decimals)} ${reserve.symbol}`);
      } else {
        console.log(`  ✓ Variable debt calculation matches within tolerance`);
      }
      
      // Check if expansion occurred
      if (indexExpansionFactor > 1.001) {
        const interestAccrued = calculatedPrincipalDebt - userData.scaledVariableDebt;
        console.log(`  ✓ Interest accrued: ${formatAmount(interestAccrued, reserve.decimals)} ${reserve.symbol}`);
        console.log(`    Expansion factor: ${((indexExpansionFactor - 1) * 100).toFixed(2)}%`);
      }
    }
    
    console.log('');
  }
  
  return results;
}

async function main() {
  try {
    // Check for required environment variables
    if (!process.env.RPC_URL) {
      console.error('Error: RPC_URL not configured');
      console.error('Please set RPC_URL in your .env file');
      process.exit(1);
    }
    
    // Get user address from command line or use a default test address
    const userAddress = process.argv[2] || process.env.TEST_USER_ADDRESS;
    
    if (!userAddress) {
      console.error('Error: No user address provided');
      console.error('Usage: node -r dotenv/config dist/scripts/diagnose-variable-debt.js [userAddress]');
      console.error('   Or: tsx -r dotenv/config scripts/diagnose-variable-debt.ts [userAddress]');
      console.error('\nAlternatively, set TEST_USER_ADDRESS in your .env file');
      process.exit(1);
    }
    
    // Validate address format
    if (!ethers.isAddress(userAddress)) {
      console.error(`Error: Invalid Ethereum address: ${userAddress}`);
      process.exit(1);
    }
    
    const results = await diagnoseUser(userAddress);
    
    // Summary
    console.log('=== Summary ===');
    if (results.length === 0) {
      console.log('No debt positions found');
    } else {
      console.log(`Total reserves with debt: ${results.length}`);
      
      const totalUsd = results.reduce((sum, r) => sum + r.debtUsd, 0);
      console.log(`Total debt value: $${totalUsd.toFixed(2)}`);
      
      console.log('\nReserve breakdown:');
      results.forEach(r => {
        console.log(`  ${r.symbol}: $${r.debtUsd.toFixed(2)} (index: ${r.indexExpansionFactor.toFixed(4)})`);
      });
      
      // Check if any reserves need attention
      const needsAttention = results.filter(r => {
        const diff = r.calculatedPrincipalDebt > r.currentVariableDebt
          ? r.calculatedPrincipalDebt - r.currentVariableDebt
          : r.currentVariableDebt - r.calculatedPrincipalDebt;
        const tolerance = r.calculatedPrincipalDebt / 1000n;
        return diff > tolerance;
      });
      
      if (needsAttention.length > 0) {
        console.log(`\n⚠️  ${needsAttention.length} reserve(s) with calculation discrepancies - review needed`);
      } else {
        console.log('\n✓ All debt calculations verified successfully');
      }
    }
    
  } catch (error) {
    console.error('\nError running diagnostics:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

export { diagnoseUser };
