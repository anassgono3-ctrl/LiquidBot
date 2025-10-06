// API routes
import { Router } from 'express';

import type { AuthRequest } from '../middleware/auth.js';
import { SubgraphService } from '../services/SubgraphService.js';
import { HealthCalculator } from '../services/HealthCalculator.js';

const router = Router();
const subgraphService = new SubgraphService();
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

export default router;
