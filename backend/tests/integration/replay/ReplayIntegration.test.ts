/**
 * ReplayIntegration.test.ts
 * 
 * Light integration test for replay mode with mocked provider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runReplay } from '../../../src/replay/ReplayRunner.js';

// Mock ethers provider
vi.mock('ethers', () => {
  const mockBlock = {
    number: 100,
    timestamp: Math.floor(Date.now() / 1000),
    hash: '0x1234567890abcdef'
  };

  return {
    ethers: {
      JsonRpcProvider: vi.fn().mockImplementation(() => ({
        getBlock: vi.fn().mockResolvedValue(mockBlock)
      }))
    }
  };
});

describe('Replay Integration', () => {
  const replayDir = path.join(process.cwd(), 'replay');
  const testStartBlock = 100;
  const testEndBlock = 102; // 3 blocks

  beforeEach(() => {
    // Ensure replay directory exists
    if (!fs.existsSync(replayDir)) {
      fs.mkdirSync(replayDir, { recursive: true });
    }
    
    // Set required env var for provider
    process.env.RPC_URL = 'http://test-rpc-url';
  });

  afterEach(() => {
    // Clean up test output files
    const ndjsonPath = path.join(replayDir, `replay-${testStartBlock}-${testEndBlock}.ndjson`);
    const summaryPath = path.join(replayDir, `replay-${testStartBlock}-${testEndBlock}-summary.json`);
    
    if (fs.existsSync(ndjsonPath)) {
      fs.unlinkSync(ndjsonPath);
    }
    if (fs.existsSync(summaryPath)) {
      fs.unlinkSync(summaryPath);
    }
  });

  it('should run replay and generate output files', async () => {
    await runReplay(testStartBlock, testEndBlock);

    // Verify NDJSON file exists and has correct number of lines
    const ndjsonPath = path.join(replayDir, `replay-${testStartBlock}-${testEndBlock}.ndjson`);
    expect(fs.existsSync(ndjsonPath)).toBe(true);

    const ndjsonContent = fs.readFileSync(ndjsonPath, 'utf-8');
    const lines = ndjsonContent.trim().split('\n');
    expect(lines.length).toBe(3); // 3 blocks

    // Verify each line is valid JSON with expected structure
    for (const line of lines) {
      const metrics = JSON.parse(line);
      expect(metrics).toHaveProperty('block');
      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('candidateCount');
      expect(metrics).toHaveProperty('liquidatableCount');
      expect(metrics).toHaveProperty('minHF');
      expect(metrics).toHaveProperty('newLiquidatables');
      expect(metrics).toHaveProperty('durationMs');
    }

    // Verify summary file exists and has correct structure
    const summaryPath = path.join(replayDir, `replay-${testStartBlock}-${testEndBlock}-summary.json`);
    expect(fs.existsSync(summaryPath)).toBe(true);

    const summaryContent = fs.readFileSync(summaryPath, 'utf-8');
    const summary = JSON.parse(summaryContent);
    
    expect(summary).toHaveProperty('startBlock', testStartBlock);
    expect(summary).toHaveProperty('endBlock', testEndBlock);
    expect(summary).toHaveProperty('totalBlocks', 3);
    expect(summary).toHaveProperty('totalUniqueLiquidatableUsers');
    expect(summary).toHaveProperty('earliestLiquidationBlock');
    expect(summary).toHaveProperty('totalLiquidatableEvents');
    expect(summary).toHaveProperty('avgDurationMs');
    expect(summary).toHaveProperty('minHF');
    expect(summary).toHaveProperty('generatedAt');
  });

  it('should handle empty candidate sets gracefully', async () => {
    // This test verifies the current scaffold behavior where candidates are empty
    await runReplay(testStartBlock, testEndBlock);

    const ndjsonPath = path.join(replayDir, `replay-${testStartBlock}-${testEndBlock}.ndjson`);
    const ndjsonContent = fs.readFileSync(ndjsonPath, 'utf-8');
    const lines = ndjsonContent.trim().split('\n');

    for (const line of lines) {
      const metrics = JSON.parse(line);
      expect(metrics.candidateCount).toBe(0);
      expect(metrics.liquidatableCount).toBe(0);
      expect(metrics.newLiquidatables).toEqual([]);
    }

    const summaryPath = path.join(replayDir, `replay-${testStartBlock}-${testEndBlock}-summary.json`);
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    expect(summary.totalUniqueLiquidatableUsers).toBe(0);
  });
});
