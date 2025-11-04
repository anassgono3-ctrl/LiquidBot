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
  
  // Aave V3 Base Data Provider addresses
  AAVE_ADDRESSES_PROVIDER: z.string().optional(),
  AAVE_PROTOCOL_DATA_PROVIDER: z.string().optional(),
  AAVE_ORACLE: z.string().optional(),
  AAVE_POOL_CONFIGURATOR: z.string().optional(),
  AAVE_UI_POOL_DATA_PROVIDER: z.string().optional(),
  AAVE_WRAPPED_TOKEN_GATEWAY: z.string().optional(),

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
  HEALTH_QUERY_MODE: z.string().optional(),

  // Poll configuration
  POLL_LIMIT: z.string().optional(),
  IGNORE_BOOTSTRAP_BATCH: z.string().optional(),

  // Gas cost estimation
  GAS_COST_USD: z.string().optional(),

  // Chainlink price feeds
  CHAINLINK_RPC_URL: z.string().optional(),
  CHAINLINK_FEEDS: z.string().optional(),

  // At-risk user scanning
  AT_RISK_SCAN_LIMIT: z.string().optional(),
  AT_RISK_WARN_THRESHOLD: z.string().optional(),
  AT_RISK_LIQ_THRESHOLD: z.string().optional(),
  AT_RISK_DUST_EPSILON: z.string().optional(),
  AT_RISK_NOTIFY_WARN: z.string().optional(),
  AT_RISK_NOTIFY_CRITICAL: z.string().optional(),

  // Execution scaffold
  EXECUTION_ENABLED: z.string().optional(),
  DRY_RUN_EXECUTION: z.string().optional(),
  PRIVATE_BUNDLE_RPC: z.string().optional(),
  MAX_GAS_PRICE_GWEI: z.string().optional(),
  MIN_PROFIT_AFTER_GAS_USD: z.string().optional(),
  MAX_POSITION_SIZE_USD: z.string().optional(),
  DAILY_LOSS_LIMIT_USD: z.string().optional(),
  BLACKLISTED_TOKENS: z.string().optional(),

  // On-chain executor
  EXECUTOR_ADDRESS: z.string().optional(),
  EXECUTION_PRIVATE_KEY: z.string().optional(),
  RPC_URL: z.string().optional(),
  CHAIN_ID: z.string().optional(),
  ONEINCH_API_KEY: z.string().optional(),
  ONEINCH_BASE_URL: z.string().optional(),
  MAX_SLIPPAGE_BPS: z.string().optional(),
  CLOSE_FACTOR_MODE: z.string().optional(),
  CLOSE_FACTOR_EXECUTION_MODE: z.string().optional(),
  LIQUIDATION_DEBT_ASSETS: z.string().optional(),

  // Real-time HF detection
  USE_REALTIME_HF: z.string().optional(),
  WS_RPC_URL: z.string().optional(),
  USE_FLASHBLOCKS: z.string().optional(),
  FLASHBLOCKS_WS_URL: z.string().optional(),
  FLASHBLOCKS_TICK_MS: z.string().optional(),
  MULTICALL3_ADDRESS: z.string().optional(),
  AAVE_POOL: z.string().optional(),
  EXECUTION_HF_THRESHOLD_BPS: z.string().optional(),
  REALTIME_SEED_INTERVAL_SEC: z.string().optional(),
  CANDIDATE_MAX: z.string().optional(),
  HYSTERESIS_BPS: z.string().optional(),
  NOTIFY_ONLY_WHEN_ACTIONABLE: z.string().optional(),
  EXECUTION_INFLIGHT_LOCK: z.string().optional(),

  // Subgraph usage gating
  USE_SUBGRAPH: z.string().optional(),

  // On-chain backfill for candidate discovery
  REALTIME_INITIAL_BACKFILL_ENABLED: z.string().optional(),
  REALTIME_INITIAL_BACKFILL_BLOCKS: z.string().optional(),
  REALTIME_INITIAL_BACKFILL_CHUNK_BLOCKS: z.string().optional(),
  REALTIME_INITIAL_BACKFILL_MAX_LOGS: z.string().optional(),
  BACKFILL_RPC_URL: z.string().optional(),

  // Subgraph paging (when USE_SUBGRAPH=true)
  SUBGRAPH_PAGE_SIZE: z.string().optional(),

  // Head-check paging/rotation
  HEAD_CHECK_PAGE_STRATEGY: z.string().optional(),
  HEAD_CHECK_PAGE_SIZE: z.string().optional(),

  // Always-include low-HF threshold for head checks
  ALWAYS_INCLUDE_HF_BELOW: z.string().optional(),

  // Optional secondary RPC for head-check fallback
  SECONDARY_HEAD_RPC_URL: z.string().optional(),

  // Optional hedge window for dirty-first chunks (milliseconds)
  HEAD_CHECK_HEDGE_MS: z.string().optional(),

  // Timeout and retry configuration for multicall chunks
  CHUNK_TIMEOUT_MS: z.string().optional(),
  CHUNK_RETRY_ATTEMPTS: z.string().optional(),

  // Run-level watchdog configuration
  RUN_STALL_ABORT_MS: z.string().optional(),

  // WebSocket heartbeat configuration
  WS_HEARTBEAT_MS: z.string().optional()
});

export const env = (() => {
  const parsed = rawEnvSchema.parse(process.env);
  const useMock = booleanString.parse(parsed.USE_MOCK_SUBGRAPH || 'false');
  const useSubgraph = (parsed.USE_SUBGRAPH || 'false').toLowerCase() === 'true';

  // Only enforce gateway secrets when USE_SUBGRAPH=true AND not mocking AND not in test mode
  if (useSubgraph && !useMock && !isTest) {
    if (!parsed.GRAPH_API_KEY) throw new Error('GRAPH_API_KEY required when USE_SUBGRAPH=true and USE_MOCK_SUBGRAPH=false');
    if (!parsed.SUBGRAPH_DEPLOYMENT_ID) throw new Error('SUBGRAPH_DEPLOYMENT_ID required when USE_SUBGRAPH=true and USE_MOCK_SUBGRAPH=false');
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
    
    // Aave V3 Base Data Provider addresses
    aaveAddressesProvider: parsed.AAVE_ADDRESSES_PROVIDER || '0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D',
    aaveProtocolDataProvider: parsed.AAVE_PROTOCOL_DATA_PROVIDER || '0xC4Fcf9893072d61Cc2899C0054877Cb752587981',
    aaveOracle: parsed.AAVE_ORACLE || '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156',
    aavePoolConfigurator: parsed.AAVE_POOL_CONFIGURATOR || '0x5731a04B1E775f0fdd454Bf70f3335886e9A96be',
    aaveUiPoolDataProvider: parsed.AAVE_UI_POOL_DATA_PROVIDER || '0x68100bD5345eA474D93577127C11F39FF8463e93',
    aaveWrappedTokenGateway: parsed.AAVE_WRAPPED_TOKEN_GATEWAY || '0xa0d9C1E9E48Ca30c8d8C3B5D69FF5dc1f6DFfC24',

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
    profitMinUsd: Number(parsed.PROFIT_MIN_USD || 5),

    // Price oracle
    priceOracleMode: parsed.PRICE_ORACLE_MODE || 'coingecko',

    // Health factor resolver
    healthUserCacheTtlMs: Number(parsed.HEALTH_USER_CACHE_TTL_MS || 60000),
    healthMaxBatch: Number(parsed.HEALTH_MAX_BATCH || 25),
    healthQueryMode: parsed.HEALTH_QUERY_MODE || 'on_demand',

    // Poll configuration
    pollLimit: Number(parsed.POLL_LIMIT || 5),
    ignoreBootstrapBatch: (parsed.IGNORE_BOOTSTRAP_BATCH || 'true').toLowerCase() === 'true',

    // Gas cost estimation (default 0.5 USD)
    gasCostUsd: Number(parsed.GAS_COST_USD || 0.5),

    // Chainlink price feeds
    chainlinkRpcUrl: parsed.CHAINLINK_RPC_URL,
    chainlinkFeeds: parsed.CHAINLINK_FEEDS,

    // At-risk user scanning
    atRiskScanLimit: Number(parsed.AT_RISK_SCAN_LIMIT || 0),
    atRiskWarnThreshold: Number(parsed.AT_RISK_WARN_THRESHOLD || 1.05),
    atRiskLiqThreshold: Number(parsed.AT_RISK_LIQ_THRESHOLD || 1.0),
    atRiskDustEpsilon: Number(parsed.AT_RISK_DUST_EPSILON || 1e-9),
    atRiskNotifyWarn: (parsed.AT_RISK_NOTIFY_WARN || 'false').toLowerCase() === 'true',
    atRiskNotifyCritical: (parsed.AT_RISK_NOTIFY_CRITICAL || 'true').toLowerCase() === 'true',

    // Execution scaffold
    executionEnabled: (parsed.EXECUTION_ENABLED || 'false').toLowerCase() === 'true',
    dryRunExecution: (parsed.DRY_RUN_EXECUTION || 'true').toLowerCase() === 'true',
    privateBundleRpc: parsed.PRIVATE_BUNDLE_RPC,
    maxGasPriceGwei: Number(parsed.MAX_GAS_PRICE_GWEI || 50),
    minProfitAfterGasUsd: Number(parsed.MIN_PROFIT_AFTER_GAS_USD || 10),
    maxPositionSizeUsd: Number(parsed.MAX_POSITION_SIZE_USD || 5000),
    dailyLossLimitUsd: Number(parsed.DAILY_LOSS_LIMIT_USD || 1000),
    blacklistedTokens: (parsed.BLACKLISTED_TOKENS || '')
      .split(',')
      .map(t => t.trim().toUpperCase())
      .filter(t => t.length > 0),

    // On-chain executor
    executorAddress: parsed.EXECUTOR_ADDRESS,
    executionPrivateKey: parsed.EXECUTION_PRIVATE_KEY,
    rpcUrl: parsed.RPC_URL,
    chainId: Number(parsed.CHAIN_ID || 8453),
    oneInchApiKey: parsed.ONEINCH_API_KEY,
    oneInchBaseUrl: parsed.ONEINCH_BASE_URL || 'https://api.1inch.dev/swap/v6.0/8453',
    maxSlippageBps: Number(parsed.MAX_SLIPPAGE_BPS || 100),
    closeFactorMode: parsed.CLOSE_FACTOR_MODE || 'auto',
    closeFactorExecutionMode: parsed.CLOSE_FACTOR_EXECUTION_MODE || 'fixed50',
    liquidationDebtAssets: (parsed.LIQUIDATION_DEBT_ASSETS || '')
      .split(',')
      .map(a => a.trim().toLowerCase())
      .filter(a => a.length > 0),

    // Real-time HF detection
    useRealtimeHF: (parsed.USE_REALTIME_HF || 'false').toLowerCase() === 'true',
    wsRpcUrl: parsed.WS_RPC_URL,
    useFlashblocks: (parsed.USE_FLASHBLOCKS || 'false').toLowerCase() === 'true',
    flashblocksWsUrl: parsed.FLASHBLOCKS_WS_URL,
    flashblocksTickMs: Number(parsed.FLASHBLOCKS_TICK_MS || 250),
    multicall3Address: parsed.MULTICALL3_ADDRESS || '0xca11bde05977b3631167028862be2a173976ca11',
    aavePool: parsed.AAVE_POOL || '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    executionHfThresholdBps: Number(parsed.EXECUTION_HF_THRESHOLD_BPS || 9800),
    realtimeSeedIntervalSec: Number(parsed.REALTIME_SEED_INTERVAL_SEC || 45),
    candidateMax: Number(parsed.CANDIDATE_MAX || 300),
    hysteresisBps: Number(parsed.HYSTERESIS_BPS || 20),
    notifyOnlyWhenActionable: (parsed.NOTIFY_ONLY_WHEN_ACTIONABLE || 'true').toLowerCase() === 'true',
    executionInflightLock: (parsed.EXECUTION_INFLIGHT_LOCK || 'true').toLowerCase() === 'true',

    // Subgraph usage gating
    useSubgraph: (parsed.USE_SUBGRAPH || 'false').toLowerCase() === 'true',

    // On-chain backfill for candidate discovery
    realtimeInitialBackfillEnabled: (parsed.REALTIME_INITIAL_BACKFILL_ENABLED || 'true').toLowerCase() === 'true',
    realtimeInitialBackfillBlocks: Number(parsed.REALTIME_INITIAL_BACKFILL_BLOCKS || 50000),
    realtimeInitialBackfillChunkBlocks: Number(parsed.REALTIME_INITIAL_BACKFILL_CHUNK_BLOCKS || 2000),
    realtimeInitialBackfillMaxLogs: Number(parsed.REALTIME_INITIAL_BACKFILL_MAX_LOGS || 20000),
    backfillRpcUrl: parsed.BACKFILL_RPC_URL,

    // Subgraph paging (when USE_SUBGRAPH=true)
    subgraphPageSize: Math.max(50, Math.min(200, Number(parsed.SUBGRAPH_PAGE_SIZE || 100))),

    // Head-check paging/rotation
    headCheckPageStrategy: (parsed.HEAD_CHECK_PAGE_STRATEGY || 'paged') as 'all' | 'paged',
    headCheckPageSize: Number(parsed.HEAD_CHECK_PAGE_SIZE || 250),

    // Always-include low-HF threshold
    // Default: 1.10 (matches DEFAULT_ALWAYS_INCLUDE_HF_BELOW in RealTimeHFService)
    alwaysIncludeHfBelow: Number(parsed.ALWAYS_INCLUDE_HF_BELOW || 1.10),

    // Optional secondary RPC for head-check fallback
    secondaryHeadRpcUrl: parsed.SECONDARY_HEAD_RPC_URL,

    // Optional hedge window for dirty-first chunks (default: undefined/disabled)
    headCheckHedgeMs: parsed.HEAD_CHECK_HEDGE_MS ? Number(parsed.HEAD_CHECK_HEDGE_MS) : undefined,

    // Timeout and retry configuration for multicall chunks
    chunkTimeoutMs: Number(parsed.CHUNK_TIMEOUT_MS || 2000),
    chunkRetryAttempts: Number(parsed.CHUNK_RETRY_ATTEMPTS || 2),

    // Run-level watchdog configuration
    runStallAbortMs: Number(parsed.RUN_STALL_ABORT_MS || 5000),

    // WebSocket heartbeat configuration
    wsHeartbeatMs: Number(parsed.WS_HEARTBEAT_MS || 15000)
  };
})();
