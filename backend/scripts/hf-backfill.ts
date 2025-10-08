#!/usr/bin/env tsx
// hf-backfill.ts: Recompute historical users' health factors and produce JSON report

import { GraphQLClient } from 'graphql-request';
import { writeFileSync } from 'fs';
import { config } from '../src/config/index.js';
import { OnDemandHealthFactor } from '../src/services/OnDemandHealthFactor.js';
import { SubgraphService } from '../src/services/SubgraphService.js';

interface BackfillResult {
  userId: string;
  healthFactor: number | null;
  timestamp: string;
  error?: string;
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let recentCount = 5; // Default to 5 recent liquidations
  
  for (const arg of args) {
    if (arg.startsWith('--recent=')) {
      recentCount = parseInt(arg.split('=')[1], 10);
    }
  }

  console.log(`[hf-backfill] Starting health factor backfill for ${recentCount} recent liquidations`);

  // Initialize services
  if (config.useMockSubgraph) {
    console.error('[hf-backfill] Cannot run with USE_MOCK_SUBGRAPH=true');
    process.exit(1);
  }

  const { endpoint, needsHeader } = config.resolveSubgraphEndpoint();
  let headers: Record<string, string> | undefined;
  if (needsHeader && config.graphApiKey) {
    headers = { Authorization: `Bearer ${config.graphApiKey}` };
  }

  const client = new GraphQLClient(endpoint, { headers });
  const onDemandHealthFactor = new OnDemandHealthFactor({
    client,
    debugErrors: config.subgraphDebugErrors
  });

  const subgraphService = new SubgraphService();

  // Fetch recent liquidations
  console.log(`[hf-backfill] Fetching ${recentCount} recent liquidations...`);
  const liquidations = await subgraphService.getLiquidationCalls(recentCount);
  console.log(`[hf-backfill] Found ${liquidations.length} liquidations`);

  // Extract unique user IDs
  const uniqueUserIds = [...new Set(liquidations.map(l => l.user.toLowerCase()))];
  console.log(`[hf-backfill] Processing ${uniqueUserIds.length} unique users`);

  // Compute health factors for each user
  const results: BackfillResult[] = [];
  
  for (const userId of uniqueUserIds) {
    console.log(`[hf-backfill] Computing HF for user ${userId}...`);
    
    try {
      const healthFactor = await onDemandHealthFactor.getHealthFactor(userId);
      
      results.push({
        userId,
        healthFactor,
        timestamp: new Date().toISOString()
      });
      
      console.log(`[hf-backfill]   HF=${healthFactor !== null ? healthFactor.toFixed(4) : 'null'}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      results.push({
        userId,
        healthFactor: null,
        timestamp: new Date().toISOString(),
        error: errorMessage
      });
      console.error(`[hf-backfill]   Error: ${errorMessage}`);
    }
  }

  // Write output to JSON file
  const outputPath = 'hf-backfill-output.json';
  const output = {
    timestamp: new Date().toISOString(),
    recentCount,
    totalUsers: uniqueUserIds.length,
    results
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`[hf-backfill] Report written to ${outputPath}`);
  console.log(`[hf-backfill] Complete. Processed ${results.length} users.`);
}

main().catch(err => {
  console.error('[hf-backfill] Fatal error:', err);
  process.exit(1);
});
