// Pipeline Configuration: Centralized config for real-time liquidation pipeline
// All safety limits, thresholds, and operational parameters

import dotenv from 'dotenv';

dotenv.config();

/**
 * Pipeline configuration with sensible defaults
 * Can be overridden via environment variables
 */
export const pipelineConfig = {
  // Detection thresholds
  minDebtUsd: parseFloat(process.env.MIN_DEBT_USD || '200'),
  minProfitUsd: parseFloat(process.env.MIN_PROFIT_USD || '15'),
  
  // Slippage and gas
  maxSlippageBps: parseInt(process.env.MAX_SLIPPAGE_BPS || '80', 10), // 0.8%
  gasPriceCeilingGwei: parseFloat(process.env.GAS_PRICE_CEILING_GWEI || '50'),
  gasCostUsd: parseFloat(process.env.GAS_COST_USD || '0'),
  
  // Close factor
  closeFactorBps: parseInt(process.env.CLOSE_FACTOR_BPS || '5000', 10), // 50%
  
  // Execution control
  execute: process.env.EXECUTE === 'true',
  recognizeOnly: process.env.EXECUTE !== 'true', // Inverse of execute
  dryRun: process.env.DRY_RUN_EXECUTION !== 'false', // Default to true
  
  // Flash loan and DEX
  allowFlash: process.env.ALLOW_FLASH === 'true',
  dexRouters: process.env.DEX_ROUTERS?.split(',').map(s => s.trim()) || ['UniswapV3'],
  
  // Asset lists
  allowedAssets: process.env.ALLOWED_ASSETS?.split(',').map(s => s.trim().toLowerCase()) || [],
  deniedAssets: process.env.DENIED_ASSETS?.split(',').map(s => s.trim().toLowerCase()) || [],
  
  // Cooldowns and deduplication
  userCooldownMs: parseInt(process.env.USER_COOLDOWN_MS || '60000', 10), // 1 minute
  
  // Scan cadence
  headSweepIntervalMs: parseInt(process.env.HEAD_SWEEP_INTERVAL_MS || '12000', 10), // 12 seconds
  
  // Candidate management
  maxCandidates: parseInt(process.env.MAX_CANDIDATES || '300', 10),
  
  // Network
  rpcUrl: process.env.RPC_URL || '',
  wsRpcUrl: process.env.WS_RPC_URL || '',
  chainId: parseInt(process.env.CHAIN_ID || '8453', 10), // Base
  
  // Contracts (Base defaults)
  aavePool: process.env.AAVE_POOL || '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  aaveProtocolDataProvider: process.env.AAVE_PROTOCOL_DATA_PROVIDER || '0xC4Fcf9893072d61Cc2899C0054877Cb752587981',
  aaveOracle: process.env.AAVE_ORACLE || '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156',
  multicall3: process.env.MULTICALL3_ADDRESS || '0xca11bde05977b3631167028862be2a173976ca11',
  
  // Executor contract
  executorAddress: process.env.EXECUTOR_ADDRESS || '',
  executionPrivateKey: process.env.EXECUTION_PRIVATE_KEY || '',
  
  // 1inch
  oneInchApiKey: process.env.ONEINCH_API_KEY || '',
  oneInchBaseUrl: process.env.ONEINCH_BASE_URL || 'https://api.1inch.dev/swap/v6.0/8453',
  
  // Observability
  metricsEnabled: process.env.METRICS_ENABLED !== 'false',
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // Subgraph (optional background discovery)
  useSubgraphDiscovery: process.env.USE_SUBGRAPH_DISCOVERY === 'true',
  subgraphUrl: process.env.SUBGRAPH_URL || '',
  subgraphRefreshIntervalMs: parseInt(process.env.SUBGRAPH_REFRESH_INTERVAL_MS || '1800000', 10), // 30 minutes
  
  // Validate configuration
  validate(): string[] {
    const errors: string[] = [];
    
    if (this.execute && !this.dryRun) {
      if (!this.rpcUrl) {
        errors.push('RPC_URL is required when EXECUTE=true and DRY_RUN_EXECUTION=false');
      }
      if (!this.executorAddress) {
        errors.push('EXECUTOR_ADDRESS is required when EXECUTE=true and DRY_RUN_EXECUTION=false');
      }
      if (!this.executionPrivateKey) {
        errors.push('EXECUTION_PRIVATE_KEY is required when EXECUTE=true and DRY_RUN_EXECUTION=false');
      }
    }
    
    if (this.minDebtUsd < 0) {
      errors.push('MIN_DEBT_USD must be non-negative');
    }
    
    if (this.minProfitUsd < 0) {
      errors.push('MIN_PROFIT_USD must be non-negative');
    }
    
    if (this.maxSlippageBps < 0 || this.maxSlippageBps > 10000) {
      errors.push('MAX_SLIPPAGE_BPS must be between 0 and 10000');
    }
    
    if (this.closeFactorBps < 0 || this.closeFactorBps > 10000) {
      errors.push('CLOSE_FACTOR_BPS must be between 0 and 10000');
    }
    
    return errors;
  },
  
  // Get summary for logging
  getSummary(): string {
    return [
      'Pipeline Configuration:',
      `  Mode: ${this.recognizeOnly ? 'RECOGNIZE-ONLY' : (this.dryRun ? 'DRY-RUN' : 'EXECUTE')}`,
      `  Min Debt: $${this.minDebtUsd}`,
      `  Min Profit: $${this.minProfitUsd}`,
      `  Max Slippage: ${this.maxSlippageBps / 100}%`,
      `  Close Factor: ${this.closeFactorBps / 100}%`,
      `  Gas Ceiling: ${this.gasPriceCeilingGwei} Gwei`,
      `  Flash Loans: ${this.allowFlash ? 'ENABLED' : 'DISABLED'}`,
      `  DEX Routers: ${this.dexRouters.join(', ')}`,
      `  Max Candidates: ${this.maxCandidates}`,
      `  User Cooldown: ${this.userCooldownMs / 1000}s`,
      `  Chain ID: ${this.chainId}`,
      this.allowedAssets.length > 0 ? `  Allowed Assets: ${this.allowedAssets.length}` : '',
      this.deniedAssets.length > 0 ? `  Denied Assets: ${this.deniedAssets.length}` : ''
    ].filter(Boolean).join('\n');
  }
};
