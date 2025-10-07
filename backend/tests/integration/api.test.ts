// Integration tests for API routes
// Force mock mode for this test file BEFORE importing config
process.env.USE_MOCK_SUBGRAPH = 'true';

import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

import { config } from '../../src/config/index.js';
import { authenticate } from '../../src/middleware/auth.js';
import buildRoutes from '../../src/api/routes.js';
import { SubgraphService } from '../../src/services/SubgraphService.js';

describe('API Integration Tests', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    const subgraphService = SubgraphService.createMock();
    app.use('/api/v1', authenticate, buildRoutes(subgraphService));
  });

  describe('GET /api/v1/health', () => {
    it('should return health status with valid API key', async () => {
      const response = await request(app)
        .get('/api/v1/health')
        .set('x-api-key', config.apiKey)
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeTruthy();
    });

    it('should reject requests without authentication', async () => {
      await request(app)
        .get('/api/v1/health')
        .expect(401);
    });
  });

  describe('GET /api/v1/positions', () => {
    it('should return positions list with authentication', async () => {
      const response = await request(app)
        .get('/api/v1/positions')
        .set('x-api-key', config.apiKey)
        .expect(200);

      expect(response.body).toHaveProperty('positions');
      expect(response.body).toHaveProperty('count');
      expect(response.body).toHaveProperty('timestamp');
      expect(Array.isArray(response.body.positions)).toBe(true);
    });
  });

  describe('POST /api/v1/protect', () => {
    it('should queue protection request', async () => {
      const response = await request(app)
        .post('/api/v1/protect')
        .set('x-api-key', config.apiKey)
        .send({
          userAddress: '0x1234567890123456789012345678901234567890',
          protectionType: 'REFINANCE',
        })
        .expect(200);

      expect(response.body.status).toBe('queued');
      expect(response.body.requestId).toBeTruthy();
      expect(response.body.userAddress).toBe('0x1234567890123456789012345678901234567890');
    });

    it('should reject requests without userAddress', async () => {
      const response = await request(app)
        .post('/api/v1/protect')
        .set('x-api-key', config.apiKey)
        .send({ protectionType: 'REFINANCE' })
        .expect(400);

      expect(response.body.error).toContain('userAddress is required');
    });
  });
});
