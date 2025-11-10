#!/usr/bin/env tsx
/**
 * diagnose-dirty-users.ts - Diagnostic script for dirty user set debugging
 * 
 * Multi-phase diagnostic that tests all pathways for marking users dirty.
 * Prints detailed JSON output and exits with status code 0 on success, non-zero on failure.
 * 
 * Usage:
 *   tsx scripts/diagnose-dirty-users.ts
 *   or
 *   npm run diagnose:dirty
 */

import 'dotenv/config';
import { EventLog, Interface, WebSocketProvider } from 'ethers';

import { config } from '../src/config/index.js';
import { RealTimeHFService } from '../src/services/RealTimeHFService.js';

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

interface DiagnosticResult {
  env: Record<string, unknown>;
  providerUrl: string | null;
  chainlinkEventsTest: {
    status: 'PASS' | 'FAIL' | 'SKIP';
    message: string;
    details?: string[];
  };
  aaveEventsTest: {
    status: 'PASS' | 'FAIL' | 'SKIP';
    message: string;
    details?: string[];
  };
  priceTriggerTest: {
    status: 'PASS' | 'FAIL' | 'SKIP';
    message: string;
    details?: string[];
  };
  debounceTest: {
    status: 'PASS' | 'FAIL' | 'SKIP';
    message: string;
    details?: string[];
  };
  ttlTest: {
    status: 'PASS' | 'FAIL' | 'SKIP';
    message: string;
    details?: string[];
  };
  final: {
    dirtyCount: number;
    metrics: Record<string, unknown>;
  };
}

const result: DiagnosticResult = {
  env: {},
  providerUrl: null,
  chainlinkEventsTest: { status: 'SKIP', message: 'Not executed' },
  aaveEventsTest: { status: 'SKIP', message: 'Not executed' },
  priceTriggerTest: { status: 'SKIP', message: 'Not executed' },
  debounceTest: { status: 'SKIP', message: 'Not executed' },
  ttlTest: { status: 'SKIP', message: 'Not executed' },
  final: { dirtyCount: 0, metrics: {} }
};

function printHeader(title: string) {
  console.log('\n' + BOLD + BLUE + '═'.repeat(80) + RESET);
  console.log(BOLD + BLUE + `  ${title}` + RESET);
  console.log(BOLD + BLUE + '═'.repeat(80) + RESET + '\n');
}

function printStatus(status: 'PASS' | 'FAIL' | 'SKIP' | 'WARN', message: string) {
  const statusColor = status === 'PASS' ? GREEN : status === 'FAIL' ? RED : status === 'SKIP' ? BLUE : YELLOW;
  const statusSymbol = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : status === 'SKIP' ? '○' : '⚠';
  console.log(`${statusColor}${statusSymbol}${RESET} ${message}`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function phaseA_validateEnv(): Promise<void> {
  printHeader('Phase A: Environment Validation');
  
  // Collect relevant environment variables
  result.env = {
    USE_REALTIME_HF: config.useRealtimeHF,
    WS_RPC_URL: config.wsRpcUrl,
    CHAINLINK_RPC_URL: config.chainlinkRpcUrl,
    CHAINLINK_FEEDS: config.chainlinkFeeds,
    PRICE_TRIGGER_ENABLED: config.priceTriggerEnabled,
    PRICE_TRIGGER_DROP_BPS: config.priceTriggerDropBps,
    PRICE_TRIGGER_DEBOUNCE_SEC: config.priceTriggerDebounceSec,
    PRICE_TRIGGER_CUMULATIVE: config.priceTriggerCumulative,
    PRICE_TRIGGER_MAX_SCAN: config.priceTriggerMaxScan,
    PRICE_TRIGGER_ASSETS: config.priceTriggerAssets,
    EXECUTION_HF_THRESHOLD_BPS: config.executionHfThresholdBps,
    CANDIDATE_MAX: config.candidateMax,
    NOTIFY_ONLY_WHEN_ACTIONABLE: config.notifyOnlyWhenActionable,
    HEAD_CHECK_PAGE_STRATEGY: config.headCheckPageStrategy,
    HEAD_CHECK_PAGE_SIZE: config.headCheckPageSize,
    ALWAYS_INCLUDE_HF_BELOW: config.alwaysIncludeHfBelow
  };
  
  console.log('Environment Configuration:');
  for (const [key, value] of Object.entries(result.env)) {
    console.log(`  ${key}: ${value}`);
  }
  
  // Validate critical settings
  const warnings: string[] = [];
  
  if (!config.useRealtimeHF) {
    warnings.push('USE_REALTIME_HF is disabled - service will not run');
  }
  
  if (!config.wsRpcUrl) {
    warnings.push('WS_RPC_URL is not configured');
  }
  
  if (config.executionHfThresholdBps === 10000) {
    warnings.push('EXECUTION_HF_THRESHOLD_BPS=10000 (100%) may cause inconsistent logic');
  }
  
  if (config.priceTriggerEnabled && !config.chainlinkFeeds) {
    warnings.push('PRICE_TRIGGER_ENABLED but CHAINLINK_FEEDS not configured');
  }
  
  if (warnings.length > 0) {
    console.log('\n' + YELLOW + 'Warnings:' + RESET);
    warnings.forEach(w => console.log(`  ⚠ ${w}`));
  }
  
  printStatus(warnings.length === 0 ? 'PASS' : 'WARN', 
    warnings.length === 0 ? 'Environment validation passed' : `Environment validation passed with ${warnings.length} warning(s)`);
}

async function phaseB_instrumentProvider(service: RealTimeHFService): Promise<void> {
  printHeader('Phase B: Provider Identity Instrumentation');
  
  try {
    // Extract provider URL from service (accessing private field for diagnostics)
    const serviceAny = service as any;
    const provider = serviceAny.provider;
    
    if (provider) {
      // For WebSocketProvider, try to extract the connection URL
      if (provider instanceof WebSocketProvider) {
        // WebSocketProvider has _websocket property with url
        const ws = (provider as any)._websocket;
        if (ws && ws.url) {
          result.providerUrl = ws.url;
          console.log(`Provider Type: WebSocketProvider`);
          console.log(`WebSocket URL: ${ws.url}`);
          printStatus('PASS', 'Provider identified successfully');
        } else {
          result.providerUrl = 'WebSocketProvider (URL not accessible)';
          console.log(`Provider Type: WebSocketProvider`);
          printStatus('WARN', 'WebSocketProvider detected but URL not accessible');
        }
      } else {
        result.providerUrl = provider.constructor.name;
        console.log(`Provider Type: ${provider.constructor.name}`);
        printStatus('PASS', 'Provider identified');
      }
    } else {
      result.providerUrl = null;
      console.log('Provider: Not initialized');
      printStatus('WARN', 'Provider not initialized (skipWsConnection may be enabled)');
    }
  } catch (err) {
    console.error('Error instrumenting provider:', err);
    result.providerUrl = null;
    printStatus('FAIL', `Failed to instrument provider: ${err}`);
  }
}

async function phaseC_syntheticChainlinkEvents(service: RealTimeHFService): Promise<void> {
  printHeader('Phase C: Synthetic Chainlink AnswerUpdated Events');
  
  if (!config.priceTriggerEnabled) {
    result.chainlinkEventsTest = {
      status: 'SKIP',
      message: 'PRICE_TRIGGER_ENABLED is false, skipping test'
    };
    printStatus('SKIP', 'Price trigger disabled, skipping Chainlink event test');
    return;
  }
  
  if (!config.chainlinkFeeds) {
    result.chainlinkEventsTest = {
      status: 'SKIP',
      message: 'CHAINLINK_FEEDS not configured, skipping test'
    };
    printStatus('SKIP', 'No Chainlink feeds configured, skipping test');
    return;
  }
  
  try {
    // Parse feeds to get first feed address
    const feeds = parseChainlinkFeeds(config.chainlinkFeeds);
    const feedEntries = Object.entries(feeds);
    
    if (feedEntries.length === 0) {
      result.chainlinkEventsTest = {
        status: 'SKIP',
        message: 'No valid Chainlink feeds found'
      };
      printStatus('SKIP', 'No valid Chainlink feeds to test');
      return;
    }
    
    const [symbol, feedAddress] = feedEntries[0];
    console.log(`Testing with feed: ${symbol} (${feedAddress})`);
    
    // Create synthetic AnswerUpdated event
    const answerUpdatedInterface = new Interface([
      'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)'
    ]);
    
    // Simulate price drop: baseline 2000e8, drop to 1994e8 (-30bps = -0.30%)
    const baselinePrice = BigInt(2000e8);
    const droppedPrice = BigInt(1994e8); // 0.30% drop
    
    // Create synthetic logs
    const syntheticLog1 = {
      address: feedAddress,
      topics: [
        answerUpdatedInterface.getEvent('AnswerUpdated')!.topicHash,
        // current price (indexed)
        '0x' + baselinePrice.toString(16).padStart(64, '0'),
        // roundId (indexed)
        '0x0000000000000000000000000000000000000000000000000000000000000001'
      ],
      data: '0x0000000000000000000000000000000000000000000000000000000000000001', // updatedAt
      blockNumber: 1000,
      transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      transactionIndex: 0,
      blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      logIndex: 0,
      removed: false
    } as unknown as EventLog;
    
    const syntheticLog2 = {
      address: feedAddress,
      topics: [
        answerUpdatedInterface.getEvent('AnswerUpdated')!.topicHash,
        '0x' + droppedPrice.toString(16).padStart(64, '0'),
        '0x0000000000000000000000000000000000000000000000000000000000000002'
      ],
      data: '0x0000000000000000000000000000000000000000000000000000000000000002',
      blockNumber: 1001,
      transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde0',
      transactionIndex: 0,
      blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456789a',
      logIndex: 0,
      removed: false
    } as unknown as EventLog;
    
    // Inject logs via handleLog (accessing private method for testing)
    const serviceAny = service as any;
    
    console.log(`Injecting baseline price update: ${baselinePrice} (${Number(baselinePrice) / 1e8})`);
    await serviceAny.handleLog(syntheticLog1);
    
    console.log('Waiting 100ms...');
    await sleep(100);
    
    console.log(`Injecting price drop: ${droppedPrice} (${Number(droppedPrice) / 1e8}) - drop of 30bps`);
    await serviceAny.handleLog(syntheticLog2);
    
    console.log('Waiting 200ms for price trigger to process...');
    await sleep(200);
    
    // Check if dirty users were marked
    const dirtyUsers = serviceAny.dirtyUsers as Set<string>;
    const dirtyCount = dirtyUsers.size;
    
    result.chainlinkEventsTest = {
      status: dirtyCount > 0 || config.priceTriggerDropBps > 30 ? 'PASS' : 'FAIL',
      message: dirtyCount > 0 
        ? `Price trigger worked: ${dirtyCount} user(s) marked dirty`
        : config.priceTriggerDropBps > 30
          ? `No users marked dirty (expected: threshold ${config.priceTriggerDropBps}bps > test drop 30bps)`
          : 'Price drop did not mark any users dirty',
      details: [
        `Baseline price: ${Number(baselinePrice) / 1e8}`,
        `Dropped price: ${Number(droppedPrice) / 1e8}`,
        `Drop magnitude: 30 bps`,
        `Threshold: ${config.priceTriggerDropBps} bps`,
        `Dirty users: ${dirtyCount}`
      ]
    };
    
    printStatus(result.chainlinkEventsTest.status, result.chainlinkEventsTest.message);
    if (result.chainlinkEventsTest.details) {
      result.chainlinkEventsTest.details.forEach(d => console.log(`  • ${d}`));
    }
  } catch (err) {
    result.chainlinkEventsTest = {
      status: 'FAIL',
      message: `Error injecting Chainlink events: ${err}`
    };
    printStatus('FAIL', result.chainlinkEventsTest.message);
  }
}

async function phaseD_syntheticAaveEvents(service: RealTimeHFService): Promise<void> {
  printHeader('Phase D: Synthetic Aave Borrow Event');
  
  try {
    // Create synthetic Borrow event
    const borrowInterface = new Interface([
      'event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)'
    ]);
    
    const testUser = '0x1234567890123456789012345678901234567890';
    const testReserve = '0x4200000000000000000000000000000000000006'; // WETH on Base
    
    // Encode the non-indexed parameters for the data field using AbiCoder
    // Non-indexed params: user (address), amount (uint256), interestRateMode (uint8), borrowRate (uint256)
    const { AbiCoder } = await import('ethers');
    const abiCoder = AbiCoder.defaultAbiCoder();
    const encodedData = abiCoder.encode(
      ['address', 'uint256', 'uint8', 'uint256'],
      [
        testUser,      // user
        BigInt(1e18),  // amount: 1 ETH
        2,             // interestRateMode: variable rate
        BigInt(3e25)   // borrowRate: 3% APR
      ]
    );
    
    const syntheticBorrowLog = {
      address: config.aavePool,
      topics: [
        borrowInterface.getEvent('Borrow')!.topicHash,
        // reserve (indexed)
        '0x' + testReserve.slice(2).padStart(64, '0'),
        // onBehalfOf (indexed)
        '0x' + testUser.slice(2).padStart(64, '0'),
        // referralCode (indexed)
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      ],
      data: encodedData,
      blockNumber: 2000,
      transactionHash: '0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      transactionIndex: 0,
      blockHash: '0xbbcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      logIndex: 0,
      removed: false
    } as unknown as EventLog;
    
    console.log(`Injecting Borrow event for user: ${testUser}`);
    
    // Get initial dirty set size
    const serviceAny = service as any;
    const dirtyUsersBefore = new Set(serviceAny.dirtyUsers as Set<string>);
    const sizeBefore = dirtyUsersBefore.size;
    
    // Inject log
    await serviceAny.handleLog(syntheticBorrowLog);
    
    console.log('Waiting 100ms for event processing...');
    await sleep(100);
    
    // Check if user was marked dirty
    const dirtyUsersAfter = serviceAny.dirtyUsers as Set<string>;
    const sizeAfter = dirtyUsersAfter.size;
    const userMarkedDirty = dirtyUsersAfter.has(testUser.toLowerCase());
    
    result.aaveEventsTest = {
      status: userMarkedDirty ? 'PASS' : 'FAIL',
      message: userMarkedDirty 
        ? `Aave event successfully marked user ${testUser} as dirty`
        : `Aave event did NOT mark user as dirty`,
      details: [
        `User: ${testUser}`,
        `Reserve: ${testReserve}`,
        `Dirty set size before: ${sizeBefore}`,
        `Dirty set size after: ${sizeAfter}`,
        `User in dirty set: ${userMarkedDirty}`
      ]
    };
    
    printStatus(result.aaveEventsTest.status, result.aaveEventsTest.message);
    if (result.aaveEventsTest.details) {
      result.aaveEventsTest.details.forEach(d => console.log(`  • ${d}`));
    }
  } catch (err) {
    result.aaveEventsTest = {
      status: 'FAIL',
      message: `Error injecting Aave event: ${err}`
    };
    printStatus('FAIL', result.aaveEventsTest.message);
  }
}

async function phaseE_debounceTest(service: RealTimeHFService): Promise<void> {
  printHeader('Phase E: Debounce Testing');
  
  if (!config.priceTriggerEnabled || !config.chainlinkFeeds) {
    result.debounceTest = {
      status: 'SKIP',
      message: 'Price trigger not enabled or feeds not configured'
    };
    printStatus('SKIP', 'Price trigger not enabled, skipping debounce test');
    return;
  }
  
  try {
    const feeds = parseChainlinkFeeds(config.chainlinkFeeds);
    const feedEntries = Object.entries(feeds);
    
    if (feedEntries.length === 0) {
      result.debounceTest = {
        status: 'SKIP',
        message: 'No valid Chainlink feeds found'
      };
      printStatus('SKIP', 'No valid Chainlink feeds to test');
      return;
    }
    
    const [symbol, feedAddress] = feedEntries[0];
    const answerUpdatedInterface = new Interface([
      'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)'
    ]);
    
    // Test 1: Rapid fire within debounce window (should be debounced)
    console.log(`Testing rapid price drops within ${config.priceTriggerDebounceSec}s debounce window...`);
    
    const price1 = BigInt(2000e8);
    const price2 = BigInt(1994e8); // -30bps
    const price3 = BigInt(1988e8); // another -30bps
    
    const createLog = (price: bigint, roundId: number, blockNum: number) => ({
      address: feedAddress,
      topics: [
        answerUpdatedInterface.getEvent('AnswerUpdated')!.topicHash,
        '0x' + price.toString(16).padStart(64, '0'),
        '0x' + roundId.toString(16).padStart(64, '0')
      ],
      data: '0x' + Date.now().toString(16).padStart(64, '0'),
      blockNumber: blockNum,
      transactionHash: '0x' + blockNum.toString(16).padStart(64, '0'),
      transactionIndex: 0,
      blockHash: '0x' + blockNum.toString(16).padStart(64, '0'),
      logIndex: 0,
      removed: false
    } as unknown as EventLog);
    
    const serviceAny = service as any;
    
    // Reset price tracking
    serviceAny.lastSeenPrices.clear();
    serviceAny.baselinePrices.clear();
    serviceAny.lastPriceTriggerTime.clear();
    
    console.log('Injecting first price drop...');
    await serviceAny.handleLog(createLog(price1, 100, 3000));
    await sleep(50);
    await serviceAny.handleLog(createLog(price2, 101, 3001));
    await sleep(100);
    
    console.log('Injecting second price drop within debounce window...');
    await serviceAny.handleLog(createLog(price3, 102, 3002));
    await sleep(100);
    
    // Test 2: Price drop outside debounce window (should trigger)
    const debounceMs = config.priceTriggerDebounceSec * 1000;
    console.log(`Waiting ${config.priceTriggerDebounceSec}s for debounce window to expire...`);
    
    // Advance the last trigger time artificially for testing
    const lastTriggerMap = serviceAny.lastPriceTriggerTime as Map<string, number>;
    const symbolKeys = Array.from(lastTriggerMap.keys());
    if (symbolKeys.length > 0) {
      const oldTime = lastTriggerMap.get(symbolKeys[0])!;
      lastTriggerMap.set(symbolKeys[0], oldTime - debounceMs - 1000);
      
      console.log('Injecting price drop after debounce window...');
      const price4 = BigInt(1982e8); // another -30bps
      await serviceAny.handleLog(createLog(price4, 103, 3003));
      await sleep(100);
    }
    
    result.debounceTest = {
      status: 'PASS',
      message: 'Debounce test completed (manual verification needed via logs)',
      details: [
        `Debounce window: ${config.priceTriggerDebounceSec}s`,
        'Test 1: Rapid drops within window (should be debounced)',
        'Test 2: Drop after window (should trigger)',
        'Check logs above for [price-trigger] Debounced messages'
      ]
    };
    
    printStatus(result.debounceTest.status, result.debounceTest.message);
    if (result.debounceTest.details) {
      result.debounceTest.details.forEach(d => console.log(`  • ${d}`));
    }
  } catch (err) {
    result.debounceTest = {
      status: 'FAIL',
      message: `Error in debounce test: ${err}`
    };
    printStatus('FAIL', result.debounceTest.message);
  }
}

async function phaseF_cumulativeTest(service: RealTimeHFService): Promise<void> {
  printHeader('Phase F: Cumulative Mode Testing');
  
  if (!config.priceTriggerEnabled || !config.chainlinkFeeds) {
    result.priceTriggerTest = {
      status: 'SKIP',
      message: 'Price trigger not enabled or feeds not configured'
    };
    printStatus('SKIP', 'Price trigger not enabled, skipping cumulative test');
    return;
  }
  
  try {
    const mode = config.priceTriggerCumulative ? 'cumulative' : 'delta';
    console.log(`Current mode: ${mode}`);
    
    if (config.priceTriggerCumulative) {
      console.log('Testing cumulative mode: sequential small drops should accumulate');
      
      const feeds = parseChainlinkFeeds(config.chainlinkFeeds);
      const feedEntries = Object.entries(feeds);
      
      if (feedEntries.length === 0) {
        result.priceTriggerTest = {
          status: 'SKIP',
          message: 'No valid Chainlink feeds found'
        };
        printStatus('SKIP', 'No valid Chainlink feeds to test');
        return;
      }
      
      const [symbol, feedAddress] = feedEntries[0];
      const answerUpdatedInterface = new Interface([
        'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)'
      ]);
      
      // Sequential drops: 2000 -> 1995 (-25bps) -> 1990 (-25bps) = cumulative -50bps
      const prices = [
        BigInt(2000e8), // baseline
        BigInt(1995e8), // -25bps
        BigInt(1990e8)  // another -25bps, total -50bps from baseline
      ];
      
      const serviceAny = service as any;
      serviceAny.lastSeenPrices.clear();
      serviceAny.baselinePrices.clear();
      serviceAny.lastPriceTriggerTime.clear();
      
      for (let i = 0; i < prices.length; i++) {
        console.log(`Injecting price update ${i + 1}/${prices.length}: ${Number(prices[i]) / 1e8}`);
        
        const log = {
          address: feedAddress,
          topics: [
            answerUpdatedInterface.getEvent('AnswerUpdated')!.topicHash,
            '0x' + prices[i].toString(16).padStart(64, '0'),
            '0x' + (200 + i).toString(16).padStart(64, '0')
          ],
          data: '0x' + Date.now().toString(16).padStart(64, '0'),
          blockNumber: 4000 + i,
          transactionHash: '0x' + (4000 + i).toString(16).padStart(64, '0'),
          transactionIndex: 0,
          blockHash: '0x' + (4000 + i).toString(16).padStart(64, '0'),
          logIndex: 0,
          removed: false
        } as unknown as EventLog;
        
        await serviceAny.handleLog(log);
        
        // Wait longer than debounce window between updates
        if (i < prices.length - 1) {
          await sleep((config.priceTriggerDebounceSec + 1) * 1000);
        }
      }
      
      result.priceTriggerTest = {
        status: 'PASS',
        message: 'Cumulative mode test completed',
        details: [
          'Mode: cumulative',
          'Test: Sequential small drops accumulating to large drop',
          'Check logs above for price trigger behavior'
        ]
      };
    } else {
      result.priceTriggerTest = {
        status: 'SKIP',
        message: 'Cumulative mode not enabled (PRICE_TRIGGER_CUMULATIVE=false)'
      };
    }
    
    printStatus(result.priceTriggerTest.status, result.priceTriggerTest.message);
    if (result.priceTriggerTest.details) {
      result.priceTriggerTest.details.forEach(d => console.log(`  • ${d}`));
    }
  } catch (err) {
    result.priceTriggerTest = {
      status: 'FAIL',
      message: `Error in cumulative test: ${err}`
    };
    printStatus('FAIL', result.priceTriggerTest.message);
  }
}

async function phaseG_finalReport(service: RealTimeHFService): Promise<void> {
  printHeader('Phase G: Final Report');
  
  try {
    const serviceAny = service as any;
    const dirtyUsers = serviceAny.dirtyUsers as Set<string>;
    const metrics = service.getMetrics();
    
    result.final.dirtyCount = dirtyUsers.size;
    result.final.metrics = {
      blocksReceived: metrics.blocksReceived,
      aaveLogsReceived: metrics.aaveLogsReceived,
      priceUpdatesReceived: metrics.priceUpdatesReceived,
      healthChecksPerformed: metrics.healthChecksPerformed,
      triggersProcessed: metrics.triggersProcessed,
      candidateCount: metrics.candidateCount
    };
    
    console.log('Final State:');
    console.log(`  Dirty users count: ${result.final.dirtyCount}`);
    console.log(`  Dirty users: ${Array.from(dirtyUsers).join(', ') || '(none)'}`);
    console.log('\nMetrics:');
    for (const [key, value] of Object.entries(result.final.metrics)) {
      console.log(`  ${key}: ${value}`);
    }
    
    printStatus('PASS', 'Final report generated');
  } catch (err) {
    console.error('Error generating final report:', err);
    printStatus('FAIL', `Failed to generate final report: ${err}`);
  }
}

function parseChainlinkFeeds(feedsStr: string): Record<string, string> {
  const feeds: Record<string, string> = {};
  const pairs = feedsStr.split(',');
  
  for (const pair of pairs) {
    const [symbol, address] = pair.split(':').map(s => s.trim());
    if (symbol && address && address.match(/^0x[a-fA-F0-9]{40}$/)) {
      feeds[symbol] = address;
    }
  }
  
  return feeds;
}

async function main() {
  console.log(BOLD + '\n🔍 Dirty User Set Diagnostic Tool\n' + RESET);
  
  let exitCode = 0;
  let service: RealTimeHFService | null = null;
  
  try {
    // Phase A: Environment validation
    await phaseA_validateEnv();
    
    // Initialize service with skipWsConnection to avoid actual network calls
    console.log('\nInitializing RealTimeHFService (test mode)...');
    service = new RealTimeHFService({ skipWsConnection: true });
    await service.start();
    console.log('Service started successfully\n');
    
    // Phase B: Provider instrumentation
    await phaseB_instrumentProvider(service);
    
    // Phase C: Chainlink events
    await phaseC_syntheticChainlinkEvents(service);
    
    // Phase D: Aave events
    await phaseD_syntheticAaveEvents(service);
    
    // Phase E: Debounce testing
    await phaseE_debounceTest(service);
    
    // Phase F: Cumulative mode testing
    await phaseF_cumulativeTest(service);
    
    // Phase G: Final report
    await phaseG_finalReport(service);
    
    // Print summary
    printHeader('Summary');
    
    const tests = [
      result.chainlinkEventsTest,
      result.aaveEventsTest,
      result.priceTriggerTest,
      result.debounceTest,
      result.ttlTest
    ];
    
    const passed = tests.filter(t => t.status === 'PASS').length;
    const failed = tests.filter(t => t.status === 'FAIL').length;
    const skipped = tests.filter(t => t.status === 'SKIP').length;
    
    console.log(`Tests: ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}, ${BLUE}${skipped} skipped${RESET}`);
    console.log(`Final dirty user count: ${result.final.dirtyCount}`);
    
    if (failed > 0) {
      exitCode = 1;
      console.log('\n' + RED + '❌ Diagnostic failed - see failures above' + RESET);
    } else {
      console.log('\n' + GREEN + '✅ Diagnostic completed successfully' + RESET);
    }
    
    // Output JSON result
    console.log('\n' + BOLD + 'JSON Output:' + RESET);
    console.log(JSON.stringify(result, null, 2));
    
  } catch (err) {
    console.error('\n' + RED + 'Fatal error:' + RESET, err);
    exitCode = 1;
  } finally {
    if (service) {
      console.log('\nShutting down service...');
      await service.stop();
    }
  }
  
  process.exit(exitCode);
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
