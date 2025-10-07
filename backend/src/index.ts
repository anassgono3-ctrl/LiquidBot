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
import { registry, opportunitiesGeneratedTotal, opportunityProfitEstimate, healthBreachEventsTotal } from "./metrics/index.js";
import { SubgraphService } from "./services/SubgraphService.js";
import { startSubgraphPoller, SubgraphPollerHandle } from "./polling/subgraphPoller.js";
import { buildInfo } from "./buildInfo.js";
import { OpportunityService } from "./services/OpportunityService.js";
import { NotificationService } from "./services/NotificationService.js";
import { HealthMonitor } from "./services/HealthMonitor.js";
import { HealthFactorResolver } from "./services/HealthFactorResolver.js";

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

// Initialize health factor resolver (only when not mocking)
let healthFactorResolver: HealthFactorResolver | undefined;
if (!config.useMockSubgraph) {
  const { endpoint, needsHeader } = config.resolveSubgraphEndpoint();
  let headers: Record<string, string> | undefined;
  if (needsHeader && config.graphApiKey) {
    headers = { Authorization: `Bearer ${config.graphApiKey}` };
  }
  const client = new GraphQLClient(endpoint, { headers });
  healthFactorResolver = new HealthFactorResolver({
    client,
    cacheTtlMs: config.healthUserCacheTtlMs,
    maxBatchSize: config.healthMaxBatch,
    debugErrors: config.subgraphDebugErrors
  });
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

  // Add health monitoring stats
  healthData.healthMonitoring = healthMonitor.getStats();

  // Add notification status
  healthData.notifications = {
    telegramEnabled: notificationService.isEnabled()
  };

  // Add health factor resolver stats
  if (healthFactorResolver) {
    const cacheStats = healthFactorResolver.getCacheStats();
    healthData.healthFactorCache = {
      size: cacheStats.size,
      ttlMs: cacheStats.ttlMs,
      maxBatchSize: cacheStats.maxBatchSize,
      queryMode: config.healthQueryMode
    };
  }
  
  res.json(healthData);
});

// Inject the singleton service
app.use("/api/v1", authenticate, buildRoutes(subgraphService));

// Initialize WebSocket server
const { wss, broadcastLiquidationEvent, broadcastOpportunityEvent, broadcastHealthBreachEvent } = initWebSocketServer(httpServer);

let subgraphPoller: SubgraphPollerHandle | null = null;
let healthMonitorInterval: NodeJS.Timeout | null = null;

if (!config.useMockSubgraph) {
  const resolved = config.resolveSubgraphEndpoint();
  logger.info(`Subgraph resolved endpoint authMode=${resolved.mode} header=${resolved.needsHeader} url=${config.subgraphUrl.replace(config.graphApiKey || '', '****')}`);
  
  subgraphPoller = startSubgraphPoller({
    service: subgraphService,
    intervalMs: config.subgraphPollIntervalMs || 15000,
    logger,
    pollLimit: config.liquidationPollLimit,
    trackMax: config.liquidationTrackMax,
    healthFactorResolver,
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
        // Get health snapshot for context
        const healthSnapshots = await healthMonitor.getHealthSnapshotMap();
        
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
      } catch (err) {
        logger.error('[opportunity] Failed to process opportunities:', err);
      }
    }
  });

  // Start health monitoring (check every 2 poll intervals)
  const healthCheckInterval = (config.subgraphPollIntervalMs || 15000) * 2;
  healthMonitorInterval = setInterval(async () => {
    try {
      const breaches = await healthMonitor.updateAndDetectBreaches();
      
      if (breaches.length > 0) {
        logger.info(`[health-monitor] Detected ${breaches.length} health factor breaches`);
        
        // Update metrics
        healthBreachEventsTotal.inc(breaches.length);
        
        // Broadcast each breach via WebSocket
        for (const breach of breaches) {
          if (wss.clients.size > 0) {
            broadcastHealthBreachEvent({
              type: 'health.breach',
              user: breach.user,
              healthFactor: breach.healthFactor,
              threshold: breach.threshold,
              timestamp: new Date(breach.timestamp * 1000).toISOString()
            });
          }
          
          // Send Telegram notification
          await notificationService.notifyHealthBreach({
            user: breach.user,
            healthFactor: breach.healthFactor,
            threshold: breach.threshold,
            timestamp: breach.timestamp
          });
        }
      }
    } catch (err) {
      logger.error('[health-monitor] Health check failed:', err);
    }
  }, healthCheckInterval);
  
  logger.info(`[health-monitor] Started health monitoring (interval=${healthCheckInterval}ms, threshold=${config.healthAlertThreshold})`);
}

// Graceful shutdown handling
const shutdown = (signal: string) => {
  logger.info(`Received ${signal}, shutting down...`);
  subgraphPoller?.stop();
  if (healthMonitorInterval) {
    clearInterval(healthMonitorInterval);
  }
  wss.close(() => {
    logger.info("WebSocket server closed");
    process.exit(0);
  });
};
["SIGINT", "SIGTERM"].forEach((sig) => process.on(sig, () => shutdown(sig)));

const port = config.port;
httpServer.listen(port, () => {
  logger.info(`LiquidBot backend listening on port ${port}`);
  logger.info(`WebSocket server available at ws://localhost:${port}/ws`);
  logger.info(`Build info: commit=${buildInfo.commit} node=${buildInfo.node} started=${buildInfo.startedAt}`);
  logger.info(`Subgraph endpoint: ${config.useMockSubgraph ? "(MOCK MODE)" : config.subgraphUrl.replace(config.graphApiKey || '', '****')}`);
});
