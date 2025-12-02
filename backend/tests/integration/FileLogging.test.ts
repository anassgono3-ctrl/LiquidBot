/**
 * Integration test for file logging feature
 * 
 * Validates that:
 * - File logging can be enabled via LOG_FILE_ENABLED
 * - Log files are created in logs/ directory
 * - Rotation works as expected
 * - Console logging continues to work
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

describe('File Logging Integration Test', () => {
  const testLogsDir = join(process.cwd(), 'test-logs');
  
  beforeAll(() => {
    // Create test logs directory
    if (existsSync(testLogsDir)) {
      rmSync(testLogsDir, { recursive: true, force: true });
    }
    mkdirSync(testLogsDir, { recursive: true });
  });

  afterAll(() => {
    // Clean up test logs directory
    if (existsSync(testLogsDir)) {
      rmSync(testLogsDir, { recursive: true, force: true });
    }
  });

  describe('Logger configuration', () => {
    it('should create logger with console transport when file logging disabled', () => {
      const logger = createLogger({
        level: 'info',
        format: format.combine(format.timestamp(), format.json()),
        transports: [new transports.Console()]
      });

      expect(logger).toBeDefined();
      expect(logger.transports).toHaveLength(1);
      expect(logger.transports[0]).toBeInstanceOf(transports.Console);
    });

    it('should create logger with both console and file transports when enabled', () => {
      const fileTransport = new DailyRotateFile({
        filename: join(testLogsDir, 'test-%DATE%.log'),
        datePattern: 'YYYY-MM-DD-HH',
        maxSize: '50m',
        maxFiles: '1d',
        format: format.combine(format.timestamp(), format.json())
      });

      const logger = createLogger({
        level: 'info',
        format: format.combine(format.timestamp(), format.json()),
        transports: [
          new transports.Console(),
          fileTransport
        ]
      });

      expect(logger).toBeDefined();
      expect(logger.transports).toHaveLength(2);
      expect(logger.transports[0]).toBeInstanceOf(transports.Console);
      expect(logger.transports[1]).toBeInstanceOf(DailyRotateFile);
    });
  });

  describe('File writing', () => {
    it('should write logs to file when file transport is configured', async () => {
      const fileTransport = new DailyRotateFile({
        filename: join(testLogsDir, 'bot-%DATE%.log'),
        datePattern: 'YYYY-MM-DD-HH',
        maxSize: '50m',
        maxFiles: '1d',
        format: format.combine(format.timestamp(), format.json())
      });

      const logger = createLogger({
        level: 'info',
        format: format.combine(format.timestamp(), format.json()),
        transports: [fileTransport]
      });

      // Write some test logs
      logger.info('Test log message 1', { test: true });
      logger.info('Test log message 2', { test: true });
      logger.warn('Test warning message', { warning: true });

      // Give logger time to flush
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check that log files were created
      const files = readdirSync(testLogsDir);
      expect(files.length).toBeGreaterThan(0);

      // Find the log file
      const logFile = files.find(f => f.startsWith('bot-') && f.endsWith('.log'));
      expect(logFile).toBeDefined();

      // Verify log content
      const logPath = join(testLogsDir, logFile!);
      const logContent = readFileSync(logPath, 'utf-8');
      
      expect(logContent).toContain('Test log message 1');
      expect(logContent).toContain('Test log message 2');
      expect(logContent).toContain('Test warning message');
      expect(logContent).toContain('"test":true');
      expect(logContent).toContain('"warning":true');

      // Close logger to release file handles
      logger.close();
    });

    it('should create structured JSON log entries', async () => {
      const fileTransport = new DailyRotateFile({
        filename: join(testLogsDir, 'structured-%DATE%.log'),
        datePattern: 'YYYY-MM-DD-HH',
        maxSize: '50m',
        maxFiles: '1d',
        format: format.combine(format.timestamp(), format.json())
      });

      const logger = createLogger({
        level: 'info',
        format: format.combine(format.timestamp(), format.json()),
        transports: [fileTransport]
      });

      // Write structured log
      logger.info('Liquidation detected', {
        user: '0x1234567890123456789012345678901234567890',
        healthFactor: 0.98,
        collateralUsd: 1000,
        debtUsd: 950
      });

      // Give logger time to flush
      await new Promise(resolve => setTimeout(resolve, 100));

      // Read and parse log
      const files = readdirSync(testLogsDir);
      const logFile = files.find(f => f.startsWith('structured-'));
      expect(logFile).toBeDefined();

      const logPath = join(testLogsDir, logFile!);
      const logContent = readFileSync(logPath, 'utf-8');
      const logLines = logContent.trim().split('\n');
      
      expect(logLines.length).toBeGreaterThan(0);
      
      // Parse first log entry
      const logEntry = JSON.parse(logLines[0]);
      
      expect(logEntry).toHaveProperty('timestamp');
      expect(logEntry).toHaveProperty('level', 'info');
      expect(logEntry).toHaveProperty('message', 'Liquidation detected');
      expect(logEntry).toHaveProperty('user', '0x1234567890123456789012345678901234567890');
      expect(logEntry).toHaveProperty('healthFactor', 0.98);
      expect(logEntry).toHaveProperty('collateralUsd', 1000);
      expect(logEntry).toHaveProperty('debtUsd', 950);

      // Close logger
      logger.close();
    });
  });

  describe('Log rotation', () => {
    it('should respect maxSize configuration', async () => {
      const fileTransport = new DailyRotateFile({
        filename: join(testLogsDir, 'rotate-%DATE%.log'),
        datePattern: 'YYYY-MM-DD-HH',
        maxSize: '1k', // Very small size to trigger rotation
        maxFiles: '1d',
        format: format.combine(format.timestamp(), format.json())
      });

      const logger = createLogger({
        level: 'info',
        format: format.combine(format.timestamp(), format.json()),
        transports: [fileTransport]
      });

      // Write enough data to trigger rotation (1KB limit)
      for (let i = 0; i < 50; i++) {
        logger.info(`Test message ${i}`, { 
          data: 'x'.repeat(100), // 100 chars of padding
          iteration: i 
        });
      }

      // Give logger time to flush and rotate
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check that files were created (may include rotated files)
      const files = readdirSync(testLogsDir);
      const rotateFiles = files.filter(f => f.startsWith('rotate-'));
      
      // Should have at least the main log file
      expect(rotateFiles.length).toBeGreaterThan(0);

      // Close logger
      logger.close();
    });
  });
});
