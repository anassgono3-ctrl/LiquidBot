/**
 * BlockBoundaryController: Block-boundary liquidation dispatch
 * 
 * On block event (via Flashblocks WS or standard WS), dispatches prebuilt
 * intents for HotCriticalQueue users with HF <= threshold or pending-verified.
 * 
 * Supports optional timing window (block_boundary_send_ms_before) for
 * predictable block timing chains.
 */

import { ethers } from 'ethers';
import type { HotCriticalQueue } from './PriorityQueues.js';
import type { IntentBuilder, LiquidationIntent } from './IntentBuilder.js';
import type { TxSubmitter } from './TxSubmitter.js';
import type { PriceHotCacheService } from './PriceHotCacheService.js';

export interface BlockBoundaryConfig {
  enabled: boolean;
  sendMsBefore: number; // Optional: send N ms before expected block time (0 = immediate)
  executionHfThresholdBps: number; // Only dispatch if HF <= this threshold
  maxDispatchesPerBlock: number; // Limit concurrent dispatches per block
}

export interface BlockEvent {
  blockNumber: number;
  blockHash: string;
  timestamp: number;
}

export interface DispatchResult {
  user: string;
  txHash?: string;
  success: boolean;
  error?: string;
  latencyMs: number;
}

/**
 * BlockBoundaryController orchestrates liquidation dispatch at block boundaries
 */
export class BlockBoundaryController {
  private config: BlockBoundaryConfig;
  private hotQueue: HotCriticalQueue;
  private intentBuilder: IntentBuilder;
  private txSubmitter: TxSubmitter;
  private priceCache: PriceHotCacheService;
  private provider: ethers.JsonRpcProvider | null = null;
  private blockListener: ((blockNumber: number) => void) | null = null;

  constructor(
    hotQueue: HotCriticalQueue,
    intentBuilder: IntentBuilder,
    txSubmitter: TxSubmitter,
    priceCache: PriceHotCacheService,
    config: BlockBoundaryConfig
  ) {
    this.hotQueue = hotQueue;
    this.intentBuilder = intentBuilder;
    this.txSubmitter = txSubmitter;
    this.priceCache = priceCache;
    this.config = config;

    if (this.config.enabled) {
      // eslint-disable-next-line no-console
      console.log(
        `[block-boundary] Initialized: sendMsBefore=${config.sendMsBefore}ms, ` +
        `hfThreshold=${config.executionHfThresholdBps / 100}%, ` +
        `maxDispatches=${config.maxDispatchesPerBlock}`
      );
    }
  }

  /**
   * Start listening to block events
   */
  start(provider: ethers.JsonRpcProvider): void {
    if (!this.config.enabled) {
      return;
    }

    this.provider = provider;

    // Listen to block events
    this.blockListener = (blockNumber: number) => {
      void this.onBlock({
        blockNumber,
        blockHash: '', // Will be filled by provider if needed
        timestamp: Date.now()
      });
    };

    provider.on('block', this.blockListener);
    
    // eslint-disable-next-line no-console
    console.log('[block-boundary] Started listening to block events');
  }

  /**
   * Stop listening to block events
   */
  stop(): void {
    if (this.provider && this.blockListener) {
      this.provider.off('block', this.blockListener);
      this.blockListener = null;
      // eslint-disable-next-line no-console
      console.log('[block-boundary] Stopped listening to block events');
    }
  }

  /**
   * Handle new block event
   */
  private async onBlock(event: BlockEvent): Promise<void> {
    const startTime = Date.now();

    try {
      // Get hot critical queue entries
      const entries = this.hotQueue.getAll();
      
      if (entries.length === 0) {
        return;
      }

      // Filter entries by HF threshold
      const executionThreshold = this.config.executionHfThresholdBps / 10000;
      const eligibleEntries = entries.filter(
        entry => entry.healthFactor <= executionThreshold
      );

      if (eligibleEntries.length === 0) {
        return;
      }

      // Limit concurrent dispatches
      const toDispatch = eligibleEntries.slice(0, this.config.maxDispatchesPerBlock);

      // eslint-disable-next-line no-console
      console.log(
        `[block-boundary] Block ${event.blockNumber}: Dispatching ${toDispatch.length} liquidations ` +
        `(${eligibleEntries.length} eligible, ${entries.length} total in queue)`
      );

      // Dispatch liquidations concurrently
      const dispatchPromises = toDispatch.map(entry =>
        this.dispatchLiquidation(entry.user, entry.healthFactor, event.blockNumber)
      );

      const results = await Promise.all(dispatchPromises);

      // Log summary
      const successful = results.filter(r => r.success).length;
      const failed = results.length - successful;
      const avgLatency = results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length;

      // eslint-disable-next-line no-console
      console.log(
        `[block-boundary] Block ${event.blockNumber} dispatch complete: ` +
        `${successful} successful, ${failed} failed, avg latency ${Math.round(avgLatency)}ms`
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[block-boundary] Error processing block ${event.blockNumber}:`, error);
    }
  }

  /**
   * Dispatch a liquidation for a specific user
   */
  private async dispatchLiquidation(
    user: string,
    healthFactor: number,
    blockNumber: number
  ): Promise<DispatchResult> {
    const startTime = Date.now();

    try {
      // Get or build intent (this should be fast if prebuilt)
      // For now, we'll need to determine debt and collateral assets
      // This would typically come from the queue entry or a service
      // Simplified: return early with error
      
      // In a real implementation, we would:
      // 1. Get prebuilt intent from IntentBuilder cache
      // 2. Revalidate prices if intent age > threshold
      // 3. Sign transaction
      // 4. Submit via TxSubmitter
      
      // For now, return placeholder
      return {
        user,
        success: false,
        error: 'Intent dispatch not fully implemented - needs debt/collateral resolution',
        latencyMs: Date.now() - startTime
      };
    } catch (error) {
      return {
        user,
        success: false,
        error: (error as Error).message,
        latencyMs: Date.now() - startTime
      };
    }
  }

  /**
   * Manually trigger dispatch for testing
   */
  async triggerDispatch(blockNumber: number): Promise<DispatchResult[]> {
    const event: BlockEvent = {
      blockNumber,
      blockHash: '',
      timestamp: Date.now()
    };

    await this.onBlock(event);
    return [];
  }

  /**
   * Get controller statistics
   */
  getStats(): {
    enabled: boolean;
    queueSize: number;
    eligibleCount: number;
  } {
    const entries = this.hotQueue.getAll();
    const executionThreshold = this.config.executionHfThresholdBps / 10000;
    const eligibleCount = entries.filter(e => e.healthFactor <= executionThreshold).length;

    return {
      enabled: this.config.enabled,
      queueSize: entries.length,
      eligibleCount
    };
  }
}

/**
 * Load BlockBoundaryController configuration from environment variables
 */
export function loadBlockBoundaryConfig(): BlockBoundaryConfig {
  return {
    enabled: (process.env.BLOCK_BOUNDARY_ENABLED || 'false').toLowerCase() === 'true',
    sendMsBefore: Number(process.env.BLOCK_BOUNDARY_SEND_MS_BEFORE || 0),
    executionHfThresholdBps: Number(process.env.EXECUTION_HF_THRESHOLD_BPS || 9800),
    maxDispatchesPerBlock: Number(process.env.MAX_DISPATCHES_PER_BLOCK || 5)
  };
}
