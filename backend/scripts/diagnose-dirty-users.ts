#!/usr/bin/env node
/**
 * diagnose-dirty-users.ts - Comprehensive dirty users pipeline diagnostic
 * 
 * Validates the entire "dirty users" pipeline in one run:
 * - Provider connectivity (WS and HTTP)
 * - Price-trigger configuration sanity
 * - Chainlink feed health and recent activity
 * - Aave candidate pool from recent events
 * 
 * Exits non-zero on critical failures with clear PASS/FAIL guidance.
 * Read-only: does not mutate Redis/DB or mark users dirty.
 * 
 * Usage:
 *   npm run build
 *   npm run diagnose:dirty
 */

import 'dotenv/config';
import { ethers } from 'ethers';

import { config } from '../src/config/index.js';
import { normalizeChainlinkPrice } from '../src/utils/chainlinkMath.js';

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// Diagnostic configuration from env
const DIAG_FEED_BLOCKS = parseInt(process.env.DIAG_FEED_BLOCKS || '5000', 10);
const DIAG_AAVE_BLOCKS = parseInt(process.env.DIAG_AAVE_BLOCKS || '10000', 10);
const DIAG_TIMEOUT_MS = parseInt(process.env.DIAG_TIMEOUT_MS || '8000', 10);

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
      console.log(`    ${detail}`);
    });
  }
}

function addResult(name: string, status: 'PASS' | 'FAIL' | 'WARN', message?: string, details?: string[]) {
  const result: CheckResult = { name, status, message, details };
  results.push(result);
  printCheck(result);
}

/**
 * Helper to run async operations with timeout
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout: ${errorMsg}`)), timeoutMs)
  );
  return Promise.race([promise, timeout]);
}

/**
 * Check WS and HTTP provider connectivity
 */
async function checkProviderConnectivity() {
  printHeader('Provider Connectivity');
  
  const details: string[] = [];
  let hasFail = false;
  
  // Check WS provider (used by real-time listeners)
  if (config.wsRpcUrl) {
    details.push(`WS_RPC_URL: ${config.wsRpcUrl}`);
    try {
      const wsProvider = new ethers.WebSocketProvider(config.wsRpcUrl);
      
      const [network, blockNumber] = await withTimeout(
        Promise.all([
          wsProvider.getNetwork(),
          wsProvider.getBlockNumber()
        ]),
        DIAG_TIMEOUT_MS,
        'WS provider connection'
      );
      
      details.push(`  ✓ WS Provider connected`);
      details.push(`    Chain ID: ${network.chainId}`);
      details.push(`    Latest block: ${blockNumber}`);
      
      // Clean up
      wsProvider.destroy();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      details.push(`  ${RED}✗ WS Provider failed: ${message}${RESET}`);
      hasFail = true;
    }
  } else {
    details.push(`${YELLOW}⚠ WS_RPC_URL not configured${RESET}`);
  }
  
  // Check HTTP provider (used for backfill and historical queries)
  const httpUrl = process.env.RPC_URL || process.env.BACKFILL_RPC_URL;
  if (httpUrl) {
    details.push('');
    details.push(`HTTP RPC: ${httpUrl}`);
    try {
      const httpProvider = new ethers.JsonRpcProvider(httpUrl);
      
      const [network, blockNumber] = await withTimeout(
        Promise.all([
          httpProvider.getNetwork(),
          httpProvider.getBlockNumber()
        ]),
        DIAG_TIMEOUT_MS,
        'HTTP provider connection'
      );
      
      details.push(`  ✓ HTTP Provider connected`);
      details.push(`    Chain ID: ${network.chainId}`);
      details.push(`    Latest block: ${blockNumber}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      details.push(`  ${RED}✗ HTTP Provider failed: ${message}${RESET}`);
      hasFail = true;
    }
  } else {
    details.push('');
    details.push(`${YELLOW}⚠ RPC_URL / BACKFILL_RPC_URL not configured${RESET}`);
  }
  
  addResult(
    'Provider Connectivity',
    hasFail ? 'FAIL' : 'PASS',
    hasFail ? 'One or more providers failed connectivity check' : undefined,
    details
  );
}

/**
 * Check price-trigger configuration sanity
 */
async function checkPriceTriggerConfig() {
  printHeader('Price-Trigger Configuration');
  
  const details: string[] = [];
  let hasWarn = false;
  
  const enabled = config.priceTriggerEnabled;
  details.push(`PRICE_TRIGGER_ENABLED: ${enabled}`);
  
  if (!enabled) {
    addResult('Price-Trigger Config', 'WARN', 'Price triggers disabled - skip validation', details);
    return;
  }
  
  const dropBps = config.priceTriggerDropBps;
  const debounceSec = config.priceTriggerDebounceSec;
  const dirtyTtlSec = process.env.DIRTY_TTL_SEC ? parseInt(process.env.DIRTY_TTL_SEC, 10) : null;
  const mode = config.priceTriggerCumulative ? 'cumulative' : 'delta';
  
  details.push(`DROP_BPS: ${dropBps} (${(dropBps / 100).toFixed(2)}%)`);
  details.push(`DEBOUNCE_SEC: ${debounceSec}s`);
  details.push(`MODE: ${mode}`);
  
  if (dirtyTtlSec !== null) {
    details.push(`DIRTY_TTL_SEC: ${dirtyTtlSec}s`);
    
    // Warn if debounce >= TTL (users may expire before next trigger eligible)
    if (debounceSec >= dirtyTtlSec) {
      details.push(`  ${YELLOW}⚠ DEBOUNCE_SEC (${debounceSec}) >= DIRTY_TTL_SEC (${dirtyTtlSec})${RESET}`);
      details.push(`    Guidance: Debounce should be < TTL to allow repeated triggers`);
      hasWarn = true;
    }
  } else {
    details.push(`${YELLOW}⚠ DIRTY_TTL_SEC not set${RESET}`);
  }
  
  // Validate DROP_BPS is reasonable
  if (dropBps < 10 || dropBps > 1000) {
    details.push(`  ${YELLOW}⚠ DROP_BPS (${dropBps}) outside typical range [10, 1000]${RESET}`);
    details.push(`    Guidance: 10-100 bps (0.1-1%) typical; adjust based on volatility`);
    hasWarn = true;
  }
  
  addResult(
    'Price-Trigger Config',
    hasWarn ? 'WARN' : 'PASS',
    undefined,
    details
  );
}

/**
 * Check Chainlink feeds: health, staleness, recent activity
 */
async function checkChainlinkFeeds() {
  printHeader('Chainlink Feed Health & Activity');
  
  const details: string[] = [];
  
  if (!config.chainlinkFeeds) {
    addResult('Chainlink Feeds', 'WARN', 'CHAINLINK_FEEDS not configured', details);
    return;
  }
  
  // Use RPC_URL or BACKFILL_RPC_URL for historical log scans (HTTP preferred)
  const rpcUrl = process.env.RPC_URL || process.env.BACKFILL_RPC_URL || config.wsRpcUrl;
  if (!rpcUrl) {
    addResult('Chainlink Feeds', 'FAIL', 'No RPC provider configured for feed checks', details);
    return;
  }
  
  details.push(`RPC: ${rpcUrl}`);
  details.push(`Feeds: ${config.chainlinkFeeds}`);
  details.push('');
  
  let hasFail = false;
  let hasWarn = false;
  
  try {
    const provider = rpcUrl.startsWith('ws') 
      ? new ethers.WebSocketProvider(rpcUrl)
      : new ethers.JsonRpcProvider(rpcUrl);
    
    const currentBlock = await provider.getBlockNumber();
    details.push(`Current block: ${currentBlock}`);
    details.push(`Scanning last ${DIAG_FEED_BLOCKS} blocks for AnswerUpdated events...`);
    details.push('');
    
    const aggregatorAbi = [
      'function decimals() external view returns (uint8)',
      'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
      'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)'
    ];
    
    const feedPairs = config.chainlinkFeeds.split(',').map(pair => {
      const [symbol, address] = pair.split(':').map(s => s.trim());
      return { symbol, address };
    });
    
    const dropBps = config.priceTriggerDropBps;
    
    for (const feed of feedPairs) {
      details.push(`${BOLD}${feed.symbol}${RESET} (${feed.address}):`);
      
      try {
        const contract = new ethers.Contract(feed.address, aggregatorAbi, provider);
        
        // Get latest round data
        const [decimals, roundData] = await withTimeout(
          Promise.all([
            contract.decimals(),
            contract.latestRoundData()
          ]),
          DIAG_TIMEOUT_MS,
          `${feed.symbol} feed queries`
        );
        
        const roundId = roundData[0] as bigint;
        const answer = roundData[1] as bigint;
        const updatedAt = roundData[3] as bigint;
        const answeredInRound = roundData[4] as bigint;
        
        // Check for invalid answer
        if (answer <= 0n) {
          details.push(`  ${RED}✗ Invalid answer: ${answer}${RESET}`);
          hasFail = true;
          continue;
        }
        
        // Check for stale round
        if (answeredInRound < roundId) {
          details.push(`  ${YELLOW}⚠ Stale: answeredInRound (${answeredInRound}) < roundId (${roundId})${RESET}`);
          hasWarn = true;
        }
        
        const price = normalizeChainlinkPrice(answer, Number(decimals));
        const now = Math.floor(Date.now() / 1000);
        const age = now - Number(updatedAt);
        
        details.push(`  Latest price: ${price.toFixed(8)}`);
        details.push(`  Updated: ${age}s ago`);
        
        if (age > 3600) {
          details.push(`  ${YELLOW}⚠ Stale data: >1 hour old${RESET}`);
          hasWarn = true;
        }
        
        // Scan recent AnswerUpdated logs
        const fromBlock = Math.max(0, currentBlock - DIAG_FEED_BLOCKS);
        const filter = contract.filters.AnswerUpdated();
        
        const logs = await withTimeout(
          contract.queryFilter(filter, fromBlock, currentBlock),
          DIAG_TIMEOUT_MS,
          `${feed.symbol} log scan`
        );
        
        details.push(`  AnswerUpdated events (last ${DIAG_FEED_BLOCKS} blocks): ${logs.length}`);
        
        if (logs.length === 0) {
          details.push(`  ${YELLOW}⚠ No recent updates - feed may be inactive${RESET}`);
          hasWarn = true;
        } else {
          // Analyze last few updates for price deltas
          const recentLogs = logs.slice(-5);
          details.push(`  Recent updates (last ${Math.min(5, logs.length)}):`);
          
          for (let i = 1; i < recentLogs.length; i++) {
            const prevLog = recentLogs[i - 1] as ethers.EventLog;
            const currLog = recentLogs[i] as ethers.EventLog;
            
            const prevAnswer = prevLog.args?.[0] as bigint;
            const currAnswer = currLog.args?.[0] as bigint;
            
            if (prevAnswer > 0n && currAnswer > 0n) {
              const prevPrice = normalizeChainlinkPrice(prevAnswer, Number(decimals));
              const currPrice = normalizeChainlinkPrice(currAnswer, Number(decimals));
              
              const deltaBps = Math.abs((currPrice - prevPrice) / prevPrice * 10000);
              const direction = currPrice > prevPrice ? '↑' : '↓';
              
              const exceeds = deltaBps >= dropBps;
              const marker = exceeds ? `${BOLD}*${RESET}` : ' ';
              
              details.push(`    ${marker}Block ${currLog.blockNumber}: ${prevPrice.toFixed(4)} → ${currPrice.toFixed(4)} ${direction} ${deltaBps.toFixed(0)} bps${exceeds ? ' (exceeds threshold)' : ''}`);
            }
          }
          
          details.push(`  ${GREEN}✓ Feed is active${RESET}`);
        }
        
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        details.push(`  ${RED}✗ Failed: ${message}${RESET}`);
        hasFail = true;
      }
      
      details.push('');
    }
    
    // Clean up provider
    if ('destroy' in provider && typeof provider.destroy === 'function') {
      provider.destroy();
    }
    
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addResult('Chainlink Feeds', 'FAIL', `Provider error: ${message}`, details);
    return;
  }
  
  addResult(
    'Chainlink Feeds',
    hasFail ? 'FAIL' : hasWarn ? 'WARN' : 'PASS',
    hasFail ? 'One or more feeds failed checks' : hasWarn ? 'Some feeds have warnings' : undefined,
    details
  );
}

/**
 * Check Aave candidate pool from recent events
 */
async function checkAaveCandidatePool() {
  printHeader('Aave Candidate Pool (Recent Activity)');
  
  const details: string[] = [];
  
  const poolAddress = config.aavePoolAddress || config.aavePool;
  if (!poolAddress) {
    addResult('Aave Candidate Pool', 'FAIL', 'AAVE_POOL_ADDRESS not configured', details);
    return;
  }
  
  const rpcUrl = process.env.RPC_URL || process.env.BACKFILL_RPC_URL || config.wsRpcUrl;
  if (!rpcUrl) {
    addResult('Aave Candidate Pool', 'FAIL', 'No RPC provider configured', details);
    return;
  }
  
  details.push(`AAVE_POOL: ${poolAddress}`);
  details.push(`RPC: ${rpcUrl}`);
  details.push(`Scanning last ${DIAG_AAVE_BLOCKS} blocks for Borrow/Repay/Supply/Withdraw events...`);
  details.push('');
  
  try {
    const provider = rpcUrl.startsWith('ws')
      ? new ethers.WebSocketProvider(rpcUrl)
      : new ethers.JsonRpcProvider(rpcUrl);
    
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - DIAG_AAVE_BLOCKS);
    
    details.push(`Current block: ${currentBlock}`);
    details.push(`Scan range: ${fromBlock} → ${currentBlock}`);
    details.push('');
    
    const poolAbi = [
      'event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)',
      'event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)',
      'event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)',
      'event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)'
    ];
    
    const contract = new ethers.Contract(poolAddress, poolAbi, provider);
    
    // Query all event types
    const [borrowLogs, repayLogs, supplyLogs, withdrawLogs] = await withTimeout(
      Promise.all([
        contract.queryFilter(contract.filters.Borrow(), fromBlock, currentBlock),
        contract.queryFilter(contract.filters.Repay(), fromBlock, currentBlock),
        contract.queryFilter(contract.filters.Supply(), fromBlock, currentBlock),
        contract.queryFilter(contract.filters.Withdraw(), fromBlock, currentBlock)
      ]),
      DIAG_TIMEOUT_MS * 2, // Allow extra time for large scans
      'Aave event log queries'
    );
    
    details.push(`Events found:`);
    details.push(`  Borrow: ${borrowLogs.length}`);
    details.push(`  Repay: ${repayLogs.length}`);
    details.push(`  Supply: ${supplyLogs.length}`);
    details.push(`  Withdraw: ${withdrawLogs.length}`);
    details.push(`  Total: ${borrowLogs.length + repayLogs.length + supplyLogs.length + withdrawLogs.length}`);
    details.push('');
    
    // Extract unique users
    const uniqueUsers = new Set<string>();
    
    for (const log of borrowLogs) {
      const eventLog = log as ethers.EventLog;
      // user field at args[1] for Borrow
      const user = eventLog.args?.[1] as string;
      if (user) uniqueUsers.add(user.toLowerCase());
    }
    
    for (const log of repayLogs) {
      const eventLog = log as ethers.EventLog;
      // user field at args[1] for Repay
      const user = eventLog.args?.[1] as string;
      if (user) uniqueUsers.add(user.toLowerCase());
    }
    
    for (const log of supplyLogs) {
      const eventLog = log as ethers.EventLog;
      // user field at args[1] for Supply
      const user = eventLog.args?.[1] as string;
      if (user) uniqueUsers.add(user.toLowerCase());
    }
    
    for (const log of withdrawLogs) {
      const eventLog = log as ethers.EventLog;
      // user field at args[1] for Withdraw
      const user = eventLog.args?.[1] as string;
      if (user) uniqueUsers.add(user.toLowerCase());
    }
    
    details.push(`Unique active users: ${uniqueUsers.size}`);
    
    if (uniqueUsers.size === 0) {
      details.push(`${YELLOW}⚠ No active users found - emergency scans will have empty target set${RESET}`);
      details.push(`  Guidance: Check if AAVE_POOL_ADDRESS is correct for your network`);
      addResult('Aave Candidate Pool', 'WARN', 'No recent activity detected', details);
    } else {
      details.push(`${GREEN}✓ Active user pool available for emergency scans${RESET}`);
      
      // Show sample users (first 5)
      const sampleUsers = Array.from(uniqueUsers).slice(0, 5);
      details.push('');
      details.push('Sample users (first 5):');
      sampleUsers.forEach(user => details.push(`  ${user}`));
      
      addResult('Aave Candidate Pool', 'PASS', undefined, details);
    }
    
    // Clean up provider
    if ('destroy' in provider && typeof provider.destroy === 'function') {
      provider.destroy();
    }
    
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addResult('Aave Candidate Pool', 'FAIL', `Failed to scan events: ${message}`, details);
  }
}

/**
 * Main diagnostic runner
 */
async function main() {
  console.log(BOLD + BLUE + '\n╔════════════════════════════════════════════════════════════════════════════════╗' + RESET);
  console.log(BOLD + BLUE + '║            LiquidBot Dirty Users Pipeline Diagnostics                         ║' + RESET);
  console.log(BOLD + BLUE + '╚════════════════════════════════════════════════════════════════════════════════╝' + RESET);
  
  console.log('\nDiagnostic Configuration:');
  console.log(`  DIAG_FEED_BLOCKS: ${DIAG_FEED_BLOCKS}`);
  console.log(`  DIAG_AAVE_BLOCKS: ${DIAG_AAVE_BLOCKS}`);
  console.log(`  DIAG_TIMEOUT_MS: ${DIAG_TIMEOUT_MS}`);
  
  // Run all checks
  await checkProviderConnectivity();
  await checkPriceTriggerConfig();
  await checkChainlinkFeeds();
  await checkAaveCandidatePool();
  
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
    console.log(`${RED}${BOLD}✗ Diagnostics FAILED${RESET}`);
    console.log('Action required: Review failures above and fix configuration/connectivity issues.\n');
    process.exit(1);
  } else if (warnCount > 0) {
    console.log(`${YELLOW}${BOLD}⚠ Diagnostics completed with warnings${RESET}`);
    console.log('Review warnings above - system may work but could have suboptimal configuration.\n');
    process.exit(0);
  } else {
    console.log(`${GREEN}${BOLD}✓ All diagnostics PASSED${RESET}`);
    console.log('Dirty users pipeline is properly configured and healthy.\n');
    process.exit(0);
  }
}

// Run diagnostics
main().catch((err) => {
  console.error(`${RED}${BOLD}✗ Diagnostics crashed:${RESET}`, err);
  process.exit(1);
});
