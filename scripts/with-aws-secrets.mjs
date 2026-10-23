#!/usr/bin/env node
/**
 * Runs a command with secrets loaded from AWS Secrets Manager into its environment, so no
 * password or key is stored in a file on the server.
 *
 *   node scripts/with-aws-secrets.mjs node apps/api/dist/main.js        (the API service)
 *   node scripts/with-aws-secrets.mjs npm run db:migrate:deploy        (migrations, seed, ...)
 *
 * Settings (plain environment variables, none of them secret):
 *   APP_SECRET_ARN  a JSON secret; every key becomes an environment variable
 *                   (JWT_SECRET, MASTER_PASSWORD, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ...)
 *   DB_SECRET_ARN   an RDS-managed secret ({ username, password }); DATABASE_URL is built from
 *                   it with DB_HOST, DB_NAME, DB_PORT (5432) and DB_SSLMODE (require)
 *
 * Credentials come from the default AWS chain (the EC2 instance role on the server). With
 * neither ARN set the command just runs (local development is unchanged). Any failure to read
 * a secret stops with a message instead of starting the command half configured.
 */
import { spawn } from 'node:child_process';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: node scripts/with-aws-secrets.mjs <command> [args...]');
  process.exit(2);
}

/** Region from the ARN (arn:aws:secretsmanager:<region>:...). */
function regionOf(arn) {
  const region = arn.split(':')[3];
  if (!region) throw new Error(`not a Secrets Manager ARN: ${arn}`);
  return region;
}

async function readJsonSecret(name, arn) {
  try {
    const client = new SecretsManagerClient({ region: regionOf(arn) });
    const res = await client.send(new GetSecretValueCommand({ SecretId: arn }));
    const value = JSON.parse(res.SecretString ?? '');
    if (!value || typeof value !== 'object') throw new Error('not a JSON object');
    return value;
  } catch (err) {
    throw new Error(`Cannot read ${name} (${arn}): ${err instanceof Error ? err.message : err}`);
  }
}

async function loadSecrets() {
  const env = {};
  const appArn = process.env.APP_SECRET_ARN?.trim();
  if (appArn) {
    const app = await readJsonSecret('APP_SECRET_ARN', appArn);
    for (const [key, value] of Object.entries(app)) {
      if (typeof value === 'string') env[key] = value;
    }
  }
  const dbArn = process.env.DB_SECRET_ARN?.trim();
  if (dbArn) {
    const { username, password } = await readJsonSecret('DB_SECRET_ARN', dbArn);
    const host = process.env.DB_HOST?.trim();
    const name = process.env.DB_NAME?.trim();
    if (!username || !password) throw new Error('DB_SECRET_ARN: username / password missing');
    if (!host || !name) throw new Error('DB_SECRET_ARN needs DB_HOST and DB_NAME');
    const port = process.env.DB_PORT?.trim() || '5432';
    const sslmode = process.env.DB_SSLMODE?.trim() || 'require';
    env.DATABASE_URL =
      `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}` +
      `@${host}:${port}/${encodeURIComponent(name)}?sslmode=${encodeURIComponent(sslmode)}`;
  }
  return env;
}

let secrets;
try {
  secrets = await loadSecrets();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
if (Object.keys(secrets).length > 0) {
  console.log(`[secrets] loaded from AWS Secrets Manager: ${Object.keys(secrets).sort().join(', ')}`);
}

const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...secrets } });
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (err) => {
  console.error(`Cannot start ${command}: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
