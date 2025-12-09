import { createServer } from "http";
import { mkdirSync } from "fs";
import { join } from "path";

import express from "express";
import cors from "cors";
import { createLogger, format, transports } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { gql, GraphQLClient } from 'graphql-request';

import { config } from "./config/index.js";
import { authenticate } from "./middleware/auth.js";
import { rateLimiter } from "./middleware/rateLimit.js";
import buildRoutes from "./api/routes.js";
import { initWebSocketServer } from "./websocket/server.js";
import { 
  registry,
  actionableOpportunitiesTotal,
  skippedUnresolvedPlanTotal,
  initMetricsOnce,
  predictiveMicroVerifyScheduledTotal,
  predictivePrestagedTotal
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
import { StartupDiagnosticsService } from "./services/StartupDiagnostics.js";
import { PredictiveOrchestrator, type PredictiveScenarioEvent, type UserSnapshotProvider } from './risk/PredictiveOrchestrator.js';
import type { UserSnapshot, ReserveData } from './risk/HFCalculator.js';
import type { AaveDataService } from './services/AaveDataService.js';

// Configure logger with optional file transport
const loggerTransports: any[] = [new transports.Console()];

// Add file transport if enabled
if (config.logFileEnabled) {
  // Ensure logs directory exists
  const logsDir = join(process.cwd(), 'logs');
  try {
    mkdirSync(logsDir, { recursive: true });
  } catch (err) {
    console.error('[logger] Failed to create logs directory:', err);
  }
  
  // Calculate retention - winston-daily-rotate-file supports 'Nh' and 'Nd' formats
  // Use hours directly for sub-24h retention, days for 24h+
  const retentionHours = config.logFileRetentionHours;
  const retentionSpec = retentionHours >= 24 
    ? `${Math.floor(retentionHours / 24)}d`  // Use floor to not exceed configured retention
    : `${retentionHours}h`;
  
  // Add rotating file transport
  const fileTransport = new DailyRotateFile({
    filename: join(logsDir, 'bot-%DATE%.log'),
    datePattern: 'YYYY-MM-DD-HH', // Hourly rotation
    maxSize: '50m', // Max 50MB per file
    maxFiles: retentionSpec, // Retention based on config
    format: format.combine(
      format.timestamp(),
      format.json()
    ),
    auditFile: join(logsDir, '.audit.json')
  });
  
  loggerTransports.push(fileTransport);
  
  console.log(`[logger] File logging enabled: logs/bot-*.log (retention: ${config.logFileRetentionHours}h)`);
}

const logger = createLogger({
  level: "info",
  format: format.combine(format.timestamp(), format.json()),
  transports: loggerTransports,
});

/**
 * Helper function to build UserSnapshot reserves with REAL data from AaveDataService
 * Used by PredictiveOrchestrator for accurate HF projections
 */
async function buildUserReserves(userAddress: string, aaveDataService: AaveDataService | undefined): Promise<ReserveData[]> {
  if (!aaveDataService || !aaveDataService.isInitialized()) {
    // Fallback: return empty reserves if service not available
    return [];
  }

  // Guard: If WebSocket is unhealthy, skip to avoid provider destroyed errors
  // Service will automatically route through HTTP when needed
  if (!aaveDataService.isWsHealthy()) {
    // eslint-disable-next-line no-console
    console.log(`[provider] ws_unhealthy; buildUserReserves will use http fallback for ${userAddress}`);
  }

  try {
    // Fetch all user reserves from Aave Protocol Data Provider
    const userReserves = await aaveDataService.getAllUserReserves(userAddress);
    
    // Transform to ReserveData format required by HFCalculator
    const reserves: ReserveData[] = [];
    
    for (const reserve of userReserves) {
      // Get liquidation threshold from reserve config
      const configData = await aaveDataService.getReserveConfigurationData(reserve.asset);
      const liquidationThreshold = Number(configData.liquidationThreshold) / 10000; // Convert from bps
      
      reserves.push({
        asset: reserve.asset,
        debtUsd: reserve.debtValueUsd,
        collateralUsd: reserve.collateralValueUsd,
        liquidationThreshold
      });
    }
    
    return reserves;
  } catch (err) {
    logger.error(`[build-user-reserves] Error fetching reserves for ${userAddress}:`, err);
    return [];
  }
}

// Initialize metrics before any other modules attempt to use them
initMetricsOnce();

const app = express();
const httpServer = createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
app.use(rateLimiter);

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

// Module-level references for AaveMetadata and TokenMetadataRegistry
// These will be initialized asynchronously and used by multiple services
let aaveMetadata: import('./aave/AaveMetadata.js').AaveMetadata | undefined;
let tokenMetadataRegistry: import('./services/TokenMetadataRegistry.js').TokenMetadataRegistry | undefined;

// Initialize AaveMetadata if RPC is configured (async initialization deferred)
// Use async IIFE to initialize AaveMetadata and TokenMetadataRegistry
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
      
      // Store in module-level variable for use by other services
      aaveMetadata = metadata;
      
      executionService.setAaveMetadata(metadata);
      logger.info(`[aave-metadata] Initialized with ${metadata.getReserveCount()} reserves`);
      
      // Initialize TokenMetadataRegistry
      const { TokenMetadataRegistry } = await import('./services/TokenMetadataRegistry.js');
      const tokenRegistry = new TokenMetadataRegistry({
        provider,
        aaveMetadata: metadata
      });
      
      // Store in module-level variable for use by other services
      tokenMetadataRegistry = tokenRegistry;
      
      // Try to connect Redis for distributed caching
      const redisUrl = config.redisUrl;
      if (redisUrl) {
        try {
          const ioredis = await import('ioredis');
          const redis = new ioredis.Redis(redisUrl, {
            retryStrategy: (times: number) => Math.min(times * 50, 2000),
            maxRetriesPerRequest: 3
          });
          await redis.ping();
          tokenRegistry.setRedis(redis);
          logger.info('[token-registry] Initialized with Redis caching');
        } catch (redisError) {
          logger.warn('[token-registry] Redis not available, using in-memory cache only:', redisError);
        }
      } else {
        logger.info('[token-registry] Initialized with in-memory cache (Redis not configured)');
      }
      
      // Wire the registry into services that need it
      if (executionService && typeof executionService.setTokenRegistry === 'function') {
        executionService.setTokenRegistry(tokenRegistry);
        executionService.setAaveMetadata(metadata);
      }
      
      // Note: realtimeHFService may not be initialized yet (it's created later)
      // We'll wire it asynchronously below after this initialization completes
      
      logger.info('[token-registry] Initialized and wired into ExecutionService');
    } catch (error) {
      logger.error('[aave-metadata] Failed to initialize:', error);
    }
  }
})().then(() => {
  // Wire TokenMetadataRegistry into RealTimeHFService if it was created
  // This runs after the async initialization above completes
  if (realtimeHFService && tokenMetadataRegistry) {
    realtimeHFService.setTokenRegistry(tokenMetadataRegistry);
    logger.info('[token-registry] Wired into RealTimeHFService');
  }
  if (realtimeHFService && aaveMetadata) {
    realtimeHFService.setAaveMetadata(aaveMetadata);
    logger.info('[aave-metadata] Wired into RealTimeHFService');
  }
}).catch(err => logger.error('[aave-metadata] Initialization error:', err));

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

// Per-block dedupe and in-flight execution tracking
const lastNotifiedBlock = new Map<string, number>();
const inflightExecutions = new Set<string>();

// Initialize predictive orchestrator (only when enabled via config and realtime HF is enabled)
// Must be created before RealTimeHFService so it can be passed in options
let predictiveOrchestrator: PredictiveOrchestrator | undefined;

if (config.predictiveEnabled && config.useRealtimeHF) {
  predictiveOrchestrator = new PredictiveOrchestrator();
  logger.info('[predictive-orchestrator] Created (will wire after RealTimeHFService initialization)');
}

// Initialize real-time HF service (only when enabled via config)
let realtimeHFService: RealTimeHFService | undefined;

if (config.useRealtimeHF) {
  realtimeHFService = new RealTimeHFService({ 
    subgraphService, 
    notificationService, 
    priceService,
    predictiveOrchestrator 
  });
  
  // Note: AaveMetadata and TokenMetadataRegistry will be wired asynchronously
  // after they're initialized in the async IIFE above
  
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
  
  // Wire predictive orchestrator if both are enabled
  if (predictiveOrchestrator) {
    // Wire up the predictive orchestrator listener to route candidates to RealTimeHFService,
    // MicroVerifier, and SprinterEngine
    predictiveOrchestrator.addListener({
      async onPredictiveCandidate(event: PredictiveScenarioEvent): Promise<void> {
        if (!realtimeHFService) return;
        
        // 1. Ingest candidate into the realtime HF service's queue
        realtimeHFService.ingestPredictiveCandidates([{
          address: event.candidate.address,
          scenario: event.candidate.scenario,
          hfCurrent: event.candidate.hfCurrent,
          hfProjected: event.candidate.hfProjected,
          etaSec: event.candidate.etaSec,
          totalDebtUsd: event.candidate.totalDebtUsd
        }]);
        
        // 2. Schedule micro-verify if shouldMicroVerify is true
        if (event.shouldMicroVerify) {
          try {
            await realtimeHFService.schedulePredictiveMicroVerify(
              event.candidate.address,
              event.candidate.hfProjected,
              event.candidate.scenario
            );
            predictiveMicroVerifyScheduledTotal.inc({ scenario: event.candidate.scenario });
            
            logger.debug(
              `[predictive-listener] micro-verify scheduled user=${event.candidate.address.slice(0, 10)}... ` +
              `scenario=${event.candidate.scenario}`
            );
          } catch (err) {
            logger.error(`[predictive-listener] Failed to schedule micro-verify:`, err);
          }
        }
        
        // 3. Call SprinterEngine.prestageFromPredictive if shouldPrestage is true
        if (event.shouldPrestage && config.sprinterEnabled) {
          try {
            await realtimeHFService.prestageFromPredictiveCandidate(
              event.candidate.address,
              event.candidate.hfProjected,
              event.candidate.totalDebtUsd,
              event.candidate.scenario
            );
            predictivePrestagedTotal.inc({ scenario: event.candidate.scenario });
            
            logger.debug(
              `[predictive-listener] prestage called user=${event.candidate.address.slice(0, 10)}... ` +
              `scenario=${event.candidate.scenario} debtUsd=${event.candidate.totalDebtUsd.toFixed(2)}`
            );
          } catch (err) {
            logger.error(`[predictive-listener] Failed to prestage from predictive:`, err);
          }
        }
      }
    });
    
    // Set up user provider for fallback evaluations using the candidate manager
    // This provider fetches REAL reserve data from AaveDataService for predictive evaluation
    const userProvider: UserSnapshotProvider = {
      async getUserSnapshots(maxUsers: number) {
        const manager = realtimeHFService!.getCandidateManager();
        const allCandidates = manager.getAll();
        
        // Separate candidates into different slices for targeted evaluation
        // 1) Head-start: near-critical slice (HF < 1.02)
        const nearCritical = allCandidates
          .filter(c => c.lastHF !== null && c.lastHF < PredictiveOrchestrator.LOW_HF_THRESHOLD)
          .sort((a, b) => (a.lastHF ?? 1) - (b.lastHF ?? 1));
        
        // 2) Price-trigger targeted: candidates touched by recent price events
        // (already filtered by HF < 1.2 for better candidate density)
        const priceTouched = allCandidates
          .filter(c => c.lastHF !== null && c.lastHF >= 1.02 && c.lastHF < 1.2)
          .sort((a, b) => (a.lastHF ?? 1) - (b.lastHF ?? 1));
        
        // Combine slices, prioritizing near-critical
        const combined = [...nearCritical, ...priceTouched].slice(0, maxUsers);
        
        // Build UserSnapshot[] with reserves from CandidateManager/AaveDataService
        const aaveDataService = realtimeHFService!.getAaveDataService();
        const snapshots: UserSnapshot[] = [];
        const currentBlock = await realtimeHFService!.getCurrentBlock();
        
        for (const candidate of combined) {
          try {
            const reserves = await buildUserReserves(candidate.address, aaveDataService);
            snapshots.push({
              address: candidate.address,
              block: currentBlock,
              reserves
            });
          } catch (err) {
            logger.warn(`[predictive-user-provider] Failed to fetch reserves for ${candidate.address}:`, err);
          }
        }
        
        return snapshots;
      }
    };
    
    predictiveOrchestrator.setUserProvider(userProvider);
    logger.info('[predictive-orchestrator] User provider set from candidate manager');
    
    // Wire PriceService to predictive orchestrator for price updates
    if (priceService) {
      // Add price update listener to feed predictive orchestrator
      priceService.onPriceUpdate = (asset: string, price: number, timestamp: number, block: number) => {
        if (predictiveOrchestrator) {
          predictiveOrchestrator.updatePrice(asset, price, timestamp, block);
        }
      };
      logger.info('[predictive-orchestrator] Wired to PriceService for price updates');
    }
    
    // Start the fallback evaluation timer
    predictiveOrchestrator.startFallbackTimer();
    
    // Wire up low-HF hotset provider to focus predictive on low-HF accounts
    predictiveOrchestrator.setLowHfProvider(() => {
      const manager = realtimeHFService!.getCandidateManager();
      return PredictiveOrchestrator.getLowHfAddresses(manager);
    });
    
    logger.info(
      `[predictive-orchestrator] Initialized with fallback intervals: ` +
      `blocks=${config.predictiveFallbackIntervalBlocks}, ms=${config.predictiveFallbackIntervalMs}`
    );
  }
} else {
  logger.info('[realtime-hf] Disabled (USE_REALTIME_HF=false)');
  if (config.predictiveEnabled) {
    logger.info('[predictive-orchestrator] Disabled (USE_REALTIME_HF=false required)');
  }
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
  
  // Stop predictive orchestrator if running
  if (predictiveOrchestrator) {
    try {
      predictiveOrchestrator.stop();
      logger.info('[predictive-orchestrator] Stopped');
    } catch (err) {
      logger.error('[predictive-orchestrator] Error stopping:', err);
    }
  }
  
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
  
  // Feature module banners (A)
  if (config.hotlistEnabled) {
    logger.info(
      `[hotlist] enabled hf=[${config.hotlistMinHf},${config.hotlistMaxHf}] ` +
      `topN=${config.hotlistMax} minDebt=${config.hotlistMinDebtUsd} ` +
      `revisitSec=${config.hotlistRevisitSec}`
    );
  }
  
  if (config.precomputeEnabled) {
    logger.info(
      `[precompute] enabled topK=${config.precomputeTopK} ` +
      `receiveAToken=${config.precomputeReceiveAToken}`
    );
  }
  
  if (config.pricesUseAaveOracle) {
    const oracleAddr = config.aaveOracle || '(will resolve from AddressesProvider)';
    logger.info(
      `[oracle] using Aave PriceOracle=${oracleAddr} BASE_CURRENCY_UNIT=1e8`
    );
  }
  
  if (config.liquidationAuditEnabled && config.auditClassifierEnabled) {
    logger.info(
      `[audit] classifier enabled (decision-trace ${config.decisionTraceEnabled ? 'on' : 'off'})`
    );
  }
  
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
  
  // Run startup diagnostics if enabled
  if (config.startupDiagnostics) {
    try {
      // Get WebSocket provider from real-time service if available
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wsProvider = realtimeHFService ? (realtimeHFService as any).provider : undefined;
      
      const diagnostics = new StartupDiagnosticsService(wsProvider);
      const result = await diagnostics.run();
      const formatted = diagnostics.formatDiagnostics(result);
      
      // Log diagnostics regardless of LOG_LEVEL
      console.log(formatted);
      
      // Also log summary line for easy parsing
      const mempoolStatus = result.mempoolTransmit.status === 'ACTIVE' 
        ? `ACTIVE (${result.mempoolTransmit.reason})`
        : `INACTIVE (${result.mempoolTransmit.reason})`;
      logger.info(`[startup] mempool-transmit: ${mempoolStatus} | feeds: ${result.feeds.pendingSubscriptions} pending / ${result.feeds.onChainSubscriptions} on-chain`);
    } catch (err) {
      logger.error('[startup-diagnostics] Failed to run diagnostics:', err);
    }
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
