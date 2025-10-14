// CandidateManager: Bounded in-memory set for real-time HF candidate tracking
// Maintains a priority queue of users to monitor with LRU eviction

export interface Candidate {
  address: string;
  lastHF: number | null;
  lastCheck: number; // timestamp
  touchedAt: number; // last time user was seen in events or subgraph
}

export interface CandidateManagerOptions {
  maxCandidates?: number;
}

/**
 * CandidateManager maintains a bounded set of user addresses to monitor
 * for health factor changes. Uses priority by lowest HF and LRU for eviction.
 */
export class CandidateManager {
  private candidates: Map<string, Candidate> = new Map();
  private readonly maxCandidates: number;

  constructor(options: CandidateManagerOptions = {}) {
    this.maxCandidates = options.maxCandidates || 300;
  }

  /**
   * Add or update a candidate in the set
   */
  add(address: string, hf: number | null = null): void {
    const now = Date.now();
    const existing = this.candidates.get(address);

    if (existing) {
      // Update existing candidate
      existing.touchedAt = now;
      if (hf !== null) {
        existing.lastHF = hf;
        existing.lastCheck = now;
      }
    } else {
      // Check if we need to evict before adding
      if (this.candidates.size >= this.maxCandidates) {
        this.evictOne();
      }

      // Add new candidate
      this.candidates.set(address, {
        address,
        lastHF: hf,
        lastCheck: hf !== null ? now : 0,
        touchedAt: now
      });
    }
  }

  /**
   * Update HF for a candidate after a check
   */
  updateHF(address: string, hf: number): void {
    const candidate = this.candidates.get(address);
    if (candidate) {
      candidate.lastHF = hf;
      candidate.lastCheck = Date.now();
      candidate.touchedAt = Date.now();
    }
  }

  /**
   * Mark candidate as touched (seen in events)
   */
  touch(address: string): void {
    const candidate = this.candidates.get(address);
    if (candidate) {
      candidate.touchedAt = Date.now();
    }
  }

  /**
   * Get a candidate by address
   */
  get(address: string): Candidate | undefined {
    return this.candidates.get(address);
  }

  /**
   * Get all candidate addresses
   */
  getAddresses(): string[] {
    return Array.from(this.candidates.keys());
  }

  /**
   * Get all candidates
   */
  getAll(): Candidate[] {
    return Array.from(this.candidates.values());
  }

  /**
   * Get count of candidates
   */
  size(): number {
    return this.candidates.size;
  }

  /**
   * Get candidate with lowest HF (priority for monitoring)
   */
  getLowestHF(): Candidate | null {
    let lowest: Candidate | null = null;
    for (const candidate of this.candidates.values()) {
      if (candidate.lastHF !== null) {
        if (!lowest || candidate.lastHF < lowest.lastHF!) {
          lowest = candidate;
        }
      }
    }
    return lowest;
  }

  /**
   * Evict one candidate using LRU + priority strategy
   * - First try to evict candidates with HF > 1.1 (healthy, low priority)
   * - Fall back to oldest touched candidate
   */
  private evictOne(): void {
    if (this.candidates.size === 0) return;

    // Strategy 1: Evict healthy users (HF > 1.1) that haven't been touched recently
    const healthyThreshold = 1.1;
    let evictCandidate: Candidate | null = null;

    for (const candidate of this.candidates.values()) {
      if (candidate.lastHF && candidate.lastHF > healthyThreshold) {
        if (!evictCandidate || candidate.touchedAt < evictCandidate.touchedAt) {
          evictCandidate = candidate;
        }
      }
    }

    // Strategy 2: If no healthy candidates, evict oldest touched
    if (!evictCandidate) {
      for (const candidate of this.candidates.values()) {
        if (!evictCandidate || candidate.touchedAt < evictCandidate.touchedAt) {
          evictCandidate = candidate;
        }
      }
    }

    if (evictCandidate) {
      this.candidates.delete(evictCandidate.address);
    }
  }

  /**
   * Remove a candidate from the set
   */
  remove(address: string): void {
    this.candidates.delete(address);
  }

  /**
   * Clear all candidates
   */
  clear(): void {
    this.candidates.clear();
  }

  /**
   * Bulk add/update candidates from a list of addresses
   */
  addBulk(addresses: string[]): void {
    for (const address of addresses) {
      this.add(address);
    }
  }

  /**
   * Get candidates that need recheck based on staleness threshold
   * @param staleThresholdMs Milliseconds since last check to consider stale
   */
  getStale(staleThresholdMs: number): Candidate[] {
    const now = Date.now();
    const stale: Candidate[] = [];

    for (const candidate of this.candidates.values()) {
      if (now - candidate.lastCheck > staleThresholdMs) {
        stale.push(candidate);
      }
    }

    return stale;
  }
}
