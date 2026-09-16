import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['dist/**', 'node_modules/**'],
    coverage: { reporter: ['text', 'html'] },
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
