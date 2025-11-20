// ReplayConfig: Parse and validate replay environment variables
import { z } from 'zod';

/**
 * Replay mode defines the execution behavior during replay:
 * - observe: candidate detection only (no simulation)
 * - simulate: perform callStatic liquidation to assess success
 * - hybrid: simulate only candidates above profit/HF thresholds
 * - exec-fork: run against local anvil/Foundry fork (never broadcast)
 */
export type ReplayMode = 'observe' | 'simulate' | 'hybrid' | 'exec-fork';

/**
 * Replay speed controls the playback rate:
 * - realtime: simulate actual block times with delays
 * - accelerated: reduced delays between blocks
 * - max: no delays, process as fast as possible
 */
export type ReplaySpeed = 'realtime' | 'accelerated' | 'max';

/**
 * Price source for historical price queries:
 * - oracle: use on-chain oracle prices at historical blocks
 * - subgraph: use subgraph price data (if available)
 * - mixed: prefer oracle, fallback to subgraph
 */
export type ReplayPriceSource = 'oracle' | 'subgraph' | 'mixed';

const ReplayConfigSchema = z.object({
  // Core replay settings
  enabled: z.boolean().default(false),
  mode: z.enum(['observe', 'simulate', 'hybrid', 'exec-fork']).default('simulate'),
  startBlock: z.number().int().positive().optional(),
  endBlock: z.number().int().positive().optional(),
  chainId: z.number().int().default(8453), // Base chain default
  
  // Performance controls
  speed: z.enum(['realtime', 'accelerated', 'max']).default('accelerated'),
  blockStep: z.number().int().positive().default(1),
  sleepMs: z.number().int().nonnegative().default(0),
  
  // Data sources
  priceSource: z.enum(['oracle', 'subgraph', 'mixed']).default('oracle'),
  
  // Output configuration
  exportDir: z.string().default('./replay/out'),
  compareWithOnchain: z.boolean().default(true),
  logCalldata: z.boolean().default(true),
  logMissed: z.boolean().default(true),
  
  // Error handling
  pauseOnError: z.boolean().default(true),
  maxBlockErrors: z.number().int().positive().default(10),
  
  // Threshold overrides for analysis
  includeLowDebt: z.boolean().default(false),
  forceMinDebtUsd: z.number().nonnegative().optional(),
  forceMinProfitUsd: z.number().nonnegative().optional(),
  
  // Fork execution (for exec-fork mode)
  localForkUrl: z.string().optional(),
  forkAutoAdvance: z.boolean().default(true),
});

export type ReplayConfigType = z.infer<typeof ReplayConfigSchema>;

/**
 * Parse replay configuration from environment variables.
 * Returns default config if REPLAY_ENABLED is not set or false.
 */
export function parseReplayConfig(): ReplayConfigType {
  const env = process.env;
  
  // If replay is not enabled, return minimal default config
  if (env.REPLAY_ENABLED !== 'true') {
    return ReplayConfigSchema.parse({ enabled: false });
  }
  
  const raw = {
    enabled: env.REPLAY_ENABLED === 'true',
    mode: env.REPLAY_MODE || 'simulate',
    startBlock: env.REPLAY_START_BLOCK ? parseInt(env.REPLAY_START_BLOCK, 10) : undefined,
    endBlock: env.REPLAY_END_BLOCK ? parseInt(env.REPLAY_END_BLOCK, 10) : undefined,
    chainId: env.REPLAY_CHAIN_ID ? parseInt(env.REPLAY_CHAIN_ID, 10) : 8453,
    
    speed: env.REPLAY_SPEED || 'accelerated',
    blockStep: env.REPLAY_BLOCK_STEP ? parseInt(env.REPLAY_BLOCK_STEP, 10) : 1,
    sleepMs: env.REPLAY_SLEEP_MS ? parseInt(env.REPLAY_SLEEP_MS, 10) : 0,
    
    priceSource: env.REPLAY_PRICE_SOURCE || 'oracle',
    
    exportDir: env.REPLAY_EXPORT_DIR || './replay/out',
    compareWithOnchain: env.REPLAY_COMPARE_WITH_ONCHAIN !== 'false',
    logCalldata: env.REPLAY_LOG_CALDATA !== 'false',
    logMissed: env.REPLAY_LOG_MISSED !== 'false',
    
    pauseOnError: env.REPLAY_PAUSE_ON_ERROR !== 'false',
    maxBlockErrors: env.REPLAY_MAX_BLOCK_ERRORS ? parseInt(env.REPLAY_MAX_BLOCK_ERRORS, 10) : 10,
    
    includeLowDebt: env.REPLAY_INCLUDE_LOW_DEBT === 'true',
    forceMinDebtUsd: env.REPLAY_FORCE_MIN_DEBT_USD ? parseFloat(env.REPLAY_FORCE_MIN_DEBT_USD) : undefined,
    forceMinProfitUsd: env.REPLAY_FORCE_MIN_PROFIT_USD ? parseFloat(env.REPLAY_FORCE_MIN_PROFIT_USD) : undefined,
    
    localForkUrl: env.REPLAY_LOCAL_FORK_URL,
    forkAutoAdvance: env.REPLAY_FORK_AUTO_ADVANCE !== 'false',
  };
  
  const config = ReplayConfigSchema.parse(raw);
  
  // Validation: startBlock and endBlock must be provided when enabled
  if (config.enabled && (!config.startBlock || !config.endBlock)) {
    throw new Error('REPLAY_START_BLOCK and REPLAY_END_BLOCK must be set when REPLAY_ENABLED=true');
  }
  
  if (config.enabled && config.startBlock && config.endBlock && config.startBlock >= config.endBlock) {
    throw new Error('REPLAY_START_BLOCK must be less than REPLAY_END_BLOCK');
  }
  
  // Validation: fork URL required for exec-fork mode
  if (config.enabled && config.mode === 'exec-fork' && !config.localForkUrl) {
    throw new Error('REPLAY_LOCAL_FORK_URL must be set when REPLAY_MODE=exec-fork');
  }
  
  return config;
}

/**
 * Get sleep duration in milliseconds based on replay speed.
 */
export function getSleepDuration(config: ReplayConfigType): number {
  if (config.sleepMs > 0) {
    return config.sleepMs;
  }
  
  switch (config.speed) {
    case 'max':
      return 0;
    case 'accelerated':
      return 100; // 100ms default for accelerated
    case 'realtime':
      return 2000; // ~2s average block time on Base
    default:
      return 0;
  }
}

/**
 * Validate replay configuration and log warnings for common issues.
 */
export function validateReplayConfig(config: ReplayConfigType): string[] {
  const warnings: string[] = [];
  
  if (!config.enabled) {
    return warnings;
  }
  
  // Warn about large block ranges
  if (config.startBlock && config.endBlock) {
    const blockCount = config.endBlock - config.startBlock;
    if (blockCount > 10000) {
      warnings.push(`Large block range detected (${blockCount} blocks). Consider using smaller ranges for initial testing.`);
    }
  }
  
  // Warn about simulation performance
  if (config.mode === 'simulate' && config.speed === 'max') {
    warnings.push('Running full simulation at max speed may be rate-limited by RPC provider.');
  }
  
  // Warn about fork mode setup
  if (config.mode === 'exec-fork' && config.localForkUrl?.includes('localhost')) {
    warnings.push('Ensure local fork (anvil/hardhat) is running before starting replay.');
  }
  
  return warnings;
}
