import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.unit-spec.ts'],
    setupFiles: ['./test/setup.ts'],
    clearMocks: true,
  },
});
