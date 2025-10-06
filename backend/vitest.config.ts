import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      all: true,
      lines: 80,
      functions: 80,
      statements: 80,
      branches: 70,
      reportsDirectory: './coverage'
    }
  }
});
