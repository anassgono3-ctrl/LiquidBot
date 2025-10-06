import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/types/**',
        'src/worker/**',
        'src/index.ts',
        'scripts/**'
      ],
      lines: 80,
      functions: 65,
      statements: 80,
      branches: 70,
      reportsDirectory: './coverage'
    }
  }
});
