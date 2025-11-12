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
  actionableOpportunitiesTotal,
  skippedUnresolvedPlanTotal
} from "./metrics/index.js";
import { SubgraphService } from "./services/SubgraphService.js";
import { startSubgraphPoller, SubgraphPollerHandle } from "./polling/subgraphPoller.js";
import { buildInfo } from "./buildInfo.js";
import { NotificationService } from "./services/NotificationService.js";
import { PriceService } from "./services/PriceService.js";
import { HealthMonitor } from "./services/HealthMonitor.js";
import { OnDemandHealthFactor } from "./services/OnDemandHealthFactor.js";
import { ExecutionService } from "./services/ExecutionService.js";
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

// Single service instance - only when USE_SUBGRAPH=true
let subgraphService: SubgraphService | undefined;

if (config.useSubgraph) {
  subgraphService = new SubgraphService();
  logger.info('[subgraph] Service enabled (USE_SUBGRAPH=true)');
} else {
  logger.info('[subgraph] Service disabled (USE_SUBGRAPH=false) - relying on on-chain discovery');
}

// Initialize price and notification services
const priceService = new PriceService();
const notificationService = new NotificationService(priceService);
const healthMonitor = new HealthMonitor(subgraphService || SubgraphService.createMock());

// Initialize execution scaffold
const executionService = new ExecutionService();

// Log execution configuration prominently at startup
if (config.executionEnabled) {
  logger.info('[config] EXECUTION_ENABLED=true (live execution active)');
} else {
  logger.info('[config] EXECUTION_ENABLED=false (execution disabled)');
}

// Initialize AaveMetadata if RPC is configured (async initialization deferred)
// Use async IIFE to initialize AaveMetadata
(async () => {
  // Check if we have an RPC URL configured for execution
  const rpcUrl = process.env.RPC_URL;
  if (rpcUrl) {
    try {
      const { ethers } = await import('ethers');
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const { AaveMetadata } = await import('./aave/AaveMetadata.js');
      const metadata = new AaveMetadata(provider);
      await metadata.initialize();
      executionService.setAaveMetadata(metadata);
      logger.info(`[aave-metadata] Initialized with ${metadata.getReserveCount()} reserves`);
    } catch (error) {
      logger.error('[aave-metadata] Failed to initialize:', error);
    }
  }
})().catch(err => logger.error('[aave-metadata] Initialization error:', err));

// Initialize on-demand health factor service (only when USE_SUBGRAPH=true and not mocking)
let onDemandHealthFactor: OnDemandHealthFactor | undefined;
if (config.useSubgraph && !config.useMockSubgraph) {
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

// Initialize at-risk scanner (only when enabled via config and USE_SUBGRAPH=true)
let atRiskScanner: AtRiskScanner | undefined;
if (config.useSubgraph && config.atRiskScanLimit > 0 && subgraphService) {
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
  logger.info('[at-risk-scanner] Disabled (requires USE_SUBGRAPH=true and AT_RISK_SCAN_LIMIT>0)');
}

// Initialize real-time HF service (only when enabled via config)
let realtimeHFService: RealTimeHFService | undefined;

// Per-block dedupe and in-flight execution tracking
const lastNotifiedBlock = new Map<string, number>();
const inflightExecutions = new Set<string>();

if (config.useRealtimeHF) {
  realtimeHFService = new RealTimeHFService({ 
    subgraphService, 
    notificationService, 
    priceService 
  });
  
  // Handle liquidatable events
  realtimeHFService.on('liquidatable', async (event: LiquidatableEvent) => {
    const userAddr = event.userAddress;
    
    // Per-block dedupe safety net
    const lastBlock = lastNotifiedBlock.get(userAddr);
    if (lastBlock === event.blockNumber) {
      logger.debug(`[realtime-hf] Skip duplicate notification for user=${userAddr} block=${event.blockNumber}`);
      return;
    }
    
    // Always resolve actionable opportunity with explicit skip reasons
    const result = await executionService.prepareActionableOpportunityWithReason(userAddr, {
      healthFactor: event.healthFactor,
      blockNumber: event.blockNumber,
      triggerType: event.triggerType
    });
    
    if (!result.success) {
      // Cannot resolve plan - log with explicit reason
      const details = result.details ? ` details=${result.details}` : '';
      logger.info(`[notify] skip user=${userAddr} reason=${result.skipReason}${details}`);
      skippedUnresolvedPlanTotal.inc();
      return;
    }
    
    const actionablePlan = result.plan;
    
    // Build enriched opportunity with resolved plan
    logger.info(`[realtime-hf] notify actionable user=${userAddr} debtAsset=${actionablePlan.debtAssetSymbol} collateral=${actionablePlan.collateralSymbol} debtToCover=$${actionablePlan.debtToCoverUsd.toFixed(2)} bonusBps=${Math.round(actionablePlan.liquidationBonusPct * 10000)}`);
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
  });
  
  logger.info('[realtime-hf] Service initialized and will start when server starts');
} else {
  logger.info('[realtime-hf] Disabled (USE_REALTIME_HF=false)');
}



// Warmup probe
async function warmup() {
  if (!config.useSubgraph || config.useMockSubgraph || !subgraphService) return;
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
    build: buildInfo
  };
  
  // Add subgraph health only when enabled
  if (config.useSubgraph && subgraphService) {
    healthData.subgraph = subgraphService.healthStatus();
  } else {
    healthData.subgraph = { mode: 'disabled', enabled: false };
  }
  
  // Add liquidation tracker stats if poller is active
  if (subgraphPoller) {
    const trackerStats = subgraphPoller.getTrackerStats();
    if (trackerStats) {
      healthData.liquidationTracker = trackerStats;
    }
  }

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

// Status endpoint with low HF tracking data
app.get("/status", (_req, res) => {
  const statusData: Record<string, unknown> = {
    lastBlock: null,
    candidateCount: 0,
    lastMinHF: null,
    lowHfCount: 0
  };

  if (realtimeHFService) {
    const metrics = realtimeHFService.getMetrics();
    statusData.candidateCount = metrics.candidateCount;
    statusData.lastMinHF = metrics.minHF;

    const tracker = realtimeHFService.getLowHFTracker();
    if (tracker) {
      statusData.lowHfCount = tracker.getCount();
    }
  }

  res.json(statusData);
});

// Low HF entries endpoint with pagination
app.get("/lowhf", (req, res) => {
  if (!realtimeHFService) {
    return res.status(503).json({ error: 'Real-time HF service not available' });
  }

  const tracker = realtimeHFService.getLowHFTracker();
  if (!tracker) {
    return res.status(503).json({ error: 'Low HF tracker not enabled' });
  }

  // Parse query parameters
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
  const offset = parseInt(req.query.offset as string) || 0;
  const includeReserves = (req.query.includeReserves as string) !== '0';

  const entries = tracker.getPaginated(limit, offset, includeReserves);

  res.json({
    entries,
    count: entries.length,
    total: tracker.getCount(),
    limit,
    offset,
    minHF: tracker.getMinHF()
  });
});

// Inject the singleton service
app.use("/api/v1", authenticate, buildRoutes(subgraphService || SubgraphService.createMock()));

// Initialize WebSocket server
const { wss, broadcastLiquidationEvent } = initWebSocketServer(httpServer);

let subgraphPoller: SubgraphPollerHandle | null = null;

// NOTE: SubgraphPoller is DEPRECATED for triggering notifications/executions.
// It now serves only for monitoring historical liquidations and at-risk scanning.
// Subgraph is used for candidate discovery ONLY via SubgraphSeeder in RealTimeHFService.
// The real-time engine (RealTimeHFService) is the ONLY trigger path for notifications/executions.
if (config.useSubgraph && !config.useMockSubgraph && subgraphService) {
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
      // DISABLED: Subgraph liquidationCalls must NOT trigger notifications or executions.
      // The real-time engine (RealTimeHFService) is the ONLY trigger path.
      // Subgraph is used ONLY for candidate discovery via SubgraphSeeder.
      
      // Log for monitoring purposes only
      if (newEvents.length > 0) {
        logger.info(
          `[subgraph-poller] Detected ${newEvents.length} historical liquidation(s) ` +
          `(not triggering notifications - real-time engine handles detection)`
        );
      }
      
      // Broadcast informational events via WebSocket only (no notifications/executions)
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
    }
  });

  // Note: Bulk health monitoring has been disabled
  // Health factors are now resolved on-demand per liquidation event
  logger.info('[health-monitor] Bulk health monitoring disabled - using on-demand resolution');
} else {
  logger.info('[subgraph-poller] Disabled (USE_SUBGRAPH=false or in mock mode)');
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
  
  // Log critical configuration at startup
  logger.info(`[config] NOTIFY_ONLY_WHEN_ACTIONABLE=${config.notifyOnlyWhenActionable}`);
  logger.info(`[config] ALWAYS_INCLUDE_HF_BELOW=${config.alwaysIncludeHfBelow}`);
  logger.info(`[config] PROFIT_MIN_USD=${config.profitMinUsd}`);
  logger.info(`[config] EXECUTION_HF_THRESHOLD_BPS=${config.executionHfThresholdBps}`);
  if (config.secondaryHeadRpcUrl) {
    logger.info(`[config] SECONDARY_HEAD_RPC_URL configured for fallback`);
  }
  // AaveMetadata info is logged during initialization above
  
  // Log subgraph status
  if (config.useSubgraph) {
    logger.info(`Subgraph endpoint: ${config.useMockSubgraph ? "(MOCK MODE)" : config.subgraphUrl.replace(config.graphApiKey || '', '****')}`);
  } else {
    logger.info('Subgraph: DISABLED (USE_SUBGRAPH=false) - using on-chain discovery only');
  }
  
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
