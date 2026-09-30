import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

/**
 * Browser journey tests (npm run test:browser). They run against a SEPARATE instance of the
 * app: the API on port 3001 and the web app on 5174, using the test database
 * (<dev database>_test) and ./data/uploads-test — never the development data.
 */
const apiEnvFile = path.join(__dirname, 'apps', 'api', '.env');
const apiEnv = dotenv.config({ path: apiEnvFile, processEnv: {} }).parsed ?? {};
const devUrl = new URL(
  apiEnv.DATABASE_URL ?? 'postgresql://finance:finance_dev_password@localhost:54329/finance_close',
);
devUrl.pathname = `${devUrl.pathname.replace(/^\//, '')}_test`;

const TEST_ENV = {
  DATABASE_URL: devUrl.toString(),
  PORT: '3001',
  CORS_ORIGINS: 'http://localhost:5174',
  MASTER_NAME: 'Test master',
  MASTER_EMAIL: 'master@test.local',
  MASTER_PASSWORD: 'MasterPass123',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  BCRYPT_ROUNDS: '4',
  COOKIE_SECURE: 'false',
  DEMO_MODE: 'true',
  FIXED_TODAY: '2026-09-29',
  STORAGE_LOCAL_DIR: './data/uploads-test',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: [
    {
      // Build the API, prepare the test database, then serve the API on 3001.
      command:
        'npm run build -w @finance-close/api && npx tsx test/browser-prepare.ts && node dist/main.js',
      cwd: path.join(__dirname, 'apps', 'api'),
      url: 'http://localhost:3001/api/health',
      env: TEST_ENV,
      timeout: 300_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      cwd: path.join(__dirname, 'apps', 'web'),
      url: 'http://localhost:5174',
      env: { API_PROXY_TARGET: 'http://localhost:3001' },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
