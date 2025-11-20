/**
 * ReplayOutputWriter: Writes replay results to NDJSON and summary JSON
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger, format, transports } from 'winston';

import type { BlockMetrics, ReplaySummary, LiquidationDetection } from './types.js';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

export interface OutputWriterOptions {
  outputDir: string;
  startBlock: number;
  endBlock: number;
}

export class ReplayOutputWriter {
  private outputDir: string;
  private blockLogPath: string;
  private summaryPath: string;
  private blockLogStream: fs.WriteStream | null = null;

  constructor(options: OutputWriterOptions) {
    this.outputDir = options.outputDir;
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Define output paths
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rangeStr = `${options.startBlock}-${options.endBlock}`;
    
    this.blockLogPath = path.join(
      this.outputDir,
      `replay-blocks-${rangeStr}-${timestamp}.ndjson`
    );
    
    this.summaryPath = path.join(
      this.outputDir,
      `replay-summary-${rangeStr}-${timestamp}.json`
    );

    logger.info(`[replay-output] Block log: ${this.blockLogPath}`);
    logger.info(`[replay-output] Summary: ${this.summaryPath}`);
  }

  /**
   * Initialize output stream for block-level metrics
   */
  initBlockLog(): void {
    this.blockLogStream = fs.createWriteStream(this.blockLogPath, { flags: 'a' });
  }

  /**
   * Write a block metric entry (NDJSON format)
   */
  writeBlockMetric(metric: BlockMetrics): void {
    if (!this.blockLogStream) {
      throw new Error('Block log stream not initialized. Call initBlockLog() first.');
    }

    const line = JSON.stringify(metric) + '\n';
    this.blockLogStream.write(line);
  }

  /**
   * Close block log stream
   */
  closeBlockLog(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.blockLogStream) {
        resolve();
        return;
      }

      this.blockLogStream.end((err?: Error) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Write summary JSON
   */
  async writeSummary(summary: ReplaySummary): Promise<void> {
    const content = JSON.stringify(summary, null, 2);
    await fs.promises.writeFile(this.summaryPath, content, 'utf-8');
    logger.info(`[replay-output] Summary written to ${this.summaryPath}`);
  }

  /**
   * Optional: Write detection details to CSV
   */
  async writeDetectionCSV(detections: LiquidationDetection[]): Promise<void> {
    const csvPath = this.summaryPath.replace('.json', '-detections.csv');
    
    const header = 'userAddress,firstDetectBlock,liquidationBlock,detectionLagBlocks,missReason\n';
    const rows = detections.map(d => {
      return [
        d.userAddress,
        d.firstDetectBlock !== null ? d.firstDetectBlock.toString() : '',
        d.liquidationBlock.toString(),
        d.detectionLagBlocks !== null ? d.detectionLagBlocks.toString() : '',
        d.missReason || ''
      ].join(',');
    }).join('\n');

    const content = header + rows;
    await fs.promises.writeFile(csvPath, content, 'utf-8');
    logger.info(`[replay-output] Detection CSV written to ${csvPath}`);
  }

  /**
   * Get output file paths
   */
  getOutputPaths(): { blockLog: string; summary: string } {
    return {
      blockLog: this.blockLogPath,
      summary: this.summaryPath
    };
  }
}
