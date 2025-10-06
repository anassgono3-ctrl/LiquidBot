import { createServer } from "http";

import express from "express";
import cors from "cors";
import promClient from "prom-client";
import { createLogger, format, transports } from "winston";

import { config } from "./config/index.js";
import { authenticate } from "./middleware/auth.js";
import { rateLimiter } from "./middleware/rateLimit.js";
import apiRoutes from "./api/routes.js";
import { initWebSocketServer } from "./websocket/server.js";

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

// Metrics registry
const registry = new promClient.Registry();
promClient.collectDefaultMetrics({ register: registry });

// Prometheus metrics endpoint (no auth)
app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", registry.contentType);
  res.send(await registry.metrics());
});

// API routes with authentication
app.use("/api/v1", authenticate, apiRoutes);

// Initialize WebSocket server
const { wss } = initWebSocketServer(httpServer);

// Graceful shutdown handling
const shutdown = (signal: string) => {
  logger.info(`Received ${signal}, shutting down...`);
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
});
