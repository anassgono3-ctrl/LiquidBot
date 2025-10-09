// Execution configuration for liquidation execution pipeline
import { config } from './index.js';

export interface ExecutionConfig {
  // Master switch
  executionEnabled: boolean;
  
  // Dry run mode (simulate without broadcasting)
  dryRunExecution: boolean;
  
  // MEV controls
  privateBundleRpc?: string;
  maxGasPriceGwei: number;
  
  // Risk controls
  minProfitAfterGasUsd: number;
  maxPositionSizeUsd: number;
  dailyLossLimitUsd: number;
  blacklistedTokens: string[];
}

/**
 * Load and parse execution configuration from environment variables
 */
export function loadExecutionConfig(): ExecutionConfig {
  return {
    executionEnabled: (process.env.EXECUTION_ENABLED || 'false').toLowerCase() === 'true',
    dryRunExecution: (process.env.DRY_RUN_EXECUTION || 'true').toLowerCase() === 'true',
    privateBundleRpc: process.env.PRIVATE_BUNDLE_RPC || undefined,
    maxGasPriceGwei: Number(process.env.MAX_GAS_PRICE_GWEI || 50),
    minProfitAfterGasUsd: Number(process.env.MIN_PROFIT_AFTER_GAS_USD || 10),
    maxPositionSizeUsd: Number(process.env.MAX_POSITION_SIZE_USD || 5000),
    dailyLossLimitUsd: Number(process.env.DAILY_LOSS_LIMIT_USD || 1000),
    blacklistedTokens: (process.env.BLACKLISTED_TOKENS || '')
      .split(',')
      .map(t => t.trim().toUpperCase())
      .filter(t => t.length > 0)
  };
}

// Export singleton instance
export const executionConfig = loadExecutionConfig();
