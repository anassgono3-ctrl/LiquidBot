/**
 * Build metadata exported at compile time
 */

export const buildInfo = {
  startedAt: new Date().toISOString(),
  commit: process.env.GIT_COMMIT_SHA || 'unknown',
  node: process.version
};
