import type { SubgraphService } from '../services/SubgraphService.js';
import type { LiquidationCall } from '../types/index.js';

export interface SubgraphPollerOptions {
  service: SubgraphService;
  intervalMs: number;
  logger?: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  onLiquidations?: (events: LiquidationCall[]) => void;
}

export interface SubgraphPollerHandle {
  stop(): void;
  isRunning(): boolean;
}

function formatError(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || err.toString();
  try { return JSON.stringify(err); } catch { return String(err); }
}

export function startSubgraphPoller(opts: SubgraphPollerOptions): SubgraphPollerHandle {
  const { service, intervalMs, logger = console, onLiquidations } = opts;

  let active = true;
  logger.info(`[subgraph] starting poller (interval=${intervalMs}ms)`);

  const tick = async () => {
    if (!active) return;

    if ('isDegraded' in service && typeof service.isDegraded === 'function' && service.isDegraded()) {
      logger.info('[subgraph] poll start (degraded mode) – returning empty snapshot');
    } else {
      logger.info('[subgraph] poll start');
    }

    try {
      const liqs = await service.getLiquidationCalls(50);
      if (liqs.length > 0) {
        const sample = liqs.slice(0, 3).map(l => l.id.substring(0, 12)).join(', ');
        logger.info(`[subgraph] retrieved ${liqs.length} liquidation calls (sample ids: ${sample}...)`);
      } else {
        logger.info('[subgraph] retrieved 0 liquidation calls');
      }
      onLiquidations?.(liqs);
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
    }
  };
}
