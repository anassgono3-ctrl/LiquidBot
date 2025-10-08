#!/usr/bin/env tsx
/**
 * Risk Scanning Script (TypeScript version)
 * Uses AtRiskScanner to identify users approaching liquidation
 * 
 * This version imports from src/ instead of dist/ to avoid stale build issues
 */

// Load environment before anything else
import 'dotenv/config';

// Run in development mode to allow diagnostic instance creation
process.env.NODE_ENV = 'development';

import { SubgraphService } from '../src/services/SubgraphService.js';
import { HealthCalculator } from '../src/services/HealthCalculator.js';
import { AtRiskScanner } from '../src/services/AtRiskScanner.js';
import { config } from '../src/config/index.js';

const subgraphService = new SubgraphService();
const healthCalculator = new HealthCalculator();

// Configure scanner with environment variables or defaults
const scanner = new AtRiskScanner(
  subgraphService,
  healthCalculator,
  {
    warnThreshold: config.atRiskWarnThreshold || 1.05,
    liqThreshold: config.atRiskLiqThreshold || 1.0,
    dustEpsilon: config.atRiskDustEpsilon || 1e-9,
    notifyWarn: false // No notifications in script mode
  }
);

async function main() {
  console.log('🔍 Scanning for at-risk positions...');
  console.log(`📊 Warning threshold: HF < ${config.atRiskWarnThreshold || 1.05}`);
  console.log(`⚠️  Liquidation threshold: HF < ${config.atRiskLiqThreshold || 1.0}`);
  console.log(`🔢 Scan limit: ${config.atRiskScanLimit || 100} users`);
  console.log('');

  try {
    const scanLimit = config.atRiskScanLimit || 100;
    const result = await scanner.scanAndClassify(scanLimit);

    // Display results
    console.log('📊 Risk Assessment Results:');
    console.log('─'.repeat(80));
    console.log(`Total positions scanned: ${result.scannedCount}`);
    console.log(`Positions with no debt/dust: ${result.noDebtCount}`);
    console.log(`Warning tier (HF < ${config.atRiskWarnThreshold || 1.05}): ${result.warnCount}`);
    console.log(`Critical tier (HF < ${config.atRiskLiqThreshold || 1.0}): ${result.criticalCount}`);
    console.log('');

    // Filter and display by tier
    const criticalUsers = result.users.filter(u => u.classification === 'CRITICAL');
    const warnUsers = result.users.filter(u => u.classification === 'WARN');

    if (criticalUsers.length > 0) {
      console.log('🚨 CRITICAL - Liquidation Imminent:');
      criticalUsers.forEach((user) => {
        console.log(
          `   ${user.userId} - HF: ${user.healthFactor?.toFixed(4) || 'N/A'} | ` +
          `Collateral: ${user.totalCollateralETH.toFixed(6)} ETH | ` +
          `Debt: ${user.totalDebtETH.toFixed(6)} ETH`
        );
      });
      console.log('');
    }

    if (warnUsers.length > 0) {
      console.log('⚠️  WARNING - Monitor Closely:');
      warnUsers.forEach((user) => {
        console.log(
          `   ${user.userId} - HF: ${user.healthFactor?.toFixed(4) || 'N/A'} | ` +
          `Collateral: ${user.totalCollateralETH.toFixed(6)} ETH | ` +
          `Debt: ${user.totalDebtETH.toFixed(6)} ETH`
        );
      });
      console.log('');
    }

    if (criticalUsers.length === 0 && warnUsers.length === 0) {
      console.log('✅ No at-risk positions found - all scanned users are healthy!');
      console.log('');
    }

    console.log('✅ Risk scan completed successfully');
    process.exit(0);
  } catch (error) {
    const err = error as Error;
    console.error('❌ Risk scan failed:', err.message);
    if ('cause' in err) {
      console.error('   Cause:', (err.cause as Error).message);
    }
    process.exit(1);
  }
}

main();
