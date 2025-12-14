/**
 * ScanConcurrencyController - Prevents duplicate concurrent scanning runs
 * 
 * Ensures only one batch of chunking per trigger class is active at a time.
 * Prevents the duplicate "Chunking 532 calls into batches" logs observed in production.
 */

interface ScanLock {
  triggerType: string;
  blockNumber?: number;
  reserve?: string;
  startTime: number;
  timeout: number;
}

export class ScanConcurrencyController {
  private locks: Map<string, ScanLock> = new Map();
  private readonly defaultTimeoutMs: number = 30000; // 30 seconds
  
  /**
   * Attempt to acquire a lock for a scan operation
   * @param triggerType - Type of trigger (head/price/reserve/event)
   * @param blockNumber - Optional block number for block-specific locks
   * @param reserve - Optional reserve address for reserve-specific locks
   * @returns true if lock acquired, false if scan already in-flight
   */
  tryAcquireLock(
    triggerType: string,
    blockNumber?: number,
    reserve?: string
  ): boolean {
    const lockKey = this.getLockKey(triggerType, blockNumber, reserve);
    
    // Check if lock exists and is still valid
    const existing = this.locks.get(lockKey);
    if (existing) {
      const elapsed = Date.now() - existing.startTime;
      if (elapsed < existing.timeout) {
        // Lock still valid, scan in-flight
        return false;
      }
      // Lock expired (stale), allow new scan
      this.locks.delete(lockKey);
    }
    
    // Acquire new lock
    this.locks.set(lockKey, {
      triggerType,
      blockNumber,
      reserve,
      startTime: Date.now(),
      timeout: this.defaultTimeoutMs
    });
    
    return true;
  }
  
  /**
   * Release a lock after scan completes
   */
  releaseLock(
    triggerType: string,
    blockNumber?: number,
    reserve?: string
  ): void {
    const lockKey = this.getLockKey(triggerType, blockNumber, reserve);
    this.locks.delete(lockKey);
  }
  
  /**
   * Generate lock key from trigger parameters
   */
  private getLockKey(
    triggerType: string,
    blockNumber?: number,
    reserve?: string
  ): string {
    const parts = [triggerType];
    if (blockNumber !== undefined) {
      parts.push(`block-${blockNumber}`);
    }
    if (reserve) {
      parts.push(`reserve-${reserve.slice(0, 10)}`);
    }
    return parts.join(':');
  }
  
  /**
   * Clean up expired locks (garbage collection)
   */
  cleanupExpired(): number {
    let cleaned = 0;
    const now = Date.now();
    
    for (const [key, lock] of this.locks.entries()) {
      const elapsed = now - lock.startTime;
      if (elapsed >= lock.timeout) {
        this.locks.delete(key);
        cleaned++;
      }
    }
    
    return cleaned;
  }
  
  /**
   * Get current number of active locks
   */
  getActiveLockCount(): number {
    return this.locks.size;
  }
  
  /**
   * Check if a scan is in-flight for the given parameters
   */
  isInFlight(
    triggerType: string,
    blockNumber?: number,
    reserve?: string
  ): boolean {
    const lockKey = this.getLockKey(triggerType, blockNumber, reserve);
    const lock = this.locks.get(lockKey);
    
    if (!lock) return false;
    
    const elapsed = Date.now() - lock.startTime;
    return elapsed < lock.timeout;
  }
}
