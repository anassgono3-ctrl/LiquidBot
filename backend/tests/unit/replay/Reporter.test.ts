import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Reporter, type BlockMetrics, type CandidateMetrics, type MissedLiquidation } from '../../../src/replay/Reporter.js';

describe('Reporter', () => {
  let tempDir: string;
  let reporter: Reporter;

  beforeEach(() => {
    // Create a temporary directory for test outputs
    tempDir = mkdtempSync(join(tmpdir(), 'replay-test-'));
    reporter = new Reporter(tempDir);
  });

  afterEach(() => {
    // Clean up temporary directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('writeBlock', () => {
    it('should write block metrics to blocks.jsonl', () => {
      const metrics: BlockMetrics = {
        type: 'block',
        block: 1000,
        timestamp: 1234567890,
        scanLatencyMs: 150,
        candidates: 5,
        onChainLiquidations: 2,
        missed: ['0xUser1'],
        falsePositives: ['0xUser2', '0xUser3']
      };

      reporter.writeBlock(metrics);

      const content = readFileSync(join(tempDir, 'blocks.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.type).toBe('block');
      expect(parsed.block).toBe(1000);
      expect(parsed.candidates).toBe(5);
    });

    it('should append multiple block entries', () => {
      reporter.writeBlock({
        type: 'block',
        block: 1000,
        timestamp: 1234567890,
        scanLatencyMs: 150,
        candidates: 5,
        onChainLiquidations: 2,
        missed: [],
        falsePositives: []
      });

      reporter.writeBlock({
        type: 'block',
        block: 1001,
        timestamp: 1234567892,
        scanLatencyMs: 200,
        candidates: 3,
        onChainLiquidations: 1,
        missed: [],
        falsePositives: []
      });

      const content = readFileSync(join(tempDir, 'blocks.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);
    });
  });

  describe('writeCandidate', () => {
    it('should write candidate metrics to candidates.jsonl', () => {
      const metrics: CandidateMetrics = {
        type: 'candidate',
        block: 1000,
        user: '0xUser1',
        hf: 0.98,
        debtUSD: 1500,
        collateralUSD: 1650,
        profitEstUSD: 75,
        wouldSend: true,
        simulation: 'ok',
        onChainLiquidated: true,
        classification: 'detected'
      };

      reporter.writeCandidate(metrics);

      const content = readFileSync(join(tempDir, 'candidates.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.type).toBe('candidate');
      expect(parsed.user).toBe('0xUser1');
      expect(parsed.classification).toBe('detected');
    });
  });

  describe('writeMissed', () => {
    it('should write missed liquidation to missed.jsonl', () => {
      const missed: MissedLiquidation = {
        type: 'missed',
        block: 1000,
        user: '0xUser1',
        txHash: '0xTx1',
        reason: 'not-detected'
      };

      reporter.writeMissed(missed);

      const content = readFileSync(join(tempDir, 'missed.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.type).toBe('missed');
      expect(parsed.user).toBe('0xUser1');
    });
  });

  describe('recordLeadTime', () => {
    it('should track lead times for summary', () => {
      reporter.recordLeadTime(5);
      reporter.recordLeadTime(10);
      reporter.recordLeadTime(3);

      reporter.writeSummary();

      const content = readFileSync(join(tempDir, 'summary.jsonl'), 'utf-8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.avgLeadBlocks).toBe(6); // (5 + 10 + 3) / 3
      expect(parsed.medianLeadBlocks).toBe(5);
      expect(parsed.minLeadBlocks).toBe(3);
      expect(parsed.maxLeadBlocks).toBe(10);
    });
  });

  describe('writeSummary', () => {
    it('should write aggregated summary to summary.jsonl', () => {
      // Write some blocks
      reporter.writeBlock({
        type: 'block',
        block: 1000,
        timestamp: 1234567890,
        scanLatencyMs: 150,
        candidates: 5,
        onChainLiquidations: 2,
        missed: ['0xUser1'],
        falsePositives: ['0xUser2']
      });

      reporter.writeBlock({
        type: 'block',
        block: 1001,
        timestamp: 1234567892,
        scanLatencyMs: 200,
        candidates: 3,
        onChainLiquidations: 1,
        missed: [],
        falsePositives: []
      });

      // Write some candidates
      reporter.writeCandidate({
        type: 'candidate',
        block: 1000,
        user: '0xUser1',
        hf: 0.98,
        debtUSD: 1500,
        collateralUSD: 1650,
        profitEstUSD: 75,
        wouldSend: true,
        simulation: 'ok',
        onChainLiquidated: true,
        classification: 'detected'
      });

      reporter.writeCandidate({
        type: 'candidate',
        block: 1000,
        user: '0xUser2',
        hf: 0.99,
        debtUSD: 1000,
        collateralUSD: 1100,
        profitEstUSD: 50,
        wouldSend: true,
        simulation: 'ok',
        onChainLiquidated: false,
        classification: 'false-positive'
      });

      // Record lead time
      reporter.recordLeadTime(5);

      // Write summary
      reporter.writeSummary();

      const content = readFileSync(join(tempDir, 'summary.jsonl'), 'utf-8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('summary');
      expect(parsed.blocks).toBe(2);
      expect(parsed.candidates).toBe(2);
      expect(parsed.onChainLiquidations).toBe(3);
      expect(parsed.detected).toBe(1);
      expect(parsed.missed).toBe(1);
      expect(parsed.falsePositives).toBe(1);
      expect(parsed.avgLeadBlocks).toBe(5);
      expect(parsed.avgProfitUSD).toBe(62.5); // (75 + 50) / 2
      expect(parsed.avgScanLatencyMs).toBe(175); // (150 + 200) / 2
    });

    it('should calculate coverage ratio correctly', () => {
      // Write blocks with liquidations
      reporter.writeBlock({
        type: 'block',
        block: 1000,
        timestamp: 1234567890,
        scanLatencyMs: 150,
        candidates: 2,
        onChainLiquidations: 2,
        missed: [],
        falsePositives: []
      });

      // Write detected candidates
      reporter.writeCandidate({
        type: 'candidate',
        block: 1000,
        user: '0xUser1',
        hf: 0.98,
        debtUSD: 1500,
        collateralUSD: 1650,
        profitEstUSD: 75,
        wouldSend: true,
        simulation: 'ok',
        onChainLiquidated: true,
        classification: 'detected'
      });

      reporter.writeCandidate({
        type: 'candidate',
        block: 1000,
        user: '0xUser2',
        hf: 0.97,
        debtUSD: 2000,
        collateralUSD: 2200,
        profitEstUSD: 100,
        wouldSend: true,
        simulation: 'ok',
        onChainLiquidated: true,
        classification: 'detected'
      });

      reporter.writeSummary();

      const content = readFileSync(join(tempDir, 'summary.jsonl'), 'utf-8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.coverageRatio).toBe(1); // 2/2 = 1.0
    });

    it('should handle empty data gracefully', () => {
      reporter.writeSummary();

      const content = readFileSync(join(tempDir, 'summary.jsonl'), 'utf-8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.type).toBe('summary');
      expect(parsed.blocks).toBe(0);
      expect(parsed.candidates).toBe(0);
      expect(parsed.coverageRatio).toBe(0);
      expect(parsed.avgLeadBlocks).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return current statistics without writing', () => {
      reporter.writeBlock({
        type: 'block',
        block: 1000,
        timestamp: 1234567890,
        scanLatencyMs: 150,
        candidates: 5,
        onChainLiquidations: 2,
        missed: ['0xUser1'],
        falsePositives: []
      });

      reporter.writeCandidate({
        type: 'candidate',
        block: 1000,
        user: '0xUser1',
        hf: 0.98,
        debtUSD: 1500,
        collateralUSD: 1650,
        profitEstUSD: 75,
        wouldSend: true,
        simulation: 'ok',
        onChainLiquidated: true,
        classification: 'detected'
      });

      const stats = reporter.getStats();

      expect(stats.blocks).toBe(1);
      expect(stats.candidates).toBe(1);
      expect(stats.onChainLiquidations).toBe(2);
      expect(stats.detected).toBe(1);
      expect(stats.missed).toBe(1);
    });
  });
});
