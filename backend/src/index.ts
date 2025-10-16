import { createServer } from "http";

import express from "express";
import cors from "cors";
import promClient from "prom-client";
import { createLogger, format, transports } from "winston";

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
import { buildInfo } from "./buildInfo.js";
import { OpportunityService } from "./services/OpportunityService.js";
import { NotificationService } from "./services/NotificationService.js";
import { ExecutionService } from "./services/ExecutionService.js";
import { RiskManager } from "./services/RiskManager.js";
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

// Initialize opportunity and notification services
const opportunityService = new OpportunityService();
const notificationService = new NotificationService();

// Initialize execution scaffold
const executionService = new ExecutionService();
const riskManager = new RiskManager();

// Initialize real-time HF service (only when enabled via config)
let realtimeHFService: RealTimeHFService | undefined;

// Per-block dedupe and in-flight execution tracking
const lastNotifiedBlock = new Map<string, number>();
const inflightExecutions = new Set<string>();

if (config.useRealtimeHF) {
  realtimeHFService = new RealTimeHFService();
  
  // Handle liquidatable events
  realtimeHFService.on('liquidatable', async (event: LiquidatableEvent) => {
    const userAddr = event.userAddress;
    
    // Per-block dedupe safety net
    const lastBlock = lastNotifiedBlock.get(userAddr);
    if (lastBlock === event.blockNumber) {
      logger.debug(`[realtime-hf] Skip duplicate notification for user=${userAddr} block=${event.blockNumber}`);
      return;
    }
    
    // Always resolve actionable opportunity (debt/collateral plan)
    // This ensures we never notify or execute without a fully resolved plan
    const actionablePlan = await executionService.prepareActionableOpportunity(userAddr, {
      healthFactor: event.healthFactor,
      blockNumber: event.blockNumber,
      triggerType: event.triggerType
    });
    
    if (!actionablePlan) {
      // Cannot resolve debt/collateral plan - log once per block and skip
      // Reasons: no debt, no collateral, below PROFIT_MIN_USD, or resolve failure
      logger.info(`[realtime-hf] skip notify (unresolved plan) user=${userAddr} block=${event.blockNumber}`);
      skippedUnresolvedPlanTotal.inc();
      return;
    }
    
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

  // Add notification status
  healthData.notifications = {
    telegramEnabled: notificationService.isEnabled()
  };
  
  // Add real-time HF service metrics if enabled
  if (realtimeHFService) {
    healthData.realtimeHF = realtimeHFService.getMetrics();
  }
  
  res.json(healthData);
});

// API routes (minimal auth check only)
app.use("/api/v1", authenticate, (req, res) => {
  res.json({ message: "API v1 - real-time liquidation detection only" });
});

// Initialize WebSocket server
const { wss } = initWebSocketServer(httpServer);

// Graceful shutdown handling
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down...`);
  
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
