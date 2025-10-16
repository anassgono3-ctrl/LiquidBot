import dotenv from 'dotenv';

import { env } from './envSchema.js';

dotenv.config();

export const config = {
  get port() { return env.port; },
  get nodeEnv() { return env.nodeEnv; },

  get aavePoolAddress() { return env.aavePoolAddress; },
  
  // Aave V3 Base Data Provider addresses
  get aaveAddressesProvider() { return env.aaveAddressesProvider; },
  get aaveProtocolDataProvider() { return env.aaveProtocolDataProvider; },
  get aaveOracle() { return env.aaveOracle; },
  get aavePoolConfigurator() { return env.aavePoolConfigurator; },
  get aaveUiPoolDataProvider() { return env.aaveUiPoolDataProvider; },
  get aaveWrappedTokenGateway() { return env.aaveWrappedTokenGateway; },

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

  // Gas cost estimation
  get gasCostUsd() { return env.gasCostUsd; },

  // Chainlink price feeds
  get chainlinkRpcUrl() { return env.chainlinkRpcUrl; },
  get chainlinkFeeds() { return env.chainlinkFeeds; },

  // Real-time HF detection
  get useRealtimeHF() { return env.useRealtimeHF; },
  get wsRpcUrl() { return env.wsRpcUrl; },
  get useFlashblocks() { return env.useFlashblocks; },
  get flashblocksWsUrl() { return env.flashblocksWsUrl; },
  get flashblocksTickMs() { return env.flashblocksTickMs; },
  get multicall3Address() { return env.multicall3Address; },
  get aavePool() { return env.aavePool; },
  get executionHfThresholdBps() { return env.executionHfThresholdBps; },
  get candidateMax() { return env.candidateMax; },
  get hysteresisBps() { return env.hysteresisBps; },
  get notifyOnlyWhenActionable() { return env.notifyOnlyWhenActionable; },
  get executionInflightLock() { return env.executionInflightLock; },
  
  // On-chain backfill configuration
  get realtimeInitialBackfillEnabled() { return env.realtimeInitialBackfillEnabled; },
  get realtimeInitialBackfillBlocks() { return env.realtimeInitialBackfillBlocks; },
  get realtimeInitialBackfillMaxLogs() { return env.realtimeInitialBackfillMaxLogs; },
  get realtimeInitialBackfillChunkBlocks() { return env.realtimeInitialBackfillChunkBlocks; },
  
  // Execution configuration
  get executionEnabled() { return env.executionEnabled; },
  get dryRunExecution() { return env.dryRunExecution; },
  get closeFactorExecutionMode() { return env.closeFactorExecutionMode; },
  get liquidationDebtAssets() { return env.liquidationDebtAssets; },

  // Rate limiting
  rateLimitWindowMs: 60 * 1000, // 1 minute
  rateLimitMaxRequests: 120,

  // Health factor thresholds (legacy, use healthAlertThreshold and healthEmergencyThreshold instead)
  alertThreshold: 1.1,
  emergencyThreshold: 1.05,
};
