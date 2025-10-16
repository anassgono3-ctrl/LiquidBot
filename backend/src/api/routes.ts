// API routes - Minimal stub for authentication check
import { Router } from 'express';

export default function buildRoutes() {
  const router = Router();

  /**
   * GET /health - Health check endpoint
   */
  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'liquidbot-api',
      mode: 'realtime-only'
    });
  });

  return router;
}
