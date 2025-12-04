/**
 * OnChainConfirmWatcher: Monitor on-chain confirmations of pre-submitted liquidations
 * 
 * Watches new blocks and correlates pending pre-submit transactions with:
 * - Transaction receipt (mined/reverted)
 * - Chainlink oracle round changes
 * - Borrower health factor post-execution
 * 
 * Tracks outcomes and cleans up expired entries.
 */

import { ethers } from 'ethers';
import { config } from '../config/index.js';
import type { PreSubmitManager } from './PreSubmitManager.js';
import { recordPreSubmitOutcome } from '../metrics/preSubmitMetrics.js';

// Chainlink Aggregator V3 Interface ABI (minimal)
const AGGREGATOR_V3_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
];

// Aave Pool ABI (minimal - getUserAccountData)
const AAVE_POOL_ABI = [
  'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
];

interface ChainlinkRound {
  roundId: bigint;
  updatedAt: number;
}

export class OnChainConfirmWatcher {
  private enabled: boolean;
  private provider: ethers.JsonRpcProvider | null = null;
  private aavePool: ethers.Contract | null = null;
  private preSubmitManager: PreSubmitManager | null = null;
  
  // Track Chainlink rounds
  private chainlinkFeeds: Map<string, ethers.Contract> = new Map();
  private lastRounds: Map<string, ChainlinkRound> = new Map();
  
  private blockListener: ((blockNumber: number) => void) | null = null;
  private isRunning = false;

  constructor(preSubmitManager?: PreSubmitManager) {
    this.enabled = config.preSubmitEnabled;
    this.preSubmitManager = preSubmitManager || null;

    if (this.enabled) {
      this.initialize();
    }
  }

  /**
   * Initialize provider and contracts
   */
  private initialize(): void {
    // Get RPC URL
    const rpcUrl = config.chainlinkRpcUrl || process.env.RPC_URL;
    if (!rpcUrl) {
      console.warn('[confirm-watcher] No RPC_URL configured, disabling');
      this.enabled = false;
      return;
    }

    // Get Aave pool address
    const poolAddress = config.aavePool || config.aavePoolAddress;
    if (!poolAddress) {
      console.warn('[confirm-watcher] No AAVE_POOL address configured, disabling');
      this.enabled = false;
      return;
    }

    try {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      this.aavePool = new ethers.Contract(poolAddress, AAVE_POOL_ABI, this.provider);

      // Initialize Chainlink feed contracts
      this.initializeChainlinkFeeds();

      console.log('[confirm-watcher] Initialized');
    } catch (error) {
      console.error('[confirm-watcher] Initialization error:', error);
      this.enabled = false;
    }
  }

  /**
   * Initialize Chainlink feed contracts
   */
  private initializeChainlinkFeeds(): void {
    if (!this.provider) {
      return;
    }

    // Parse CHAINLINK_FEEDS env var
    const feedsConfig = config.chainlinkFeeds;
    if (!feedsConfig) {
      console.warn('[confirm-watcher] No CHAINLINK_FEEDS configured');
      return;
    }

    try {
      // Expected format: "ETH:0x...,BTC:0x..."
      const feeds = feedsConfig.split(',').map(f => f.trim());
      
      for (const feedEntry of feeds) {
        const [symbol, address] = feedEntry.split(':').map(s => s.trim());
        if (symbol && address) {
          const contract = new ethers.Contract(address, AGGREGATOR_V3_ABI, this.provider);
          this.chainlinkFeeds.set(symbol, contract);
        }
      }

      console.log(`[confirm-watcher] Initialized ${this.chainlinkFeeds.size} Chainlink feeds`);
    } catch (error) {
      console.error('[confirm-watcher] Error parsing CHAINLINK_FEEDS:', error);
    }
  }

  /**
   * Start watching blocks
   */
  public async start(): Promise<void> {
    if (!this.enabled || this.isRunning) {
      return;
    }

    if (!this.provider) {
      console.error('[confirm-watcher] Provider not initialized');
      return;
    }

    console.log('[confirm-watcher] Starting block watcher');
    this.isRunning = true;

    // Initialize last rounds
    await this.updateChainlinkRounds();

    // Listen to new blocks
    this.blockListener = (blockNumber: number) => {
      this.onNewBlock(blockNumber).catch(error => {
        console.error('[confirm-watcher] Error processing block:', error);
      });
    };

    this.provider.on('block', this.blockListener);
  }

  /**
   * Stop watching blocks
   */
  public async stop(): Promise<void> {
    console.log('[confirm-watcher] Stopping');
    this.isRunning = false;

    if (this.provider && this.blockListener) {
      this.provider.off('block', this.blockListener);
      this.blockListener = null;
    }
  }

  /**
   * Handle new block
   */
  private async onNewBlock(blockNumber: number): Promise<void> {
    if (!this.preSubmitManager || !this.provider) {
      return;
    }

    try {
      // Check for Chainlink round changes
      const roundChanged = await this.checkChainlinkRoundChanges();

      // Get pending pre-submits
      const pending = this.preSubmitManager.getPendingPreSubmits();

      if (pending.size === 0) {
        return;
      }

      // Process each pending pre-submit
      for (const [txHash, metadata] of pending.entries()) {
        await this.processPendingTransaction(txHash, metadata, blockNumber);
      }

      // Cleanup expired
      const cleaned = await this.preSubmitManager.cleanupExpired();
      if (cleaned > 0) {
        console.log(`[confirm-watcher] Cleaned up ${cleaned} expired pre-submits`);
      }
    } catch (error) {
      console.error('[confirm-watcher] Error in onNewBlock:', error);
    }
  }

  /**
   * Check if any Chainlink rounds changed
   */
  private async checkChainlinkRoundChanges(): Promise<boolean> {
    let anyChanged = false;

    for (const [symbol, contract] of this.chainlinkFeeds.entries()) {
      try {
        const roundData = await contract.latestRoundData();
        const roundId = roundData.roundId;
        const updatedAt = Number(roundData.updatedAt);

        const lastRound = this.lastRounds.get(symbol);
        
        if (lastRound && lastRound.roundId !== roundId) {
          console.log(`[confirm-watcher] Chainlink round changed: ${symbol} ${lastRound.roundId} → ${roundId}`);
          anyChanged = true;
        }

        this.lastRounds.set(symbol, { roundId, updatedAt });
      } catch (error) {
        // Silently continue on error
      }
    }

    return anyChanged;
  }

  /**
   * Update Chainlink rounds (initial fetch)
   */
  private async updateChainlinkRounds(): Promise<void> {
    for (const [symbol, contract] of this.chainlinkFeeds.entries()) {
      try {
        const roundData = await contract.latestRoundData();
        const roundId = roundData.roundId;
        const updatedAt = Number(roundData.updatedAt);
        
        this.lastRounds.set(symbol, { roundId, updatedAt });
      } catch (error) {
        console.error(`[confirm-watcher] Error fetching initial round for ${symbol}:`, error);
      }
    }
  }

  /**
   * Process a pending transaction
   */
  private async processPendingTransaction(
    txHash: string,
    metadata: any,
    currentBlock: number
  ): Promise<void> {
    if (!this.provider || !this.aavePool) {
      return;
    }

    try {
      // Get transaction receipt
      const receipt = await this.provider.getTransactionReceipt(txHash);

      if (!receipt) {
        // Transaction not mined yet
        return;
      }

      // Transaction mined - check outcome
      const success = receipt.status === 1;
      const timeToMineSec = (Date.now() - metadata.submittedTime) / 1000;
      const etaAccuracySec = timeToMineSec - metadata.etaSec;

      if (success) {
        // Check user HF
        const userHF = await this.getUserHealthFactor(metadata.user);
        
        if (userHF < 1.0) {
          // Successful liquidation
          console.log(
            `[confirm-watcher] SUCCESS: ${txHash} user=${metadata.user} HF=${userHF.toFixed(3)} time=${timeToMineSec.toFixed(1)}s`
          );
          
          recordPreSubmitOutcome('success', timeToMineSec, etaAccuracySec);
        } else {
          // Transaction succeeded but user HF > 1.0 (shouldn't happen)
          console.warn(
            `[confirm-watcher] UNEXPECTED: ${txHash} succeeded but HF=${userHF.toFixed(3)} > 1.0`
          );
          
          recordPreSubmitOutcome('success', timeToMineSec, etaAccuracySec);
        }
      } else {
        // Transaction reverted
        const revertReason = await this.getRevertReason(txHash);
        
        console.warn(
          `[confirm-watcher] REVERTED: ${txHash} reason="${revertReason}" time=${timeToMineSec.toFixed(1)}s`
        );
        
        recordPreSubmitOutcome('reverted', timeToMineSec, etaAccuracySec, revertReason);
      }

      // Remove from pending
      this.preSubmitManager!.removePending(txHash);
    } catch (error) {
      console.error(`[confirm-watcher] Error processing tx ${txHash}:`, error);
    }
  }

  /**
   * Get user health factor from Aave
   */
  private async getUserHealthFactor(user: string): Promise<number> {
    if (!this.aavePool) {
      return 1.0; // Default safe value
    }

    try {
      const accountData = await this.aavePool.getUserAccountData(user);
      const hf = accountData.healthFactor;
      
      // Health factor is returned with 18 decimals
      return Number(ethers.formatUnits(hf, 18));
    } catch (error) {
      console.error(`[confirm-watcher] Error fetching HF for ${user}:`, error);
      return 1.0;
    }
  }

  /**
   * Get revert reason for a transaction
   */
  private async getRevertReason(txHash: string): Promise<string> {
    if (!this.provider) {
      return 'unknown';
    }

    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      const tx = await this.provider.getTransaction(txHash);
      
      if (!receipt || !tx) {
        return 'unknown';
      }

      // Try to decode revert reason from receipt logs
      // This is a simplified approach - in production you'd parse the actual error
      
      // Common Aave error codes
      if (receipt.logs.length > 0) {
        // Attempt to extract numeric error code from logs
        // Aave uses error codes like "35" for various failures
        return 'see_logs';
      }

      return 'unknown';
    } catch (error) {
      return 'error_fetching_reason';
    }
  }

  /**
   * Set PreSubmitManager reference
   */
  public setPreSubmitManager(manager: PreSubmitManager): void {
    this.preSubmitManager = manager;
  }

  /**
   * Check if enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check if running
   */
  public isWatching(): boolean {
    return this.isRunning;
  }
}
