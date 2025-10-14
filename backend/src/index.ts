import { createServer } from "http";

import express from "express";
import cors from "cors";
import promClient from "prom-client";
import { createLogger, format, transports } from "winston";
import { gql, GraphQLClient } from 'graphql-request';

import { config } from "./config/index.js";
import { authenticate } from "./middleware/auth.js";
import { rateLimiter } from "./middleware/rateLimit.js";
import buildRoutes from "./api/routes.js";
import { initWebSocketServer } from "./websocket/server.js";
import { 
  registry, 
  opportunitiesGeneratedTotal, 
  opportunityProfitEstimate,
  actionableOpportunitiesTotal,
  skippedUnresolvedPlanTotal
} from "./metrics/index.js";
import { SubgraphService } from "./services/SubgraphService.js";
import { startSubgraphPoller, SubgraphPollerHandle } from "./polling/subgraphPoller.js";
import { buildInfo } from "./buildInfo.js";
import { OpportunityService } from "./services/OpportunityService.js";
import { NotificationService } from "./services/NotificationService.js";
import { HealthMonitor } from "./services/HealthMonitor.js";
import { OnDemandHealthFactor } from "./services/OnDemandHealthFactor.js";
import { ExecutionService } from "./services/ExecutionService.js";
import { RiskManager } from "./services/RiskManager.js";
import { HealthCalculator } from "./services/HealthCalculator.js";
import { AtRiskScanner } from "./services/AtRiskScanner.js";
import { RealTimeHFService } from "./services/RealTimeHFService.js";
import type { LiquidatableEvent } from "./services/RealTimeHFService.js";

const logger = createLogger({
  level: "info",
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const app = express();
const httpServer = createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
app.use(rateLimiter);

// Collect default metrics
promClient.collectDefaultMetrics({ register: registry });

// Single service instance
const subgraphService = new SubgraphService();

// Initialize opportunity and notification services
const opportunityService = new OpportunityService();
const notificationService = new NotificationService();
const healthMonitor = new HealthMonitor(subgraphService);

// Initialize execution scaffold
const executionService = new ExecutionService();
const riskManager = new RiskManager();

// Initialize on-demand health factor service (only when not mocking)
let onDemandHealthFactor: OnDemandHealthFactor | undefined;
if (!config.useMockSubgraph) {
  const { endpoint, needsHeader } = config.resolveSubgraphEndpoint();
  let headers: Record<string, string> | undefined;
  if (needsHeader && config.graphApiKey) {
    headers = { Authorization: `Bearer ${config.graphApiKey}` };
  }
  const client = new GraphQLClient(endpoint, { headers });
  onDemandHealthFactor = new OnDemandHealthFactor({
    client,
    debugErrors: config.subgraphDebugErrors
  });
}

// Initialize at-risk scanner (only when enabled via config)
let atRiskScanner: AtRiskScanner | undefined;
if (config.atRiskScanLimit > 0) {
  const healthCalculator = new HealthCalculator();
  atRiskScanner = new AtRiskScanner(
    subgraphService,
    healthCalculator,
    {
      warnThreshold: config.atRiskWarnThreshold,
      liqThreshold: config.atRiskLiqThreshold,
      dustEpsilon: config.atRiskDustEpsilon,
      notifyWarn: config.atRiskNotifyWarn,
      notifyCritical: config.atRiskNotifyCritical
    },
    notificationService
  );
  logger.info(
    `[at-risk-scanner] Initialized with limit=${config.atRiskScanLimit} ` +
    `warnThreshold=${config.atRiskWarnThreshold} liqThreshold=${config.atRiskLiqThreshold} ` +
    `notifyWarn=${config.atRiskNotifyWarn} notifyCritical=${config.atRiskNotifyCritical}`
  );
} else {
  logger.info('[at-risk-scanner] Disabled (AT_RISK_SCAN_LIMIT=0)');
}

// Initialize real-time HF service (only when enabled via config)
let realtimeHFService: RealTimeHFService | undefined;

// Per-block dedupe and in-flight execution tracking
const lastNotifiedBlock = new Map<string, number>();
const inflightExecutions = new Set<string>();

if (config.useRealtimeHF) {
  realtimeHFService = new RealTimeHFService({ subgraphService });
  
  // Handle liquidatable events
  realtimeHFService.on('liquidatable', async (event: LiquidatableEvent) => {
    const userAddr = event.userAddress;
    
    // Per-block dedupe safety net
    const lastBlock = lastNotifiedBlock.get(userAddr);
    if (lastBlock === event.blockNumber) {
      logger.debug(`[realtime-hf] Skip duplicate notification for user=${userAddr} block=${event.blockNumber}`);
      return;
    }
    
    // Prepare actionable opportunity (resolve debt/collateral plan)
    if (config.notifyOnlyWhenActionable) {
      const actionablePlan = await executionService.prepareActionableOpportunity(userAddr, {
        healthFactor: event.healthFactor,
        blockNumber: event.blockNumber,
        triggerType: event.triggerType
      });
      
      if (!actionablePlan) {
        // Cannot resolve debt/collateral plan - log once per block and skip
        logger.info(`[realtime-hf] skip notify (unresolved plan) user=${userAddr} block=${event.blockNumber}`);
        skippedUnresolvedPlanTotal.inc();
        return;
      }
      
      // Build enriched opportunity with resolved plan
      logger.info(`[realtime-hf] notify actionable user=${userAddr} debtAsset=${actionablePlan.debtAssetSymbol} debtToCover=${actionablePlan.debtToCoverUsd.toFixed(2)} bonusBps=${Math.round(actionablePlan.liquidationBonusPct * 10000)}`);
      actionableOpportunitiesTotal.inc();
      
      const opportunity = {
        id: `realtime-${userAddr}-${event.timestamp}`,
        txHash: null,
        user: userAddr,
        liquidator: 'bot',
        timestamp: Math.floor(event.timestamp / 1000),
        collateralAmountRaw: '0',
        principalAmountRaw: actionablePlan.totalDebt.toString(),
        collateralReserve: { id: actionablePlan.collateralAsset, symbol: actionablePlan.collateralSymbol, decimals: 18 },
        principalReserve: { id: actionablePlan.debtAsset, symbol: actionablePlan.debtAssetSymbol, decimals: 6 },
        healthFactor: event.healthFactor,
        triggerSource: 'realtime' as const,
        triggerType: event.triggerType,
        debtToCover: actionablePlan.debtToCover.toString(),
        debtToCoverUsd: actionablePlan.debtToCoverUsd,
        bonusPct: actionablePlan.liquidationBonusPct
      };
      
      // Track notification
      lastNotifiedBlock.set(userAddr, event.blockNumber);
      
      // Send Telegram notification
      await notificationService.notifyOpportunity(opportunity);
      
      // Execute if enabled and not already in-flight
      if (config.executionEnabled) {
        if (config.executionInflightLock && inflightExecutions.has(userAddr)) {
          logger.info(`[realtime-hf] Skip execution - already in-flight for user=${userAddr}`);
          return;
        }
        
        try {
          inflightExecutions.add(userAddr);
          const result = await executionService.execute(opportunity);
          logger.info(`[realtime-hf] Execution result:`, { 
            user: userAddr, 
            success: result.success, 
            reason: result.reason,
            simulated: result.simulated
          });
        } catch (error) {
          logger.error(`[realtime-hf] Execution error:`, { 
            user: userAddr,
            error: error instanceof Error ? error.message : String(error)
          });
        } finally {
          inflightExecutions.delete(userAddr);
        }
      }
    } else {
      // Legacy mode: notify without resolving plan
      logger.info(`[realtime-hf] Liquidatable event: user=${userAddr} HF=${event.healthFactor.toFixed(4)} trigger=${event.triggerType}`);
      
      const opportunity = {
        id: `realtime-${userAddr}-${event.timestamp}`,
        txHash: null,
        user: userAddr,
        liquidator: 'bot',
        timestamp: Math.floor(event.timestamp / 1000),
        collateralAmountRaw: '0',
        principalAmountRaw: '0',
        collateralReserve: { id: 'unknown', symbol: null, decimals: null },
        principalReserve: { id: 'unknown', symbol: null, decimals: null },
        healthFactor: event.healthFactor,
        triggerSource: 'realtime' as const,
        triggerType: event.triggerType
      };
      
      await notificationService.notifyOpportunity(opportunity);
      
      if (config.executionEnabled) {
        try {
          const result = await executionService.execute(opportunity);
          logger.info(`[realtime-hf] Execution result:`, { 
            user: userAddr, 
            success: result.success, 
            reason: result.reason,
            simulated: result.simulated
          });
        } catch (error) {
          logger.error(`[realtime-hf] Execution error:`, { 
            user: userAddr,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  });
  
  logger.info('[realtime-hf] Service initialized and will start when server starts');
} else {
  logger.info('[realtime-hf] Disabled (USE_REALTIME_HF=false)');
}

// Track opportunity stats for health endpoint
const opportunityStats = {
  lastBatchSize: 0,
  totalOpportunities: 0,
  lastProfitSampleUsd: 0
};

// Warmup probe
async function warmup() {
  if (config.useMockSubgraph) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = (subgraphService as any).client;
    if (client) {
      const meta = await client.request(gql`query { _meta { block { number } } }`);
      logger.info(`[subgraph] warmup ok block=${meta?._meta?.block?.number ?? 'n/a'}`);
    }
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    logger.error(`[subgraph] warmup failed: ${errorMessage}`);
    if (config.subgraphDebugErrors) {
      console.error('[subgraph][warmup debug]', e);
    }
  }
}
void warmup();

// Prometheus metrics endpoint (no auth)
app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", registry.contentType);
  res.send(await registry.metrics());
});

// Enhanced health endpoint
app.get("/health", (_req, res) => {
  const healthData: Record<string, unknown> = {
    status: "ok",
    app: {
      uptimeSeconds: Math.floor(process.uptime()),
      version: "0.1.0"
    },
    build: buildInfo,
    subgraph: subgraphService.healthStatus()
  };
  
  // Add liquidation tracker stats if poller is active
  if (subgraphPoller) {
    const trackerStats = subgraphPoller.getTrackerStats();
    if (trackerStats) {
      healthData.liquidationTracker = trackerStats;
    }
  }

  // Add opportunity stats
  healthData.opportunity = opportunityStats;

  // Health monitoring status (now disabled)
  healthData.healthMonitoring = healthMonitor.getStats();

  // Add notification status
  healthData.notifications = {
    telegramEnabled: notificationService.isEnabled()
  };

  // Add on-demand health factor flag
  healthData.onDemandHealthFactor = !!onDemandHealthFactor;
  
  // Add real-time HF service metrics if enabled
  if (realtimeHFService) {
    healthData.realtimeHF = realtimeHFService.getMetrics();
  }
  
  res.json(healthData);
});

// Inject the singleton service
app.use("/api/v1", authenticate, buildRoutes(subgraphService));

// Initialize WebSocket server
const { wss, broadcastLiquidationEvent, broadcastOpportunityEvent } = initWebSocketServer(httpServer);

let subgraphPoller: SubgraphPollerHandle | null = null;

if (!config.useMockSubgraph) {
  const resolved = config.resolveSubgraphEndpoint();
  logger.info(`Subgraph resolved endpoint authMode=${resolved.mode} header=${resolved.needsHeader} url=${config.subgraphUrl.replace(config.graphApiKey || '', '****')}`);
  
  subgraphPoller = startSubgraphPoller({
    service: subgraphService,
    intervalMs: config.subgraphPollIntervalMs || 15000,
    logger,
    pollLimit: config.pollLimit,
    trackMax: config.liquidationTrackMax,
    onDemandHealthFactor,
    atRiskScanner,
    atRiskScanLimit: config.atRiskScanLimit,
    onLiquidations: () => {
      // placeholder for raw snapshot callback
    },
    onNewLiquidations: async (newEvents) => {
      // Broadcast new liquidation events via WebSocket
      if (newEvents.length > 0 && wss.clients.size > 0) {
        broadcastLiquidationEvent({
          type: 'liquidation.new',
          liquidations: newEvents.map(e => ({
            id: e.id,
            timestamp: e.timestamp,
            user: e.user,
            liquidator: e.liquidator
          })),
          timestamp: new Date().toISOString()
        });
      }

      // Build opportunities from new liquidations
      try {
        // Health factors are already attached to newEvents by poller (on-demand)
        // Pass empty health snapshot map (no longer used)
        const healthSnapshots = new Map();
        
        // Build opportunities
        const opportunities = await opportunityService.buildOpportunities(newEvents, healthSnapshots);
        
        // Update stats
        opportunityStats.lastBatchSize = opportunities.length;
        opportunityStats.totalOpportunities += opportunities.length;
        if (opportunities.length > 0 && opportunities[0].profitEstimateUsd !== null && opportunities[0].profitEstimateUsd !== undefined) {
          opportunityStats.lastProfitSampleUsd = opportunities[0].profitEstimateUsd;
        }

        // Update metrics
        opportunitiesGeneratedTotal.inc(opportunities.length);
        for (const op of opportunities) {
          if (op.profitEstimateUsd !== null && op.profitEstimateUsd !== undefined && op.profitEstimateUsd > 0) {
            opportunityProfitEstimate.observe(op.profitEstimateUsd);
          }
        }

        // Broadcast opportunity events via WebSocket
        if (opportunities.length > 0 && wss.clients.size > 0) {
          broadcastOpportunityEvent({
            type: 'opportunity.new',
            opportunities: opportunities.map(op => ({
              id: op.id,
              user: op.user,
              profitEstimateUsd: op.profitEstimateUsd ?? null,
              healthFactor: op.healthFactor ?? null,
              timestamp: op.timestamp
            })),
            timestamp: new Date().toISOString()
          });
        }

        // Send Telegram notifications for profitable opportunities
        const profitableOps = opportunityService.filterProfitableOpportunities(opportunities);
        for (const op of profitableOps) {
          await notificationService.notifyOpportunity(op);
        }
        
        if (profitableOps.length > 0) {
          logger.info(`[opportunity] Found ${profitableOps.length} profitable opportunities (profit >= $${config.profitMinUsd})`);
        }

        // Execution pipeline (scaffold - disabled by default)
        // Note: This does NOT auto-execute from scanner - requires explicit enablement
        for (const op of profitableOps) {
          try {
            // Calculate after-gas profit
            const gasCostUsd = config.gasCostUsd;
            const afterGasProfit = (op.profitEstimateUsd || 0) - gasCostUsd;

            // Apply risk checks
            const riskCheck = riskManager.canExecute(op, afterGasProfit);
            if (!riskCheck.allowed) {
              logger.info(`[execution] Skipped opportunity ${op.id}: ${riskCheck.reason}`);
              continue;
            }

            // Execute (will be simulated/skipped based on config)
            const result = await executionService.execute(op);
            
            if (result.success) {
              logger.info(`[execution] Executed opportunity ${op.id}:`, {
                simulated: result.simulated,
                reason: result.reason,
                txHash: result.txHash,
                realizedProfitUsd: result.realizedProfitUsd
              });
              
              // Record realized P&L if real execution
              if (!result.simulated && result.realizedProfitUsd !== undefined) {
                riskManager.recordRealizedProfit(result.realizedProfitUsd);
              }
            } else {
              logger.info(`[execution] Skipped opportunity ${op.id}: ${result.reason}`);
            }
          } catch (err) {
            logger.error(`[execution] Failed to execute opportunity ${op.id}:`, err);
          }
        }
      } catch (err) {
        logger.error('[opportunity] Failed to process opportunities:', err);
      }
    }
  });

  // Note: Bulk health monitoring has been disabled
  // Health factors are now resolved on-demand per liquidation event
  logger.info('[health-monitor] Bulk health monitoring disabled - using on-demand resolution');
}

// Graceful shutdown handling
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down...`);
  subgraphPoller?.stop();
  
  // Stop real-time HF service if running
  if (realtimeHFService) {
    try {
      await realtimeHFService.stop();
      logger.info('[realtime-hf] Service stopped');
    } catch (err) {
      logger.error('[realtime-hf] Error stopping service:', err);
    }
  }
  
  wss.close(() => {
    logger.info("WebSocket server closed");
    process.exit(0);
  });
};
["SIGINT", "SIGTERM"].forEach((sig) => process.on(sig, () => shutdown(sig)));

const port = config.port;
httpServer.listen(port, async () => {
  logger.info(`LiquidBot backend listening on port ${port}`);
  logger.info(`WebSocket server available at ws://localhost:${port}/ws`);
  logger.info(`Build info: commit=${buildInfo.commit} node=${buildInfo.node} started=${buildInfo.startedAt}`);
  logger.info(`Subgraph endpoint: ${config.useMockSubgraph ? "(MOCK MODE)" : config.subgraphUrl.replace(config.graphApiKey || '', '****')}`);
  
  // Start real-time HF service if enabled
  if (realtimeHFService) {
    try {
      await realtimeHFService.start();
      logger.info('[realtime-hf] Service started successfully');
    } catch (err) {
      logger.error('[realtime-hf] Failed to start service:', err);
    }
  }
});
