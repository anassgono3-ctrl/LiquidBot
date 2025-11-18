/**
 * Startup Diagnostics Script
 * 
 * Runs a quick connectivity check and subscription test without starting the full engine.
 * Usage: npm run diag
 */

import dotenv from 'dotenv';
import { WebSocketProvider } from 'ethers';

import { config } from '../src/config/index.js';
import { StartupDiagnosticsService } from '../src/services/StartupDiagnostics.js';

dotenv.config();

async function main() {
  console.log('Running startup diagnostics...\n');

  let wsProvider: WebSocketProvider | undefined;

  try {
    // Initialize WebSocket provider if configured
    if (config.wsRpcUrl) {
      console.log(`Connecting to WebSocket: ${config.wsRpcUrl.substring(0, 50)}...`);
      wsProvider = new WebSocketProvider(config.wsRpcUrl);
      
      // Wait for connection with timeout
      await Promise.race([
        wsProvider.getNetwork(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 5000)
        )
      ]);
      
      console.log('WebSocket connected successfully\n');
    } else {
      console.log('No WebSocket URL configured (WS_RPC_URL not set)\n');
    }

    // Run diagnostics
    const diagnostics = new StartupDiagnosticsService(wsProvider, config.startupDiagTimeoutMs);
    const result = await diagnostics.run();
    const formatted = diagnostics.formatDiagnostics(result);

    // Print results
    console.log(formatted);

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    
    const status = result.mempoolTransmit.status === 'ACTIVE' ? '✓' : '✗';
    console.log(`${status} Mempool transmit: ${result.mempoolTransmit.status}`);
    
    const wsStatus = result.wsConnectivity.connected ? '✓' : '✗';
    console.log(`${wsStatus} WebSocket: ${result.wsConnectivity.connected ? 'CONNECTED' : 'DISCONNECTED'}`);
    
    const feedsStatus = result.feeds.discoveredCount > 0 ? '✓' : '✗';
    console.log(`${feedsStatus} Feeds: ${result.feeds.discoveredCount} discovered`);
    
    console.log('='.repeat(80));
    console.log('');

    // Exit
    if (wsProvider) {
      wsProvider.destroy();
    }
    process.exit(0);
  } catch (error) {
    console.error('Diagnostics failed:', error);
    
    if (wsProvider) {
      wsProvider.destroy();
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
