import express from "express";
import dotenv from "dotenv";
import promClient from "prom-client";
import { createLogger, format, transports } from "winston";

dotenv.config();

const logger = createLogger({
  level: "info",
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()]
});

const app = express();
app.use(express.json());

// Metrics registry
const registry = new promClient.Registry();
promClient.collectDefaultMetrics({ register: registry });

// Health endpoint
app.get("/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// Prometheus metrics endpoint
app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", registry.contentType);
  res.send(await registry.metrics());
});

// Graceful shutdown handling (basic)
const shutdown = (signal: string) => {
  logger.info(`Received ${signal}, shutting down...`);
  process.exit(0);
};
["SIGINT", "SIGTERM"].forEach(sig => process.on(sig, () => shutdown(sig)));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  logger.info(`LiquidBot backend listening on port ${port}`);
});
