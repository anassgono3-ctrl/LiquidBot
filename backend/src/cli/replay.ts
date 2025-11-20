#!/usr/bin/env node
// CLI entry point for historical replay mode
import { JsonRpcProvider } from 'ethers';

import { parseReplayConfig, validateReplayConfig } from '../replay/ReplayConfig.js';
import { ReplayController, type ReplayCandidateDetector } from '../replay/ReplayController.js';
import { HistoricalStateProvider } from '../replay/HistoricalStateProvider.js';
import type { Candidate } from '../replay/Comparator.js';

/**
 * Simple candidate detector for replay.
 * In a full implementation, this would integrate with the existing
 * candidate pipeline (CandidateManager, health factor checks, etc.)
 */
class SimpleCandidateDetector implements ReplayCandidateDetector {
  private poolAddress: string;
  private oracleAddress: string;
  private candidateUsers: string[];
  
  constructor(poolAddress: string, oracleAddress: string, candidateUsers: string[]) {
    this.poolAddress = poolAddress;
    this.oracleAddress = oracleAddress;
    this.candidateUsers = candidateUsers;
  }
  
  async detectCandidates(block: number, stateProvider: HistoricalStateProvider): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    
    // For each candidate user, check their health factor at this block
    for (const user of this.candidateUsers) {
      try {
        const accountData = await stateProvider.getUserAccountData(this.poolAddress, user);
        
        // Calculate health factor (with 18 decimals)
        const hf = Number(accountData.healthFactor) / 1e18;
        
        // Skip users with no debt
        if (accountData.totalDebtBase === 0n) {
          continue;
        }
        
        // Check if user is liquidatable (HF < 1.0)
        if (hf < 1.0) {
          // Simple USD estimation (assuming base currency unit is 1e8)
          const debtUSD = Number(accountData.totalDebtBase) / 1e8;
          const collateralUSD = Number(accountData.totalCollateralBase) / 1e8;
          
          // Simple profit estimation (5% bonus)
          const profitEstUSD = debtUSD * 0.05;
          
          candidates.push({
            user,
            block,
            healthFactor: hf,
            debtUSD,
            collateralUSD,
            profitEstUSD,
          });
        }
      } catch (error) {
        // Skip users that error (might not exist at this block)
        continue;
      }
    }
    
    return candidates;
  }
}

/**
 * Main replay CLI function.
 */
async function main() {
  console.log('=== LiquidBot Historical Replay Mode ===\n');
  
  // Parse replay configuration
  const config = parseReplayConfig();
  
  if (!config.enabled) {
    console.error('ERROR: REPLAY_ENABLED must be set to true');
    console.error('Set REPLAY_ENABLED=true and configure REPLAY_START_BLOCK and REPLAY_END_BLOCK');
    process.exit(1);
  }
  
  // Validate configuration
  const warnings = validateReplayConfig(config);
  if (warnings.length > 0) {
    console.log('Configuration warnings:');
    for (const warning of warnings) {
      console.log(`  ⚠️  ${warning}`);
    }
    console.log();
  }
  
  // Safety check: Force execution disabled
  if (process.env.EXECUTION_ENABLED === 'true') {
    console.error('ERROR: EXECUTION_ENABLED must be false in replay mode for safety');
    process.exit(1);
  }
  
  // Initialize RPC provider
  const rpcUrl = process.env.RPC_URL || process.env.BACKFILL_RPC_URL;
  if (!rpcUrl) {
    console.error('ERROR: RPC_URL or BACKFILL_RPC_URL must be configured');
    process.exit(1);
  }
  
  console.log(`Connecting to RPC: ${rpcUrl.replace(/\/[^/]+$/, '/***')}`);
  const provider = new JsonRpcProvider(rpcUrl);
  
  // Get Aave Pool address
  const poolAddress = process.env.AAVE_POOL_ADDRESS;
  if (!poolAddress) {
    console.error('ERROR: AAVE_POOL_ADDRESS must be configured');
    process.exit(1);
  }
  
  // Get Aave Oracle address
  const oracleAddress = process.env.AAVE_ORACLE;
  if (!oracleAddress) {
    console.error('ERROR: AAVE_ORACLE must be configured');
    process.exit(1);
  }
  
  // Get subgraph URL (optional)
  const subgraphUrl = process.env.SUBGRAPH_URL;
  
  // For this simplified CLI, we'll use a static list of candidate users
  // In production, this would integrate with SubgraphSeeder or on-chain discovery
  const candidateUsers: string[] = [];
  
  // TODO: Load candidate users from subgraph or on-chain events
  // For now, we'll detect candidates from ground truth events themselves
  console.log('Note: Using simplified candidate detection (ground truth users only)');
  console.log('For full pipeline integration, use the main application entry point\n');
  
  // Create candidate detector
  const candidateDetector = new SimpleCandidateDetector(
    poolAddress,
    oracleAddress,
    candidateUsers
  );
  
  // Create and start replay controller
  const controller = new ReplayController(
    config,
    provider,
    candidateDetector,
    poolAddress,
    subgraphUrl
  );
  
  try {
    await controller.start();
    console.log('\n✅ Replay completed successfully');
    console.log(`📊 Results exported to: ${config.exportDir}`);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Replay failed:', error);
    process.exit(1);
  }
}

// Run CLI
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
