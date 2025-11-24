/**
 * PriorityQueues: Hot-critical and warm-projected queue system
 * 
 * Manages priority-based queues for liquidation candidates:
 * - HotCriticalQueue: Users with HF <= threshold OR projected to cross < 1.0 within 1-2 blocks
 * - WarmProjectedQueue: Users close but not immediate (HF between hot threshold and warm threshold)
 * 
 * HotCriticalQueue preempts bulk head/price-trigger scans for ultra-low latency execution.
 */

export interface QueueEntry {
  user: string;
  healthFactor: number;
  blockNumber: number;
  timestamp: number;
  totalCollateralUsd: number;
  totalDebtUsd: number;
  // Projection data (optional)
  projectedHF?: number;
  blocksUntilCritical?: number;
  volatilityScore?: number;
  // Entry metadata
  entryReason: 'hf_threshold' | 'volatility_projection' | 'price_trigger' | 'reserve_update' | 'predictive_scenario';
  priority: number; // Lower = higher priority
  // Predictive metadata (optional)
  predictiveScenario?: string;
  predictiveEtaSec?: number;
}

export interface PriorityQueueConfig {
  // Hot critical thresholds
  hotHfThresholdBps: number; // e.g., 10012 = 1.0012
  // Warm projected thresholds
  warmHfThresholdBps: number; // e.g., 10300 = 1.03
  // Volatility projection settings
  preSim: {
    enabled: boolean;
    hfWindow: number; // e.g., 1.01
    bufferBps: number; // e.g., 50 bps
  };
  // Queue size limits
  maxHotSize: number;
  maxWarmSize: number;
  // Minimum debt filter
  minLiqExecUsd: number;
}

/**
 * HotCriticalQueue: Users meeting immediate liquidation criteria
 */
export class HotCriticalQueue {
  private queue: Map<string, QueueEntry> = new Map();
  private config: PriorityQueueConfig;

  constructor(config: PriorityQueueConfig) {
    this.config = config;
  }

  /**
   * Add or update an entry in the hot critical queue
   */
  upsert(entry: QueueEntry): boolean {
    const normalized = entry.user.toLowerCase();
    
    // Check if entry qualifies for hot critical queue
    if (!this.qualifies(entry)) {
      return false;
    }

    // Check debt threshold
    if (entry.totalDebtUsd < this.config.minLiqExecUsd) {
      return false;
    }

    // Enforce max size by evicting lowest priority entries
    if (this.queue.size >= this.config.maxHotSize && !this.queue.has(normalized)) {
      this.evictLowestPriority();
    }

    this.queue.set(normalized, {
      ...entry,
      user: normalized,
      timestamp: Date.now()
    });

    return true;
  }

  /**
   * Check if an entry qualifies for hot critical queue
   */
  private qualifies(entry: QueueEntry): boolean {
    const hotThreshold = this.config.hotHfThresholdBps / 10000;

    // Check 1: HF <= hot threshold
    if (entry.healthFactor <= hotThreshold) {
      return true;
    }

    // Check 2: Projected to cross < 1.0 within 1-2 blocks (if volatility projection present)
    if (
      this.config.preSim.enabled &&
      entry.projectedHF !== undefined &&
      entry.blocksUntilCritical !== undefined
    ) {
      if (entry.projectedHF < 1.0 && entry.blocksUntilCritical <= 2) {
        return true;
      }
    }

    return false;
  }

  /**
   * Remove an entry
   */
  remove(user: string): boolean {
    return this.queue.delete(user.toLowerCase());
  }

  /**
   * Get all entries sorted by priority (ascending = highest priority first)
   */
  getAll(): QueueEntry[] {
    return Array.from(this.queue.values()).sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get entry by user address
   */
  get(user: string): QueueEntry | undefined {
    return this.queue.get(user.toLowerCase());
  }

  /**
   * Check if user is in queue
   */
  has(user: string): boolean {
    return this.queue.has(user.toLowerCase());
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.queue.size;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.queue.clear();
  }

  /**
   * Evict lowest priority entry to make room
   */
  private evictLowestPriority(): void {
    let lowestPriority = -Infinity;
    let lowestUser: string | null = null;

    for (const [user, entry] of this.queue.entries()) {
      if (entry.priority > lowestPriority) {
        lowestPriority = entry.priority;
        lowestUser = user;
      }
    }

    if (lowestUser) {
      this.queue.delete(lowestUser);
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    size: number;
    avgHF: number;
    minHF: number;
    avgDebtUsd: number;
    reasonBreakdown: Record<string, number>;
  } {
    const entries = this.getAll();
    
    if (entries.length === 0) {
      return {
        size: 0,
        avgHF: 0,
        minHF: 0,
        avgDebtUsd: 0,
        reasonBreakdown: {}
      };
    }

    const reasonBreakdown: Record<string, number> = {};
    let sumHF = 0;
    let minHF = Infinity;
    let sumDebt = 0;

    for (const entry of entries) {
      sumHF += entry.healthFactor;
      minHF = Math.min(minHF, entry.healthFactor);
      sumDebt += entry.totalDebtUsd;
      reasonBreakdown[entry.entryReason] = (reasonBreakdown[entry.entryReason] || 0) + 1;
    }

    return {
      size: entries.length,
      avgHF: sumHF / entries.length,
      minHF,
      avgDebtUsd: sumDebt / entries.length,
      reasonBreakdown
    };
  }
}

/**
 * WarmProjectedQueue: Users approaching liquidation but not immediate
 */
export class WarmProjectedQueue {
  private queue: Map<string, QueueEntry> = new Map();
  private config: PriorityQueueConfig;

  constructor(config: PriorityQueueConfig) {
    this.config = config;
  }

  /**
   * Add or update an entry in the warm projected queue
   */
  upsert(entry: QueueEntry): boolean {
    const normalized = entry.user.toLowerCase();
    
    // Check if entry qualifies for warm queue
    if (!this.qualifies(entry)) {
      return false;
    }

    // Check debt threshold
    if (entry.totalDebtUsd < this.config.minLiqExecUsd) {
      return false;
    }

    // Enforce max size
    if (this.queue.size >= this.config.maxWarmSize && !this.queue.has(normalized)) {
      this.evictLowestPriority();
    }

    this.queue.set(normalized, {
      ...entry,
      user: normalized,
      timestamp: Date.now()
    });

    return true;
  }

  /**
   * Check if an entry qualifies for warm queue
   */
  private qualifies(entry: QueueEntry): boolean {
    const hotThreshold = this.config.hotHfThresholdBps / 10000;
    const warmThreshold = this.config.warmHfThresholdBps / 10000;

    // Must be above hot threshold but below warm threshold
    return entry.healthFactor > hotThreshold && entry.healthFactor <= warmThreshold;
  }

  /**
   * Remove an entry
   */
  remove(user: string): boolean {
    return this.queue.delete(user.toLowerCase());
  }

  /**
   * Get all entries sorted by priority
   */
  getAll(): QueueEntry[] {
    return Array.from(this.queue.values()).sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get entry by user address
   */
  get(user: string): QueueEntry | undefined {
    return this.queue.get(user.toLowerCase());
  }

  /**
   * Check if user is in queue
   */
  has(user: string): boolean {
    return this.queue.has(user.toLowerCase());
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.queue.size;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.queue.clear();
  }

  /**
   * Evict lowest priority entry
   */
  private evictLowestPriority(): void {
    let lowestPriority = -Infinity;
    let lowestUser: string | null = null;

    for (const [user, entry] of this.queue.entries()) {
      if (entry.priority > lowestPriority) {
        lowestPriority = entry.priority;
        lowestUser = user;
      }
    }

    if (lowestUser) {
      this.queue.delete(lowestUser);
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    size: number;
    avgHF: number;
    minHF: number;
    avgDebtUsd: number;
  } {
    const entries = this.getAll();
    
    if (entries.length === 0) {
      return {
        size: 0,
        avgHF: 0,
        minHF: 0,
        avgDebtUsd: 0
      };
    }

    let sumHF = 0;
    let minHF = Infinity;
    let sumDebt = 0;

    for (const entry of entries) {
      sumHF += entry.healthFactor;
      minHF = Math.min(minHF, entry.healthFactor);
      sumDebt += entry.totalDebtUsd;
    }

    return {
      size: entries.length,
      avgHF: sumHF / entries.length,
      minHF,
      avgDebtUsd: sumDebt / entries.length
    };
  }
}

/**
 * Load priority queue configuration from environment variables
 */
export function loadPriorityQueueConfig(): PriorityQueueConfig {
  // Use FAST_LANE_HF_BUFFER_BPS as fallback for HOT_HF_THRESHOLD_BPS
  const fastLaneBuffer = Number(process.env.FAST_LANE_HF_BUFFER_BPS || 0);
  const hotHfThresholdBps = Number(
    process.env.HOT_HF_THRESHOLD_BPS ||
    (fastLaneBuffer > 0 ? 10000 + fastLaneBuffer : 10012)
  );

  return {
    hotHfThresholdBps,
    warmHfThresholdBps: Number(process.env.WARM_SET_HF_MAX || 1.03) * 10000,
    preSim: {
      enabled: (process.env.PRE_SIM_ENABLED || 'true').toLowerCase() === 'true',
      hfWindow: Number(process.env.PRE_SIM_HF_WINDOW || 1.01),
      bufferBps: Number(process.env.FAST_LANE_HF_BUFFER_BPS || 50)
    },
    maxHotSize: Number(process.env.MAX_HOT_SIZE || 1000),
    maxWarmSize: Number(process.env.MAX_WARM_SIZE || 5000),
    minLiqExecUsd: Number(process.env.MIN_LIQ_EXEC_USD || 50)
  };
}
