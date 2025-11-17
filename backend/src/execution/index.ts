/**
 * Execution module: Ultra-low-latency execution path for one-block liquidation races
 * 
 * This module provides a dedicated execution path for competitive liquidation capture:
 * - ExecutionRpcPool: Separate RPC management for public/private endpoints
 * - TxSubmitter: Multi-mode transaction submission (public/private/race/bundle)
 * - PriorityQueues: Hot-critical and warm-projected queue system
 * - IntentBuilder: Prebuilt liquidation intents with caching
 * - PriceHotCacheService: Sub-second price cache for hot accounts
 * - BlockBoundaryController: Block-boundary liquidation dispatch
 * 
 * All features are opt-in via feature flags and preserve existing defaults.
 */

// RPC Management
export {
  ExecutionRpcPool,
  loadExecutionRpcPool,
  type ExecutionRpcConfig,
  type RpcEndpoint
} from './ExecutionRpcPool.js';

// Transaction Submission
export {
  TxSubmitter,
  loadTxSubmitConfig,
  type TxSubmitMode,
  type TxSubmitConfig,
  type TxSubmitResult
} from './TxSubmitter.js';

// Priority Queues
export {
  HotCriticalQueue,
  WarmProjectedQueue,
  loadPriorityQueueConfig,
  type QueueEntry,
  type PriorityQueueConfig
} from './PriorityQueues.js';

// Intent Building
export {
  IntentBuilder,
  loadIntentBuilderConfig,
  type LiquidationIntent,
  type IntentBuilderConfig
} from './IntentBuilder.js';

// Price Cache
export {
  PriceHotCacheService,
  loadPriceHotCacheConfig,
  type PriceHotCacheConfig
} from './PriceHotCacheService.js';

// Block Boundary Controller
export {
  BlockBoundaryController,
  loadBlockBoundaryConfig,
  type BlockBoundaryConfig,
  type BlockEvent,
  type DispatchResult
} from './BlockBoundaryController.js';
