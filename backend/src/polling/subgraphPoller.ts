import type { SubgraphService } from '../services/SubgraphService.js';
import type { LiquidationCall } from '../types/index.js';
import type { OnDemandHealthFactor } from '../services/OnDemandHealthFactor.js';
import {
  liquidationNewEventsTotal,
  liquidationSnapshotSize,
  liquidationSeenTotal
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
    onDemandHealthFactor
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
      
      // Resolve health factors for new events (on-demand, one at a time)
      let hfResolved = 0;
      if (onDemandHealthFactor && newEvents.length > 0) {
        try {
          // Gather unique user IDs from new events
          const uniqueUserIds = [...new Set(newEvents.map(e => e.user.toLowerCase()))];
          
          // Fetch health factor individually for each unique user (no batching)
          for (const userId of uniqueUserIds) {
            try {
              const hf = await onDemandHealthFactor.getHealthFactor(userId);
              
              // Attach HF to all events for this user
              for (const event of newEvents) {
                if (event.user.toLowerCase() === userId) {
                  event.healthFactor = hf;
                  if (hf !== null) hfResolved++;
                }
              }
            } catch (err: unknown) {
              const msg = formatError(err);
              logger.error(`[subgraph] health factor resolution error for ${userId}: ${msg}`);
            }
          }
        } catch (err: unknown) {
          const msg = formatError(err);
          logger.error(`[subgraph] health factor resolution error: ${msg}`);
        }
      }
      
      // Log with new format (include hfResolved when > 0)
      const hfResolvedMsg = hfResolved > 0 ? ` hfResolved=${hfResolved}` : '';
      logger.info(
        `[subgraph] liquidation snapshot size=${snapshotLen} new=${newEvents.length} totalSeen=${seenSize}${hfResolvedMsg}`
      );
      
      // Log sample of new IDs if any
      if (newEvents.length > 0) {
        const sampleIds = newEvents.slice(0, 3).map(l => l.id.substring(0, 12)).join(', ');
        const truncated = newEvents.length > 3 ? '...' : '';
        logger.info(`[subgraph] new liquidation IDs: ${sampleIds}${truncated}`);
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
      if (newEvents.length > 0) {
        onNewLiquidations?.(newEvents);
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
