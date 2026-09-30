import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts', 'test/**/*.e2e-spec.mts'],
    setupFiles: ['./test/setup.ts', './test/postgres-test-setup.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
