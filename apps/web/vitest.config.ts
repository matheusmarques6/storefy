import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, '.'),
      // Ver `test/server-only.ts`: é marca de build, não código.
      'server-only': resolve(import.meta.dirname, 'test/server-only.ts'),
    },
  },
});
