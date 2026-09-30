import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/**/*.service.spec.ts',
      'test/**/*.unit-spec.ts',
      'test/**/*.unit-spec.mts',
    ],
    setupFiles: ['./test/setup.ts'],
    clearMocks: true,
  },
});
