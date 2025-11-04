// PipelineLogger: Structured logging for the liquidation pipeline
// Provides consistent log format with decision reasons and context

import { createLogger, format, transports, Logger } from 'winston';

import { SkipReason, pipelineMetrics } from './PipelineMetrics.js';

export interface LogContext {
  userAddress?: string;
  blockNumber?: number;
  triggerType?: 'event' | 'head' | 'price';
  healthFactor?: number;
  debtUsd?: number;
  collateralUsd?: number;
  profitUsd?: number;
  reason?: SkipReason | string;
  [key: string]: any;
}

/**
 * PipelineLogger provides structured logging with automatic metrics tracking
 */
export class PipelineLogger {
  private logger: Logger;
  
  constructor(level: string = 'info') {
    this.logger = createLogger({
      level,
      format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.json()
      ),
      transports: [
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.printf(({ timestamp, level, message, ...meta }) => {
              const metaStr = Object.keys(meta).length > 0 
                ? ` ${JSON.stringify(meta)}` 
                : '';
              return `${timestamp} [${level}] ${message}${metaStr}`;
            })
          )
        })
      ]
    });
  }
  
  /**
   * Log candidate discovery
   */
  discovered(context: LogContext): void {
    const { userAddress, blockNumber, triggerType = 'event' } = context;
    pipelineMetrics.recordDiscovery(triggerType);
    
    this.logger.info('Candidate discovered', {
      stage: 'discovery',
      userAddress,
      blockNumber,
      triggerType
    });
  }
  
  /**
   * Log successful verification
   */
  verified(context: LogContext & { latencyMs: number }): void {
    const { userAddress, blockNumber, healthFactor, debtUsd, latencyMs } = context;
    pipelineMetrics.recordVerified(latencyMs);
    
    if (healthFactor !== undefined) {
      pipelineMetrics.updateMinHealthFactor(healthFactor);
    }
    
    this.logger.info('Candidate verified', {
      stage: 'verified',
      userAddress,
      blockNumber,
      healthFactor,
      debtUsd,
      latencyMs
    });
  }
  
  /**
   * Log profitable candidate
   */
  profitable(context: LogContext & { latencyMs: number }): void {
    const { userAddress, blockNumber, profitUsd, latencyMs } = context;
    pipelineMetrics.recordProfitable(latencyMs);
    
    this.logger.info('Candidate profitable', {
      stage: 'profitable',
      userAddress,
      blockNumber,
      profitUsd,
      latencyMs
    });
  }
  
  /**
   * Log execution
   */
  executed(context: LogContext & { latencyMs: number; success: boolean; txHash?: string }): void {
    const { userAddress, blockNumber, success, profitUsd, latencyMs, txHash } = context;
    pipelineMetrics.recordExecuted(latencyMs, success, profitUsd);
    
    this.logger.info('Candidate executed', {
      stage: 'executed',
      userAddress,
      blockNumber,
      success,
      profitUsd,
      latencyMs,
      txHash
    });
  }
  
  /**
   * Log skipped candidate with reason
   */
  skipped(context: LogContext & { reason: SkipReason | string }): void {
    const { userAddress, blockNumber, reason, ...extra } = context;
    
    // Record metric if it's a known reason
    if (Object.values(SkipReason).includes(reason as SkipReason)) {
      pipelineMetrics.recordSkipped(reason as SkipReason);
    }
    
    this.logger.debug('Candidate skipped', {
      stage: 'skipped',
      userAddress,
      blockNumber,
      reason,
      ...extra
    });
  }
  
  /**
   * Log duplicate candidate
   */
  duplicate(context: LogContext): void {
    const { userAddress, blockNumber } = context;
    pipelineMetrics.recordDuplicate();
    
    this.logger.debug('Duplicate candidate dropped', {
      stage: 'deduped',
      userAddress,
      blockNumber
    });
  }
  
  /**
   * Log error
   */
  error(message: string, context?: LogContext & { error?: Error }): void {
    const { error, ...ctx } = context || {};
    
    this.logger.error(message, {
      ...ctx,
      error: error ? {
        message: error.message,
        stack: error.stack
      } : undefined
    });
  }
  
  /**
   * Log warning
   */
  warn(message: string, context?: LogContext): void {
    this.logger.warn(message, context);
  }
  
  /**
   * Log info
   */
  info(message: string, context?: LogContext): void {
    this.logger.info(message, context);
  }
  
  /**
   * Log debug
   */
  debug(message: string, context?: LogContext): void {
    this.logger.debug(message, context);
  }
}

// Singleton instance
export const pipelineLogger = new PipelineLogger(process.env.LOG_LEVEL || 'info');
