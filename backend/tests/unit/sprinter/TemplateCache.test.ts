import { describe, it, expect, beforeEach } from 'vitest';

import { TemplateCache, type TemplateCacheConfig } from '../../../src/sprinter/TemplateCache.js';

describe('TemplateCache', () => {
  let cache: TemplateCache;
  const config: TemplateCacheConfig = {
    aavePoolAddress: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    refreshIndexBps: 10000, // Refresh after 100 blocks
    maxEntries: 10
  };

  beforeEach(() => {
    cache = new TemplateCache(config);
  });

  describe('Template generation', () => {
    it('should create a template for a token pair', () => {
      const debtToken = '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA';
      const collateralToken = '0x4200000000000000000000000000000000000006';
      const currentBlock = 1000;

      const template = cache.getTemplate(debtToken, collateralToken, currentBlock);

      expect(template).toBeDefined();
      expect(template.debtToken).toBe(debtToken.toLowerCase());
      expect(template.collateralToken).toBe(collateralToken.toLowerCase());
      expect(template.buffer).toBeInstanceOf(Buffer);
      expect(template.buffer.length).toBeGreaterThan(0);
      expect(template.repayOffset).toBe(4 + 32 * 3);
      expect(template.createdBlock).toBe(currentBlock);
    });
  });
});
