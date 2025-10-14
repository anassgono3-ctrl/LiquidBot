// RealTimeHFService: Real-time on-chain liquidation detection via WebSocket
// Monitors Aave Pool events and blocks, performs Multicall3 batch HF checks

import EventEmitter from 'events';

import { WebSocketProvider, JsonRpcProvider, Contract, Interface, formatUnits, EventLog } from 'ethers';

import {
  eventRegistry,
  extractUserFromAaveEvent,
  extractReserveFromAaveEvent,
  formatDecodedEvent
} from '../abi/aaveV3PoolEvents.js';
import { config } from '../config/index.js';
import {
  realtimeBlocksReceived,
  realtimeAaveLogsReceived,
  realtimePriceUpdatesReceived,
  realtimeHealthChecksPerformed,
  realtimeTriggersProcessed,
  realtimeReconnects,
  realtimeCandidateCount,
  realtimeMinHealthFactor,
  liquidatableEdgeTriggersTotal
} from '../metrics/index.js';

import { CandidateManager } from './CandidateManager.js';
import type { SubgraphService } from './SubgraphService.js';

// ABIs
const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) external payable returns (tuple(bool success, bytes returnData)[] returnData)'
];

const AAVE_POOL_ABI = [
  'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)',
  'event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)',
  'event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)',
  'event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)'
];

const CHAINLINK_AGG_ABI = [
  'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)'
];

export interface RealTimeHFServiceOptions {
  subgraphService?: SubgraphService;
  skipWsConnection?: boolean; // for testing
}

export interface LiquidatableEvent {
  userAddress: string;
  healthFactor: number;
  blockNumber: number;
  triggerType: 'event' | 'head' | 'price';
  timestamp: number;
}

/**
 * RealTimeHFService provides low-latency liquidation detection via WebSocket subscriptions.
 * Monitors Aave Pool events, newHeads, and optional Chainlink price feeds.
 * Uses Multicall3 for efficient batch health factor checks.
 * 
 * Emits 'liquidatable' events when users cross below the HF threshold.
 */
interface UserState {
  status: 'safe' | 'liq';
  lastHf: number;
  lastBlock: number;
}

export class RealTimeHFService extends EventEmitter {
  private provider: WebSocketProvider | JsonRpcProvider | null = null;
  private multicall3: Contract | null = null;
  private aavePool: Contract | null = null;
  private candidateManager: CandidateManager;
  private subgraphService?: SubgraphService;
  private isShuttingDown = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private reconnectTimer?: NodeJS.Timeout;
  private seedTimer?: NodeJS.Timeout;
  private pendingBlockTimer?: NodeJS.Timeout;
  private skipWsConnection: boolean;

  // Edge-triggering state per user
  private userStates = new Map<string, UserState>();
  private lastEmitBlock = new Map<string, number>();

  // Metrics
  private metrics = {
    blocksReceived: 0,
    aaveLogsReceived: 0,
    priceUpdatesReceived: 0,
    healthChecksPerformed: 0,
    triggersProcessed: 0,
    reconnects: 0,
    minHF: null as number | null
  };

  constructor(options: RealTimeHFServiceOptions = {}) {
    super();
    this.candidateManager = new CandidateManager({ maxCandidates: config.candidateMax });
    this.subgraphService = options.subgraphService;
    this.skipWsConnection = options.skipWsConnection || false;
  }

  /**
   * Initialize and start the real-time service
   */
  async start(): Promise<void> {
    if (!config.useRealtimeHF) {
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Service disabled (USE_REALTIME_HF=false)');
      return;
    }

    // eslint-disable-next-line no-console
    console.log('[realtime-hf] Starting real-time HF detection service');
    // eslint-disable-next-line no-console
    console.log('[realtime-hf] Configuration:', {
      useFlashblocks: config.useFlashblocks,
      multicall3: config.multicall3Address,
      aavePool: config.aavePool,
      hfThresholdBps: config.executionHfThresholdBps,
      seedInterval: config.realtimeSeedIntervalSec,
      candidateMax: config.candidateMax
    });

    if (!this.skipWsConnection) {
      await this.setupProvider();
      await this.setupContracts();
      await this.setupRealtime();
    }

    // Start periodic seeding from subgraph
    if (this.subgraphService) {
      this.startPeriodicSeeding();
    }

    // eslint-disable-next-line no-console
    console.log('[realtime-hf] Service started successfully');
  }

  /**
   * Stop the service and clean up
   */
  async stop(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    // eslint-disable-next-line no-console
    console.log('[realtime-hf] Shutting down...');

    // Clear timers
    if (this.seedTimer) clearInterval(this.seedTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pendingBlockTimer) clearInterval(this.pendingBlockTimer);

    // Remove all event listeners
    if (this.provider) {
      try {
        this.provider.removeAllListeners();
      } catch (err) {
        // Ignore errors during cleanup
      }
    }

    // Destroy provider
    if (this.provider) {
      try {
        if (this.provider instanceof WebSocketProvider) {
          await this.provider.destroy();
        }
      } catch (err) {
        // Ignore errors during destroy
      }
    }

    // Clear candidates
    this.candidateManager.clear();

    // eslint-disable-next-line no-console
    console.log('[realtime-hf] Shutdown complete');
  }

  /**
   * Setup WebSocket or HTTP provider
   */
  private async setupProvider(): Promise<void> {
    let wsUrl: string | undefined;

    if (config.useFlashblocks && config.flashblocksWsUrl) {
      wsUrl = config.flashblocksWsUrl;
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Using Flashblocks WebSocket');
    } else if (config.wsRpcUrl) {
      wsUrl = config.wsRpcUrl;
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Using standard WebSocket');
    } else {
      throw new Error('[realtime-hf] No WS_RPC_URL configured. Set WS_RPC_URL environment variable.');
    }

    try {
      this.provider = new WebSocketProvider(wsUrl);

      // Add error handler
      this.provider.on('error', (error: Error) => {
        // eslint-disable-next-line no-console
        console.error('[realtime-hf] Provider error:', error.message);
        this.handleDisconnect();
      });

      // Wait for provider to be ready
      await this.provider.ready;
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] WebSocket provider connected');
      this.reconnectAttempts = 0;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] Failed to setup provider:', err);
      throw err;
    }
  }

  /**
   * Setup contract instances
   */
  private async setupContracts(): Promise<void> {
    if (!this.provider) {
      throw new Error('[realtime-hf] Provider not initialized');
    }

    this.multicall3 = new Contract(config.multicall3Address, MULTICALL3_ABI, this.provider);
    this.aavePool = new Contract(config.aavePool, AAVE_POOL_ABI, this.provider);

    // Verify contracts exist
    try {
      const multicallCode = await this.provider.getCode(config.multicall3Address);
      const aavePoolCode = await this.provider.getCode(config.aavePool);

      if (multicallCode === '0x') {
        throw new Error(`Multicall3 not found at ${config.multicall3Address}`);
      }
      if (aavePoolCode === '0x') {
        throw new Error(`Aave Pool not found at ${config.aavePool}`);
      }

      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Contracts verified');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] Contract verification failed:', err);
      throw err;
    }
  }

  /**
   * Setup real-time event listeners using native ethers v6 providers
   */
  private async setupRealtime(): Promise<void> {
    if (!this.provider) {
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] No provider, skipping real-time setup');
      return;
    }

    try {
      // 1. Setup block listener for canonical rechecks
      this.provider.on('block', (blockNumber: number) => {
        if (this.isShuttingDown) return;
        try {
          this.handleNewBlock(blockNumber).catch(err => {
            // eslint-disable-next-line no-console
            console.error('[realtime-hf] Error handling block:', err);
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[realtime-hf] Error in block listener:', err);
        }
      });
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Subscribed (ethers) to block listener');

      // 2. Setup Aave Pool log listener
      // Get all registered event topics from EventRegistry
      const aaveTopics = eventRegistry.getAllTopics().filter(topic => {
        const entry = eventRegistry.get(topic);
        // Filter to only Aave events (exclude Chainlink)
        return entry && entry.name !== 'AnswerUpdated';
      });
      
      const aaveFilter = {
        address: config.aavePool,
        topics: [
          aaveTopics.length > 0 ? aaveTopics : [
            // Fallback to legacy event topics if registry is empty
            new Interface(AAVE_POOL_ABI).getEvent('Borrow')?.topicHash || '',
            new Interface(AAVE_POOL_ABI).getEvent('Repay')?.topicHash || '',
            new Interface(AAVE_POOL_ABI).getEvent('Supply')?.topicHash || '',
            new Interface(AAVE_POOL_ABI).getEvent('Withdraw')?.topicHash || ''
          ]
        ]
      };

      this.provider.on(aaveFilter, (log: EventLog) => {
        if (this.isShuttingDown) return;
        try {
          this.handleLog(log).catch(err => {
            // eslint-disable-next-line no-console
            console.error('[realtime-hf] Error handling Aave log:', err);
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[realtime-hf] Error in Aave log listener:', err);
        }
      });
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Subscribed (ethers) to Aave Pool logs');

      // 3. Optional: Setup Chainlink price feed listeners
      if (config.chainlinkFeeds) {
        const feeds = this.parseChainlinkFeeds(config.chainlinkFeeds);
        // Get AnswerUpdated topic from event registry
        const answerUpdatedTopic = Array.from(eventRegistry.getAllTopics()).find(topic => {
          const entry = eventRegistry.get(topic);
          return entry && entry.name === 'AnswerUpdated';
        });
        
        for (const [token, feedAddress] of Object.entries(feeds)) {
          try {
            const chainlinkFilter = {
              address: feedAddress,
              topics: [
                answerUpdatedTopic || new Interface(CHAINLINK_AGG_ABI).getEvent('AnswerUpdated')?.topicHash || ''
              ]
            };
            
            this.provider.on(chainlinkFilter, (log: EventLog) => {
              if (this.isShuttingDown) return;
              try {
                this.handleLog(log).catch(err => {
                  // eslint-disable-next-line no-console
                  console.error(`[realtime-hf] Error handling Chainlink log for ${token}:`, err);
                });
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error(`[realtime-hf] Error in Chainlink listener for ${token}:`, err);
              }
            });
            // eslint-disable-next-line no-console
            console.log(`[realtime-hf] Subscribed (ethers) to Chainlink feed for ${token}`);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`[realtime-hf] Failed to subscribe to Chainlink feed for ${token}:`, err);
          }
        }
      }

      // 4. Optional: Setup pending block polling when Flashblocks enabled
      if (config.useFlashblocks) {
        this.startPendingBlockPolling();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] Failed to setup real-time listeners:', err);
      throw err;
    }
  }

  /**
   * Handle new block notification - perform canonical recheck
   */
  private async handleNewBlock(blockNumber: number): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] New block ${blockNumber}`);

    this.metrics.blocksReceived++;
    realtimeBlocksReceived.inc();

    // Perform batch check on all candidates
    await this.checkAllCandidates('head');
  }

  /**
   * Start pending block polling (Flashblocks mode)
   */
  private startPendingBlockPolling(): void {
    if (!this.provider) return;

    const tickMs = config.flashblocksTickMs;
    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] Starting pending block polling (tick=${tickMs}ms)`);

    this.pendingBlockTimer = setInterval(async () => {
      if (this.isShuttingDown || !this.provider) return;

      try {
        // Query pending block
        const pendingBlock = await this.provider.send('eth_getBlockByNumber', ['pending', false]);
        if (pendingBlock && pendingBlock.number) {
          // Trigger selective checks on low HF candidates when pending block changes
          await this.checkLowHFCandidates('price');
        }
      } catch (err) {
        // Silently ignore errors in pending block queries (expected for some providers)
      }
    }, tickMs);
  }

  /**
   * Handle Aave Pool or Chainlink log event
   */
  private async handleLog(log: EventLog): Promise<void> {
    const logAddress = log.address.toLowerCase();

    // Check if it's an Aave Pool log
    if (logAddress === config.aavePool.toLowerCase()) {
      this.metrics.aaveLogsReceived++;
      realtimeAaveLogsReceived.inc();

      // Decode event using EventRegistry
      const decoded = eventRegistry.decode(log.topics as string[], log.data);
      
      if (decoded) {
        // Get block number for logging
        const blockNumber = typeof log.blockNumber === 'string' 
          ? parseInt(log.blockNumber, 16) 
          : log.blockNumber;

        // Log human-readable event details
        // eslint-disable-next-line no-console
        console.log(`[realtime-hf] ${formatDecodedEvent(decoded, blockNumber)}`);
        
        // Extract affected users
        const users = extractUserFromAaveEvent(decoded);
        
        // Extract reserve (asset) for context
        const reserve = extractReserveFromAaveEvent(decoded);
        
        // Handle based on event type
        if (decoded.name === 'LiquidationCall') {
          // Log liquidation but still check HF in case user is still liquidatable
          // eslint-disable-next-line no-console
          console.log(`[realtime-hf] LiquidationCall detected for user ${users[0]}, rechecking HF`);
        }
        
        // For all user-affecting events, enqueue targeted HF recheck
        if (users.length > 0) {
          for (const user of users) {
            // Add/touch candidate
            this.candidateManager.add(user);
            
            // Perform targeted check for this specific user
            await this.checkCandidate(user, 'event');
          }
        } else {
          // ReserveDataUpdated, FlashLoan, etc. - may affect multiple users
          if (decoded.name === 'ReserveDataUpdated' && reserve) {
            // eslint-disable-next-line no-console
            console.log(`[realtime-hf] ReserveDataUpdated for ${reserve}, checking low HF candidates`);
            await this.checkLowHFCandidates('event');
          }
        }
      } else {
        // Fallback to legacy extraction if decode fails
        const userAddress = this.extractUserFromLog(log);
        if (userAddress) {
          // eslint-disable-next-line no-console
          console.log(`[realtime-hf] Aave event detected for user ${userAddress} (legacy)`);
          
          // Add/touch candidate
          this.candidateManager.add(userAddress);
          
          // Perform targeted check
          await this.checkCandidate(userAddress, 'event');
        }
      }
    } else {
      // Chainlink price update
      this.metrics.priceUpdatesReceived++;
      realtimePriceUpdatesReceived.inc();
      
      // Try to decode Chainlink event for better logging
      const decoded = eventRegistry.decode(log.topics as string[], log.data);
      if (decoded && decoded.name === 'AnswerUpdated') {
        // eslint-disable-next-line no-console
        console.log(`[realtime-hf] ${formatDecodedEvent(decoded)}`);
      } else {
        // eslint-disable-next-line no-console
        console.log('[realtime-hf] Chainlink price update detected');
      }
      
      // Trigger selective rechecks on candidates with low HF
      await this.checkLowHFCandidates('price');
    }
  }

  /**
   * Extract user address from Aave Pool log
   */
  private extractUserFromLog(log: EventLog): string | null {
    try {
      const iface = new Interface(AAVE_POOL_ABI);
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      
      if (!parsed) return null;

      // Extract user based on event type
      switch (parsed.name) {
        case 'Borrow':
          return parsed.args.user || parsed.args.onBehalfOf || null;
        case 'Repay':
          return parsed.args.user || null;
        case 'Supply':
          return parsed.args.user || parsed.args.onBehalfOf || null;
        case 'Withdraw':
          return parsed.args.user || null;
        default:
          return null;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[realtime-hf] Failed to parse log:', err);
      return null;
    }
  }

  /**
   * Check all candidates via Multicall3 batch
   */
  private async checkAllCandidates(triggerType: 'event' | 'head' | 'price'): Promise<void> {
    const addresses = this.candidateManager.getAddresses();
    if (addresses.length === 0) return;

    await this.batchCheckCandidates(addresses, triggerType);
  }

  /**
   * Check candidates with low HF (priority for price or event trigger)
   */
  private async checkLowHFCandidates(triggerType: 'event' | 'price'): Promise<void> {
    const candidates = this.candidateManager.getAll();
    const lowHF = candidates
      .filter(c => c.lastHF !== null && c.lastHF < 1.1)
      .map(c => c.address);

    if (lowHF.length === 0) return;

    await this.batchCheckCandidates(lowHF, triggerType);
  }

  /**
   * Check a single candidate
   */
  private async checkCandidate(address: string, triggerType: 'event' | 'head' | 'price'): Promise<void> {
    await this.batchCheckCandidates([address], triggerType);
  }

  /**
   * Perform read-only Multicall3 aggregate3 call with automatic chunking
   */
  private async multicallAggregate3ReadOnly(
    calls: Array<{ target: string; allowFailure: boolean; callData: string }>,
    chunkSize = 120
  ): Promise<Array<{ success: boolean; returnData: string }>> {
    if (!this.multicall3 || !this.provider) {
      throw new Error('[realtime-hf] Multicall3 or provider not initialized');
    }

    // If calls fit in single batch, execute directly
    if (calls.length <= chunkSize) {
      try {
        const results = await this.multicall3.aggregate3.staticCall(calls);
        return results;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[realtime-hf] Multicall3 staticCall failed:', err);
        throw err;
      }
    }

    // Split into chunks for large batches
    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] Chunking ${calls.length} calls into batches of ${chunkSize}`);
    
    const allResults: Array<{ success: boolean; returnData: string }> = [];
    for (let i = 0; i < calls.length; i += chunkSize) {
      const chunk = calls.slice(i, i + chunkSize);
      try {
        const results = await this.multicall3.aggregate3.staticCall(chunk);
        allResults.push(...results);
        // eslint-disable-next-line no-console
        console.log(`[realtime-hf] Chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(calls.length / chunkSize)} complete (${chunk.length} calls)`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[realtime-hf] Multicall3 chunk ${Math.floor(i / chunkSize) + 1} failed:`, err);
        // Return failure results for this chunk to avoid crashing
        const failedResults = chunk.map(() => ({ success: false, returnData: '0x' }));
        allResults.push(...failedResults);
      }
    }

    return allResults;
  }

  /**
   * Determine if a liquidatable event should be emitted based on edge-triggering and hysteresis.
   * Returns { shouldEmit: boolean, reason?: string }
   */
  private shouldEmit(userAddress: string, healthFactor: number, blockNumber: number): { shouldEmit: boolean; reason?: string } {
    const threshold = config.executionHfThresholdBps / 10000;
    const hysteresisBps = config.hysteresisBps;
    const hysteresisFactor = hysteresisBps / 10000; // e.g., 20 bps = 0.002 = 0.2%
    
    const state = this.userStates.get(userAddress);
    const lastBlock = this.lastEmitBlock.get(userAddress);
    
    // Never emit more than once per block per user
    if (lastBlock === blockNumber) {
      return { shouldEmit: false };
    }
    
    const isLiquidatable = healthFactor < threshold;
    
    if (!state) {
      // First time seeing this user
      if (isLiquidatable) {
        // User is liquidatable, emit and track
        this.userStates.set(userAddress, {
          status: 'liq',
          lastHf: healthFactor,
          lastBlock: blockNumber
        });
        return { shouldEmit: true, reason: 'safe_to_liq' };
      } else {
        // User is safe, just track
        this.userStates.set(userAddress, {
          status: 'safe',
          lastHf: healthFactor,
          lastBlock: blockNumber
        });
        return { shouldEmit: false };
      }
    }
    
    // Update state
    const previousStatus = state.status;
    const previousHf = state.lastHf;
    
    if (isLiquidatable) {
      state.status = 'liq';
      state.lastHf = healthFactor;
      state.lastBlock = blockNumber;
      
      if (previousStatus === 'safe') {
        // Transition from safe to liq (edge trigger)
        return { shouldEmit: true, reason: 'safe_to_liq' };
      } else {
        // Already liquidatable - check hysteresis
        const hfDiff = previousHf - healthFactor;
        const hfDiffPct = hfDiff / previousHf;
        
        if (hfDiffPct >= hysteresisFactor) {
          // HF worsened by at least hysteresis threshold
          return { shouldEmit: true, reason: 'worsened' };
        } else {
          // Still liquidatable but HF hasn't worsened enough
          return { shouldEmit: false };
        }
      }
    } else {
      // User is safe now
      state.status = 'safe';
      state.lastHf = healthFactor;
      state.lastBlock = blockNumber;
      
      return { shouldEmit: false };
    }
  }

  /**
   * Batch check multiple candidates using Multicall3
   */
  private async batchCheckCandidates(addresses: string[], triggerType: 'event' | 'head' | 'price'): Promise<void> {
    if (!this.multicall3 || !this.provider || addresses.length === 0) return;

    try {
      const aavePoolInterface = new Interface(AAVE_POOL_ABI);
      const calls = addresses.map(addr => ({
        target: config.aavePool,
        allowFailure: true,
        callData: aavePoolInterface.encodeFunctionData('getUserAccountData', [addr])
      }));

      const results = await this.multicallAggregate3ReadOnly(calls);
      const blockNumber = await this.provider.getBlockNumber();
      const threshold = config.executionHfThresholdBps / 10000; // e.g., 0.98
      let minHF: number | null = null;

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const userAddress = addresses[i];

        if (result.success) {
          try {
            const decoded = aavePoolInterface.decodeFunctionResult('getUserAccountData', result.returnData);
            const healthFactorRaw = decoded[5]; // 6th element
            const healthFactor = parseFloat(formatUnits(healthFactorRaw, 18));

            this.candidateManager.updateHF(userAddress, healthFactor);
            this.metrics.healthChecksPerformed++;
            realtimeHealthChecksPerformed.inc();

            // Track min HF
            if (minHF === null || healthFactor < minHF) {
              minHF = healthFactor;
            }
            if (this.metrics.minHF === null || healthFactor < this.metrics.minHF) {
              this.metrics.minHF = healthFactor;
            }

            // Update Prometheus gauge for min HF
            if (this.metrics.minHF !== null) {
              realtimeMinHealthFactor.set(this.metrics.minHF);
            }

            // Check if we should emit based on edge-triggering and hysteresis
            const emitDecision = this.shouldEmit(userAddress, healthFactor, blockNumber);
            
            if (emitDecision.shouldEmit) {
              // eslint-disable-next-line no-console
              console.log(`[realtime-hf] emit liquidatable user=${userAddress} hf=${healthFactor.toFixed(4)} reason=${emitDecision.reason} block=${blockNumber}`);

              // Track last emit block
              this.lastEmitBlock.set(userAddress, blockNumber);

              // Emit liquidatable event
              this.emit('liquidatable', {
                userAddress,
                healthFactor,
                blockNumber,
                triggerType,
                timestamp: Date.now()
              } as LiquidatableEvent);

              this.metrics.triggersProcessed++;
              realtimeTriggersProcessed.inc({ trigger_type: triggerType });
              liquidatableEdgeTriggersTotal.inc({ reason: emitDecision.reason || 'unknown' });
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`[realtime-hf] Failed to decode result for ${userAddress}:`, err);
          }
        }
      }

      // Update candidate count gauge
      realtimeCandidateCount.set(this.candidateManager.size());

      // eslint-disable-next-line no-console
      console.log(`[realtime-hf] Batch check complete: ${addresses.length} candidates, minHF=${minHF?.toFixed(4) || 'N/A'}, trigger=${triggerType}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] Batch check failed:', err);
      // Do not crash the service - continue runtime
      // The error is already logged above
    }
  }

  /**
   * Start periodic seeding from subgraph
   */
  private startPeriodicSeeding(): void {
    const intervalMs = config.realtimeSeedIntervalSec * 1000;
    
    // Initial seed
    this.seedFromSubgraph().catch(err => {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] Initial seed failed:', err);
    });

    // Periodic seed with jitter
    this.seedTimer = setInterval(() => {
      if (this.isShuttingDown) return;
      
      // Add jitter (±20% of interval)
      const jitter = Math.random() * 0.4 - 0.2; // -0.2 to +0.2
      const delay = Math.max(0, intervalMs * jitter);
      
      setTimeout(() => {
        if (!this.isShuttingDown) {
          this.seedFromSubgraph().catch(err => {
            // eslint-disable-next-line no-console
            console.error('[realtime-hf] Periodic seed failed:', err);
          });
        }
      }, delay);
    }, intervalMs);
  }

  /**
   * Seed candidates from subgraph
   */
  private async seedFromSubgraph(): Promise<void> {
    if (!this.subgraphService || this.isShuttingDown) return;

    try {
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Seeding candidates from subgraph...');

      // Query users with borrowing activity
      const users = await this.subgraphService.getUsersWithBorrowing(config.candidateMax);
      
      if (users.length > 0) {
        this.candidateManager.addBulk(users.map(u => u.id));
        // eslint-disable-next-line no-console
        console.log(`[realtime-hf] Seeded ${users.length} candidates from subgraph`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[realtime-hf] Subgraph seed failed:', err);
    }
  }

  /**
   * Handle provider disconnect and attempt reconnect
   */
  private handleDisconnect(): void {
    if (this.isShuttingDown) return;

    this.reconnectAttempts++;
    this.metrics.reconnects++;
    realtimeReconnects.inc();

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] Max reconnect attempts reached, giving up');
      this.stop();
      return;
    }

    const backoffMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000);
    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] Attempting reconnect in ${backoffMs}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      if (this.isShuttingDown) return;
      
      this.setupProvider()
        .then(() => this.setupContracts())
        .then(() => this.setupRealtime())
        .then(() => {
          // eslint-disable-next-line no-console
          console.log('[realtime-hf] Reconnected successfully');
          this.reconnectAttempts = 0;
        })
        .catch(err => {
          // eslint-disable-next-line no-console
          console.error('[realtime-hf] Reconnect failed:', err);
          this.handleDisconnect();
        });
    }, backoffMs);
  }

  /**
   * Parse Chainlink feeds from config string
   */
  private parseChainlinkFeeds(feedsStr: string): Record<string, string> {
    const feeds: Record<string, string> = {};
    const pairs = feedsStr.split(',');
    
    for (const pair of pairs) {
      const [token, address] = pair.split(':').map(s => s.trim());
      if (token && address) {
        feeds[token] = address;
      }
    }
    
    return feeds;
  }

  /**
   * Get service metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      candidateCount: this.candidateManager.size(),
      lowestHFCandidate: this.candidateManager.getLowestHF()
    };
  }

  /**
   * Get candidate manager (for testing)
   */
  getCandidateManager(): CandidateManager {
    return this.candidateManager;
  }
}
