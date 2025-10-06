import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform(v => v === 'true');

export const rawEnvSchema = z.object({
  PORT: z.string().optional(),
  NODE_ENV: z.string().optional(),

  API_KEY: z.string().min(3, 'API_KEY required'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET too short'),

  USE_MOCK_SUBGRAPH: z.string().optional().default('false'),
  GRAPH_API_KEY: z.string().optional(),
  SUBGRAPH_DEPLOYMENT_ID: z.string().optional(),

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
  EMERGENCY_FEE_BPS: z.string().optional()
});

export const env = (() => {
  const parsed = rawEnvSchema.parse(process.env);
  const useMock = booleanString.parse(parsed.USE_MOCK_SUBGRAPH || 'false');

  if (!useMock) {
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
    emergencyFeeBps: Number(parsed.EMERGENCY_FEE_BPS || 50)
  };
})();
