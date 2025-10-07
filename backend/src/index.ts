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
import { registry } from "./metrics/index.js";
import { SubgraphService } from "./services/SubgraphService.js";
import { startSubgraphPoller, SubgraphPollerHandle } from "./polling/subgraphPoller.js";

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

// Instantiate service once
const subgraphService = new SubgraphService();

// Prometheus metrics endpoint (no auth)
app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", registry.contentType);
  res.send(await registry.metrics());
});

// Enhanced health endpoint
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    app: {
      uptimeSeconds: Math.floor(process.uptime()),
      version: "0.1.0"
    },
    subgraph: subgraphService.healthStatus()
  });
});

// API routes with authentication (inject the singleton service)
app.use("/api/v1", authenticate, buildRoutes(subgraphService));

// Initialize WebSocket server
const { wss } = initWebSocketServer(httpServer);

// Live polling (only if not mock)
let subgraphPoller: SubgraphPollerHandle | null = null;
if (!config.useMockSubgraph) {
  subgraphPoller = startSubgraphPoller({
    service: subgraphService,
    intervalMs: config.subgraphPollIntervalMs || 15000,
    logger,
    onLiquidations: () => {
      // Placeholder: broadcast or enqueue tasks later.
    }
  });
}

// Graceful shutdown handling
const shutdown = (signal: string) => {
  logger.info(`Received ${signal}, shutting down...`);
  subgraphPoller?.stop();
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
  logger.info(`Subgraph endpoint: ${config.useMockSubgraph ? "(MOCK MODE)" : config.subgraphUrl}`);
});
