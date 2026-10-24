import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['tests/browser/**', 'node_modules/**'],
    environment: 'node',
  },
});
