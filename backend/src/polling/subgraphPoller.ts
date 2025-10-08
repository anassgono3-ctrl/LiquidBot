import type { SubgraphService } from '../services/SubgraphService.js';
import type { LiquidationCall } from '../types/index.js';
import type { OnDemandHealthFactor } from '../services/OnDemandHealthFactor.js';
import type { AtRiskScanner } from '../services/AtRiskScanner.js';
import {
  liquidationNewEventsTotal,
  liquidationSnapshotSize,
  liquidationSeenTotal,
  atRiskScanUsersTotal,
  atRiskScanCriticalTotal,
  atRiskScanWarnTotal
} from '../metrics/index.js';

import { createLiquidationTracker, type LiquidationTracker } from './liquidationTracker.js';

export interface SubgraphPollerOptions {
  service: SubgraphService;
  intervalMs: number;
  logger?: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  onLiquidations?: (events: LiquidationCall[]) => void;
  onNewLiquidations?: (events: LiquidationCall[]) => void;
  pollLimit?: number;
  trackMax?: number;
  onDemandHealthFactor?: OnDemandHealthFactor;
  atRiskScanner?: AtRiskScanner;
  atRiskScanLimit?: number;
}

export interface SubgraphPollerHandle {
  stop(): void;
  isRunning(): boolean;
  getTrackerStats(): { seenTotal: number; pollLimit: number } | null;
}

function formatError(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || err.toString();
  try { return JSON.stringify(err); } catch { return String(err); }
}

export function startSubgraphPoller(opts: SubgraphPollerOptions): SubgraphPollerHandle {
  const {
    service,
    intervalMs,
    logger = console,
    onLiquidations,
    onNewLiquidations,
    pollLimit = 5,
    trackMax = 5000,
    onDemandHealthFactor,
    atRiskScanner,
    atRiskScanLimit = 0
  } = opts;

  let active = true;
  let isFirstPoll = true;
  const tracker: LiquidationTracker = createLiquidationTracker({ max: trackMax });
  
  logger.info(`[subgraph] starting poller (interval=${intervalMs}ms, pollLimit=${pollLimit}, trackMax=${trackMax})`);

  const tick = async () => {
    if (!active) return;

    if ('isDegraded' in service && typeof service.isDegraded === 'function' && service.isDegraded()) {
      logger.info('[subgraph] poll start (degraded mode) – returning empty snapshot');
    } else {
      logger.info('[subgraph] poll start');
    }

    try {
      const liqs = await service.getLiquidationCalls(pollLimit);
      
      // Use tracker to determine new events
      const { newEvents, snapshotLen, seenSize } = tracker.diff(liqs);
      
      // Update metrics
      liquidationSnapshotSize.set(snapshotLen);
      liquidationSeenTotal.set(seenSize);
      if (newEvents.length > 0) {
        liquidationNewEventsTotal.inc(newEvents.length);
      }
      
      // Select only the LATEST new event for enrichment and notification
      // Sort by timestamp descending and take the first (most recent)
      let latestEvent: LiquidationCall | null = null;
      let skippedOlderCount = 0;
      
      if (newEvents.length > 0) {
        // Sort by timestamp descending to get the latest
        const sortedNew = [...newEvents].sort((a, b) => b.timestamp - a.timestamp);
        latestEvent = sortedNew[0];
        skippedOlderCount = newEvents.length - 1;
        
        if (skippedOlderCount > 0) {
          logger.info(`[subgraph] processing latest event only, skippedOlderNewEvents=${skippedOlderCount}`);
        }
      }
      
      // Resolve health factor for the latest event only (on-demand)
      let hfResolved = 0;
      if (onDemandHealthFactor && latestEvent) {
        try {
          const userId = latestEvent.user.toLowerCase();
          try {
            const hf = await onDemandHealthFactor.getHealthFactor(userId);
            latestEvent.healthFactor = hf;
            if (hf !== null) hfResolved++;
          } catch (err: unknown) {
            const msg = formatError(err);
            logger.error(`[subgraph] health factor resolution error for ${userId}: ${msg}`);
          }
        } catch (err: unknown) {
          const msg = formatError(err);
          logger.error(`[subgraph] health factor resolution error: ${msg}`);
        }
      }
      
      // Log with new format (include hfResolved and skipped counts)
      const hfResolvedMsg = hfResolved > 0 ? ` hfResolved=${hfResolved}` : '';
      const skippedMsg = skippedOlderCount > 0 ? ` skippedOlderNewEvents=${skippedOlderCount}` : '';
      logger.info(
        `[subgraph] liquidation snapshot size=${snapshotLen} new=${newEvents.length} totalSeen=${seenSize}${hfResolvedMsg}${skippedMsg}`
      );
      
      // Log sample of new IDs if any
      if (newEvents.length > 0) {
        const sampleIds = newEvents.slice(0, 3).map(l => l.id.substring(0, 12)).join(', ');
        const truncated = newEvents.length > 3 ? '...' : '';
        logger.info(`[subgraph] new liquidation IDs: ${sampleIds}${truncated}`);
      }
      
      // Log the latest event being processed
      if (latestEvent) {
        logger.info(`[subgraph] processing latest event: id=${latestEvent.id.substring(0, 12)} timestamp=${latestEvent.timestamp}`);
      }
      
      // Check if this is the first poll and bootstrap suppression is enabled
      const shouldIgnoreBootstrap = isFirstPoll && (process.env.IGNORE_BOOTSTRAP_BATCH || 'true').toLowerCase() === 'true';
      
      if (shouldIgnoreBootstrap && newEvents.length > 0) {
        logger.info(`[subgraph] bootstrap batch ignored (${newEvents.length} events suppressed)`);
        isFirstPoll = false;
        // Call onLiquidations for full snapshot but skip onNewLiquidations
        onLiquidations?.(liqs);
        return;
      }
      
      isFirstPoll = false;
      
      // Call callbacks
      onLiquidations?.(liqs);
      // Only notify about the latest event (if any)
      if (latestEvent) {
        onNewLiquidations?.([latestEvent]);
      }

      // At-risk user scanning (if enabled)
      if (atRiskScanner && atRiskScanLimit > 0) {
        try {
          const scanResult = await atRiskScanner.scanAndClassify(atRiskScanLimit);
          
          // Update metrics
          atRiskScanUsersTotal.inc(scanResult.scannedCount);
          atRiskScanCriticalTotal.inc(scanResult.criticalCount);
          atRiskScanWarnTotal.inc(scanResult.warnCount);
          
          // Log summary
          logger.info(
            `[at-risk-scan] users=${atRiskScanLimit} scanned=${scanResult.scannedCount} ` +
            `critical=${scanResult.criticalCount} warn=${scanResult.warnCount} ` +
            `skippedNoDebt=${scanResult.noDebtCount}`
          );
          
          // Send notifications for at-risk users
          if (scanResult.users.length > 0) {
            await atRiskScanner.notifyAtRiskUsers(scanResult.users);
          }
        } catch (err: unknown) {
          const msg = formatError(err);
          logger.error(`[at-risk-scan] scan error: ${msg}`);
        }
      }
    } catch (err: unknown) {
      const msg = formatError(err);
      let details = '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errObj = err as any;
      if (errObj?.response) {
        const status = errObj.response.status;
        details += ` status=${status}`;
        if (errObj.response.errors) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          details += ` graphqlErrors=${JSON.stringify(errObj.response.errors.map((e: any) => e.message))}`;
        }
      }
      logger.error(`[subgraph] poll error: ${msg}${details}`);
      if (process.env.SUBGRAPH_DEBUG_ERRORS === 'true') {
        // eslint-disable-next-line no-console
        console.error('[subgraph][debug] full error:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
      }
    }
  };

  // Immediate first run
  void tick();
  const id = setInterval(tick, intervalMs);

  return {
    stop() {
      if (active) {
        active = false;
        clearInterval(id);
        logger.info('[subgraph] poller stopped');
      }
    },
    isRunning() {
      return active;
    },
    getTrackerStats() {
      const stats = tracker.getStats();
      return {
        seenTotal: stats.seenTotal,
        pollLimit
      };
    }
  };
}
