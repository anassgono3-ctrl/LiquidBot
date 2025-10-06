// Configuration management for LiquidBot backend
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  get port() {
    return Number(process.env.PORT) || 3000;
  },
  get nodeEnv() {
    return process.env.NODE_ENV || 'development';
  },

  // Aave V3 on Base
  get aavePoolAddress() {
    return process.env.AAVE_POOL_ADDRESS || '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
  },
  get subgraphUrl() {
    return (
      process.env.SUBGRAPH_URL ||
      'https://api.thegraph.com/subgraphs/id/GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF'
    );
  },
  get useMockSubgraph() {
    return (process.env.USE_MOCK_SUBGRAPH || '').toLowerCase() === 'true';
  },

  // Database
  get databaseUrl() {
    return process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/liquidbot';
  },

  // Redis
  get redisUrl() {
    return process.env.REDIS_URL;
  },
  get redisHost() {
    return process.env.REDIS_HOST || '127.0.0.1';
  },
  get redisPort() {
    return Number(process.env.REDIS_PORT) || 6379;
  },

  // Authentication
  get jwtSecret() {
    return process.env.JWT_SECRET || 'dev-secret-change-in-production';
  },
  get apiKey() {
    return process.env.API_KEY || 'dev-api-key';
  },

  // Rate limiting
  rateLimitWindowMs: 60 * 1000, // 1 minute
  rateLimitMaxRequests: 120,

  // Health factor thresholds
  alertThreshold: 1.1,
  emergencyThreshold: 1.05,

  // Fee constants (basis points)
  refinancingFeeBps: 15, // 0.15%
  emergencyFeeBps: 50, // 0.5%
};
