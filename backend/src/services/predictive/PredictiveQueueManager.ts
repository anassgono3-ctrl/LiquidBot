/**
 * PredictiveQueueManager: Queue deduplication and budget enforcement
 * 
 * Purpose: Prevent repeated evaluations of the same user and enforce per-block budgets
 * - Track (user, scenario) with lastEvaluatedBlock and lastEvaluatedMs
 * - Skip evaluations within EVAL_COOLDOWN_SEC or same block
 * - Enforce PREDICTIVE_QUEUE_BUDGET_CALLS_PER_BLOCK
 * - Enforce PREDICTIVE_QUEUE_MAX_CANDIDATES_PER_BLOCK
 * - Enforce PREDICTIVE_QUEUE_SAFETY_MAX queue length
 * 
 * This reduces redundant RPC calls and prevents queue overflow
 */

import { config } from '../../config/index.js';

export interface PredictiveQueueEntry {
  user: string;
  scenario: string;
  lastEvaluatedBlock: number;
  lastEvaluatedMs: number;
  hf: number;
  debtUsd: number;
  priority: number;
}

export interface QueueBudget {
  callsPerBlock: number;
  candidatesPerBlock: number;
  safetyMax: number;
  cooldownSec: number;
  blockDebounce: number;
}

export interface QueueStats {
  currentSize: number;
  callsThisBlock: number;
  candidatesThisBlock: number;
  dedupSkipsThisBlock: number;
  budgetExceededThisBlock: boolean;
}

/**
 * PredictiveQueueManager manages queue state and enforces budgets
 */
export class PredictiveQueueManager {
  private readonly budget: QueueBudget;
  
  // Queue state: key = "user:scenario"
  private queue: Map<string, PredictiveQueueEntry> = new Map();
  
  // Per-block tracking
  private currentBlock = 0;
  private callsThisBlock = 0;
  private candidatesThisBlock = 0;
  private dedupSkipsThisBlock = 0;
  private budgetExceededThisBlock = false;

  constructor(budgetOverride?: Partial<QueueBudget>) {
    this.budget = {
      callsPerBlock: budgetOverride?.callsPerBlock ?? config.predictiveQueueBudgetCallsPerBlock ?? 200,
      candidatesPerBlock: budgetOverride?.candidatesPerBlock ?? config.predictiveQueueMaxCandidatesPerBlock ?? 60,
      safetyMax: budgetOverride?.safetyMax ?? config.predictiveQueueSafetyMax ?? 500,
      cooldownSec: budgetOverride?.cooldownSec ?? config.predictiveEvalCooldownSec ?? 60,
      blockDebounce: budgetOverride?.blockDebounce ?? config.perUserBlockDebounce ?? 3
    };

    console.log(
      `[predictive-queue-mgr] Initialized: ` +
      `callsPerBlock=${this.budget.callsPerBlock}, ` +
      `candidatesPerBlock=${this.budget.candidatesPerBlock}, ` +
      `safetyMax=${this.budget.safetyMax}, ` +
      `cooldown=${this.budget.cooldownSec}s, ` +
      `blockDebounce=${this.budget.blockDebounce}`
    );
  }

  /**
   * Advance to a new block, resetting per-block counters
   */
  public advanceBlock(blockNumber: number): void {
    if (blockNumber !== this.currentBlock) {
      if (this.candidatesThisBlock > 0 || this.dedupSkipsThisBlock > 0) {
        console.log(
          `[predictive-queue-mgr] Block ${this.currentBlock} summary: ` +
          `calls=${this.callsThisBlock}, candidates=${this.candidatesThisBlock}, ` +
          `dedupSkips=${this.dedupSkipsThisBlock}, budgetExceeded=${this.budgetExceededThisBlock}`
        );
      }
      
      this.currentBlock = blockNumber;
      this.callsThisBlock = 0;
      this.candidatesThisBlock = 0;
      this.dedupSkipsThisBlock = 0;
      this.budgetExceededThisBlock = false;
    }
  }

  /**
   * Check if a candidate should be evaluated or skipped
   * @param user User address
   * @param scenario Scenario name
   * @param blockNumber Current block number
   * @returns {shouldEvaluate: boolean, reason: string}
   */
  public shouldEvaluate(
    user: string,
    scenario: string,
    blockNumber: number
  ): { shouldEvaluate: boolean; reason: string } {
    const key = this.makeKey(user, scenario);
    const existing = this.queue.get(key);
    const now = Date.now();

    // Advance block if needed
    this.advanceBlock(blockNumber);

    // Check 1: Safety max - queue length
    if (this.queue.size >= this.budget.safetyMax) {
      return {
        shouldEvaluate: false,
        reason: `queue_safety_max_exceeded: ${this.queue.size} >= ${this.budget.safetyMax}`
      };
    }

    // Check 2: Per-block candidate budget
    if (this.candidatesThisBlock >= this.budget.candidatesPerBlock) {
      this.budgetExceededThisBlock = true;
      return {
        shouldEvaluate: false,
        reason: `candidate_budget_exceeded: ${this.candidatesThisBlock} >= ${this.budget.candidatesPerBlock}`
      };
    }

    // Check 3: Per-block call budget
    if (this.callsThisBlock >= this.budget.callsPerBlock) {
      this.budgetExceededThisBlock = true;
      return {
        shouldEvaluate: false,
        reason: `call_budget_exceeded: ${this.callsThisBlock} >= ${this.budget.callsPerBlock}`
      };
    }

    // Check 4: Deduplication - same block
    if (existing && existing.lastEvaluatedBlock === blockNumber) {
      this.dedupSkipsThisBlock++;
      return {
        shouldEvaluate: false,
        reason: `dedup_same_block: last=${existing.lastEvaluatedBlock}, current=${blockNumber}`
      };
    }

    // Check 5: Deduplication - block debounce
    if (existing && blockNumber - existing.lastEvaluatedBlock < this.budget.blockDebounce) {
      this.dedupSkipsThisBlock++;
      return {
        shouldEvaluate: false,
        reason: `dedup_block_debounce: blocksSince=${blockNumber - existing.lastEvaluatedBlock}, required=${this.budget.blockDebounce}`
      };
    }

    // Check 6: Deduplication - cooldown time
    if (existing) {
      const timeSinceLastMs = now - existing.lastEvaluatedMs;
      const cooldownMs = this.budget.cooldownSec * 1000;
      if (timeSinceLastMs < cooldownMs) {
        this.dedupSkipsThisBlock++;
        return {
          shouldEvaluate: false,
          reason: `dedup_cooldown: timeSince=${(timeSinceLastMs / 1000).toFixed(1)}s, required=${this.budget.cooldownSec}s`
        };
      }
    }

    // All checks passed - should evaluate
    return {
      shouldEvaluate: true,
      reason: 'all_checks_passed'
    };
  }

  /**
   * Mark a candidate as evaluated
   * @param entry Queue entry with user, scenario, block, timestamp
   */
  public markEvaluated(entry: PredictiveQueueEntry): void {
    const key = this.makeKey(entry.user, entry.scenario);
    this.queue.set(key, entry);
    this.candidatesThisBlock++;
  }

  /**
   * Increment call counter for budget tracking
   * @param count Number of calls made (e.g., multicall batch size)
   */
  public incrementCalls(count: number = 1): void {
    this.callsThisBlock += count;
  }

  /**
   * Remove a user from the queue (e.g., after liquidation)
   * @param user User address
   */
  public removeUser(user: string): void {
    const normalizedUser = user.toLowerCase();
    const keysToRemove: string[] = [];
    
    for (const key of this.queue.keys()) {
      if (key.startsWith(normalizedUser + '|')) {
        keysToRemove.push(key);
      }
    }
    
    for (const key of keysToRemove) {
      this.queue.delete(key);
    }
  }

  /**
   * Get current queue statistics
   */
  public getStats(): QueueStats {
    return {
      currentSize: this.queue.size,
      callsThisBlock: this.callsThisBlock,
      candidatesThisBlock: this.candidatesThisBlock,
      dedupSkipsThisBlock: this.dedupSkipsThisBlock,
      budgetExceededThisBlock: this.budgetExceededThisBlock
    };
  }

  /**
   * Get remaining budget for current block
   */
  public getRemainingBudget(): { calls: number; candidates: number } {
    return {
      calls: Math.max(0, this.budget.callsPerBlock - this.callsThisBlock),
      candidates: Math.max(0, this.budget.candidatesPerBlock - this.candidatesThisBlock)
    };
  }

  /**
   * Clear the queue (for testing or reset)
   */
  public clear(): void {
    this.queue.clear();
    this.callsThisBlock = 0;
    this.candidatesThisBlock = 0;
    this.dedupSkipsThisBlock = 0;
    this.budgetExceededThisBlock = false;
  }

  /**
   * Prune stale entries older than a threshold
   * @param maxAgeMs Maximum age in milliseconds (default: 5 minutes)
   */
  public pruneStale(maxAgeMs: number = 300000): number {
    const now = Date.now();
    const keysToRemove: string[] = [];
    
    for (const [key, entry] of this.queue.entries()) {
      if (now - entry.lastEvaluatedMs > maxAgeMs) {
        keysToRemove.push(key);
      }
    }
    
    for (const key of keysToRemove) {
      this.queue.delete(key);
    }
    
    if (keysToRemove.length > 0) {
      console.log(`[predictive-queue-mgr] Pruned ${keysToRemove.length} stale entries`);
    }
    
    return keysToRemove.length;
  }

  /**
   * Make a queue key from user and scenario
   * Uses pipe separator to avoid collision with colon in scenario names
   */
  private makeKey(user: string, scenario: string): string {
    return `${user.toLowerCase()}|${scenario}`;
  }

  /**
   * Get current budget configuration
   */
  public getBudget(): QueueBudget {
    return { ...this.budget };
  }
}
