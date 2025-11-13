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
  liquidatableEdgeTriggersTotal,
  chunkTimeoutsTotal,
  runAbortsTotal,
  wsReconnectsTotal,
  chunkLatency,
  candidatesPrunedZeroDebt,
  candidatesPrunedTinyDebt,
  candidatesTotal,
  eventBatchesSkipped,
  eventBatchesExecuted,
  eventConcurrencyLevel,
  eventConcurrencyLevelHistogram,
  realtimePriceTriggersTotal,
  reserveRechecksTotal,
  pendingVerifyErrorsTotal
} from '../metrics/index.js';

import { CandidateManager } from './CandidateManager.js';
import type { SubgraphService } from './SubgraphService.js';
import { OnChainBackfillService } from './OnChainBackfillService.js';
import { SubgraphSeeder } from './SubgraphSeeder.js';
import { BorrowersIndexService } from './BorrowersIndexService.js';
import { LowHFTracker } from './LowHFTracker.js';
import { LiquidationAuditService } from './liquidationAudit.js';
import { NotificationService } from './NotificationService.js';
import { PriceService } from './PriceService.js';
import { HotSetTracker } from './HotSetTracker.js';
import { PrecomputeService } from './PrecomputeService.js';
import { DecisionTraceStore } from './DecisionTraceStore.js';
import { FeedDiscoveryService, type DiscoveredReserve } from './FeedDiscoveryService.js';
import { PerAssetTriggerConfig } from './PerAssetTriggerConfig.js';
import { AaveDataService } from './AaveDataService.js';
import { isZero } from '../utils/bigint.js';

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
  'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)',
  'event NewTransmission(uint32 indexed aggregatorRoundId, int192 answer, address transmitter, int192[] observations, bytes observers, bytes32 rawReportContext)'
];

// Chainlink aggregator interface for latestRoundData polling
const CHAINLINK_AGGREGATOR_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
];

export interface RealTimeHFServiceOptions {
  subgraphService?: SubgraphService;
  skipWsConnection?: boolean; // for testing
  notificationService?: NotificationService;
  priceService?: PriceService;
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
  private subgraphSeeder?: SubgraphSeeder;
  private backfillService?: OnChainBackfillService;
  private borrowersIndex?: BorrowersIndexService;
  private lowHfTracker?: LowHFTracker;
  private liquidationAuditService?: LiquidationAuditService;
  private hotSetTracker?: HotSetTracker;
  private precomputeService?: PrecomputeService;
  private decisionTraceStore?: DecisionTraceStore;
  private feedDiscoveryService?: FeedDiscoveryService;
  private perAssetTriggerConfig?: PerAssetTriggerConfig;
  private aaveDataService?: AaveDataService;
  private discoveredReserves: DiscoveredReserve[] = [];
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

  // Per-block dedupe tracking (Goal 3)
  private seenUsersThisBlock = new Set<string>();
  private currentBlockNumber: number | null = null;

  // Per-block gating for price and reserve triggers (Goal 5)
  private lastPriceCheckBlock: number | null = null;
  private lastReserveCheckBlock: number | null = null;

  // Adaptive rate-limit handling (Goal 4)
  private currentChunkSize: number;
  private rateLimitBackoffMs = 0;
  private consecutiveRateLimits = 0;
  private basePendingTickMs = 250;
  private currentPendingTickMs = 250;

  // Head-check paging/rotation
  private headCheckRotatingIndex = 0;
  
  // Adaptive head page sizing tracking
  private headRunHistory: Array<{
    elapsed: number;
    timeouts: number;
    avgLatency: number;
  }> = [];
  private currentDynamicPageSize: number;
  
  // Adaptive sizing constants
  private readonly ADAPTIVE_WINDOW_SIZE = 20; // rolling window size for metrics
  private readonly ADAPTIVE_DECREASE_FACTOR = 0.85; // 15% decrease when overloaded
  private readonly ADAPTIVE_INCREASE_FACTOR = 1.12; // 12% increase when underutilized
  private readonly ADAPTIVE_TIMEOUT_THRESHOLD = 0.05; // 5% timeout rate threshold

  // Serialization + coalescing for head-check runs (Goal 1)
  private scanningHead = false;
  private latestRequestedHeadBlock: number | null = null;
  private currentRunId: string | null = null;
  
  // Run-level watchdog tracking
  private lastProgressAt: number | null = null;
  private runWatchdogTimer?: NodeJS.Timeout;
  
  // WebSocket heartbeat tracking
  private lastWsActivity: number = Date.now();
  private wsHeartbeatTimer?: NodeJS.Timeout;
  private isReconnecting = false;

  // Dirty-first prioritization (Goal 2)
  private dirtyUsers = new Set<string>();
  private dirtyReserves = new Set<string>();

  // Optional secondary provider for fallback (Goal 5)
  private secondaryProvider: JsonRpcProvider | null = null;
  private secondaryMulticall3: Contract | null = null;

  // Per-run batch metrics tracking
  private currentBatchMetrics = {
    timeouts: 0,
    latencies: [] as number[],
    hedges: 0,
    primaryUsed: 0,
    secondaryUsed: 0
  };

  // Event batch coalescing
  private eventBatchQueue: Map<string, {
    users: Set<string>;
    reserves: Set<string>;
    timer: NodeJS.Timeout;
    blockNumber: number;
  }> = new Map();
  private eventBatchesPerBlock: Map<number, number> = new Map();
  private runningEventBatches = 0;
  
  // Adaptive event concurrency
  private currentMaxEventBatches: number;
  private eventBatchSkipHistory: number[] = []; // Rolling window of skipped batches (1 = skipped, 0 = executed)
  private readonly EVENT_SKIP_WINDOW_SIZE = 20;

  // Price trigger tracking for emergency scans
  private lastSeenPrices: Map<string, number> = new Map(); // feedAddress -> last price (for single-round delta mode)
  private baselinePrices: Map<string, number> = new Map(); // feedAddress -> baseline price (for cumulative mode)
  private chainlinkFeedToSymbol: Map<string, string> = new Map(); // feedAddress -> symbol
  private priceMonitorAssets: Set<string> | null = null; // null = monitor all
  private lastPriceTriggerTime: Map<string, number> = new Map(); // symbol -> timestamp in ms
  
  // Per-asset state for polling fallback
  private priceAssetState: Map<string, {
    lastAnswer: bigint | null;
    lastUpdatedAt: number | null;
    lastTriggerTs: number;
    baselineAnswer: bigint | null;
  }> = new Map();
  
  // Polling timer
  private pricePollingTimer?: NodeJS.Timeout;

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
    
    // Initialize low HF tracker if enabled
    if (config.lowHfTrackerEnabled) {
      this.lowHfTracker = new LowHFTracker();
      // eslint-disable-next-line no-console
      console.log(
        `[lowhf-tracker] Enabled: mode=${config.lowHfRecordMode} ` +
        `max=${config.lowHfTrackerMax} dumpOnShutdown=${config.lowHfDumpOnShutdown}`
      );
    }
    
    // Initialize hot-set tracker if enabled
    if (config.hotSetEnabled) {
      this.hotSetTracker = new HotSetTracker({
        hotSetHfMax: config.hotSetHfMax,
        warmSetHfMax: config.warmSetHfMax,
        maxHotSize: config.maxHotSize,
        maxWarmSize: config.maxWarmSize
      });
    }
    
    // Initialize precompute service if enabled
    if (config.precomputeEnabled) {
      this.precomputeService = new PrecomputeService({
        topK: config.precomputeTopK,
        enabled: config.precomputeEnabled,
        closeFactorPct: config.precomputeCloseFactorPct
      });
    }
    
    // Initialize decision trace store if enabled
    if (config.decisionTraceEnabled) {
      this.decisionTraceStore = new DecisionTraceStore();
      // eslint-disable-next-line no-console
      console.log('[decision-trace] Store initialized');
    }
    
    // Initialize liquidation audit service if enabled
    if (config.liquidationAuditEnabled) {
      const priceService = options.priceService || new PriceService();
      const notificationService = options.notificationService || new NotificationService(priceService);
      this.liquidationAuditService = new LiquidationAuditService(
        priceService,
        notificationService,
        this.provider as any, // Will be set later in setupProvider
        this.decisionTraceStore
      );
    }
    
    // Initialize per-asset trigger config if price triggers are enabled
    if (config.priceTriggerEnabled) {
      this.perAssetTriggerConfig = new PerAssetTriggerConfig();
      // eslint-disable-next-line no-console
      console.log('[per-asset-trigger] Config initialized');
      const configured = this.perAssetTriggerConfig.getConfiguredAssets();
      if (configured.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[per-asset-trigger] Custom settings for: ${configured.join(', ')}`);
      }
    }
    
    // Initialize adaptive settings
    this.basePendingTickMs = config.flashblocksTickMs;
    this.currentPendingTickMs = config.flashblocksTickMs;
    
    // Initialize multicall batch size from config
    this.currentChunkSize = config.multicallBatchSize;
    
    // Initialize dynamic page size to current config value
    this.currentDynamicPageSize = config.headCheckPageSize;
    
    // Initialize adaptive event concurrency
    this.currentMaxEventBatches = config.maxParallelEventBatches;
    
    // Initialize price monitoring asset filter if configured
    if (config.priceTriggerEnabled && config.priceTriggerAssets) {
      this.priceMonitorAssets = new Set(
        config.priceTriggerAssets
          .split(',')
          .map((s: string) => s.trim().toUpperCase())
          .filter((s: string) => s.length > 0)
          .map((s: string) => this.normalizeAssetSymbol(s))
      );
    }
  }

  /**
   * Normalize asset symbols for consistent mapping (e.g., ETH -> WETH)
   */
  private normalizeAssetSymbol(symbol: string): string {
    const upper = symbol.toUpperCase();
    // Map common variations to canonical symbols
    if (upper === 'ETH') return 'WETH';
    if (upper === 'BTC') return 'WBTC';
    return upper;
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
      candidateMax: config.candidateMax,
      useSubgraph: config.useSubgraph,
      backfillEnabled: config.realtimeInitialBackfillEnabled,
      headCheckPageStrategy: config.headCheckPageStrategy,
      headCheckPageSize: config.headCheckPageSize
    });
    
    // Log price-trigger configuration
    if (config.priceTriggerEnabled) {
      const assets = config.priceTriggerAssets 
        ? config.priceTriggerAssets.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0)
        : [];
      // eslint-disable-next-line no-console
      console.log(
        `[price-trigger] enabled=true mode=${config.priceTriggerCumulative ? 'cumulative' : 'delta'} ` +
        `dropBps=${config.priceTriggerDropBps} ` +
        `maxScan=${config.priceTriggerMaxScan} debounceSec=${config.priceTriggerDebounceSec} ` +
        `assets=${assets.length > 0 ? assets.join(',') : 'ALL'}`
      );
    } else {
      // eslint-disable-next-line no-console
      console.log('[price-trigger] enabled=false');
    }
    
    // Log adaptive event concurrency configuration
    // eslint-disable-next-line no-console
    console.log(
      `[config] ADAPTIVE_EVENT_CONCURRENCY=${config.adaptiveEventConcurrency} ` +
      `(base=${config.maxParallelEventBatches}, high=${config.maxParallelEventBatchesHigh}, ` +
      `threshold=${config.eventBacklogThreshold})`
    );

    if (!this.skipWsConnection) {
      await this.setupProvider();
      await this.setupContracts();
      await this.setupRealtime();
    }

    // Perform initial candidate seeding
    await this.performInitialSeeding();

    // Start periodic seeding from subgraph if enabled
    if (config.useSubgraph && this.subgraphService) {
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

    // Dump low HF tracker data if enabled
    if (this.lowHfTracker && config.lowHfDumpOnShutdown) {
      try {
        await this.lowHfTracker.dumpToFile();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[realtime-hf] Failed to dump low HF tracker data:', err);
      }
    }

    // Stop low HF tracker
    if (this.lowHfTracker) {
      this.lowHfTracker.stop();
    }

    // Clear timers
    if (this.seedTimer) clearInterval(this.seedTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pendingBlockTimer) clearInterval(this.pendingBlockTimer);
    if (this.runWatchdogTimer) clearTimeout(this.runWatchdogTimer);
    if (this.wsHeartbeatTimer) clearTimeout(this.wsHeartbeatTimer);
    if (this.pricePollingTimer) clearInterval(this.pricePollingTimer);

    // Clear event batch timers
    for (const [, batch] of this.eventBatchQueue) {
      clearTimeout(batch.timer);
    }
    this.eventBatchQueue.clear();
    this.eventBatchesPerBlock.clear();

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

    // Setup optional secondary provider for head-check fallback (Goal 5)
    if (config.secondaryHeadRpcUrl) {
      try {
        // eslint-disable-next-line no-console
        console.log('[realtime-hf] Initializing secondary provider for fallback...');
        this.secondaryProvider = new JsonRpcProvider(config.secondaryHeadRpcUrl);
        this.secondaryMulticall3 = new Contract(config.multicall3Address, MULTICALL3_ABI, this.secondaryProvider);
        // eslint-disable-next-line no-console
        console.log('[realtime-hf] Secondary provider initialized');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[realtime-hf] Failed to initialize secondary provider:', err);
        this.secondaryProvider = null;
        this.secondaryMulticall3 = null;
      }
    }

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

      // 3. Optional: Auto-discover Chainlink feeds and setup BorrowersIndexService
      let feeds: Record<string, string> = {};
      
      if (config.autoDiscoverFeeds && this.provider) {
        try {
          // eslint-disable-next-line no-console
          console.log('[feed-discovery] Auto-discovery enabled, discovering reserves...');
          await this.performFeedDiscovery();
          
          // Build feeds map from discovered reserves
          feeds = FeedDiscoveryService.buildFeedsMap(this.discoveredReserves);
          
          // Merge with manual config if provided
          if (config.chainlinkFeeds) {
            feeds = FeedDiscoveryService.mergeFeedsWithConfig(feeds, config.chainlinkFeeds);
          }
          
          // eslint-disable-next-line no-console
          console.log(`[feed-discovery] Discovered ${Object.keys(feeds).length} Chainlink feeds`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[feed-discovery] Auto-discovery failed, falling back to manual config:', err);
          // Fall back to manual config
          if (config.chainlinkFeeds) {
            feeds = this.parseChainlinkFeeds(config.chainlinkFeeds);
          }
        }
      } else if (config.chainlinkFeeds) {
        // Use manual configuration only
        feeds = this.parseChainlinkFeeds(config.chainlinkFeeds);
      }
      
      // Setup Chainlink price feed listeners if we have any feeds
      if (Object.keys(feeds).length > 0) {
        // Get AnswerUpdated topic from event registry
        const answerUpdatedTopic = Array.from(eventRegistry.getAllTopics()).find(topic => {
          const entry = eventRegistry.get(topic);
          return entry && entry.name === 'AnswerUpdated';
        });
        
        // Get NewTransmission topic (OCR2)
        const iface = new Interface(CHAINLINK_AGG_ABI);
        const newTransmissionTopic = iface.getEvent('NewTransmission')?.topicHash || '';
        
        const feedAddresses = Object.values(feeds);
        // eslint-disable-next-line no-console
        console.log(
          `[price-trigger] Setting up listeners for ${feedAddresses.length} feed(s): ` +
          `${Object.keys(feeds).join(',')} (events: AnswerUpdated + NewTransmission)`
        );
        
        for (const [token, feedAddress] of Object.entries(feeds)) {
          // Build reverse mapping for price trigger feature
          this.chainlinkFeedToSymbol.set(feedAddress.toLowerCase(), token);
          
          // Initialize per-asset state for polling
          this.priceAssetState.set(feedAddress.toLowerCase(), {
            lastAnswer: null,
            lastUpdatedAt: null,
            lastTriggerTs: 0,
            baselineAnswer: null
          });
          
          try {
            // Subscribe to AnswerUpdated (legacy Chainlink event)
            const answerUpdatedFilter = {
              address: feedAddress,
              topics: [
                answerUpdatedTopic || iface.getEvent('AnswerUpdated')?.topicHash || ''
              ]
            };
            
            this.provider.on(answerUpdatedFilter, (log: EventLog) => {
              if (this.isShuttingDown) return;
              try {
                this.handleLog(log).catch(err => {
                  // eslint-disable-next-line no-console
                  console.error(`[realtime-hf] Error handling AnswerUpdated for ${token}:`, err);
                });
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error(`[realtime-hf] Error in AnswerUpdated listener for ${token}:`, err);
              }
            });
            
            // Subscribe to NewTransmission (OCR2 Chainlink event)
            const newTransmissionFilter = {
              address: feedAddress,
              topics: [newTransmissionTopic]
            };
            
            this.provider.on(newTransmissionFilter, (log: EventLog) => {
              if (this.isShuttingDown) return;
              try {
                this.handleLog(log).catch(err => {
                  // eslint-disable-next-line no-console
                  console.error(`[realtime-hf] Error handling NewTransmission for ${token}:`, err);
                });
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error(`[realtime-hf] Error in NewTransmission listener for ${token}:`, err);
              }
            });
            
            // eslint-disable-next-line no-console
            console.log(`[realtime-hf] Subscribed to Chainlink feed for ${token} (AnswerUpdated + NewTransmission)`);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`[realtime-hf] Failed to subscribe to Chainlink feed for ${token}:`, err);
          }
        }
        
        // Start polling fallback if price trigger is enabled
        if (config.priceTriggerEnabled) {
          this.startPricePolling(feeds);
        }
      }

      // 4. Optional: Setup pending block polling when Flashblocks enabled
      if (config.useFlashblocks) {
        this.startPendingBlockPolling();
      }

      // 5. Start WebSocket heartbeat monitoring
      this.startWsHeartbeat();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] Failed to setup real-time listeners:', err);
      throw err;
    }
  }

  /**
   * Start WebSocket heartbeat monitoring to detect stalled connections
   */
  private startWsHeartbeat(): void {
    if (!this.provider || !(this.provider instanceof WebSocketProvider)) {
      return;
    }

    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] Starting WS heartbeat monitoring (interval=${config.wsHeartbeatMs}ms)`);
    
    this.lastWsActivity = Date.now();

    const heartbeatCheck = () => {
      if (this.isShuttingDown || !this.provider || this.isReconnecting) {
        return;
      }

      const now = Date.now();
      const timeSinceLastActivity = now - this.lastWsActivity;

      if (timeSinceLastActivity > config.wsHeartbeatMs) {
        // eslint-disable-next-line no-console
        console.warn(`[realtime-hf] WS heartbeat timeout: no activity for ${timeSinceLastActivity}ms, triggering reconnect`);
        wsReconnectsTotal.inc();
        this.handleWsStall();
      } else if (!this.isShuttingDown) {
        // Schedule next check only if not shutting down
        this.wsHeartbeatTimer = setTimeout(heartbeatCheck, config.wsHeartbeatMs);
      }
    };

    // Start initial check
    this.wsHeartbeatTimer = setTimeout(heartbeatCheck, config.wsHeartbeatMs);
  }

  /**
   * Handle WebSocket stall by reconnecting
   */
  private async handleWsStall(): Promise<void> {
    if (this.isReconnecting || this.isShuttingDown) {
      return;
    }

    this.isReconnecting = true;

    try {
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Attempting WS reconnect due to heartbeat failure...');

      // Clean up existing provider
      if (this.provider) {
        try {
          this.provider.removeAllListeners();
          if (this.provider instanceof WebSocketProvider) {
            await this.provider.destroy();
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[realtime-hf] Error during provider cleanup:', err);
        }
      }

      // Re-setup provider and listeners
      await this.setupProvider();
      await this.setupContracts();
      await this.setupRealtime();

      // eslint-disable-next-line no-console
      console.log('[realtime-hf] ws_reconnected successfully after heartbeat failure');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] WS reconnect failed:', err);
      // Fall back to standard reconnect logic
      this.handleDisconnect();
    } finally {
      this.isReconnecting = false;
    }
  }

  /**
   * Handle new block notification - request head check via serialized queue
   */
  private async handleNewBlock(blockNumber: number): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] New block ${blockNumber}`);

    // Update WS activity timestamp
    this.lastWsActivity = Date.now();

    this.metrics.blocksReceived++;
    realtimeBlocksReceived.inc();

    // Request head check via serialization mechanism
    this.requestHeadCheck(blockNumber);
  }

  /**
   * Request a head check for a specific block number.
   * Coalesces multiple requests to the newest block with explicit skip logging.
   */
  private requestHeadCheck(blockNumber: number): void {
    const previousLatest = this.latestRequestedHeadBlock;
    
    // Update to newest requested block
    this.latestRequestedHeadBlock = Math.max(
      this.latestRequestedHeadBlock ?? blockNumber,
      blockNumber
    );

    // If already scanning and we're skipping blocks, log it explicitly (Goal 4)
    if (this.scanningHead && previousLatest !== null && blockNumber > previousLatest) {
      const skippedCount = blockNumber - previousLatest - 1;
      if (skippedCount > 0) {
        // eslint-disable-next-line no-console
        console.log(`[head-catchup] skipped ${skippedCount} stale blocks (latest=${blockNumber})`);
      }
      return;
    }

    // If already scanning but not skipping, just return
    if (this.scanningHead) {
      return;
    }

    // Start the run loop
    this.runHeadCheckLoop().catch(err => {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] Error in head check loop:', err);
    });
  }

  /**
   * Run head-check loop that processes blocks serially, always using the newest requested block.
   */
  private async runHeadCheckLoop(): Promise<void> {
    this.scanningHead = true;

    try {
      while (this.latestRequestedHeadBlock !== null) {
        // Consume the newest requested block
        const runBlock = this.latestRequestedHeadBlock;
        this.latestRequestedHeadBlock = null;

        // Generate unique run ID
        this.currentRunId = `${Date.now()}-${runBlock}`;

        // Initialize progress tracking for this run
        this.lastProgressAt = Date.now();

        // Start run-level watchdog
        this.startRunWatchdog(runBlock);

        try {
          // Perform the head check for this block
          await this.performHeadCheck(runBlock, this.currentRunId);
        } finally {
          // Stop watchdog for this run
          this.stopRunWatchdog();
        }
      }
    } finally {
      this.scanningHead = false;
      this.currentRunId = null;
      this.lastProgressAt = null;
    }
  }

  /**
   * Start run-level watchdog to detect stalled runs
   */
  private startRunWatchdog(blockNumber: number): void {
    // Clear any existing watchdog
    this.stopRunWatchdog();

    const checkStall = () => {
      if (!this.lastProgressAt || this.isShuttingDown) {
        return;
      }

      const now = Date.now();
      const timeSinceProgress = now - this.lastProgressAt;

      if (timeSinceProgress > config.runStallAbortMs) {
        // eslint-disable-next-line no-console
        console.error(`[realtime-hf] run=${this.currentRunId} block=${blockNumber} stalled after ${timeSinceProgress}ms; aborting`);
        runAbortsTotal.inc();
        
        // Abort the run by pushing block back to queue and releasing lock
        this.abortCurrentRun(blockNumber);
      } else if (!this.isShuttingDown) {
        // Re-schedule check only if not shutting down
        this.runWatchdogTimer = setTimeout(checkStall, config.runStallAbortMs);
      }
    };

    this.runWatchdogTimer = setTimeout(checkStall, config.runStallAbortMs);
  }

  /**
   * Stop run-level watchdog
   */
  private stopRunWatchdog(): void {
    if (this.runWatchdogTimer) {
      clearTimeout(this.runWatchdogTimer);
      this.runWatchdogTimer = undefined;
    }
  }

  /**
   * Abort current run and recover cleanly
   */
  private abortCurrentRun(blockNumber: number): void {
    // Stop watchdog
    this.stopRunWatchdog();

    // If there's a pending block request that we're aborting, push it back
    if (blockNumber && this.latestRequestedHeadBlock !== blockNumber) {
      this.latestRequestedHeadBlock = blockNumber;
    }

    // Release the scanning lock to allow new runs
    this.scanningHead = false;
    this.currentRunId = null;
    this.lastProgressAt = null;

    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] Run aborted, will retry on next tick`);

    // Restart the run loop if there's a pending block
    if (this.latestRequestedHeadBlock !== null) {
      this.runHeadCheckLoop().catch(err => {
        // eslint-disable-next-line no-console
        console.error('[realtime-hf] Error restarting run loop after abort:', err);
      });
    }
  }

  /**
   * Perform a single head check for a specific block.
   * Per-run blockTag consistent reads: pass blockTag to all static calls
   */
  private async performHeadCheck(blockNumber: number, runId: string): Promise<void> {
    const startTime = Date.now();
    
    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] Starting head check run=${runId} block=${blockNumber} (blockTag=${blockNumber})`);

    // Clear per-block tracking for this block
    if (this.currentBlockNumber !== blockNumber) {
      this.seenUsersThisBlock.clear();
      this.currentBlockNumber = blockNumber;
      this.lastPriceCheckBlock = null;
      this.lastReserveCheckBlock = null;
    }

    // Perform batch check on all candidates with blockTag
    const metrics = await this.checkAllCandidates('head', blockNumber);

    // On success, clear dirty sets (users have been checked)
    this.dirtyUsers.clear();
    this.dirtyReserves.clear();

    // Record metrics for adaptive page sizing
    const elapsed = Date.now() - startTime;
    this.recordHeadRunMetrics(elapsed, metrics.timeouts, metrics.avgLatency);
  }

  /**
   * Start pending block polling (Flashblocks mode)
   * Uses adaptive tick interval that increases during rate-limit bursts (Goal 4)
   */
  private startPendingBlockPolling(): void {
    if (!this.provider) return;

    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] Starting pending block polling (tick=${this.currentPendingTickMs}ms)`);

    const pollFn = async () => {
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

      // Re-schedule with current adaptive tick interval
      if (!this.isShuttingDown) {
        this.pendingBlockTimer = setTimeout(pollFn, this.currentPendingTickMs);
      }
    };

    // Start initial poll
    this.pendingBlockTimer = setTimeout(pollFn, this.currentPendingTickMs);
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
        
        // Mark users and reserves as dirty for next head-check prioritization (Goal 2)
        for (const user of users) {
          this.dirtyUsers.add(user.toLowerCase());
          // Track reserve association for price trigger targeting
          if (reserve) {
            this.candidateManager.touchReserve(user.toLowerCase(), reserve);
          }
        }
        if (reserve) {
          this.dirtyReserves.add(reserve.toLowerCase());
        }
        
        // Handle based on event type
        if (decoded.name === 'LiquidationCall') {
          // Enhanced LiquidationCall tracking with candidate set classification
          const liquidatedUser = users[0];
          const candidate = this.candidateManager.get(liquidatedUser);
          const inSet = candidate !== undefined;
          const lastHF = candidate?.lastHF ?? null;
          
          // eslint-disable-next-line no-console
          console.log(
            `[realtime-hf] LiquidationCall detected: user=${liquidatedUser} ` +
            `in_set=${inSet} last_hf=${lastHF !== null ? lastHF.toFixed(4) : 'unknown'} ` +
            `block=${blockNumber}`
          );
          
          // Audit liquidation event if audit service is enabled
          if (this.liquidationAuditService) {
            const txHash = log.transactionHash || '';
            const candidatesTotal = this.candidateManager.size();
            
            // Async call - don't await to avoid blocking event processing
            this.liquidationAuditService.onLiquidationCall(
              decoded,
              blockNumber,
              txHash,
              (user: string) => this.candidateManager.get(user) !== undefined,
              candidatesTotal
            ).catch(err => {
              // eslint-disable-next-line no-console
              console.error('[realtime-hf] Liquidation audit failed:', err);
            });
          }
        }
        
        // For all user-affecting events, enqueue with coalescing
        if (users.length > 0) {
          // Enqueue event batch with coalescing
          this.enqueueEventBatch(users, reserve, blockNumber);
        } else {
          // ReserveDataUpdated, FlashLoan, etc. - may affect multiple users
          if (decoded.name === 'ReserveDataUpdated' && reserve) {
            // Enqueue a batch check for low-HF candidates, coalesced per block+reserve
            this.enqueueEventBatch([], reserve, blockNumber);
          }
        }
      } else {
        // Fallback to legacy extraction if decode fails
        const userAddress = this.extractUserFromLog(log);
        if (userAddress) {
          // eslint-disable-next-line no-console
          console.log(`[realtime-hf] Aave event detected for user ${userAddress} (legacy)`);
          
          const blockNumber = typeof log.blockNumber === 'string' 
            ? parseInt(log.blockNumber, 16) 
            : log.blockNumber;
          
          // Enqueue with coalescing
          this.enqueueEventBatch([userAddress], null, blockNumber);
        }
      }
    } else {
      // Chainlink price update
      this.metrics.priceUpdatesReceived++;
      realtimePriceUpdatesReceived.inc();
      
      const feedAddress = log.address.toLowerCase();
      const currentBlock = typeof log.blockNumber === 'string' 
        ? parseInt(log.blockNumber, 16) 
        : log.blockNumber;
      
      // Try to decode Chainlink event for better logging and price extraction
      let decoded = eventRegistry.decode(log.topics as string[], log.data);
      
      // If eventRegistry decode fails, try manual decode for NewTransmission
      if (!decoded) {
        try {
          const iface = new Interface(CHAINLINK_AGG_ABI);
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed) {
            // Create a compatible DecodedEvent-like object
            decoded = { 
              name: parsed.name, 
              args: parsed.args as Record<string, unknown>,
              signature: parsed.signature
            };
          }
        } catch {
          // Ignore decode errors
        }
      }
      
      if (decoded && (decoded.name === 'AnswerUpdated' || decoded.name === 'NewTransmission')) {
        // eslint-disable-next-line no-console
        console.log(`[realtime-hf] Chainlink ${decoded.name} event (block=${currentBlock})`);
        
        // Handle price trigger logic if enabled
        if (config.priceTriggerEnabled) {
          await this.handleChainlinkEvent(feedAddress, decoded, currentBlock);
        }
      } else {
        // eslint-disable-next-line no-console
        console.log('[realtime-hf] Chainlink price update detected');
      }
      
      // Per-block gating: prevent multiple price-triggered rechecks in same block (Goal 5)
      if (this.lastPriceCheckBlock === currentBlock) {
        // eslint-disable-next-line no-console
        console.log(`[realtime-hf] Price update - skipping recheck (already checked this block)`);
        return;
      }
      this.lastPriceCheckBlock = currentBlock;
      
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
   * Handle Chainlink event (AnswerUpdated or NewTransmission)
   * Extracts price and delegates to centralized price processing
   */
  private async handleChainlinkEvent(
    feedAddress: string,
    decoded: { name: string; args: Record<string, unknown> },
    blockNumber: number
  ): Promise<void> {
    try {
      let currentAnswer: bigint | undefined;
      
      // Extract price based on event type
      if (decoded.name === 'AnswerUpdated') {
        // AnswerUpdated: int256 indexed current
        currentAnswer = decoded.args.current as bigint | undefined;
      } else if (decoded.name === 'NewTransmission') {
        // NewTransmission: int192 answer (not indexed)
        currentAnswer = decoded.args.answer as bigint | undefined;
      }
      
      if (!currentAnswer || typeof currentAnswer !== 'bigint') {
        return;
      }
      
      // Process price update through centralized method
      await this.processPriceUpdate(feedAddress, currentAnswer, blockNumber, 'event');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[price-trigger] Error handling Chainlink event:', err);
    }
  }

  /**
   * Centralized price-trigger handling for both events and polling
   * Computes delta or cumulative drop vs baseline and triggers emergency scan when threshold crossed
   */
  private async processPriceUpdate(
    feedAddress: string,
    currentAnswer: bigint,
    blockNumber: number,
    source: 'event' | 'poll'
  ): Promise<void> {
    try {
      // Convert bigint to number safely
      const currentPrice = parseFloat(currentAnswer.toString());
      const rawSymbol = this.chainlinkFeedToSymbol.get(feedAddress) || feedAddress;
      const symbol = this.normalizeAssetSymbol(rawSymbol);
      
      // Check if this asset is in the monitored set (if filter is configured)
      if (this.priceMonitorAssets !== null && !this.priceMonitorAssets.has(symbol)) {
        return;
      }
      
      // Get or initialize per-asset state
      let state = this.priceAssetState.get(feedAddress);
      if (!state) {
        state = {
          lastAnswer: null,
          lastUpdatedAt: null,
          lastTriggerTs: 0,
          baselineAnswer: null
        };
        this.priceAssetState.set(feedAddress, state);
      }
      
      // Initialize baseline on first update
      if (state.baselineAnswer === null) {
        state.baselineAnswer = currentAnswer;
        state.lastAnswer = currentAnswer;
        state.lastUpdatedAt = Date.now();
        
        // Also update legacy maps for backward compatibility
        this.baselinePrices.set(feedAddress, currentPrice);
        this.lastSeenPrices.set(feedAddress, currentPrice);
        
        if (source === 'poll') {
          // eslint-disable-next-line no-console
          console.log(
            `[price-trigger] Initialized price tracking for ${symbol} via polling: ` +
            `mode=${config.priceTriggerCumulative ? 'cumulative' : 'delta'} baseline=${currentPrice}`
          );
        }
        return;
      }
      
      // Skip if no last answer (shouldn't happen after init, but guard)
      if (state.lastAnswer === null) {
        state.lastAnswer = currentAnswer;
        state.lastUpdatedAt = Date.now();
        this.lastSeenPrices.set(feedAddress, currentPrice);
        return;
      }
      
      // Calculate reference price based on mode
      const lastPrice = parseFloat(state.lastAnswer.toString());
      const baselinePrice = parseFloat(state.baselineAnswer.toString());
      const referencePrice = config.priceTriggerCumulative ? baselinePrice : lastPrice;
      
      // Update state
      state.lastAnswer = currentAnswer;
      state.lastUpdatedAt = Date.now();
      this.lastSeenPrices.set(feedAddress, currentPrice);
      
      // Guard against division by zero
      if (referencePrice <= 0) {
        // eslint-disable-next-line no-console
        console.warn(`[price-trigger] Invalid reference price (${referencePrice}) for ${symbol}, skipping trigger`);
        return;
      }
      
      // Calculate price change in basis points
      const priceDiff = currentPrice - referencePrice;
      const priceDiffPct = (priceDiff / referencePrice) * 10000; // basis points
      
      // Log price update at debug level
      if (source === 'poll' && Math.abs(priceDiffPct) > 1) {
        // eslint-disable-next-line no-console
        console.log(
          `[price-trigger] Poll update: ${symbol} ${lastPrice.toFixed(2)} → ${currentPrice.toFixed(2)} ` +
          `(${priceDiffPct >= 0 ? '+' : ''}${priceDiffPct.toFixed(2)}bps)`
        );
      }
      
      // Get per-asset threshold and debounce settings
      const assetDropBps = this.perAssetTriggerConfig?.getDropBps(symbol) ?? config.priceTriggerDropBps;
      const assetDebounceSec = this.perAssetTriggerConfig?.getDebounceSec(symbol) ?? config.priceTriggerDebounceSec;
      
      // Check if price dropped by threshold or more
      if (priceDiffPct >= -assetDropBps) {
        // Price increased or dropped less than threshold - no emergency scan
        return;
      }
      
      // Check debounce: prevent repeated scans on rapid ticks
      const now = Date.now();
      const debounceMs = assetDebounceSec * 1000;
      
      if (state.lastTriggerTs > 0 && (now - state.lastTriggerTs) < debounceMs) {
        const elapsedSec = Math.floor((now - state.lastTriggerTs) / 1000);
        // eslint-disable-next-line no-console
        console.log(
          `[price-trigger] Debounced (${source}): asset=${symbol} drop=${Math.abs(priceDiffPct).toFixed(2)}bps ` +
          `elapsed=${elapsedSec}s debounce=${assetDebounceSec}s ` +
          `mode=${config.priceTriggerCumulative ? 'cumulative' : 'delta'}`
        );
        return;
      }
      
      // Update last trigger time
      state.lastTriggerTs = now;
      this.lastPriceTriggerTime.set(symbol, now);
      
      // Reset baseline to current price after trigger (for cumulative mode)
      if (config.priceTriggerCumulative) {
        state.baselineAnswer = currentAnswer;
        this.baselinePrices.set(feedAddress, currentPrice);
      }
      
      // Price dropped significantly - trigger emergency scan
      const dropBps = Math.abs(priceDiffPct);
      // eslint-disable-next-line no-console
      console.log(
        `[price-trigger] Sharp price drop detected (${source}): asset=${symbol} ` +
        `drop=${dropBps.toFixed(2)}bps threshold=${assetDropBps}bps ` +
        `mode=${config.priceTriggerCumulative ? 'cumulative' : 'delta'} ` +
        `reference=${referencePrice.toFixed(2)} current=${currentPrice.toFixed(2)} ` +
        `block=${blockNumber}`
      );
      
      // Increment metric
      realtimePriceTriggersTotal.inc({ asset: symbol });
      
      // Select candidates for emergency scan
      const affectedUsers = this.selectCandidatesForEmergencyScan(symbol);
      
      if (affectedUsers.length === 0) {
        // eslint-disable-next-line no-console
        console.log(`[price-trigger] No candidates associated with ${symbol}, skipping emergency scan`);
        return;
      }
      
      // Execute emergency scan
      await this.executeEmergencyScan(symbol, affectedUsers, dropBps, blockNumber);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[price-trigger] Error processing price update:', err);
    }
  }

  /**
   * Execute emergency scan for affected users
   */
  private async executeEmergencyScan(
    symbol: string,
    affectedUsers: string[],
    dropBps: number,
    blockNumber: number
  ): Promise<void> {
    try {
      // Increment metric
      const { realtimePriceEmergencyScansTotal, emergencyScanLatency } = await import('../metrics/index.js');
      realtimePriceEmergencyScansTotal.inc({ asset: symbol });
      
      // If BorrowersIndexService is available, also check borrowers of this reserve
      if (this.borrowersIndex) {
        // Find the reserve address for this symbol
        const reserve = this.discoveredReserves.find(
          r => r.symbol.toUpperCase() === symbol.toUpperCase()
        );
        
        if (reserve) {
          // eslint-disable-next-line no-console
          console.log(`[price-trigger] Also checking borrowers of reserve ${symbol} via BorrowersIndexService`);
          await this.checkReserveBorrowers(reserve.asset, 'price', blockNumber);
        }
      }
      
      // Perform emergency scan with latency tracking on candidate set
      const startTime = Date.now();
      await this.batchCheckCandidatesWithPending(affectedUsers, 'price', blockNumber);
      const latencyMs = Date.now() - startTime;
      emergencyScanLatency.observe(latencyMs);
      
      // eslint-disable-next-line no-console
      console.log(
        `[price-trigger] Emergency scan complete: asset=${symbol} ` +
        `candidates=${affectedUsers.length} latency=${latencyMs}ms trigger=price`
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[price-trigger] Error handling price trigger:', err);
    }
  }

  /**
   * Start periodic polling fallback for Chainlink price feeds
   * Runs even when events are active but respects debounce window
   */
  private startPricePolling(feeds: Record<string, string>): void {
    const pollIntervalMs = config.priceTriggerPollSec * 1000;
    
    // eslint-disable-next-line no-console
    console.log(
      `[price-trigger] Starting polling fallback: interval=${config.priceTriggerPollSec}s ` +
      `feeds=${Object.keys(feeds).length}`
    );
    
    // Initial poll after a short delay
    setTimeout(() => {
      this.pollChainlinkFeeds(feeds).catch(err => {
        // eslint-disable-next-line no-console
        console.error('[price-trigger] Error in initial poll:', err);
      });
    }, 2000);
    
    // Periodic polling
    this.pricePollingTimer = setInterval(() => {
      if (this.isShuttingDown) return;
      
      this.pollChainlinkFeeds(feeds).catch(err => {
        // eslint-disable-next-line no-console
        console.error('[price-trigger] Error in polling:', err);
      });
    }, pollIntervalMs);
  }

  /**
   * Poll latestRoundData for all configured feeds
   */
  private async pollChainlinkFeeds(feeds: Record<string, string>): Promise<void> {
    if (!this.provider) return;
    
    const currentBlock = await this.provider.getBlockNumber().catch(() => null);
    if (currentBlock === null) return;
    
    for (const [token, feedAddress] of Object.entries(feeds)) {
      try {
        // Create contract instance for this feed
        const feedContract = new Contract(feedAddress, CHAINLINK_AGGREGATOR_ABI, this.provider);
        
        // Call latestRoundData
        const result = await feedContract.latestRoundData();
        const answer = result[1] as bigint; // answer is second return value
        
        if (answer && typeof answer === 'bigint') {
          // Process through centralized price update handler
          await this.processPriceUpdate(feedAddress.toLowerCase(), answer, currentBlock, 'poll');
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[price-trigger] Polling error for ${token}:`, err);
      }
    }
  }

  /**
   * Select candidates for emergency scan based on asset symbol
   * @param assetSymbol Token symbol (e.g., 'ETH', 'USDC') - used to query reserve associations
   */
  private selectCandidatesForEmergencyScan(assetSymbol: string): string[] {
    // Get users associated with this reserve
    // Note: Reserve associations are tracked using lowercase addresses/symbols from Aave events
    const reserveUsers = this.candidateManager.getUsersForReserve(assetSymbol);
    
    if (reserveUsers.length > 0) {
      // Cap by configured max scan limit
      return reserveUsers.slice(0, config.priceTriggerMaxScan);
    }
    
    // Fallback: if no reserve mapping, check all candidates up to limit
    // Prioritize low HF candidates
    const allCandidates = this.candidateManager.getAll();
    const sorted = allCandidates
      .filter(c => c.lastHF !== null)
      .sort((a, b) => (a.lastHF || Infinity) - (b.lastHF || Infinity));
    
    return sorted
      .slice(0, config.priceTriggerMaxScan)
      .map(c => c.address);
  }

  /**
   * Perform initial candidate seeding on startup
   */
  private async performInitialSeeding(): Promise<void> {
    const seedBefore = this.candidateManager.size();
    let newCount = 0;

    // Priority 1: Subgraph seeding with SubgraphSeeder (if enabled)
    if (config.useSubgraph && this.subgraphService) {
      try {
        // eslint-disable-next-line no-console
        console.log('[realtime-hf] Initial seeding from subgraph with SubgraphSeeder...');
        
        // Initialize SubgraphSeeder
        this.subgraphSeeder = new SubgraphSeeder({
          subgraphService: this.subgraphService,
          maxCandidates: config.candidateMax,
          pageSize: config.subgraphPageSize,
          politenessDelayMs: 100
        });
        
        // Perform comprehensive seeding
        const userAddresses = await this.subgraphSeeder.seed();
        this.candidateManager.addBulk(userAddresses);
        
        newCount = this.candidateManager.size() - seedBefore;
        // eslint-disable-next-line no-console
        console.log(`[realtime-hf] seed_source=subgraph_seeder candidates_total=${this.candidateManager.size()} new=${newCount}`);
        return; // Subgraph seeding is sufficient, skip on-chain backfill
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[realtime-hf] Subgraph seeding failed, falling back to on-chain backfill:', err);
      }
    }

    // Priority 2: On-chain backfill (default path when USE_SUBGRAPH=false)
    if (config.realtimeInitialBackfillEnabled) {
      try {
        // eslint-disable-next-line no-console
        console.log('[realtime-hf] Initial seeding from on-chain backfill...');
        
        this.backfillService = new OnChainBackfillService();
        
        // Provider selection logic
        if (config.backfillRpcUrl) {
          // Use dedicated backfill RPC URL if provided
          // eslint-disable-next-line no-console
          console.log(`[realtime-hf] Using dedicated backfill RPC: ${config.backfillRpcUrl.substring(0, 20)}...`);
          await this.backfillService.initialize(config.backfillRpcUrl);
        } else if (this.provider) {
          // Reuse existing connected provider
          // eslint-disable-next-line no-console
          console.log('[realtime-hf] Reusing connected provider for backfill');
          await this.backfillService.initialize(this.provider);
        } else {
          throw new Error('No provider available for backfill (BACKFILL_RPC_URL not set and no WS provider)');
        }
        
        const result = await this.backfillService.backfill();
        
        // Add discovered users to candidate manager
        this.candidateManager.addBulk(result.users);
        newCount = this.candidateManager.size() - seedBefore;
        
        // eslint-disable-next-line no-console
        console.log(`[realtime-hf] seed_source=onchain_backfill candidates_total=${this.candidateManager.size()} new=${newCount}`);
        
        // Cleanup backfill service
        await this.backfillService.cleanup();
        this.backfillService = undefined;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[realtime-hf] On-chain backfill failed:', err);
      }
    }

    if (newCount === 0) {
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] No initial candidates seeded, will rely on real-time events');
    }
  }

  /**
   * Check all candidates via Multicall3 batch with paging/rotation support and dirty-first prioritization
   * @param triggerType Type of trigger
   * @param blockTag Optional blockTag for consistent reads
   * @returns Metrics about the run
   */
  private async checkAllCandidates(triggerType: 'event' | 'head' | 'price', blockTag?: number): Promise<{ timeouts: number; avgLatency: number; candidates: number }> {
    const allAddresses = this.candidateManager.getAddresses();
    if (allAddresses.length === 0) {
      return { timeouts: 0, avgLatency: 0, candidates: 0 };
    }

    // Determine which addresses to check based on strategy
    let addressesToCheck: string[];
    
    if (config.headCheckPageStrategy === 'all') {
      // Check all candidates every head
      addressesToCheck = allAddresses;
    } else {
      // Paged strategy with dirty-first prioritization (Goal 3)
      // Use dynamic page size if adaptive is enabled
      const pageSize = config.headPageAdaptive ? this.currentDynamicPageSize : config.headCheckPageSize;
      const totalCandidates = allAddresses.length;
      const candidates = this.candidateManager.getAll();
      const addressSet = new Set(allAddresses);

      // 1. Dirty users first - users touched by recent Aave events
      const dirtyFirst = Array.from(this.dirtyUsers).filter(addr => addressSet.has(addr));
      
      // 2. Get current rotating page window
      const startIdx = this.headCheckRotatingIndex % totalCandidates;
      const endIdx = Math.min(startIdx + pageSize, totalCandidates);
      const windowAddresses = allAddresses.slice(startIdx, endIdx);
      
      // If we need more addresses to fill the page, wrap around
      if (windowAddresses.length < pageSize && totalCandidates > pageSize) {
        const remaining = pageSize - windowAddresses.length;
        const wrapAddresses = allAddresses.slice(0, Math.min(remaining, totalCandidates));
        windowAddresses.push(...wrapAddresses);
      }
      
      // 3. Always include low-HF candidates (below configurable threshold)
      const lowHfThreshold = config.alwaysIncludeHfBelow;
      const lowHfAddresses = candidates
        .filter(c => c.lastHF !== null && c.lastHF < lowHfThreshold)
        .map(c => c.address);
      
      // Deduplicate in priority order: dirty first, then window, then low HF
      const seen = new Set<string>();
      addressesToCheck = [];
      
      for (const addr of dirtyFirst) {
        if (!seen.has(addr)) {
          addressesToCheck.push(addr);
          seen.add(addr);
        }
      }
      
      for (const addr of windowAddresses) {
        if (!seen.has(addr)) {
          addressesToCheck.push(addr);
          seen.add(addr);
        }
      }
      
      for (const addr of lowHfAddresses) {
        if (!seen.has(addr)) {
          addressesToCheck.push(addr);
          seen.add(addr);
        }
      }
      
      // Update rotating index for next iteration
      this.headCheckRotatingIndex = (this.headCheckRotatingIndex + pageSize) % totalCandidates;
      
      // Log paging info with dirty-first stats and dynamic page size if adaptive
      // eslint-disable-next-line no-console
      console.log(`[realtime-hf] head_page=${startIdx}..${endIdx} size=${addressesToCheck.length} total=${totalCandidates} dirty=${dirtyFirst.length} lowHf=${lowHfAddresses.length} pageSize=${pageSize}`);
    }

    return await this.batchCheckCandidates(addressesToCheck, triggerType, blockTag);
  }

  /**
   * Check candidates with low HF (priority for price or event trigger)
   */
  private async checkLowHFCandidates(triggerType: 'event' | 'price', blockTag?: number): Promise<void> {
    const candidates = this.candidateManager.getAll();
    const lowHF = candidates
      .filter(c => c.lastHF !== null && c.lastHF < 1.1)
      .map(c => c.address);

    if (lowHF.length === 0) return;

    await this.batchCheckCandidates(lowHF, triggerType, blockTag);
  }

  /**
   * Check a single candidate
   */
  private async checkCandidate(address: string, triggerType: 'event' | 'head' | 'price', blockTag?: number): Promise<void> {
    await this.batchCheckCandidates([address], triggerType, blockTag);
  }

  /**
   * Detect if an error is a provider rate limit error (Goal 4)
   */
  private isRateLimitError(err: unknown): boolean {
    if (!err) return false;
    const errStr = String(err).toLowerCase();
    // Common rate limit error codes and messages
    return errStr.includes('-32005') || // RPS limit
           errStr.includes('rate limit') ||
           errStr.includes('too many requests') ||
           errStr.includes('429');
  }

  /**
   * Handle rate limit detection - adjust adaptive parameters (Goal 4)
   */
  private handleRateLimit(): void {
    this.consecutiveRateLimits++;
    
    // Adaptive chunking: reduce chunk size on repeated failures
    if (this.consecutiveRateLimits >= 2 && this.currentChunkSize > 50) {
      const newChunkSize = Math.max(50, Math.floor(this.currentChunkSize * 0.67));
      // eslint-disable-next-line no-console
      console.log(`[realtime-hf] Rate limit detected - reducing chunk size ${this.currentChunkSize} -> ${newChunkSize}`);
      this.currentChunkSize = newChunkSize;
    }
    
    // Adaptive flashblock tick: increase pending polling interval
    if (this.consecutiveRateLimits >= 2 && this.currentPendingTickMs < this.basePendingTickMs * 4) {
      const newTickMs = Math.min(this.basePendingTickMs * 4, this.currentPendingTickMs * 2);
      // eslint-disable-next-line no-console
      console.log(`[realtime-hf] Rate limit burst - increasing pending tick ${this.currentPendingTickMs}ms -> ${newTickMs}ms`);
      this.currentPendingTickMs = newTickMs;
    }
  }

  /**
   * Clear rate limit tracking when operations succeed (Goal 4)
   */
  private clearRateLimitTracking(): void {
    if (this.consecutiveRateLimits > 0) {
      this.consecutiveRateLimits = 0;
      
      // Restore chunk size gradually to configured value
      const targetChunkSize = config.multicallBatchSize;
      if (this.currentChunkSize < targetChunkSize) {
        this.currentChunkSize = Math.min(targetChunkSize, this.currentChunkSize + 10);
      }
      
      // Restore pending tick gradually
      if (this.currentPendingTickMs > this.basePendingTickMs) {
        this.currentPendingTickMs = Math.max(this.basePendingTickMs, Math.floor(this.currentPendingTickMs * 0.8));
      }
    }
  }

  /**
   * Get log prefix with current run and block for unambiguous tracking (Goal 4)
   */
  private getLogPrefix(): string {
    return `[realtime-hf] run=${this.currentRunId || 'unknown'} block=${this.currentBlockNumber || 'unknown'}`;
  }

  /**
   * Check borrowers of a specific reserve when it's updated or price changes
   */
  private async checkReserveBorrowers(reserveAddr: string, source: 'reserve' | 'price', blockTag?: number): Promise<void> {
    if (!this.borrowersIndex) {
      return;
    }

    try {
      // Get borrowers for this reserve
      const borrowers = await this.borrowersIndex.getBorrowers(reserveAddr);
      
      if (borrowers.length === 0) {
        return;
      }

      // Select top N borrowers to recheck (randomized or by some priority)
      const topN = config.reserveRecheckTopN;
      const maxBatch = config.reserveRecheckMaxBatch;
      
      // Shuffle for fairness and take top N
      const shuffled = [...borrowers].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, Math.min(topN, maxBatch, borrowers.length));
      
      // Resolve symbol for logging and metrics
      const reserve = this.discoveredReserves.find(r => r.asset.toLowerCase() === reserveAddr.toLowerCase());
      const symbol = reserve?.symbol || reserveAddr.slice(0, 10);
      
      // eslint-disable-next-line no-console
      console.log(
        `[reserve-recheck] Checking ${selected.length}/${borrowers.length} borrowers ` +
        `for reserve ${symbol} (source=${source}, block=${blockTag || 'latest'})`
      );
      
      // Increment metric
      reserveRechecksTotal.inc({ asset: symbol, source });
      
      // Perform batch HF check with optional pending verification
      await this.batchCheckCandidatesWithPending(selected, source, blockTag);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[reserve-recheck] Error checking reserve borrowers:`, err);
    }
  }

  /**
   * Batch check candidates with optional pending-state verification
   */
  private async batchCheckCandidatesWithPending(
    addresses: string[],
    triggerType: 'event' | 'head' | 'price' | 'reserve',
    blockTag?: number
  ): Promise<void> {
    // Determine if we should use pending verification
    const usePending = config.pendingVerifyEnabled && 
                       (triggerType === 'price' || triggerType === 'reserve') &&
                       !blockTag; // Only for real-time checks, not historical
    
    const effectiveBlockTag: number | 'pending' | undefined = usePending ? 'pending' : blockTag;
    
    // If using pending, log it
    if (usePending) {
      // eslint-disable-next-line no-console
      console.log(`[pending-verify] Using pending block for ${addresses.length} checks (trigger=${triggerType})`);
    }
    
    try {
      // Use existing batch check with effective block tag
      await this.batchCheckCandidates(addresses, triggerType as 'event' | 'head' | 'price', effectiveBlockTag);
    } catch (err) {
      // Check if error is related to pending block not supported
      const errStr = String(err).toLowerCase();
      if (usePending && (errStr.includes('pending') || errStr.includes('block tag'))) {
        // eslint-disable-next-line no-console
        console.warn('[pending-verify] Provider does not support pending block, falling back to latest');
        pendingVerifyErrorsTotal.inc();
        
        // Retry with latest (undefined means latest)
        await this.batchCheckCandidates(addresses, triggerType as 'event' | 'head' | 'price', blockTag);
      } else {
        throw err;
      }
    }
  }

  /**
   * Enqueue event-driven batch check with coalescing
   */
  private enqueueEventBatch(users: string[], reserve: string | null, blockNumber: number): void {
    // Create a key based on block number and reserve (if any)
    const batchKey = reserve ? `block-${blockNumber}-reserve-${reserve}` : `block-${blockNumber}-users`;

    // Get or create batch entry
    let batch = this.eventBatchQueue.get(batchKey);
    if (!batch) {
      // Create new batch with debounce timer
      batch = {
        users: new Set<string>(),
        reserves: new Set<string>(),
        timer: setTimeout(() => {
          this.executeEventBatch(batchKey).catch(err => {
            // eslint-disable-next-line no-console
            console.error(`[event-coalesce] Failed to execute batch ${batchKey}:`, err);
          });
        }, config.eventBatchCoalesceMs),
        blockNumber
      };
      this.eventBatchQueue.set(batchKey, batch);
    } else {
      // Reset timer to extend debounce window
      clearTimeout(batch.timer);
      batch.timer = setTimeout(() => {
        this.executeEventBatch(batchKey).catch(err => {
          // eslint-disable-next-line no-console
          console.error(`[event-coalesce] Failed to execute batch ${batchKey}:`, err);
        });
      }, config.eventBatchCoalesceMs);
    }

    // Add users and reserve to batch
    for (const user of users) {
      batch.users.add(user.toLowerCase());
      this.candidateManager.add(user);
    }
    if (reserve) {
      batch.reserves.add(reserve.toLowerCase());
    }
  }

  /**
   * Execute a coalesced event batch
   */
  private async executeEventBatch(batchKey: string): Promise<void> {
    const batch = this.eventBatchQueue.get(batchKey);
    if (!batch) return;

    // Remove from queue
    this.eventBatchQueue.delete(batchKey);

    const blockNumber = batch.blockNumber;
    const userCount = batch.users.size;
    const reserveCount = batch.reserves.size;

    // Check if we've hit the per-block limit
    const batchesThisBlock = this.eventBatchesPerBlock.get(blockNumber) || 0;
    if (batchesThisBlock >= config.eventBatchMaxPerBlock) {
      // eslint-disable-next-line no-console
      console.log(`[event-coalesce] skipped batch (block=${blockNumber}, users=${userCount}, reserves=${reserveCount}) - per-block limit reached (${config.eventBatchMaxPerBlock})`);
      this.recordEventBatchSkip();
      return;
    }

    // Check concurrency limit (use adaptive limit if enabled)
    const effectiveLimit = this.currentMaxEventBatches;
    if (this.runningEventBatches >= effectiveLimit) {
      // eslint-disable-next-line no-console
      console.log(`[event-coalesce] skipped batch (block=${blockNumber}, users=${userCount}, reserves=${reserveCount}) - concurrency limit reached (${effectiveLimit})`);
      this.recordEventBatchSkip();
      return;
    }

    // Increment counters
    this.eventBatchesPerBlock.set(blockNumber, batchesThisBlock + 1);
    this.runningEventBatches++;
    this.recordEventBatchExecuted();

    try {
      // eslint-disable-next-line no-console
      console.log(`[event-coalesce] executing batch (block=${blockNumber}, users=${userCount}, reserves=${reserveCount})`);

      // Execute checks for all users in the batch
      const usersArray = Array.from(batch.users);
      if (usersArray.length > 0) {
        await this.batchCheckCandidates(usersArray, 'event', blockNumber);
      } else if (reserveCount > 0) {
        // No specific users but reserve updated - use BorrowersIndexService if available
        // to target borrowers of the affected reserve
        if (this.borrowersIndex) {
          for (const reserveAddr of batch.reserves) {
            await this.checkReserveBorrowers(reserveAddr, 'reserve', blockNumber);
          }
        } else {
          // Fallback: check low-HF candidates
          await this.checkLowHFCandidates('event', blockNumber);
        }
      }
    } finally {
      this.runningEventBatches--;
      
      // Clean up old block counters (keep last 10 blocks)
      const oldestBlockToKeep = blockNumber - 10;
      for (const [block] of this.eventBatchesPerBlock) {
        if (block < oldestBlockToKeep) {
          this.eventBatchesPerBlock.delete(block);
        }
      }
    }
  }

  /**
   * Record head run metrics for adaptive page sizing
   */
  private recordHeadRunMetrics(elapsed: number, timeouts: number, avgLatency: number): void {
    if (!config.headPageAdaptive) return;

    // Keep rolling window of last N runs
    this.headRunHistory.push({ elapsed, timeouts, avgLatency });
    if (this.headRunHistory.length > this.ADAPTIVE_WINDOW_SIZE) {
      this.headRunHistory.shift();
    }

    // Perform adjustment if we have enough data (at least 25% of window)
    const minDataPoints = Math.ceil(this.ADAPTIVE_WINDOW_SIZE * 0.25);
    if (this.headRunHistory.length >= minDataPoints) {
      this.adjustDynamicPageSize();
    }
  }

  /**
   * Adjust dynamic page size based on recent head run metrics
   */
  private adjustDynamicPageSize(): void {
    if (!config.headPageAdaptive) return;

    const windowSize = this.headRunHistory.length;
    if (windowSize === 0) return;

    // Calculate averages over the window
    const avgElapsed = this.headRunHistory.reduce((sum, r) => sum + r.elapsed, 0) / windowSize;
    const totalTimeouts = this.headRunHistory.reduce((sum, r) => sum + r.timeouts, 0);
    const timeoutRate = totalTimeouts / windowSize;
    const timeoutPct = (timeoutRate * 100).toFixed(1);

    const prevPageSize = this.currentDynamicPageSize;
    const target = config.headPageTargetMs;
    const min = config.headPageMin;
    const max = config.headPageMax;

    // Decrease page size if avg elapsed > target OR timeout rate > threshold
    if (avgElapsed > target || timeoutRate > this.ADAPTIVE_TIMEOUT_THRESHOLD) {
      const newPageSize = Math.max(min, Math.floor(this.currentDynamicPageSize * this.ADAPTIVE_DECREASE_FACTOR));
      
      if (newPageSize !== prevPageSize) {
        this.currentDynamicPageSize = newPageSize;
        // eslint-disable-next-line no-console
        console.log(`[head-adapt] adjusted page size ${prevPageSize} -> ${newPageSize} (avg=${avgElapsed.toFixed(0)}ms, timeouts=${timeoutPct}%)`);
      }
    }
    // Increase page size if avg elapsed < 0.6 * target AND timeout rate == 0
    else if (avgElapsed < 0.6 * target && timeoutRate === 0) {
      const newPageSize = Math.min(max, Math.floor(this.currentDynamicPageSize * this.ADAPTIVE_INCREASE_FACTOR));
      
      if (newPageSize !== prevPageSize) {
        this.currentDynamicPageSize = newPageSize;
        // eslint-disable-next-line no-console
        console.log(`[head-adapt] adjusted page size ${prevPageSize} -> ${newPageSize} (avg=${avgElapsed.toFixed(0)}ms, timeouts=${timeoutPct}%)`);
      }
    }
  }

  /**
   * Record an event batch skip
   */
  private recordEventBatchSkip(): void {
    eventBatchesSkipped.inc();
    
    // Track in rolling window for adaptive adjustment
    if (config.adaptiveEventConcurrency) {
      this.eventBatchSkipHistory.push(1);
      if (this.eventBatchSkipHistory.length > this.EVENT_SKIP_WINDOW_SIZE) {
        this.eventBatchSkipHistory.shift();
      }
      this.adjustEventConcurrency();
    }
  }
  
  /**
   * Record an event batch execution
   */
  private recordEventBatchExecuted(): void {
    eventBatchesExecuted.inc();
    
    // Track in rolling window for adaptive adjustment
    if (config.adaptiveEventConcurrency) {
      this.eventBatchSkipHistory.push(0);
      if (this.eventBatchSkipHistory.length > this.EVENT_SKIP_WINDOW_SIZE) {
        this.eventBatchSkipHistory.shift();
      }
      this.adjustEventConcurrency();
    }
  }
  
  /**
   * Adjust event concurrency based on backlog and head latency
   */
  private adjustEventConcurrency(): void {
    if (!config.adaptiveEventConcurrency) return;
    
    const minLevel = config.maxParallelEventBatches;
    const maxLevel = config.maxParallelEventBatchesHigh;
    
    // Count skips in recent window
    const recentSkips = this.eventBatchSkipHistory.reduce((sum, val) => sum + val, 0);
    const backlogThreshold = config.eventBacklogThreshold;
    
    // Get head page latency from recent history
    const recentHeadLatency = this.headRunHistory.length > 0
      ? this.headRunHistory[this.headRunHistory.length - 1].elapsed
      : 0;
    const headTargetMs = config.headPageTargetMs;
    
    const prevLevel = this.currentMaxEventBatches;
    
    // Scale up if: backlog > threshold OR head latency < target
    if (recentSkips > backlogThreshold || (recentHeadLatency > 0 && recentHeadLatency < headTargetMs)) {
      this.currentMaxEventBatches = Math.min(maxLevel, this.currentMaxEventBatches + 1);
    }
    // Scale down if: no backlog and head latency approaching or exceeding target
    else if (recentSkips === 0 && recentHeadLatency > headTargetMs * 0.8) {
      this.currentMaxEventBatches = Math.max(minLevel, this.currentMaxEventBatches - 1);
    }
    
    if (this.currentMaxEventBatches !== prevLevel) {
      // eslint-disable-next-line no-console
      console.log(
        `[event-adapt] adjusted concurrency ${prevLevel} -> ${this.currentMaxEventBatches} ` +
        `(recentSkips=${recentSkips}, headLatency=${recentHeadLatency.toFixed(0)}ms)`
      );
    }
    
    // Update metrics
    eventConcurrencyLevel.set(this.currentMaxEventBatches);
    eventConcurrencyLevelHistogram.observe(this.currentMaxEventBatches);
  }

  /**
   * Execute a promise with a hard timeout
   * Properly cleans up the timeout to prevent leaks
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutError: string
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout;
    
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(timeoutError)), timeoutMs);
    });

    return Promise.race([
      promise.then(result => {
        clearTimeout(timeoutId);
        return result;
      }),
      timeoutPromise
    ]).catch(err => {
      clearTimeout(timeoutId);
      throw err;
    });
  }

  /**
   * Execute a single chunk with timeout, hedging, and retry logic
   */
  private async executeChunkWithTimeout(
    chunk: Array<{ target: string; allowFailure: boolean; callData: string }>,
    overrides: Record<string, unknown>,
    chunkNum: number,
    totalChunks: number,
    logPrefix: string
  ): Promise<Array<{ success: boolean; returnData: string }> | null> {
    const maxAttempts = config.chunkRetryAttempts + 1; // +1 for initial attempt

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const startTime = Date.now();

      try {
        let results: Array<{ success: boolean; returnData: string }>;
        let usedProvider: 'primary' | 'secondary' = 'primary';

        // Implement hedging if configured and secondary provider available
        if (config.headCheckHedgeMs > 0 && this.secondaryMulticall3 && config.secondaryHeadRpcUrl) {
          // Race primary against hedged secondary
          const hedgeDelayMs = config.headCheckHedgeMs;
          
          const primaryPromise = this.multicall3!.aggregate3.staticCall(chunk, overrides);
          
          // Create hedge promise that only fires after delay
          const hedgePromise = new Promise<{ result: Array<{ success: boolean; returnData: string }>; provider: 'secondary' }>((resolve, reject) => {
            setTimeout(() => {
              if (!this.secondaryMulticall3) {
                reject(new Error('Secondary multicall not available'));
                return;
              }
              this.secondaryMulticall3.aggregate3.staticCall(chunk, overrides)
                .then(result => resolve({ result, provider: 'secondary' }))
                .catch(reject);
            }, hedgeDelayMs);
          });

          // Race primary (immediate) vs hedge (delayed)
          const winner = await Promise.race([
            primaryPromise.then(result => ({ result, provider: 'primary' as const })),
            hedgePromise
          ]);

          results = winner.result;
          usedProvider = winner.provider;

          if (usedProvider === 'secondary') {
            this.currentBatchMetrics.hedges++;
            this.currentBatchMetrics.secondaryUsed++;
            // eslint-disable-next-line no-console
            console.log(`${logPrefix} hedge fired after ${hedgeDelayMs}ms; winner=secondary`);
          } else {
            this.currentBatchMetrics.primaryUsed++;
          }
        } else {
          // No hedging, use primary only with timeout
          results = await this.withTimeout(
            this.multicall3!.aggregate3.staticCall(chunk, overrides),
            config.chunkTimeoutMs,
            `Chunk ${chunkNum} timeout after ${config.chunkTimeoutMs}ms`
          );
          this.currentBatchMetrics.primaryUsed++;
        }

        const duration = Date.now() - startTime;
        const durationSec = duration / 1000;
        chunkLatency.observe(durationSec);
        this.currentBatchMetrics.latencies.push(duration);

        // Update progress timestamp on successful chunk
        this.lastProgressAt = Date.now();

        this.clearRateLimitTracking();
        // eslint-disable-next-line no-console
        console.log(`${logPrefix} Chunk ${chunkNum}/${totalChunks} complete (${chunk.length} calls, ${durationSec.toFixed(2)}s, provider=${usedProvider})`);
        return results;
      } catch (err) {
        const isTimeout = err instanceof Error && err.message.includes('timeout');

        if (isTimeout) {
          chunkTimeoutsTotal.inc();
          this.currentBatchMetrics.timeouts++;
          // eslint-disable-next-line no-console
          console.warn(`${logPrefix} timeout run=${this.currentRunId} block=${this.currentBlockNumber || 'unknown'} chunk ${chunkNum}/${totalChunks} after ${config.chunkTimeoutMs}ms (attempt ${attempt + 1}/${maxAttempts})`);
        }

        if (this.isRateLimitError(err)) {
          this.handleRateLimit();
        }

        // Try secondary provider on first timeout or rate-limit if available (fallback, not hedging)
        // Note: Only use fallback mode when hedging is disabled (headCheckHedgeMs === 0)
        // to avoid double-requesting to secondary (once via hedge, once via fallback)
        if ((isTimeout || this.isRateLimitError(err)) && attempt === 0 && this.secondaryMulticall3 && config.headCheckHedgeMs === 0) {
          try {
            // eslint-disable-next-line no-console
            console.log(`${logPrefix} Chunk ${chunkNum} trying secondary provider (fallback)`);
            const secondaryStartTime = Date.now();
            
            const results = await this.withTimeout(
              this.secondaryMulticall3.aggregate3.staticCall(chunk, overrides),
              config.chunkTimeoutMs,
              `Chunk ${chunkNum} secondary timeout after ${config.chunkTimeoutMs}ms`
            );

            const secondaryDuration = Date.now() - secondaryStartTime;
            const secondaryDurationSec = secondaryDuration / 1000;
            chunkLatency.observe(secondaryDurationSec);
            this.currentBatchMetrics.latencies.push(secondaryDuration);
            this.currentBatchMetrics.secondaryUsed++;

            // Update progress timestamp on successful chunk
            this.lastProgressAt = Date.now();

            this.clearRateLimitTracking();
            // eslint-disable-next-line no-console
            console.log(`${logPrefix} Chunk ${chunkNum}/${totalChunks} complete via secondary (${chunk.length} calls, ${secondaryDurationSec.toFixed(2)}s)`);
            return results;
          } catch (secondaryErr) {
            // eslint-disable-next-line no-console
            console.warn(`${logPrefix} Chunk ${chunkNum} secondary also failed`);
          }
        }

        // If not last attempt, do jittered backoff
        if (attempt < maxAttempts - 1) {
          const baseDelay = 1000 * Math.pow(2, attempt);
          const jitter = Math.random() * baseDelay * 0.3;
          const delayMs = Math.floor(baseDelay + jitter);
          // eslint-disable-next-line no-console
          console.log(`${logPrefix} Chunk ${chunkNum} retrying in ${delayMs}ms (attempt ${attempt + 2}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        // All attempts failed
        if (isTimeout) {
          // eslint-disable-next-line no-console
          console.error(`${logPrefix} Chunk ${chunkNum} failed: all attempts timed out`);
        } else if (this.isRateLimitError(err)) {
          // eslint-disable-next-line no-console
          console.warn(`${logPrefix} Chunk ${chunkNum} failed: rate limit persists after retries`);
        } else {
          // eslint-disable-next-line no-console
          console.error(`${logPrefix} Chunk ${chunkNum} failed:`, err);
        }

        return null;
      }
    }

    return null;
  }

  /**
   * Perform read-only Multicall3 aggregate3 call with automatic chunking,
   * hard timeouts, retry logic, and optional secondary fallback
   * @param calls Array of multicall calls
   * @param chunkSize Optional chunk size override
   * @param blockTag Optional blockTag for consistent reads
   */
  private async multicallAggregate3ReadOnly(
    calls: Array<{ target: string; allowFailure: boolean; callData: string }>,
    chunkSize?: number,
    blockTag?: number | 'pending'
  ): Promise<Array<{ success: boolean; returnData: string }>> {
    if (!this.multicall3 || !this.provider) {
      throw new Error('[realtime-hf] Multicall3 or provider not initialized');
    }

    // Use adaptive chunk size if not specified
    const effectiveChunkSize = chunkSize || this.currentChunkSize;
    
    // Log prefix for unambiguous run tracking
    const logPrefix = this.getLogPrefix();
    
    // Prepare overrides with blockTag if specified
    const overrides = blockTag ? { blockTag } : {};

    // If calls fit in single batch, execute with timeout and retry
    if (calls.length <= effectiveChunkSize) {
      const results = await this.executeChunkWithTimeout(
        calls,
        overrides,
        1,
        1,
        logPrefix
      );

      if (results) {
        return results;
      } else {
        // Chunk failed - return synthetic failures
        return calls.map(() => ({ success: false, returnData: '0x' }));
      }
    }

    // Split into chunks for large batches
    // eslint-disable-next-line no-console
    console.log(`${logPrefix} Chunking ${calls.length} calls into batches of ${effectiveChunkSize}`);
    
    const allResults: Array<{ success: boolean; returnData: string }> = [];
    const totalChunks = Math.ceil(calls.length / effectiveChunkSize);

    for (let i = 0; i < calls.length; i += effectiveChunkSize) {
      const chunk = calls.slice(i, i + effectiveChunkSize);
      const chunkNum = Math.floor(i / effectiveChunkSize) + 1;

      const results = await this.executeChunkWithTimeout(
        chunk,
        overrides,
        chunkNum,
        totalChunks,
        logPrefix
      );

      if (results) {
        allResults.push(...results);
      } else {
        // Chunk failed - add synthetic failures and continue
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
   * @returns Metrics about the batch run
   */
  private async batchCheckCandidates(addresses: string[], triggerType: 'event' | 'head' | 'price', blockTag?: number | 'pending'): Promise<{ timeouts: number; avgLatency: number; candidates: number }> {
    if (!this.multicall3 || !this.provider || addresses.length === 0) {
      return { timeouts: 0, avgLatency: 0, candidates: 0 };
    }

    // Reset batch metrics for this run
    this.currentBatchMetrics = {
      timeouts: 0,
      latencies: [],
      hedges: 0,
      primaryUsed: 0,
      secondaryUsed: 0
    };

    try {
      const aavePoolInterface = new Interface(AAVE_POOL_ABI);
      const calls = addresses.map(addr => ({
        target: config.aavePool,
        allowFailure: true,
        callData: aavePoolInterface.encodeFunctionData('getUserAccountData', [addr])
      }));

      const results = await this.multicallAggregate3ReadOnly(calls, undefined, blockTag);
      const blockNumber = (typeof blockTag === 'number' ? blockTag : undefined) || await this.provider.getBlockNumber();
      let minHF: number | null = null;

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const userAddress = addresses[i];

        if (result.success) {
          try {
            const decoded = aavePoolInterface.decodeFunctionResult('getUserAccountData', result.returnData);
            const totalCollateralBase = decoded[0]; // in base units (ETH equivalent, 8 decimals)
            const totalDebtBase = decoded[1]; // in base units (ETH equivalent, 8 decimals)
            const healthFactorRaw = decoded[5]; // 6th element
            const healthFactor = parseFloat(formatUnits(healthFactorRaw, 18));
            
            // Extract USD values (assuming 8 decimal base units)
            const totalCollateralUsd = parseFloat(formatUnits(totalCollateralBase, 8));
            const totalDebtUsd = parseFloat(formatUnits(totalDebtBase, 8));
            
            // Prune zero-debt users early
            if (isZero(totalDebtBase)) {
              candidatesPrunedZeroDebt.inc();
              continue;
            }
            
            // Prune tiny-debt users
            const minDebtUsd = config.minDebtUsd;
            if (totalDebtUsd < minDebtUsd) {
              candidatesPrunedTinyDebt.inc();
              continue;
            }

            this.candidateManager.updateHF(userAddress, healthFactor);
            this.metrics.healthChecksPerformed++;
            realtimeHealthChecksPerformed.inc();
            
            // Track for low HF recording
            if (this.lowHfTracker && healthFactor < config.alwaysIncludeHfBelow) {
              this.lowHfTracker.record(
                userAddress,
                healthFactor,
                blockNumber,
                triggerType,
                totalCollateralUsd,
                totalDebtUsd
                // Note: reserves data not available without additional RPC calls
              );
            }

            // Track min HF (only for users with debt > 0, excluding infinity HFs)
            // Note: Zero-debt users are already filtered above, so no need to check again
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

            // Per-block dedupe: emit at most once per user per block (Goal 3)
            if (this.seenUsersThisBlock.has(userAddress)) {
              // Already emitted for this user in this block - skip
              continue;
            }

            // Check if we should emit based on edge-triggering and hysteresis
            const emitDecision = this.shouldEmit(userAddress, healthFactor, blockNumber);
            
            if (emitDecision.shouldEmit) {
              // Track that we've seen this user in this block
              this.seenUsersThisBlock.add(userAddress);
              
              // Format HF with infinity symbol for zero debt (though zero debt should be filtered)
              const hfDisplay = isZero(totalDebtBase) ? '∞' : healthFactor.toFixed(4);
              // eslint-disable-next-line no-console
              console.log(`[realtime-hf] emit liquidatable user=${userAddress} hf=${hfDisplay} reason=${emitDecision.reason} block=${blockNumber}`);

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

      // Calculate batch metrics
      const avgLatency = this.currentBatchMetrics.latencies.length > 0
        ? this.currentBatchMetrics.latencies.reduce((a, b) => a + b, 0) / this.currentBatchMetrics.latencies.length
        : 0;

      const totalProviderCalls = this.currentBatchMetrics.primaryUsed + this.currentBatchMetrics.secondaryUsed;
      const primaryShare = totalProviderCalls > 0 
        ? Math.round((this.currentBatchMetrics.primaryUsed / totalProviderCalls) * 100)
        : 100;

      // Enhanced logging with observability metrics (Goal 6)
      // eslint-disable-next-line no-console
      console.log(
        `[realtime-hf] Batch check complete: ${addresses.length} candidates, ` +
        `minHF=${minHF !== null ? minHF.toFixed(4) : 'N/A'}, ` +
        `trigger=${triggerType}, ` +
        `subBatch=${config.multicallBatchSize}, ` +
        `hedges=${this.currentBatchMetrics.hedges}, ` +
        `timeouts=${this.currentBatchMetrics.timeouts}, ` +
        `primaryShare=${primaryShare}%`
      );

      return {
        timeouts: this.currentBatchMetrics.timeouts,
        avgLatency,
        candidates: addresses.length
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] Batch check failed:', err);
      // Do not crash the service - continue runtime
      // The error is already logged above
      return { timeouts: 0, avgLatency: 0, candidates: addresses.length };
    }
  }

  /**
   * Start periodic seeding from subgraph with SubgraphSeeder (only when USE_SUBGRAPH=true)
   */
  private startPeriodicSeeding(): void {
    if (!config.useSubgraph || !this.subgraphSeeder) {
      return;
    }

    // Convert minutes to milliseconds for setInterval
    const SECONDS_PER_MINUTE = 60;
    const MILLISECONDS_PER_SECOND = 1000;
    const intervalMs = config.subgraphRefreshMinutes * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
    
    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] Starting periodic subgraph seeding (interval=${config.subgraphRefreshMinutes} minutes)`);
    
    // Initial seed (already done in performInitialSeeding, but log it)
    // No need to seed again here since performInitialSeeding just ran

    // Periodic seed with jitter
    this.seedTimer = setInterval(() => {
      if (this.isShuttingDown) return;
      
      // Add jitter (±20% of interval)
      const jitter = Math.random() * 0.4 - 0.2; // -0.2 to +0.2
      const delay = Math.max(0, intervalMs * jitter);
      
      setTimeout(() => {
        if (!this.isShuttingDown) {
          this.seedFromSubgraphSeeder().catch(err => {
            // eslint-disable-next-line no-console
            console.error('[realtime-hf] Periodic seed failed:', err);
          });
        }
      }, delay);
    }, intervalMs);
  }

  /**
   * Seed candidates from subgraph using SubgraphSeeder
   */
  private async seedFromSubgraphSeeder(): Promise<void> {
    if (!this.subgraphSeeder || this.isShuttingDown) return;

    try {
      const seedBefore = this.candidateManager.size();

      // Perform comprehensive seeding with SubgraphSeeder
      const userAddresses = await this.subgraphSeeder.seed();
      
      if (userAddresses.length > 0) {
        this.candidateManager.addBulk(userAddresses);
        const newCount = this.candidateManager.size() - seedBefore;
        
        // Get metrics from seeder
        const metrics = this.subgraphSeeder.getMetrics();
        if (metrics) {
          // eslint-disable-next-line no-console
          console.log(
            `[realtime-hf] seed_source=subgraph_seeder ` +
            `candidates_total=${this.candidateManager.size()} ` +
            `new=${newCount} ` +
            `variable_debt=${metrics.variableDebtors} ` +
            `stable_debt=${metrics.stableDebtors} ` +
            `collateral=${metrics.collateralHolders}`
          );
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[realtime-hf] SubgraphSeeder seed failed:', err);
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
   * Perform feed discovery and initialize BorrowersIndexService
   */
  private async performFeedDiscovery(): Promise<void> {
    if (!this.provider || !(this.provider instanceof JsonRpcProvider || this.provider instanceof WebSocketProvider)) {
      throw new Error('[feed-discovery] Provider not initialized');
    }

    // Initialize AaveDataService if not already done
    if (!this.aaveDataService) {
      this.aaveDataService = new AaveDataService(this.provider as JsonRpcProvider);
    }

    // Initialize FeedDiscoveryService
    this.feedDiscoveryService = new FeedDiscoveryService(
      this.provider as JsonRpcProvider,
      this.aaveDataService
    );

    // Discover reserves
    this.discoveredReserves = await this.feedDiscoveryService.discoverReserves({
      skipInactive: true,
      onlyBorrowEnabled: true
    });

    // Initialize BorrowersIndexService with discovered reserves (if enabled)
    if (config.borrowersIndexEnabled && this.discoveredReserves.length > 0) {
      try {
        // eslint-disable-next-line no-console
        console.log(`[borrowers-index] Initializing with ${this.discoveredReserves.length} reserves`);

        const reserves = this.discoveredReserves.map(r => ({
          asset: r.asset,
          symbol: r.symbol,
          variableDebtToken: r.variableDebtToken
        }));

        this.borrowersIndex = new BorrowersIndexService(
          this.provider as JsonRpcProvider,
          {
            mode: config.borrowersIndexMode as 'memory' | 'redis' | 'postgres',
            redisUrl: config.borrowersIndexRedisUrl,
            databaseUrl: config.databaseUrl,
            backfillBlocks: config.borrowersIndexBackfillBlocks,
            chunkSize: config.borrowersIndexChunkBlocks,
            maxUsersPerReserve: config.borrowersIndexMaxUsersPerReserve
          }
        );

        await this.borrowersIndex.initialize(reserves);
        // eslint-disable-next-line no-console
        console.log('[borrowers-index] Initialized successfully');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[borrowers-index] Failed to initialize:', err);
        // Continue without BorrowersIndexService
        this.borrowersIndex = undefined;
      }
    } else if (!config.borrowersIndexEnabled) {
      // eslint-disable-next-line no-console
      console.log('[borrowers-index] Disabled via BORROWERS_INDEX_ENABLED=false');
    }
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

  /**
   * Get low HF tracker (for API endpoints)
   */
  getLowHFTracker(): LowHFTracker | undefined {
    return this.lowHfTracker;
  }
}
