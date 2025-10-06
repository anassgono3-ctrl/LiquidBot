// Enhanced configuration management for LiquidBot backend
import dotenv from 'dotenv';
dotenv.config();

function optional(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v.trim() === '') return fallback;
  return v.trim();
}

export const config = {
  // Server
  get port() {
    return Number(optional('PORT', '3000'));
  },
  get nodeEnv() {
    return optional('NODE_ENV', 'development');
  },

  // Mock toggle
  get useMockSubgraph() {
    return (optional('USE_MOCK_SUBGRAPH', 'false') || '').toLowerCase() === 'true';
  },

  // Subgraph Gateway (Aave V3 Base)
  get graphApiKey() {
    return optional('GRAPH_API_KEY');
  },
  get subgraphDeploymentId() {
    return optional('SUBGRAPH_DEPLOYMENT_ID');
  },
  get subgraphUrl() {
    if (this.useMockSubgraph) {
      return 'mock://subgraph';
    }
    if (!this.graphApiKey) {
      throw new Error('GRAPH_API_KEY required when USE_MOCK_SUBGRAPH=false');
    }
    if (!this.subgraphDeploymentId) {
      throw new Error('SUBGRAPH_DEPLOYMENT_ID required when USE_MOCK_SUBGRAPH=false');
    }
    // Construct gateway URL with key in path (do not log raw key in production logs)
    return `https://gateway.thegraph.com/api/${this.graphApiKey}/subgraphs/id/${this.subgraphDeploymentId}`;
  },

  // Aave
  get aavePoolAddress() {
    return optional('AAVE_POOL_ADDRESS', '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5');
  },

  // Database
  get databaseUrl() {
    return optional('DATABASE_URL', 'postgres://user:password@localhost:5432/liquidbot');
  },

  // Redis
  get redisUrl() {
    return optional('REDIS_URL');
  },
  get redisHost() {
    return optional('REDIS_HOST', '127.0.0.1');
  },
  get redisPort() {
    return Number(optional('REDIS_PORT', '6379'));
  },

  // Authentication
  get jwtSecret() {
    return optional('JWT_SECRET', 'dev-secret-change-in-production');
  },
  get apiKey() {
    return optional('API_KEY', 'dev-api-key');
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
