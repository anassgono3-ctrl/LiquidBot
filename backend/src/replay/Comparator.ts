// Comparator: Classify candidates and ground truth events for replay analysis

export interface Candidate {
  user: string;
  block: number;
  healthFactor: number;
  debtUSD: number;
  collateralUSD: number;
  profitEstUSD: number;
}

export interface GroundTruthEvent {
  user: string;
  block: number;
  txHash: string;
}

export type CandidateClassification = 'detected' | 'false-positive' | 'unexecuted';

export interface ClassificationResult {
  candidate: Candidate;
  classification: CandidateClassification;
  onChainLiquidated: boolean;
  matchedEvent?: GroundTruthEvent;
}

export interface DetectionResult {
  event: GroundTruthEvent;
  detected: boolean;
  firstDetectionBlock?: number;
  leadBlocks?: number;
}

/**
 * Comparator classifies replay candidates against ground truth liquidation events.
 * 
 * Classification rules:
 * - detected: candidate user was liquidated on-chain at the same or later block
 * - false-positive: candidate was never liquidated on-chain
 * - unexecuted: candidate could have been liquidated but wasn't (detected but not executed by anyone)
 */
export class Comparator {
  // Map of user -> earliest detection block
  private detectionMap = new Map<string, number>();
  
  // Map of user -> ground truth event
  private groundTruthMap = new Map<string, GroundTruthEvent>();
  
  constructor(groundTruthEvents: GroundTruthEvent[]) {
    // Index ground truth by user (latest event per user)
    for (const event of groundTruthEvents) {
      const existing = this.groundTruthMap.get(event.user);
      if (!existing || event.block > existing.block) {
        this.groundTruthMap.set(event.user, event);
      }
    }
  }
  
  /**
   * Record a candidate detection at a specific block.
   * Tracks the earliest block where each user was detected.
   */
  recordDetection(candidate: Candidate): void {
    const existing = this.detectionMap.get(candidate.user);
    if (!existing || candidate.block < existing) {
      this.detectionMap.set(candidate.user, candidate.block);
    }
  }
  
  /**
   * Classify a candidate against ground truth events.
   */
  classifyCandidate(candidate: Candidate): ClassificationResult {
    const groundTruth = this.groundTruthMap.get(candidate.user);
    
    if (groundTruth) {
      // User was liquidated on-chain
      // Check if detection happened before or at the liquidation block
      if (candidate.block <= groundTruth.block) {
        return {
          candidate,
          classification: 'detected',
          onChainLiquidated: true,
          matchedEvent: groundTruth,
        };
      } else {
        // Detected after liquidation (too late)
        return {
          candidate,
          classification: 'false-positive',
          onChainLiquidated: false,
        };
      }
    } else {
      // User was never liquidated on-chain
      // This could be a false positive or a missed opportunity (user recovered)
      return {
        candidate,
        classification: 'false-positive',
        onChainLiquidated: false,
      };
    }
  }
  
  /**
   * Check if a ground truth event was detected.
   * Returns detection result with lead time if detected.
   */
  checkDetection(event: GroundTruthEvent): DetectionResult {
    const firstDetectionBlock = this.detectionMap.get(event.user);
    
    if (firstDetectionBlock !== undefined && firstDetectionBlock <= event.block) {
      // Detected before or at liquidation block
      const leadBlocks = event.block - firstDetectionBlock;
      return {
        event,
        detected: true,
        firstDetectionBlock,
        leadBlocks,
      };
    } else {
      // Not detected or detected too late
      return {
        event,
        detected: false,
      };
    }
  }
  
  /**
   * Get all ground truth events that were missed (not detected).
   */
  getMissedEvents(): GroundTruthEvent[] {
    const missed: GroundTruthEvent[] = [];
    
    for (const event of this.groundTruthMap.values()) {
      const detection = this.checkDetection(event);
      if (!detection.detected) {
        missed.push(event);
      }
    }
    
    return missed;
  }
  
  /**
   * Calculate coverage ratio (detected / total ground truth events).
   */
  getCoverageRatio(): number {
    if (this.groundTruthMap.size === 0) {
      return 1.0; // No events to detect = perfect coverage
    }
    
    let detected = 0;
    for (const event of this.groundTruthMap.values()) {
      if (this.checkDetection(event).detected) {
        detected++;
      }
    }
    
    return detected / this.groundTruthMap.size;
  }
  
  /**
   * Get statistics for all detections.
   */
  getDetectionStats(): {
    totalEvents: number;
    detected: number;
    missed: number;
    avgLeadBlocks: number;
    medianLeadBlocks: number;
  } {
    const leadTimes: number[] = [];
    let detected = 0;
    
    for (const event of this.groundTruthMap.values()) {
      const detection = this.checkDetection(event);
      if (detection.detected) {
        detected++;
        if (detection.leadBlocks !== undefined) {
          leadTimes.push(detection.leadBlocks);
        }
      }
    }
    
    const avgLeadBlocks = leadTimes.length > 0
      ? leadTimes.reduce((sum, val) => sum + val, 0) / leadTimes.length
      : 0;
    
    let medianLeadBlocks = 0;
    if (leadTimes.length > 0) {
      const sorted = [...leadTimes].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      medianLeadBlocks = sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    }
    
    return {
      totalEvents: this.groundTruthMap.size,
      detected,
      missed: this.groundTruthMap.size - detected,
      avgLeadBlocks,
      medianLeadBlocks,
    };
  }
}
