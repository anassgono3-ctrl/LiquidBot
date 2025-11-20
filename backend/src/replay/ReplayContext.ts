/**
 * ReplayContext - Manages state for historical replay execution
 * 
 * Tracks first detection blocks, user health factor history, eviction counters,
 * and simulation results across the replay block range.
 */

export interface UserDetectionState {
  firstDetectionBlock: number | null;
  hfAtDetection: number | null;
  debtAtDetection: number | null;
  collateralAtDetection: number | null;
  simulationStatus: 'ok' | 'revert' | 'skipped';
  revertReason: string;
  detectionProfitUSD: number | null;
}

export interface LiquidationEventData {
  block: number;
  txHash: string;
  debtAsset: string;
  collateralAsset: string;
  debtCovered: bigint;
  collateralSeized: bigint;
  liquidator: string;
  hfAtLiquidation: number | null;
  eventProfitUSD: number | null;
}

export interface UserEvictionState {
  consecutiveHighHfBlocks: number;
  lastHf: number;
  lastBlock: number;
}

export interface CandidateMetrics {
  detected: number;
  missed: number;
  falsePositives: number;
  groundTruthCount: number;
  raceViableCount: number;
  detectionProfitTotalUSD: number;
  eventProfitTotalUSD: number;
  leadBlocksSum: number;
  leadBlocksCount: number;
  leadBlocksList: number[];
}

/**
 * ReplayContext maintains all state for a replay run
 */
export class ReplayContext {
  // Detection tracking: user -> detection state
  private detections = new Map<string, UserDetectionState>();
  
  // Ground truth events: user -> liquidation event data
  private liquidationEvents = new Map<string, LiquidationEventData>();
  
  // Eviction state: user -> eviction counter state
  private evictionState = new Map<string, UserEvictionState>();
  
  // Active user universe for current block
  private activeUsers = new Set<string>();
  
  // Per-block metrics for reporting
  private blockMetrics = new Map<number, {
    candidates: number;
    newDetections: number;
    onChainLiquidations: number;
    scanLatencyMs: number;
  }>();
  
  constructor(
    private readonly nearHf: number,
    private readonly evictHf: number,
    private readonly evictConsecutive: number
  ) {}
  
  /**
   * Record first detection for a user
   */
  recordFirstDetection(
    user: string,
    block: number,
    hf: number,
    debtUSD: number,
    collateralUSD: number
  ): void {
    if (!this.detections.has(user)) {
      this.detections.set(user, {
        firstDetectionBlock: block,
        hfAtDetection: hf,
        debtAtDetection: debtUSD,
        collateralAtDetection: collateralUSD,
        simulationStatus: 'skipped',
        revertReason: '',
        detectionProfitUSD: null
      });
    }
  }
  
  /**
   * Update simulation result for a user
   */
  updateSimulation(
    user: string,
    status: 'ok' | 'revert' | 'skipped',
    revertReason: string = '',
    profitUSD: number | null = null
  ): void {
    const state = this.detections.get(user);
    if (state) {
      state.simulationStatus = status;
      state.revertReason = revertReason;
      if (profitUSD !== null) {
        state.detectionProfitUSD = profitUSD;
      }
    }
  }
  
  /**
   * Record ground truth liquidation event
   */
  recordLiquidationEvent(
    user: string,
    block: number,
    txHash: string,
    debtAsset: string,
    collateralAsset: string,
    debtCovered: bigint,
    collateralSeized: bigint,
    liquidator: string
  ): void {
    // Only record earliest liquidation for each user
    if (!this.liquidationEvents.has(user)) {
      this.liquidationEvents.set(user, {
        block,
        txHash,
        debtAsset,
        collateralAsset,
        debtCovered,
        collateralSeized,
        liquidator,
        hfAtLiquidation: null,
        eventProfitUSD: null
      });
    }
  }
  
  /**
   * Update liquidation event with computed values
   */
  updateLiquidationEvent(
    user: string,
    hfAtLiquidation: number,
    eventProfitUSD: number
  ): void {
    const event = this.liquidationEvents.get(user);
    if (event) {
      event.hfAtLiquidation = hfAtLiquidation;
      event.eventProfitUSD = eventProfitUSD;
    }
  }
  
  /**
   * Add user to active universe
   */
  addUser(user: string): void {
    this.activeUsers.add(user);
  }
  
  /**
   * Remove user from active universe
   */
  removeUser(user: string): void {
    this.activeUsers.delete(user);
    this.evictionState.delete(user);
  }
  
  /**
   * Get current active users
   */
  getActiveUsers(): Set<string> {
    return new Set(this.activeUsers);
  }
  
  /**
   * Update eviction state for a user based on current HF
   */
  updateEvictionState(user: string, block: number, hf: number): void {
    const current = this.evictionState.get(user);
    
    if (hf > this.evictHf) {
      // HF above eviction threshold
      if (current) {
        current.consecutiveHighHfBlocks++;
        current.lastHf = hf;
        current.lastBlock = block;
      } else {
        this.evictionState.set(user, {
          consecutiveHighHfBlocks: 1,
          lastHf: hf,
          lastBlock: block
        });
      }
    } else if (hf < this.nearHf) {
      // HF below near threshold, reset counter
      this.evictionState.set(user, {
        consecutiveHighHfBlocks: 0,
        lastHf: hf,
        lastBlock: block
      });
    } else {
      // In between, maintain state
      if (current) {
        current.lastHf = hf;
        current.lastBlock = block;
      }
    }
  }
  
  /**
   * Check if user should be evicted from active universe
   */
  shouldEvict(user: string): boolean {
    const state = this.evictionState.get(user);
    return state !== undefined && state.consecutiveHighHfBlocks >= this.evictConsecutive;
  }
  
  /**
   * Get detection state for a user
   */
  getDetectionState(user: string): UserDetectionState | undefined {
    return this.detections.get(user);
  }
  
  /**
   * Get liquidation event for a user
   */
  getLiquidationEvent(user: string): LiquidationEventData | undefined {
    return this.liquidationEvents.get(user);
  }
  
  /**
   * Get all ground truth users
   */
  getGroundTruthUsers(): string[] {
    return Array.from(this.liquidationEvents.keys());
  }
  
  /**
   * Get all detected users
   */
  getDetectedUsers(): string[] {
    return Array.from(this.detections.keys());
  }
  
  /**
   * Record per-block metrics
   */
  recordBlockMetrics(
    block: number,
    candidates: number,
    newDetections: number,
    onChainLiquidations: number,
    scanLatencyMs: number
  ): void {
    this.blockMetrics.set(block, {
      candidates,
      newDetections,
      onChainLiquidations,
      scanLatencyMs
    });
  }
  
  /**
   * Compute comprehensive replay metrics
   */
  computeMetrics(): CandidateMetrics {
    const metrics: CandidateMetrics = {
      detected: 0,
      missed: 0,
      falsePositives: 0,
      groundTruthCount: this.liquidationEvents.size,
      raceViableCount: 0,
      detectionProfitTotalUSD: 0,
      eventProfitTotalUSD: 0,
      leadBlocksSum: 0,
      leadBlocksCount: 0,
      leadBlocksList: []
    };
    
    // Classify ground truth events
    for (const [user, event] of this.liquidationEvents.entries()) {
      const detection = this.detections.get(user);
      
      if (detection && detection.firstDetectionBlock !== null && detection.firstDetectionBlock <= event.block) {
        // Detected
        metrics.detected++;
        const leadBlocks = event.block - detection.firstDetectionBlock;
        metrics.leadBlocksSum += leadBlocks;
        metrics.leadBlocksCount++;
        metrics.leadBlocksList.push(leadBlocks);
        
        // Check if race viable
        if (detection.simulationStatus === 'ok' && detection.detectionProfitUSD !== null && detection.detectionProfitUSD > 0) {
          metrics.raceViableCount++;
        }
      } else {
        // Missed
        metrics.missed++;
      }
      
      // Sum event profit
      if (event.eventProfitUSD !== null) {
        metrics.eventProfitTotalUSD += event.eventProfitUSD;
      }
    }
    
    // Count false positives (detected but no liquidation event)
    for (const [user, detection] of this.detections.entries()) {
      if (!this.liquidationEvents.has(user)) {
        metrics.falsePositives++;
      }
      
      // Sum detection profit
      if (detection.detectionProfitUSD !== null) {
        metrics.detectionProfitTotalUSD += detection.detectionProfitUSD;
      }
    }
    
    return metrics;
  }
  
  /**
   * Get classification for a specific user
   */
  classifyUser(user: string): 'detected' | 'missed' | 'false_positive' | 'pending' {
    const hasEvent = this.liquidationEvents.has(user);
    const detection = this.detections.get(user);
    
    if (hasEvent) {
      const event = this.liquidationEvents.get(user)!;
      if (detection && detection.firstDetectionBlock !== null && detection.firstDetectionBlock <= event.block) {
        return 'detected';
      }
      return 'missed';
    } else if (detection) {
      return 'false_positive';
    }
    return 'pending';
  }
  
  /**
   * Get lead blocks for a detected user
   */
  getLeadBlocks(user: string): number | null {
    const event = this.liquidationEvents.get(user);
    const detection = this.detections.get(user);
    
    if (event && detection && detection.firstDetectionBlock !== null && detection.firstDetectionBlock <= event.block) {
      return event.block - detection.firstDetectionBlock;
    }
    return null;
  }
  
  /**
   * Check if user is race viable
   */
  isRaceViable(user: string, executionHfThreshold: number, minProfitUSD: number): boolean {
    const detection = this.detections.get(user);
    if (!detection) return false;
    
    return (
      detection.simulationStatus === 'ok' &&
      detection.hfAtDetection !== null &&
      detection.hfAtDetection < executionHfThreshold &&
      detection.detectionProfitUSD !== null &&
      detection.detectionProfitUSD >= minProfitUSD
    );
  }
}
