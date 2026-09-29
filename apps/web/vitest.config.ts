import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Tests for the web app's Node-side pieces (dev proxy) and static rendering checks. */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    conditions: ['@finance-close/source'],
  },
  test: {
    include: ['*.test.ts', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 30000,
  },
});
