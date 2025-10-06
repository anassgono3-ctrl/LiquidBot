// Configuration management for LiquidBot backend
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Aave V3 on Base
  aavePoolAddress: process.env.AAVE_POOL_ADDRESS || '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  subgraphUrl:
    process.env.SUBGRAPH_URL ||
    'https://api.thegraph.com/subgraphs/id/43Hwfi3dJSoGpyas9VwNoDAv55yjgGrPpNSmbQZArzMG',

  // Database
  databaseUrl: process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/liquidbot',

  // Redis
  redisUrl: process.env.REDIS_URL,
  redisHost: process.env.REDIS_HOST || '127.0.0.1',
  redisPort: Number(process.env.REDIS_PORT) || 6379,

  // Authentication
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  apiKey: process.env.API_KEY || 'dev-api-key',

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
