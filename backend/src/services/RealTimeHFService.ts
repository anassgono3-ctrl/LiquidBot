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
  realtimeMinHealthFactor
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
  private subscriptions: string[] = [];
  private skipWsConnection: boolean;

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
      await this.setupSubscriptions();
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

    // Unsubscribe from all subscriptions
    if (this.provider instanceof WebSocketProvider) {
      for (const subId of this.subscriptions) {
        try {
          await this.provider.send('eth_unsubscribe', [subId]);
        } catch (err) {
          // Ignore errors during unsubscribe
        }
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
   * Setup WebSocket subscriptions (newHeads, Aave Pool logs, Chainlink feeds)
   */
  private async setupSubscriptions(): Promise<void> {
    if (!this.provider || !(this.provider instanceof WebSocketProvider)) {
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] No WebSocket provider, skipping subscriptions');
      return;
    }

    try {
      // Subscribe to newHeads for canonical rechecks
      const headsSub = await this.provider.send('eth_subscribe', ['newHeads']);
      this.subscriptions.push(headsSub);
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Subscribed to newHeads');

      // Subscribe to Aave Pool logs
      // Get all registered event topics from EventRegistry
      const aaveTopics = eventRegistry.getAllTopics().filter(topic => {
        const entry = eventRegistry.get(topic);
        // Filter to only Aave events (exclude Chainlink)
        return entry && entry.name !== 'AnswerUpdated';
      });
      
      const logsFilter = {
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

      const logsSub = await this.provider.send('eth_subscribe', ['logs', logsFilter]);
      this.subscriptions.push(logsSub);
      // eslint-disable-next-line no-console
      console.log('[realtime-hf] Subscribed to Aave Pool logs');

      // Optional: Subscribe to Chainlink price feeds
      if (config.chainlinkFeeds) {
        const feeds = this.parseChainlinkFeeds(config.chainlinkFeeds);
        // Get AnswerUpdated topic from event registry
        const answerUpdatedTopic = Array.from(eventRegistry.getAllTopics()).find(topic => {
          const entry = eventRegistry.get(topic);
          return entry && entry.name === 'AnswerUpdated';
        });
        
        for (const [token, feedAddress] of Object.entries(feeds)) {
          try {
            const priceFeedFilter = {
              address: feedAddress,
              topics: [
                answerUpdatedTopic || new Interface(CHAINLINK_AGG_ABI).getEvent('AnswerUpdated')?.topicHash || ''
              ]
            };
            const priceSub = await this.provider.send('eth_subscribe', ['logs', priceFeedFilter]);
            this.subscriptions.push(priceSub);
            // eslint-disable-next-line no-console
            console.log(`[realtime-hf] Subscribed to Chainlink feed for ${token}`);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`[realtime-hf] Failed to subscribe to Chainlink feed for ${token}:`, err);
          }
        }
      }

      // Setup message handler
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.provider.on('message', (message: { type: string; data: any }) => {
        if (this.isShuttingDown) return;
        this.handleSubscriptionMessage(message).catch(err => {
          // eslint-disable-next-line no-console
          console.error('[realtime-hf] Error handling subscription message:', err);
        });
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[realtime-hf] Failed to setup subscriptions:', err);
      throw err;
    }
  }

  /**
   * Handle subscription messages (newHeads, logs)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleSubscriptionMessage(message: { type: string; data: any }): Promise<void> {
    if (message.type === 'eth_subscription') {
      const result = message.data?.result;
      if (!result) return;

      // Check if it's a newHead block
      if (result.number) {
        this.metrics.blocksReceived++;
        await this.handleNewHead(result);
      }
      // Check if it's a log
      else if (result.topics) {
        const log = result as EventLog;
        await this.handleLog(log);
      }
    }
  }

  /**
   * Handle newHeads block notification - perform canonical recheck
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleNewHead(block: any): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[realtime-hf] New block ${block.number}`);

    realtimeBlocksReceived.inc();

    // Perform batch check on all candidates
    await this.checkAllCandidates('head');
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

      const results = await this.multicall3.aggregate3(calls);
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

            // Check if below threshold
            if (healthFactor < threshold) {
              // eslint-disable-next-line no-console
              console.log(`[realtime-hf] User ${userAddress} liquidatable: HF=${healthFactor.toFixed(4)} (trigger=${triggerType})`);

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
        .then(() => this.setupSubscriptions())
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
