/**
 * Jest global setup for the API integration tests.
 *
 * Uses a separate database, <dev database>_test, on the same embedded PostgreSQL server.
 * Nothing is ever dropped or reset: each run applies any new migrations and re-runs the
 * idempotent seed (with a known test master admin). Tests create uniquely named users, so
 * rows left by earlier runs do not matter. The development database is never touched.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';
import { TEST_ENV } from './test-env';

const API_DIR = path.resolve(__dirname, '..');
const ROOT = path.resolve(API_DIR, '..', '..');

export default function globalSetup(): void {
  dotenv.config({ path: path.join(API_DIR, '.env') });
  const devUrl = process.env.DATABASE_URL;
  let testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    if (!devUrl) throw new Error('DATABASE_URL is not set (run "npm run db:start" once first)');
    const u = new URL(devUrl);
    if (!['localhost', '127.0.0.1', '::1'].includes(u.hostname)) {
      throw new Error(
        'Refusing to derive a test database from a non-local DATABASE_URL; set TEST_DATABASE_URL',
      );
    }
    u.pathname = `${u.pathname.replace(/^\//, '')}_test`;
    testUrl = u.toString();
  }

  Object.assign(process.env, TEST_ENV, { DATABASE_URL: testUrl });
  const opts = { cwd: API_DIR, env: process.env, stdio: 'pipe' as const };
  const node = process.execPath;
  const prismaCli = require.resolve('prisma/build/index.js', { paths: [API_DIR] });

  // Starts the embedded server if needed and creates the test database if missing.
  execFileSync(node, [path.join(ROOT, 'scripts', 'embedded-db.mjs'), 'start'], opts);
  execFileSync(node, [prismaCli, 'migrate', 'deploy'], opts);
  execFileSync(node, [require.resolve('tsx/cli', { paths: [API_DIR] }), 'prisma/seed.ts'], opts);
}
