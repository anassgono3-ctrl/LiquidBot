#!/usr/bin/env node
/**
 * Risk Scanning Script
 * Fetches positions from subgraph and identifies at-risk users (HF < 1.1)
 */

import { SubgraphService } from '../dist/src/services/SubgraphService.js';
import { HealthCalculator } from '../dist/src/services/HealthCalculator.js';
import { config } from '../dist/src/config/index.js';

const subgraphService = new SubgraphService();
const healthCalculator = new HealthCalculator();

async function main() {
  console.log('🔍 Scanning for at-risk positions...');
  console.log(`📊 Alert threshold: HF < ${config.alertThreshold}`);
  console.log(`⚠️  Emergency threshold: HF < ${config.emergencyThreshold}`);
  console.log('');

  try {
    // Fetch users with debt
    const users = await subgraphService.getUsersWithDebt(100);
    console.log(`📋 Found ${users.length} users with active debt`);
    console.log('');

    // Calculate health factors and identify at-risk users
    const atRiskUsers = [];
    const emergencyUsers = [];

    for (const user of users) {
      const hf = healthCalculator.calculateHealthFactor(user);
      
      if (hf.healthFactor < config.alertThreshold && hf.healthFactor !== Infinity) {
        atRiskUsers.push({
          address: user.id,
          healthFactor: hf.healthFactor,
          totalCollateralETH: hf.totalCollateralETH,
          totalDebtETH: hf.totalDebtETH,
        });

        if (hf.healthFactor < config.emergencyThreshold) {
          emergencyUsers.push({
            address: user.id,
            healthFactor: hf.healthFactor,
          });
        }
      }
    }

    // Display results
    console.log('📊 Risk Assessment Results:');
    console.log('─'.repeat(80));
    console.log(`Total positions scanned: ${users.length}`);
    console.log(`At-risk positions (HF < ${config.alertThreshold}): ${atRiskUsers.length}`);
    console.log(`Emergency positions (HF < ${config.emergencyThreshold}): ${emergencyUsers.length}`);
    console.log('');

    if (emergencyUsers.length > 0) {
      console.log('🚨 EMERGENCY - Immediate Intervention Required:');
      emergencyUsers.forEach((user) => {
        console.log(`   ${user.address} - HF: ${user.healthFactor.toFixed(4)}`);
      });
      console.log('');
    }

    if (atRiskUsers.length > 0) {
      console.log('⚠️  AT RISK - Monitor Closely:');
      atRiskUsers.forEach((user) => {
        console.log(
          `   ${user.address} - HF: ${user.healthFactor.toFixed(4)} | ` +
          `Collateral: ${user.totalCollateralETH.toFixed(6)} ETH | ` +
          `Debt: ${user.totalDebtETH.toFixed(6)} ETH`
        );
      });
      console.log('');
    } else {
      console.log('✅ No at-risk positions found - all users are healthy!');
      console.log('');
    }

    console.log('✅ Risk scan completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Risk scan failed:', error.message);
    if (error.cause) {
      console.error('   Cause:', error.cause.message);
    }
    process.exit(1);
  }
}

main();
