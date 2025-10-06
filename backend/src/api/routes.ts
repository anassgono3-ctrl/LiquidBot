// API routes
import { Router } from 'express';

import type { AuthRequest } from '../middleware/auth.js';
import { SubgraphService } from '../services/SubgraphService.js';
import { HealthCalculator } from '../services/HealthCalculator.js';
import { config } from '../config/index.js';

export default function buildRoutes(subgraph?: SubgraphService) {
  const router = Router();
  const subgraphService = subgraph || new SubgraphService(config.subgraphUrl);
  const healthCalculator = new HealthCalculator();

  /**
   * GET /health - Health check endpoint
   */
  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'liquidbot-api',
    });
  });

  /**
   * GET /positions - Get list of borrowers with health factors
   */
  router.get('/positions', async (_req, res) => {
    try {
      // Return mock data if in mock mode
      if (config.useMockSubgraph) {
        return res.json({
          positions: [
            {
              address: '0xMockUser1',
              healthFactor: '1.25',
              totalCollateralETH: '1.500000',
              totalDebtETH: '1.200000',
              isAtRisk: false,
            },
            {
              address: '0xMockUser2',
              healthFactor: '1.08',
              totalCollateralETH: '2.000000',
              totalDebtETH: '1.850000',
              isAtRisk: true,
            },
          ],
          count: 2,
          timestamp: new Date().toISOString(),
        });
      }

      const users = await subgraphService.getUsersWithDebt(100);
      const positions = users.map((user) => {
        const hf = healthCalculator.calculateHealthFactor(user);
        return {
          address: user.id,
          healthFactor: hf.healthFactor === Infinity ? 'Infinity' : hf.healthFactor.toFixed(4),
          totalCollateralETH: hf.totalCollateralETH.toFixed(6),
          totalDebtETH: hf.totalDebtETH.toFixed(6),
          isAtRisk: hf.isAtRisk,
        };
      });

      res.json({
        positions,
        count: positions.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error fetching positions:', error);
      res.status(500).json({ error: 'Failed to fetch positions' });
    }
  });

  /**
   * POST /protect - Queue protection request (stub)
   */
  router.post('/protect', async (req: AuthRequest, res) => {
    try {
      const { userAddress, protectionType } = req.body;

      if (!userAddress) {
        return res.status(400).json({ error: 'userAddress is required' });
      }

      // Stub: Queue protection request (future: integrate with BullMQ)
      const requestId = `protect-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      res.json({
        status: 'queued',
        requestId,
        userAddress,
        protectionType: protectionType || 'REFINANCE',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error queuing protection:', error);
      res.status(500).json({ error: 'Failed to queue protection request' });
    }
  });

  return router;
}
