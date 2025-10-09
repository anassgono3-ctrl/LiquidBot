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
import { NotificationService } from '../src/services/NotificationService.js';
import { config } from '../src/config/index.js';

// Parse CLI arguments
const args = process.argv.slice(2);
const enableNotifications = args.includes('--notify');

const subgraphService = new SubgraphService();
const healthCalculator = new HealthCalculator();

// Initialize notification service only if --notify flag is present
let notificationService: NotificationService | undefined;
if (enableNotifications) {
  notificationService = new NotificationService();
  if (notificationService.isEnabled()) {
    console.log('📱 Telegram notifications enabled');
  } else {
    console.log('⚠️  Telegram notifications requested but not configured (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID missing)');
  }
}

// Configure scanner with environment variables or defaults
const scanner = new AtRiskScanner(
  subgraphService,
  healthCalculator,
  {
    warnThreshold: config.atRiskWarnThreshold || 1.05,
    liqThreshold: config.atRiskLiqThreshold || 1.0,
    dustEpsilon: config.atRiskDustEpsilon || 1e-9,
    notifyWarn: false, // WARN notifications disabled in script mode
    notifyCritical: enableNotifications // CRITICAL notifications only if --notify flag is present
  },
  notificationService
);

async function main() {
  console.log('🔍 Scanning for at-risk positions...');
  console.log(`📊 Warning threshold: HF < ${config.atRiskWarnThreshold || 1.05}`);
  console.log(`⚠️  Liquidation threshold: HF < ${config.atRiskLiqThreshold || 1.0}`);
  console.log(`🔢 Scan limit: ${config.atRiskScanLimit || 100} users`);
  console.log(`📱 Notifications: ${enableNotifications ? 'enabled' : 'disabled'}`);
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

    // Send notifications if --notify flag is present
    if (enableNotifications && result.users.length > 0) {
      console.log('📱 Sending Telegram notifications...');
      await scanner.notifyAtRiskUsers(result.users);
      console.log('✅ Notifications sent');
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
