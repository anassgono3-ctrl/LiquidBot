/**
 * Sprinter High-Priority Execution Path
 * 
 * Exports:
 * - SprinterEngine: Pre-staging engine for liquidation candidates
 * - TemplateCache: Calldata template cache for fast patching
 */

export { SprinterEngine, type PreStagedCandidate, type SprinterEngineConfig } from './SprinterEngine.js';
export { TemplateCache, type CalldataTemplate, type TemplateCacheConfig } from './TemplateCache.js';
