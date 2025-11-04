// Scanner: Event-driven + periodic head sweep candidate discovery
// Coordinates between event subscriptions, head checks, and candidate management

import EventEmitter from 'events';
import { WebSocketProvider, JsonRpcProvider } from 'ethers';

import { CandidateManager } from './CandidateManager.js';
import { SameBlockVerifier } from './SameBlockVerifier.js';
import { config } from '../config/index.js';

export interface ScannerOptions {
  provider: WebSocketProvider | JsonRpcProvider;
  candidateManager: CandidateManager;
  verifier: SameBlockVerifier;
  minDebtUsd?: number;
}

export interface CandidateResult {
  userAddress: string;
  blockNumber: number;
  triggerType: 'event' | 'head' | 'price';
  verified: boolean;
  healthFactor?: bigint;
  totalDebtBase?: bigint;
  skipReason?: string;
}

/**
 * Scanner orchestrates candidate discovery from multiple sources:
 * - Event-driven: Supply/Borrow/Repay/Withdraw/Transfer events
 * - Periodic head sweep: Check all tracked candidates at each new block
 * - Price updates: ReserveDataUpdated or Chainlink price changes
 * 
 * For each candidate, runs same-block verification before emitting.
 */
export class Scanner extends EventEmitter {
  private provider: WebSocketProvider | JsonRpcProvider;
  private candidateManager: CandidateManager;
  private verifier: SameBlockVerifier;
  private minDebtUsd: number;
  
  // Per-user per-block deduplication
  private seenThisBlock = new Map<number, Set<string>>();
  
  // Per-user cooldown tracking
  private userCooldowns = new Map<string, number>();
  private readonly cooldownMs = 60_000; // 1 minute cooldown after action
  
  constructor(options: ScannerOptions) {
    super();
    this.provider = options.provider;
    this.candidateManager = options.candidateManager;
    this.verifier = options.verifier;
    this.minDebtUsd = options.minDebtUsd ?? config.profitMinUsd ?? 200;
  }
  
  /**
   * Process a candidate user at a specific block
   */
  async processCandidate(
    userAddress: string,
    blockNumber: number,
    triggerType: 'event' | 'head' | 'price'
  ): Promise<CandidateResult> {
    // Check per-block dedupe
    if (this.isDuplicate(userAddress, blockNumber)) {
      return {
        userAddress,
        blockNumber,
        triggerType,
        verified: false,
        skipReason: 'duplicate_block'
      };
    }
    
    // Check cooldown
    if (this.isInCooldown(userAddress)) {
      return {
        userAddress,
        blockNumber,
        triggerType,
        verified: false,
        skipReason: 'cooldown'
      };
    }
    
    // Mark as seen this block
    this.markSeen(userAddress, blockNumber);
    
    // Run same-block verification
    const verifyResult = await this.verifier.verify(userAddress, blockNumber);
    
    if (!verifyResult.success) {
      return {
        userAddress,
        blockNumber,
        triggerType,
        verified: false,
        skipReason: verifyResult.reason
      };
    }
    
    // Check min debt threshold
    const debtUsd = this.calculateDebtUsd(verifyResult.totalDebtBase!);
    if (debtUsd < this.minDebtUsd) {
      return {
        userAddress,
        blockNumber,
        triggerType,
        verified: false,
        healthFactor: verifyResult.healthFactor,
        totalDebtBase: verifyResult.totalDebtBase,
        skipReason: 'below_min_debt_usd'
      };
    }
    
    // Check health factor
    const hfNumber = Number(verifyResult.healthFactor!) / 1e18;
    if (hfNumber >= 1.0) {
      return {
        userAddress,
        blockNumber,
        triggerType,
        verified: false,
        healthFactor: verifyResult.healthFactor,
        totalDebtBase: verifyResult.totalDebtBase,
        skipReason: 'hf_ok'
      };
    }
    
    // Verified liquidatable candidate
    return {
      userAddress,
      blockNumber,
      triggerType,
      verified: true,
      healthFactor: verifyResult.healthFactor,
      totalDebtBase: verifyResult.totalDebtBase
    };
  }
  
  /**
   * Check if user was already processed this block
   */
  private isDuplicate(userAddress: string, blockNumber: number): boolean {
    const seen = this.seenThisBlock.get(blockNumber);
    return seen ? seen.has(userAddress) : false;
  }
  
  /**
   * Mark user as seen this block
   */
  private markSeen(userAddress: string, blockNumber: number): void {
    let seen = this.seenThisBlock.get(blockNumber);
    if (!seen) {
      seen = new Set();
      this.seenThisBlock.set(blockNumber, seen);
    }
    seen.add(userAddress);
    
    // Cleanup old blocks (keep only last 10)
    const blocks = Array.from(this.seenThisBlock.keys()).sort((a, b) => b - a);
    if (blocks.length > 10) {
      for (const block of blocks.slice(10)) {
        this.seenThisBlock.delete(block);
      }
    }
  }
  
  /**
   * Check if user is in cooldown period
   */
  private isInCooldown(userAddress: string): boolean {
    const cooldownUntil = this.userCooldowns.get(userAddress);
    if (!cooldownUntil) return false;
    
    const now = Date.now();
    if (now < cooldownUntil) {
      return true;
    }
    
    // Cooldown expired, remove it
    this.userCooldowns.delete(userAddress);
    return false;
  }
  
  /**
   * Set cooldown for a user (called after execution attempt)
   */
  setCooldown(userAddress: string, durationMs?: number): void {
    const duration = durationMs ?? this.cooldownMs;
    this.userCooldowns.set(userAddress, Date.now() + duration);
  }
  
  /**
   * Calculate debt in USD from base currency amount
   * Assumes base currency is USD with 8 decimals (Aave oracle standard)
   */
  private calculateDebtUsd(totalDebtBase: bigint): number {
    return Number(totalDebtBase) / 1e8;
  }
  
  /**
   * Start the scanner (placeholder for future event subscriptions)
   */
  async start(): Promise<void> {
    // TODO: Subscribe to Aave events
    // TODO: Start head sweep timer
    // TODO: Subscribe to price updates
  }
  
  /**
   * Stop the scanner
   */
  async stop(): Promise<void> {
    // TODO: Cleanup subscriptions and timers
  }
}
