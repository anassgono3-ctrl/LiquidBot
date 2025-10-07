import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform(v => v === 'true');
const isTest = (process.env.NODE_ENV || '').toLowerCase() === 'test';

// Inject test defaults BEFORE schema parsing so Zod doesn't throw for test runs.
if (isTest) {
  if (!process.env.API_KEY) process.env.API_KEY = 'test-api-key';
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-jwt-secret';
  if (!process.env.USE_MOCK_SUBGRAPH) process.env.USE_MOCK_SUBGRAPH = 'true';
}

export const rawEnvSchema = z.object({
  PORT: z.string().optional(),
  NODE_ENV: z.string().optional(),

  API_KEY: z.string().min(3, 'API_KEY required'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET too short'),

  USE_MOCK_SUBGRAPH: z.string().optional().default('false'),
  GRAPH_API_KEY: z.string().optional(),
  SUBGRAPH_DEPLOYMENT_ID: z.string().optional(),

  SUBGRAPH_POLL_INTERVAL_MS: z.string().optional(),
  SUBGRAPH_DEBUG_ERRORS: z.string().optional(),

  LIQUIDATION_POLL_LIMIT: z.string().optional(),
  LIQUIDATION_TRACK_MAX: z.string().optional(),

  SUBGRAPH_FAILURE_THRESHOLD: z.string().optional(),
  SUBGRAPH_RETRY_ATTEMPTS: z.string().optional(),
  SUBGRAPH_RETRY_BASE_MS: z.string().optional(),
  SUBGRAPH_RATE_LIMIT_CAPACITY: z.string().optional(),
  SUBGRAPH_RATE_LIMIT_INTERVAL_MS: z.string().optional(),

  AAVE_POOL_ADDRESS: z.string().optional(),

  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.string().optional(),

  REFINANCING_FEE_BPS: z.string().optional(),
  EMERGENCY_FEE_BPS: z.string().optional(),

  // Telegram notifications (optional)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  // Health monitoring
  HEALTH_ALERT_THRESHOLD: z.string().optional(),
  HEALTH_EMERGENCY_THRESHOLD: z.string().optional(),

  // Profit estimation
  PROFIT_FEE_BPS: z.string().optional(),
  PROFIT_MIN_USD: z.string().optional(),

  // Price oracle
  PRICE_ORACLE_MODE: z.string().optional(),

  // Health factor resolver
  HEALTH_USER_CACHE_TTL_MS: z.string().optional(),
  HEALTH_MAX_BATCH: z.string().optional(),
  HEALTH_QUERY_MODE: z.string().optional()
});

export const env = (() => {
  const parsed = rawEnvSchema.parse(process.env);
  const useMock = booleanString.parse(parsed.USE_MOCK_SUBGRAPH || 'false');

  // Only enforce gateway secrets when not mocking AND not in test mode
  if (!useMock && !isTest) {
    if (!parsed.GRAPH_API_KEY) throw new Error('GRAPH_API_KEY required when USE_MOCK_SUBGRAPH=false');
    if (!parsed.SUBGRAPH_DEPLOYMENT_ID) throw new Error('SUBGRAPH_DEPLOYMENT_ID required when USE_MOCK_SUBGRAPH=false');
  }

  return {
    port: Number(parsed.PORT || 3000),
    nodeEnv: parsed.NODE_ENV || 'development',
    apiKey: parsed.API_KEY,
    jwtSecret: parsed.JWT_SECRET,
    useMockSubgraph: useMock,

    graphApiKey: parsed.GRAPH_API_KEY,
    subgraphDeploymentId: parsed.SUBGRAPH_DEPLOYMENT_ID,
    subgraphPollIntervalMs: Number(parsed.SUBGRAPH_POLL_INTERVAL_MS || 15000),
    subgraphDebugErrors: (parsed.SUBGRAPH_DEBUG_ERRORS || '').toLowerCase() === 'true',

    liquidationPollLimit: Number(parsed.LIQUIDATION_POLL_LIMIT || 50),
    liquidationTrackMax: Number(parsed.LIQUIDATION_TRACK_MAX || 5000),

    subgraphFailureThreshold: Number(parsed.SUBGRAPH_FAILURE_THRESHOLD || 5),
    subgraphRetryAttempts: Number(parsed.SUBGRAPH_RETRY_ATTEMPTS || 3),
    subgraphRetryBaseMs: Number(parsed.SUBGRAPH_RETRY_BASE_MS || 150),
    subgraphRateLimitCapacity: Number(parsed.SUBGRAPH_RATE_LIMIT_CAPACITY || 30),
    subgraphRateLimitIntervalMs: Number(parsed.SUBGRAPH_RATE_LIMIT_INTERVAL_MS || 10000),

    aavePoolAddress: parsed.AAVE_POOL_ADDRESS || '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',

    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    redisHost: parsed.REDIS_HOST || '127.0.0.1',
    redisPort: Number(parsed.REDIS_PORT || 6379),

    refinancingFeeBps: Number(parsed.REFINANCING_FEE_BPS || 15),
    emergencyFeeBps: Number(parsed.EMERGENCY_FEE_BPS || 50),

    // Telegram notifications
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramChatId: parsed.TELEGRAM_CHAT_ID,

    // Health monitoring
    healthAlertThreshold: Number(parsed.HEALTH_ALERT_THRESHOLD || 1.10),
    healthEmergencyThreshold: Number(parsed.HEALTH_EMERGENCY_THRESHOLD || 1.05),

    // Profit estimation
    profitFeeBps: Number(parsed.PROFIT_FEE_BPS || 30),
    profitMinUsd: Number(parsed.PROFIT_MIN_USD || 10),

    // Price oracle
    priceOracleMode: parsed.PRICE_ORACLE_MODE || 'coingecko',

    // Health factor resolver
    healthUserCacheTtlMs: Number(parsed.HEALTH_USER_CACHE_TTL_MS || 60000),
    healthMaxBatch: Number(parsed.HEALTH_MAX_BATCH || 25),
    healthQueryMode: parsed.HEALTH_QUERY_MODE || 'on_demand'
  };
})();
