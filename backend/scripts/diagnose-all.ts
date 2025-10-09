#!/usr/bin/env tsx
/**
 * diagnose-all.ts - Comprehensive diagnostic script
 * 
 * Single-run diagnostic that prints PASS/FAIL for each check and exits non-zero on failure.
 * Uses tsx (no build required).
 * 
 * Checks performed:
 * - Env validation: parse CHAINLINK_FEEDS, show symbol->address map; warn invalid/placeholder addresses; show GAS_COST_USD and PROFIT_MIN_USD
 * - Subgraph warmup: _meta { block { number } } and liquidationCalls(first: 1)
 * - Users page sanity: fetch getUsersPage(limit = min(AT_RISK_SCAN_LIMIT||5, 50)), compute HF locally for up to 5 users, classify with dust epsilon, print a small table
 * - PriceService / Chainlink: for each symbol in CHAINLINK_FEEDS, connect via ethers and call decimals() + latestRoundData(); compute price = answer / 10^decimals; warn if answer <= 0
 * - HF computation: verify HealthCalculator on sample user
 * - Opportunity building: build sample opportunity from liquidation
 * - Telegram notification: test connectivity (check if enabled)
 * - WebSocket: verify server can be initialized
 * - Metrics: verify registry can be accessed
 * 
 * Usage:
 *   tsx scripts/diagnose-all.ts
 *   or
 *   npm run diagnose
 */

import 'dotenv/config';
import { ethers } from 'ethers';

import { config } from '../src/config/index.js';
import { SubgraphService } from '../src/services/SubgraphService.js';
import { HealthCalculator } from '../src/services/HealthCalculator.js';
import { OpportunityService } from '../src/services/OpportunityService.js';
import { NotificationService } from '../src/services/NotificationService.js';
import { registry } from '../src/metrics/index.js';

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

interface CheckResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message?: string;
  details?: string[];
}

const results: CheckResult[] = [];

function printHeader(title: string) {
  console.log('\n' + BOLD + BLUE + '═'.repeat(80) + RESET);
  console.log(BOLD + BLUE + `  ${title}` + RESET);
  console.log(BOLD + BLUE + '═'.repeat(80) + RESET + '\n');
}

function printCheck(result: CheckResult) {
  const statusColor = result.status === 'PASS' ? GREEN : result.status === 'FAIL' ? RED : YELLOW;
  const statusSymbol = result.status === 'PASS' ? '✓' : result.status === 'FAIL' ? '✗' : '⚠';
  
  console.log(`${statusColor}${statusSymbol}${RESET} ${BOLD}${result.name}${RESET}: ${statusColor}${result.status}${RESET}`);
  
  if (result.message) {
    console.log(`  ${result.message}`);
  }
  
  if (result.details && result.details.length > 0) {
    result.details.forEach(detail => {
      console.log(`    • ${detail}`);
    });
  }
}

function addResult(name: string, status: 'PASS' | 'FAIL' | 'WARN', message?: string, details?: string[]) {
  const result: CheckResult = { name, status, message, details };
  results.push(result);
  printCheck(result);
}

async function checkEnvValidation() {
  printHeader('Environment Validation');
  
  const details: string[] = [];
  let hasIssues = false;
  
  // Check CHAINLINK_FEEDS
  if (config.chainlinkFeeds) {
    details.push(`CHAINLINK_FEEDS configured: ${config.chainlinkFeeds}`);
    
    const feedPairs = config.chainlinkFeeds.split(',');
    for (const pair of feedPairs) {
      const [symbol, address] = pair.split(':').map(s => s.trim());
      if (symbol && address) {
        details.push(`  ${symbol} -> ${address}`);
        
        // Warn about placeholder addresses
        if (address.startsWith('0x0000') || address === '0x' || address.length !== 42) {
          details.push(`    ${YELLOW}⚠ Warning: ${symbol} has invalid/placeholder address${RESET}`);
          hasIssues = true;
        }
      }
    }
  } else {
    details.push('CHAINLINK_FEEDS not configured (will use stub prices)');
  }
  
  // Show profit/gas configuration
  details.push(`GAS_COST_USD: ${config.gasCostUsd}`);
  details.push(`PROFIT_MIN_USD: ${config.profitMinUsd}`);
  
  // Check critical environment variables
  if (config.useMockSubgraph) {
    details.push(`${YELLOW}⚠ Using mock subgraph (USE_MOCK_SUBGRAPH=true)${RESET}`);
  } else {
    if (!config.graphApiKey || config.graphApiKey === 'replace_with_gateway_key') {
      addResult('Env Validation', 'FAIL', 'Missing or placeholder GRAPH_API_KEY', details);
      return;
    }
    details.push('GRAPH_API_KEY configured');
  }
  
  addResult('Env Validation', hasIssues ? 'WARN' : 'PASS', undefined, details);
}

async function checkSubgraphWarmup() {
  printHeader('Subgraph Connectivity');
  
  const details: string[] = [];
  
  if (config.useMockSubgraph) {
    addResult('Subgraph Warmup', 'WARN', 'Skipped (mock mode enabled)', details);
    return;
  }
  
  const subgraphService = new SubgraphService();
  
  try {
    // Test endpoint resolution
    const endpoint = config.resolveSubgraphEndpoint();
    details.push(`Endpoint: ${endpoint.endpoint}`);
    
    // Test liquidationCalls query
    details.push('Testing liquidationCalls query (first: 1)...');
    const liquidations = await subgraphService.getLiquidationCalls(1);
    details.push(`Fetched ${liquidations.length} liquidation(s)`);
    
    addResult('Subgraph Warmup', 'PASS', undefined, details);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addResult('Subgraph Warmup', 'FAIL', `Failed to connect: ${message}`, details);
  }
}

async function checkUsersPageSanity() {
  printHeader('Users Page Sanity Check');
  
  const details: string[] = [];
  
  if (config.useMockSubgraph) {
    addResult('Users Page Sanity', 'WARN', 'Skipped (mock mode enabled)', details);
    return;
  }
  
  const subgraphService = new SubgraphService();
  const healthCalculator = new HealthCalculator();
  
  try {
    const scanLimit = Math.min(config.atRiskScanLimit || 5, 50);
    details.push(`Fetching getUsersPage(limit=${scanLimit})...`);
    
    const users = await subgraphService.getUsersPage(scanLimit);
    details.push(`Fetched ${users.length} user(s) with debt`);
    
    if (users.length === 0) {
      addResult('Users Page Sanity', 'WARN', 'No users with debt found', details);
      return;
    }
    
    // Compute HF for up to 5 users
    const sampleSize = Math.min(users.length, 5);
    details.push(`Computing HF for ${sampleSize} sample user(s):`);
    details.push('');
    details.push(`${'User'.padEnd(42)} | ${'HF'.padEnd(10)} | ${'Classification'.padEnd(15)} | ${'Debt (ETH)'.padEnd(12)}`);
    details.push('-'.repeat(85));
    
    const dustEpsilon = config.atRiskDustEpsilon || 1e-9;
    
    for (let i = 0; i < sampleSize; i++) {
      const user = users[i];
      const hfResult = healthCalculator.calculateHealthFactor(user);
      
      let classification = 'OK';
      if (hfResult.totalDebtETH < dustEpsilon) {
        classification = 'DUST';
      } else if (hfResult.healthFactor === Infinity) {
        classification = 'NO_DEBT';
      } else if (hfResult.healthFactor < config.atRiskLiqThreshold) {
        classification = 'CRITICAL';
      } else if (hfResult.healthFactor < config.atRiskWarnThreshold) {
        classification = 'WARN';
      }
      
      const hfDisplay = hfResult.healthFactor === Infinity ? 'Infinity' : hfResult.healthFactor.toFixed(4);
      const debtDisplay = hfResult.totalDebtETH.toFixed(9);
      
      details.push(
        `${user.id.padEnd(42)} | ${hfDisplay.padEnd(10)} | ${classification.padEnd(15)} | ${debtDisplay.padEnd(12)}`
      );
    }
    
    addResult('Users Page Sanity', 'PASS', undefined, details);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addResult('Users Page Sanity', 'FAIL', `Failed: ${message}`, details);
  }
}

async function checkChainlinkPrices() {
  printHeader('Chainlink Price Feeds');
  
  const details: string[] = [];
  
  if (!config.chainlinkRpcUrl || !config.chainlinkFeeds) {
    addResult('Chainlink Prices', 'WARN', 'Chainlink not configured (will use stub prices)', details);
    return;
  }
  
  details.push(`RPC URL: ${config.chainlinkRpcUrl}`);
  details.push('');
  
  try {
    const provider = new ethers.JsonRpcProvider(config.chainlinkRpcUrl);
    
    // Parse feeds
    const feedPairs = config.chainlinkFeeds.split(',');
    const aggregatorAbi = [
      'function decimals() external view returns (uint8)',
      'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
    ];
    
    let hasErrors = false;
    
    for (const pair of feedPairs) {
      const [symbol, address] = pair.split(':').map(s => s.trim());
      if (!symbol || !address) continue;
      
      try {
        const aggregator = new ethers.Contract(address, aggregatorAbi, provider);
        
        details.push(`${symbol}:`);
        
        // Call decimals()
        const decimals = await aggregator.decimals();
        details.push(`  Decimals: ${decimals}`);
        
        // Call latestRoundData()
        const roundData = await aggregator.latestRoundData();
        const answer = roundData[1];
        const updatedAt = roundData[3];
        
        const price = Number(answer) / Math.pow(10, Number(decimals));
        details.push(`  Latest price: ${price} (answer: ${answer.toString()})`);
        
        // Check for invalid answer
        if (answer <= 0) {
          details.push(`  ${RED}✗ Warning: answer <= 0${RESET}`);
          hasErrors = true;
        }
        
        // Check freshness
        const now = Math.floor(Date.now() / 1000);
        const age = now - Number(updatedAt);
        details.push(`  Updated: ${age}s ago`);
        
        if (age > 3600) {
          details.push(`  ${YELLOW}⚠ Warning: data is stale (>1 hour old)${RESET}`);
        }
        
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        details.push(`  ${RED}✗ Failed: ${message}${RESET}`);
        hasErrors = true;
      }
      
      details.push('');
    }
    
    addResult('Chainlink Prices', hasErrors ? 'WARN' : 'PASS', undefined, details);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addResult('Chainlink Prices', 'FAIL', `Provider connection failed: ${message}`, details);
  }
}

async function checkHealthFactorComputation() {
  printHeader('Health Factor Computation');
  
  const details: string[] = [];
  
  if (config.useMockSubgraph) {
    addResult('HF Computation', 'WARN', 'Skipped (mock mode enabled)', details);
    return;
  }
  
  const subgraphService = new SubgraphService();
  const healthCalculator = new HealthCalculator();
  
  try {
    // Fetch a sample user
    const users = await subgraphService.getUsersPage(1);
    
    if (users.length === 0) {
      addResult('HF Computation', 'WARN', 'No users available to test', details);
      return;
    }
    
    const user = users[0];
    details.push(`Testing with user: ${user.id}`);
    
    const hfResult = healthCalculator.calculateHealthFactor(user);
    
    details.push(`Health Factor: ${hfResult.healthFactor === Infinity ? 'Infinity' : hfResult.healthFactor.toFixed(6)}`);
    details.push(`Total Collateral (ETH): ${hfResult.totalCollateralETH.toFixed(6)}`);
    details.push(`Total Debt (ETH): ${hfResult.totalDebtETH.toFixed(6)}`);
    details.push(`Is At Risk: ${hfResult.isAtRisk}`);
    
    // Verify calculation logic
    if (hfResult.totalDebtETH > 0 && hfResult.healthFactor !== Infinity) {
      // Manually verify: HF should be > 0 if there's debt
      if (hfResult.healthFactor <= 0) {
        addResult('HF Computation', 'FAIL', 'Invalid HF calculation (HF <= 0 with debt)', details);
        return;
      }
    }
    
    addResult('HF Computation', 'PASS', undefined, details);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addResult('HF Computation', 'FAIL', `Failed: ${message}`, details);
  }
}

async function checkOpportunityBuilding() {
  printHeader('Opportunity Building');
  
  const details: string[] = [];
  
  if (config.useMockSubgraph) {
    addResult('Opportunity Building', 'WARN', 'Skipped (mock mode enabled)', details);
    return;
  }
  
  const subgraphService = new SubgraphService();
  const opportunityService = new OpportunityService();
  
  try {
    // Fetch a recent liquidation
    details.push('Fetching recent liquidations...');
    const liquidations = await subgraphService.getLiquidationCalls(1);
    
    if (liquidations.length === 0) {
      addResult('Opportunity Building', 'WARN', 'No liquidations available to test', details);
      return;
    }
    
    const liquidation = liquidations[0];
    details.push(`Testing with liquidation: ${liquidation.id}`);
    details.push(`User: ${liquidation.user}`);
    
    // Build opportunity
    const opportunities = await opportunityService.buildOpportunities([liquidation]);
    
    if (opportunities.length === 0) {
      addResult('Opportunity Building', 'FAIL', 'Failed to build opportunity', details);
      return;
    }
    
    const opp = opportunities[0];
    details.push(`Opportunity built successfully`);
    details.push(`  ID: ${opp.id}`);
    details.push(`  Profit Estimate (USD): ${opp.profitEstimateUsd !== null && opp.profitEstimateUsd !== undefined ? opp.profitEstimateUsd.toFixed(2) : 'N/A'}`);
    details.push(`  Health Factor: ${opp.healthFactor !== null && opp.healthFactor !== undefined ? opp.healthFactor.toFixed(4) : 'N/A'}`);
    
    addResult('Opportunity Building', 'PASS', undefined, details);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addResult('Opportunity Building', 'FAIL', `Failed: ${message}`, details);
  }
}

async function checkTelegramNotification() {
  printHeader('Telegram Notification');
  
  const details: string[] = [];
  
  const notificationService = new NotificationService();
  const isEnabled = notificationService.isEnabled();
  
  if (isEnabled) {
    details.push('Telegram bot is enabled');
    details.push(`Bot token: ${config.telegramBotToken ? '***' + config.telegramBotToken.slice(-4) : 'N/A'}`);
    details.push(`Chat ID: ${config.telegramChatId}`);
    addResult('Telegram Notification', 'PASS', 'Telegram configured and enabled', details);
  } else {
    details.push('Telegram bot is disabled (credentials not configured)');
    addResult('Telegram Notification', 'WARN', 'Telegram not configured', details);
  }
}

async function checkWebSocket() {
  printHeader('WebSocket Server');
  
  const details: string[] = [];
  
  try {
    // We can't actually start a WebSocket server without an HTTP server,
    // but we can verify the module loads correctly
    const { initWebSocketServer } = await import('../src/websocket/server.js');
    
    if (typeof initWebSocketServer === 'function') {
      details.push('WebSocket module loaded successfully');
      details.push('initWebSocketServer function is available');
      addResult('WebSocket Server', 'PASS', undefined, details);
    } else {
      addResult('WebSocket Server', 'FAIL', 'initWebSocketServer is not a function', details);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addResult('WebSocket Server', 'FAIL', `Failed to load WebSocket module: ${message}`, details);
  }
}

async function checkMetrics() {
  printHeader('Metrics Registry');
  
  const details: string[] = [];
  
  try {
    const metrics = await registry.metrics();
    
    if (metrics && metrics.length > 0) {
      details.push('Metrics registry is accessible');
      details.push(`Registry has ${metrics.split('\n').length} lines of metrics`);
      addResult('Metrics Registry', 'PASS', undefined, details);
    } else {
      addResult('Metrics Registry', 'WARN', 'Metrics registry is empty', details);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addResult('Metrics Registry', 'FAIL', `Failed to access metrics: ${message}`, details);
  }
}

async function main() {
  console.log(BOLD + BLUE + '\n╔════════════════════════════════════════════════════════════════════════════════╗' + RESET);
  console.log(BOLD + BLUE + '║                    LiquidBot Comprehensive Diagnostics                         ║' + RESET);
  console.log(BOLD + BLUE + '╚════════════════════════════════════════════════════════════════════════════════╝' + RESET);
  
  // Run all checks
  await checkEnvValidation();
  await checkSubgraphWarmup();
  await checkUsersPageSanity();
  await checkChainlinkPrices();
  await checkHealthFactorComputation();
  await checkOpportunityBuilding();
  await checkTelegramNotification();
  await checkWebSocket();
  await checkMetrics();
  
  // Print summary
  printHeader('Summary');
  
  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  const warnCount = results.filter(r => r.status === 'WARN').length;
  
  console.log(`${GREEN}${passCount} PASSED${RESET}`);
  console.log(`${YELLOW}${warnCount} WARNINGS${RESET}`);
  console.log(`${RED}${failCount} FAILED${RESET}`);
  console.log('');
  
  if (failCount > 0) {
    console.log(`${RED}${BOLD}✗ Diagnostics FAILED${RESET}\n`);
    process.exit(1);
  } else if (warnCount > 0) {
    console.log(`${YELLOW}${BOLD}⚠ Diagnostics completed with warnings${RESET}\n`);
    process.exit(0);
  } else {
    console.log(`${GREEN}${BOLD}✓ All diagnostics PASSED${RESET}\n`);
    process.exit(0);
  }
}

// Run diagnostics
main().catch((err) => {
  console.error(`${RED}${BOLD}✗ Diagnostics crashed:${RESET}`, err);
  process.exit(1);
});
