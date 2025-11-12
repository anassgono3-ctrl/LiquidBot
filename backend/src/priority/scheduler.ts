// Priority Sweep Scheduler
// Manages periodic execution of priority sweeps with single-flight protection

import { config } from '../config/index.js';

import { PrioritySweepRunner } from './prioritySweep.js';

let schedulerHandle: NodeJS.Timeout | null = null;
let sweepInProgress = false;
let sweepRunner: PrioritySweepRunner | null = null;

/**
 * Start the priority sweep scheduler
 * Runs immediately and then on the configured interval
 */
export function startPrioritySweepScheduler(): void {
  if (!config.prioritySweepEnabled) {
    // eslint-disable-next-line no-console
    console.log('[priority-sweep] Priority sweep disabled (PRIORITY_SWEEP_ENABLED=false)');
    return;
  }

  // Log startup configuration
  // eslint-disable-next-line no-console
  console.log('[priority-sweep] Starting scheduler with config:', {
    intervalMin: config.prioritySweepIntervalMin,
    minDebtUsd: config.priorityMinDebtUsd,
    minCollateralUsd: config.priorityMinCollateralUsd,
    targetSize: config.priorityTargetSize,
    maxScanUsers: config.priorityMaxScanUsers,
    timeoutMs: config.prioritySweepTimeoutMs
  });

  sweepRunner = new PrioritySweepRunner();

  // Run immediately on startup
  void runSweepWithProtection();

  // Schedule periodic runs
  const intervalMs = config.prioritySweepIntervalMin * 60 * 1000;
  schedulerHandle = setInterval(() => {
    void runSweepWithProtection();
  }, intervalMs);

  // eslint-disable-next-line no-console
  console.log(`[priority-sweep] Scheduler started (interval=${config.prioritySweepIntervalMin}min)`);
}

/**
 * Stop the priority sweep scheduler
 */
export function stopPrioritySweepScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
    // eslint-disable-next-line no-console
    console.log('[priority-sweep] Scheduler stopped');
  }
}

/**
 * Run a sweep with single-flight protection and timeout
 */
async function runSweepWithProtection(): Promise<void> {
  // Single-flight protection: skip if sweep already in progress
  if (sweepInProgress) {
    // eslint-disable-next-line no-console
    console.log('[priority-sweep] Skipping sweep - previous sweep still in progress');
    return;
  }

  if (!sweepRunner) {
    // eslint-disable-next-line no-console
    console.error('[priority-sweep][error] Sweep runner not initialized');
    return;
  }

  sweepInProgress = true;

  try {
    // Create abort controller for timeout
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, config.prioritySweepTimeoutMs);

    try {
      await sweepRunner.runSweep(abortController.signal);
    } finally {
      clearTimeout(timeoutHandle);
    }
  } catch (error) {
    // Error already logged in runSweep
    // eslint-disable-next-line no-console
    console.error('[priority-sweep][error] Sweep execution failed:', error);
  } finally {
    sweepInProgress = false;
  }
}

/**
 * Get the current priority set (for external access)
 */
export function getPrioritySet() {
  return sweepRunner?.getPrioritySet() || null;
}

/**
 * Check if a sweep is currently in progress
 */
export function isSweepInProgress(): boolean {
  return sweepInProgress;
}
