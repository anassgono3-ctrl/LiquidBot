#!/usr/bin/env tsx
// hf-realtime-harness.ts: Real-time HF validation harness for low-latency detection testing
// This is a test-only utility that does NOT affect main bot behavior.

import { WebSocketProvider, JsonRpcProvider, Contract, Interface, formatUnits } from 'ethers';

import { config } from '../src/config/index.js';
import { SubgraphService } from '../src/services/SubgraphService.js';
import { HealthCalculator } from '../src/services/HealthCalculator.js';

// Environment variable helpers
function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || defaultValue;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseInt(value, 10) : defaultValue;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

// Configuration
const USE_FLASHBLOCKS = getEnvBoolean('USE_FLASHBLOCKS', false);
const FLASHBLOCKS_WS_URL = getEnv('FLASHBLOCKS_WS_URL');
const WS_RPC_URL = getEnv('WS_RPC_URL');
const RPC_URL = getEnv('RPC_URL');
const MULTICALL3_ADDRESS = getEnv('MULTICALL3_ADDRESS', '0xca11bde05977b3631167028862be2a173976ca11');
const AAVE_POOL = getEnv('AAVE_POOL', '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5');
const EXECUTION_HF_THRESHOLD_BPS = getEnvNumber('EXECUTION_HF_THRESHOLD_BPS', 9800);
const CANDIDATE_USERS = getEnv('CANDIDATE_USERS');
const SEED_LIMIT = getEnvNumber('SEED_LIMIT', 50);
const HARNESS_DURATION_SEC = getEnvNumber('HARNESS_DURATION_SEC', 60);
const CHAINLINK_FEEDS = getEnv('CHAINLINK_FEEDS');

// Multicall3 ABI (aggregate3 method)
const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) external payable returns (tuple(bool success, bytes returnData)[] returnData)'
];

// Aave Pool ABI (getUserAccountData method)
const AAVE_POOL_ABI = [
  'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)',
  'event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)',
  'event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)',
  'event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)'
];

// Chainlink AggregatorV3 ABI (AnswerUpdated event)
const CHAINLINK_AGG_ABI = [
  'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)'
];

interface CandidateState {
  address: string;
  lastHF: number | null;
  lastCheck: number;
}

interface HarnessStats {
  startTime: number;
  blocksReceived: number;
  aaveLogsReceived: number;
  priceUpdatesReceived: number;
  healthChecksPerformed: number;
  lowestHF: number | null;
  lowestHFUser: string | null;
  liquidatableCandidates: string[];
}

class HFRealtimeHarness {
  private provider: WebSocketProvider | JsonRpcProvider | null = null;
  private multicall3: Contract | null = null;
  private aavePool: Contract | null = null;
  private candidates: Map<string, CandidateState> = new Map();
  private stats: HarnessStats;
  private isShuttingDown = false;
  private subscriptions: string[] = [];
  private healthCalculator: HealthCalculator;

  constructor() {
    this.stats = {
      startTime: Date.now(),
      blocksReceived: 0,
      aaveLogsReceived: 0,
      priceUpdatesReceived: 0,
      healthChecksPerformed: 0,
      lowestHF: null,
      lowestHFUser: null,
      liquidatableCandidates: []
    };
    this.healthCalculator = new HealthCalculator();
  }

  async initialize(): Promise<void> {
    console.log('[harness] Starting real-time HF harness');
    console.log('[harness] Configuration:');
    console.log(`[harness]   USE_FLASHBLOCKS: ${USE_FLASHBLOCKS}`);
    console.log(`[harness]   MULTICALL3_ADDRESS: ${MULTICALL3_ADDRESS}`);
    console.log(`[harness]   AAVE_POOL: ${AAVE_POOL}`);
    console.log(`[harness]   HF_THRESHOLD: ${EXECUTION_HF_THRESHOLD_BPS} bps (${EXECUTION_HF_THRESHOLD_BPS / 10000})`);
    console.log(`[harness]   DURATION: ${HARNESS_DURATION_SEC}s`);

    // Setup WebSocket provider
    await this.setupProvider();

    // Verify contract code presence
    await this.verifyContracts();

    // Seed candidates
    await this.seedCandidates();

    // Setup subscriptions
    await this.setupSubscriptions();

    console.log('[harness] Initialization complete, monitoring started');
  }

  private async setupProvider(): Promise<void> {
    let wsUrl: string | undefined;
    let useFlashblocks = false;

    if (USE_FLASHBLOCKS && FLASHBLOCKS_WS_URL) {
      wsUrl = FLASHBLOCKS_WS_URL;
      useFlashblocks = true;
      console.log(`[harness] Using Flashblocks WebSocket: ${wsUrl}`);
    } else if (WS_RPC_URL) {
      wsUrl = WS_RPC_URL;
      console.log(`[harness] Using standard WebSocket: ${wsUrl}`);
    } else {
      console.error('[harness] ERROR: No WebSocket URL configured');
      if (RPC_URL) {
        console.log('[harness] Fallback to HTTP RPC (read-only mode)');
        this.provider = new JsonRpcProvider(RPC_URL);
        return;
      } else {
        console.error('[harness] ERROR: No RPC_URL for fallback. Please set WS_RPC_URL or RPC_URL');
        process.exit(1);
      }
    }

    try {
      this.provider = new WebSocketProvider(wsUrl);
      
      // Add error handler before awaiting ready
      this.provider.on('error', (err) => {
        console.error('[harness] Provider error:', err.message);
      });

      await this.provider.ready;
      console.log(`[harness] WebSocket connected successfully`);

      // Feature detection for Flashblocks
      if (useFlashblocks) {
        try {
          await this.provider.send('flashblocks_subscribe', []);
          console.log('[harness] Flashblocks subscription supported');
        } catch (err) {
          console.log('[harness] Flashblocks not supported, will use newHeads');
        }
      }
    } catch (err) {
      console.error('[harness] WebSocket connection failed:', err instanceof Error ? err.message : String(err));
      if (RPC_URL) {
        console.log('[harness] Fallback to HTTP RPC (read-only mode)');
        this.provider = new JsonRpcProvider(RPC_URL);
        try {
          await this.provider.ready;
        } catch (fallbackErr) {
          console.error('[harness] HTTP RPC fallback also failed:', fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr));
          process.exit(1);
        }
      } else {
        console.error('[harness] ERROR: No RPC_URL for fallback');
        process.exit(1);
      }
    }
  }

  private async verifyContracts(): Promise<void> {
    if (!this.provider) {
      console.error('[harness] ERROR: Provider not initialized');
      process.exit(1);
    }

    // Validate addresses are set
    if (!MULTICALL3_ADDRESS) {
      console.error('[harness] ERROR: MULTICALL3_ADDRESS not configured');
      process.exit(1);
    }
    if (!AAVE_POOL) {
      console.error('[harness] ERROR: AAVE_POOL not configured');
      process.exit(1);
    }

    // Check Multicall3 code
    const multicall3Code = await this.provider.getCode(MULTICALL3_ADDRESS);
    if (multicall3Code === '0x' || multicall3Code === '0x0') {
      console.error(`[harness] ERROR: No code at Multicall3 address ${MULTICALL3_ADDRESS}`);
      process.exit(1);
    }
    console.log(`[harness] Multicall3 code detected at ${MULTICALL3_ADDRESS}`);
    this.multicall3 = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, this.provider);

    // Check Aave Pool code
    const aavePoolCode = await this.provider.getCode(AAVE_POOL);
    if (aavePoolCode === '0x' || aavePoolCode === '0x0') {
      console.error(`[harness] ERROR: No code at Aave Pool address ${AAVE_POOL}`);
      process.exit(1);
    }
    console.log(`[harness] Aave Pool code detected at ${AAVE_POOL}`);
    this.aavePool = new Contract(AAVE_POOL, AAVE_POOL_ABI, this.provider);
  }

  private async seedCandidates(): Promise<void> {
    if (CANDIDATE_USERS) {
      // Parse comma-separated addresses
      const addresses = CANDIDATE_USERS.split(',')
        .map(addr => addr.trim().toLowerCase())
        .filter(addr => addr.startsWith('0x'));
      
      for (const addr of addresses) {
        this.candidates.set(addr, {
          address: addr,
          lastHF: null,
          lastCheck: 0
        });
      }
      console.log(`[harness] Seeded ${this.candidates.size} candidates from CANDIDATE_USERS`);
    } else if (config.graphApiKey && config.subgraphDeploymentId) {
      // Seed from subgraph
      console.log(`[harness] Seeding candidates from subgraph (limit: ${SEED_LIMIT})...`);
      
      if (config.useMockSubgraph) {
        console.error('[harness] ERROR: Cannot seed from subgraph with USE_MOCK_SUBGRAPH=true');
        process.exit(1);
      }

      const subgraphService = new SubgraphService();
      const users = await subgraphService.getUsersPage(SEED_LIMIT);
      
      // Filter users with debt
      for (const user of users) {
        const hasDebt = user.reserves.some(r => 
          parseFloat(r.currentVariableDebt) > 0 || parseFloat(r.currentStableDebt) > 0
        );
        
        if (hasDebt) {
          this.candidates.set(user.id.toLowerCase(), {
            address: user.id.toLowerCase(),
            lastHF: null,
            lastCheck: 0
          });
        }
      }
      
      console.log(`[harness] Seeded ${this.candidates.size} candidates with debt from subgraph`);
    } else {
      console.error('[harness] ERROR: No candidates configured');
      console.error('[harness]   Set CANDIDATE_USERS=0xaddr1,0xaddr2,... OR configure GRAPH_API_KEY + SUBGRAPH_DEPLOYMENT_ID');
      process.exit(1);
    }

    if (this.candidates.size === 0) {
      console.error('[harness] ERROR: No candidates to monitor');
      process.exit(1);
    }
  }

  private async setupSubscriptions(): Promise<void> {
    if (!(this.provider instanceof WebSocketProvider)) {
      console.log('[harness] HTTP provider - skipping subscriptions');
      return;
    }

    // Subscribe to newHeads for canonical recheck
    try {
      this.provider.on('block', async (blockNumber: number) => {
        if (this.isShuttingDown) return;
        this.stats.blocksReceived++;
        console.log(`[harness] Block ${blockNumber} - running health checks`);
        await this.checkAllCandidates();
      });
      console.log('[harness] Subscribed to newHeads');
    } catch (err) {
      console.error('[harness] Failed to subscribe to newHeads:', err);
    }

    // Subscribe to Aave Pool logs
    if (this.aavePool) {
      try {
        const borrowFilter = this.aavePool.filters.Borrow();
        const repayFilter = this.aavePool.filters.Repay();
        const supplyFilter = this.aavePool.filters.Supply();
        const withdrawFilter = this.aavePool.filters.Withdraw();

        this.aavePool.on(borrowFilter, (reserve: string, user: string, onBehalfOf: string) => {
          if (this.isShuttingDown) return;
          this.stats.aaveLogsReceived++;
          const targetUser = (onBehalfOf || user).toLowerCase();
          if (this.candidates.has(targetUser)) {
            console.log(`[harness] Borrow event for candidate ${targetUser}`);
            this.checkCandidate(targetUser).catch(console.error);
          }
        });

        this.aavePool.on(repayFilter, (reserve: string, user: string) => {
          if (this.isShuttingDown) return;
          this.stats.aaveLogsReceived++;
          const targetUser = user.toLowerCase();
          if (this.candidates.has(targetUser)) {
            console.log(`[harness] Repay event for candidate ${targetUser}`);
            this.checkCandidate(targetUser).catch(console.error);
          }
        });

        this.aavePool.on(supplyFilter, (reserve: string, user: string, onBehalfOf: string) => {
          if (this.isShuttingDown) return;
          this.stats.aaveLogsReceived++;
          const targetUser = (onBehalfOf || user).toLowerCase();
          if (this.candidates.has(targetUser)) {
            console.log(`[harness] Supply event for candidate ${targetUser}`);
            this.checkCandidate(targetUser).catch(console.error);
          }
        });

        this.aavePool.on(withdrawFilter, (reserve: string, user: string) => {
          if (this.isShuttingDown) return;
          this.stats.aaveLogsReceived++;
          const targetUser = user.toLowerCase();
          if (this.candidates.has(targetUser)) {
            console.log(`[harness] Withdraw event for candidate ${targetUser}`);
            this.checkCandidate(targetUser).catch(console.error);
          }
        });

        console.log('[harness] Subscribed to Aave Pool logs (Borrow, Repay, Supply, Withdraw)');
      } catch (err) {
        console.error('[harness] Failed to subscribe to Aave Pool logs:', err);
      }
    }

    // Optional: Subscribe to Chainlink price feeds
    if (CHAINLINK_FEEDS) {
      const feeds = CHAINLINK_FEEDS.split(',').map(f => f.trim());
      for (const feedSpec of feeds) {
        const [token, feedAddress] = feedSpec.split(':').map(s => s.trim());
        if (token && feedAddress && feedAddress.startsWith('0x')) {
          try {
            const feedContract = new Contract(feedAddress, CHAINLINK_AGG_ABI, this.provider);
            const filter = feedContract.filters.AnswerUpdated();
            
            feedContract.on(filter, () => {
              if (this.isShuttingDown) return;
              this.stats.priceUpdatesReceived++;
              console.log(`[harness] ${token} price updated - triggering recheck`);
              this.checkAllCandidates().catch(console.error);
            });
            
            console.log(`[harness] Subscribed to Chainlink ${token} feed at ${feedAddress}`);
          } catch (err) {
            console.error(`[harness] Failed to subscribe to Chainlink feed ${token}:`, err);
          }
        }
      }
    }
  }

  private async checkCandidate(userAddress: string): Promise<void> {
    if (!this.aavePool || !this.provider) return;

    try {
      const candidate = this.candidates.get(userAddress);
      if (!candidate) return;

      // Call getUserAccountData via contract
      const result = await this.aavePool.getUserAccountData(userAddress);
      
      // result is [totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor]
      const healthFactorRaw = result[5]; // 6th element is healthFactor
      const healthFactor = parseFloat(formatUnits(healthFactorRaw, 18));

      candidate.lastHF = healthFactor;
      candidate.lastCheck = Date.now();
      this.stats.healthChecksPerformed++;

      // Update global stats
      if (this.stats.lowestHF === null || healthFactor < this.stats.lowestHF) {
        this.stats.lowestHF = healthFactor;
        this.stats.lowestHFUser = userAddress;
      }

      // Check if liquidatable
      const threshold = EXECUTION_HF_THRESHOLD_BPS / 10000;
      if (healthFactor <= threshold && !this.stats.liquidatableCandidates.includes(userAddress)) {
        this.stats.liquidatableCandidates.push(userAddress);
      }
    } catch (err) {
      console.error(`[harness] Failed to check candidate ${userAddress}:`, err);
    }
  }

  private async checkAllCandidates(): Promise<void> {
    if (!this.multicall3 || !this.provider || !AAVE_POOL) return;

    try {
      const aavePoolInterface = new Interface(AAVE_POOL_ABI);
      const calls = Array.from(this.candidates.keys()).map(addr => ({
        target: AAVE_POOL,
        allowFailure: true,
        callData: aavePoolInterface.encodeFunctionData('getUserAccountData', [addr])
      }));

      if (calls.length === 0) return;

      const results = await this.multicall3.aggregate3.staticCall(calls);
      
      let minHF: number | null = null;
      let minHFUser: string | null = null;
      const liquidatable: string[] = [];

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const userAddress = Array.from(this.candidates.keys())[i];
        
        if (result.success) {
          try {
            const decoded = aavePoolInterface.decodeFunctionResult('getUserAccountData', result.returnData);
            const healthFactorRaw = decoded[5];
            const healthFactor = parseFloat(formatUnits(healthFactorRaw, 18));

            const candidate = this.candidates.get(userAddress);
            if (candidate) {
              candidate.lastHF = healthFactor;
              candidate.lastCheck = Date.now();
            }

            if (minHF === null || healthFactor < minHF) {
              minHF = healthFactor;
              minHFUser = userAddress;
            }

            const threshold = EXECUTION_HF_THRESHOLD_BPS / 10000;
            if (healthFactor <= threshold) {
              liquidatable.push(userAddress);
            }
          } catch (decodeErr) {
            console.error(`[harness] Failed to decode result for ${userAddress}:`, decodeErr);
          }
        }
      }

      this.stats.healthChecksPerformed += calls.length;
      
      if (minHF !== null) {
        this.stats.lowestHF = minHF;
        this.stats.lowestHFUser = minHFUser;
      }
      
      this.stats.liquidatableCandidates = liquidatable;

      // Print summary
      const liquidatableStatus = liquidatable.length > 0 ? `liquidatable=true (${liquidatable.length} candidates)` : 'liquidatable=false';
      console.log(`[harness] Health check complete: minHF=${minHF?.toFixed(4) || 'N/A'} (${minHFUser || 'N/A'}), ${liquidatableStatus}`);
    } catch (err) {
      console.error('[harness] Batch health check failed:', err);
    }
  }

  async run(): Promise<void> {
    await this.initialize();

    // Setup timeout for auto-exit
    const timeout = setTimeout(() => {
      console.log('[harness] Duration reached, shutting down...');
      this.shutdown();
    }, HARNESS_DURATION_SEC * 1000);

    // Setup signal handlers for graceful shutdown
    process.on('SIGINT', () => {
      clearTimeout(timeout);
      this.shutdown();
    });

    process.on('SIGTERM', () => {
      clearTimeout(timeout);
      this.shutdown();
    });

    // If HTTP provider, manually trigger checks periodically
    if (!(this.provider instanceof WebSocketProvider)) {
      const interval = setInterval(async () => {
        if (this.isShuttingDown) {
          clearInterval(interval);
          return;
        }
        console.log('[harness] Manual check cycle (HTTP mode)');
        await this.checkAllCandidates();
      }, 10000); // Check every 10 seconds in HTTP mode
    }

    // Wait for shutdown
    await new Promise<void>(resolve => {
      const checkShutdown = setInterval(() => {
        if (this.isShuttingDown) {
          clearInterval(checkShutdown);
          resolve();
        }
      }, 100);
    });
  }

  private shutdown(): void {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    console.log('[harness] Shutting down...');
    
    // Print final stats
    const duration = (Date.now() - this.stats.startTime) / 1000;
    console.log('[harness] Final Statistics:');
    console.log(`[harness]   Duration: ${duration.toFixed(1)}s`);
    console.log(`[harness]   Blocks received: ${this.stats.blocksReceived}`);
    console.log(`[harness]   Aave logs received: ${this.stats.aaveLogsReceived}`);
    console.log(`[harness]   Price updates received: ${this.stats.priceUpdatesReceived}`);
    console.log(`[harness]   Health checks performed: ${this.stats.healthChecksPerformed}`);
    console.log(`[harness]   Candidates monitored: ${this.candidates.size}`);
    console.log(`[harness]   Lowest HF: ${this.stats.lowestHF?.toFixed(4) || 'N/A'} (${this.stats.lowestHFUser || 'N/A'})`);
    console.log(`[harness]   Liquidatable candidates: ${this.stats.liquidatableCandidates.length}`);
    
    if (this.stats.liquidatableCandidates.length > 0) {
      console.log(`[harness]   Liquidatable addresses:`);
      for (const addr of this.stats.liquidatableCandidates) {
        const candidate = this.candidates.get(addr);
        console.log(`[harness]     ${addr} (HF: ${candidate?.lastHF?.toFixed(4) || 'N/A'})`);
      }
    }

    // Cleanup provider
    if (this.provider instanceof WebSocketProvider) {
      this.provider.removeAllListeners();
      this.provider.destroy();
    }

    process.exit(0);
  }
}

// Main entry point
async function main() {
  console.log('[harness] HF Real-time Harness - Test Utility (does not affect bot behavior)');
  
  const harness = new HFRealtimeHarness();
  
  try {
    await harness.run();
  } catch (err) {
    console.error('[harness] Fatal error:', err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[harness] Unhandled error:', err);
  process.exit(1);
});
