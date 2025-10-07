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
  get liquidationPollLimit() { return env.liquidationPollLimit; },
  get liquidationTrackMax() { return env.liquidationTrackMax; },

  // Optional raw override (header mode or custom proxy)
  get rawSubgraphUrl() { return process.env.SUBGRAPH_URL; },

  /**
   * Determine effective endpoint + auth needs.
   */
  resolveSubgraphEndpoint() {
    if (this.useMockSubgraph) {
      return { endpoint: 'mock://subgraph', mode: 'mock' as const, needsHeader: false };
    }

    const key = this.graphApiKey;
    const dep = this.subgraphDeploymentId;

    let endpoint = this.rawSubgraphUrl;
    let mode: 'path' | 'header' | 'raw' = 'raw';
    let needsHeader = false;

    if (!endpoint) {
      // Default path-embedded mode
      endpoint = `https://gateway.thegraph.com/api/${key}/subgraphs/id/${dep}`;
      mode = 'path';
      needsHeader = false;
    } else {
      const hasEmbedded = key && endpoint.includes(`/${key}/subgraphs/`);
      const matchesHeaderPattern = /https:\/\/gateway\.thegraph\.com\/api\/subgraphs\/id\//.test(endpoint);

      if (hasEmbedded) {
        mode = 'path';
        needsHeader = false;
      } else if (matchesHeaderPattern) {
        mode = 'header';
        needsHeader = true;
      } else {
        mode = 'raw';
        needsHeader = !!key; // opportunistic header if key present
      }
    }

    return { endpoint: endpoint!, mode, needsHeader };
  },

  get subgraphUrl() {
    return this.resolveSubgraphEndpoint().endpoint;
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

  // Fees
  get refinancingFeeBps() { return env.refinancingFeeBps; },
  get emergencyFeeBps() { return env.emergencyFeeBps; },

  // Telegram
  get telegramBotToken() { return env.telegramBotToken; },
  get telegramChatId() { return env.telegramChatId; },

  // Health monitoring
  get healthAlertThreshold() { return env.healthAlertThreshold; },
  get healthEmergencyThreshold() { return env.healthEmergencyThreshold; },

  // Profit estimation
  get profitFeeBps() { return env.profitFeeBps; },
  get profitMinUsd() { return env.profitMinUsd; },

  // Price oracle
  get priceOracleMode() { return env.priceOracleMode; },

  // Health factor resolver
  get healthUserCacheTtlMs() { return env.healthUserCacheTtlMs; },
  get healthMaxBatch() { return env.healthMaxBatch; },
  get healthQueryMode() { return env.healthQueryMode; },

  // Rate limiting
  rateLimitWindowMs: 60 * 1000, // 1 minute
  rateLimitMaxRequests: 120,

  // Health factor thresholds (legacy, use healthAlertThreshold and healthEmergencyThreshold instead)
  alertThreshold: 1.1,
  emergencyThreshold: 1.05,
};
