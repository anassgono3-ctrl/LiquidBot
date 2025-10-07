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

export function startSubgraphPoller(opts: SubgraphPollerOptions): SubgraphPollerHandle {
  const { service, intervalMs, logger = console, onLiquidations } = opts;

  let active = true;
  logger.info(`[subgraph] starting poller (interval=${intervalMs}ms)`);

  const tick = async () => {
    if (!active) return;
    logger.info('[subgraph] poll start');
    try {
      const liqs = await service.getLiquidationCalls(100);
      logger.info(`[subgraph] retrieved ${liqs.length} liquidation calls`);
      if (onLiquidations) {
        onLiquidations(liqs);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[subgraph] poll error:', message);
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
