import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./apps/desktop/src', import.meta.url)) },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/desktop/src/**/*.test.{ts,tsx}', 'apps/desktop/electron/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
});
