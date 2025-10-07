import dotenv from 'dotenv';

import { env } from './envSchema.js';

dotenv.config();

export const config = {
  get port() { return env.port; },
  get nodeEnv() { return env.nodeEnv; },

  get useMockSubgraph() { return env.useMockSubgraph; },
  get graphApiKey() { return env.graphApiKey; },
  get subgraphDeploymentId() { return env.subgraphDeploymentId; },
  get subgraphPollIntervalMs() { return env.subgraphPollIntervalMs; },
  get subgraphDebugErrors() { return env.subgraphDebugErrors; },

  get subgraphUrl() {
    if (this.useMockSubgraph) return 'mock://subgraph';
    return `https://gateway.thegraph.com/api/${this.graphApiKey}/subgraphs/id/${this.subgraphDeploymentId}`;
  },

  get aavePoolAddress() { return env.aavePoolAddress; },

  // Limits / retries
  get subgraphFailureThreshold() { return env.subgraphFailureThreshold; },
  get subgraphRetryAttempts() { return env.subgraphRetryAttempts; },
  get subgraphRetryBaseMs() { return env.subgraphRetryBaseMs; },
  get subgraphRateLimitCapacity() { return env.subgraphRateLimitCapacity; },
  get subgraphRateLimitIntervalMs() { return env.subgraphRateLimitIntervalMs; },

  // Auth
  get apiKey() { return env.apiKey; },
  get jwtSecret() { return env.jwtSecret; },

  // Database
  get databaseUrl() { return env.databaseUrl; },

  // Redis
  get redisUrl() { return env.redisUrl; },
  get redisHost() { return env.redisHost; },
  get redisPort() { return env.redisPort; },

  // Rate limiting
  rateLimitWindowMs: 60 * 1000, // 1 minute
  rateLimitMaxRequests: 120,

  // Health factor thresholds
  alertThreshold: 1.1,
  emergencyThreshold: 1.05,

  // Fees
  get refinancingFeeBps() { return env.refinancingFeeBps; },
  get emergencyFeeBps() { return env.emergencyFeeBps; },
};
