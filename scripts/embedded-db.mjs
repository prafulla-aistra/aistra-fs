#!/usr/bin/env node
/**
 * Local embedded PostgreSQL 16 — no Docker, no installation, no admin rights.
 *
 *   node scripts/embedded-db.mjs start    create (first time) and start the server; idempotent
 *   node scripts/embedded-db.mjs stop     stop it
 *   node scripts/embedded-db.mjs status   show whether it is running
 *
 * The PostgreSQL binaries come from the `embedded-postgres` npm package. Data lives in
 * ./data/db (git-ignored); the server log is ./data/db.log.
 *
 * Which server the app uses is decided ONLY by DATABASE_URL in apps/api/.env. When it
 * points at localhost, `start` runs the embedded server on that port with those credentials.
 * When it points anywhere else (e.g. AWS RDS), this script does nothing.
 *
 * The server keeps running in the background after `npm run dev` stops (like the old
 * Docker container); `npm run db:stop` stops it. `npm run dev` starts it again if needed.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data', 'db');
const LOG_FILE = path.join(ROOT, 'data', 'db.log');
const API_ENV = path.join(ROOT, 'apps', 'api', '.env');
const API_ENV_EXAMPLE = path.join(ROOT, 'apps', 'api', '.env.example');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function log(msg) {
  console.log(`[db] ${msg}`);
}

function fail(msg) {
  console.error(`[db] ERROR: ${msg}`);
  process.exit(1);
}

/**
 * Creates apps/api/.env from the example on first run, and on later runs appends any
 * settings added to the example since (so pulling a new step needs no manual edits).
 * Empty *_SECRET values are filled with a random secret generated on this machine.
 */
function ensureEnvFile() {
  const created = !existsSync(API_ENV);
  if (created) copyFileSync(API_ENV_EXAMPLE, API_ENV);

  const current = readFileSync(API_ENV, 'utf8');
  const present = new Set(parseKeys(current).map(([k]) => k));
  let text = current;
  const added = [];
  for (const [key, value] of parseKeys(readFileSync(API_ENV_EXAMPLE, 'utf8'))) {
    if (!present.has(key)) {
      text += `${text.endsWith('\n') ? '' : '\n'}${key}=${value}\n`;
      added.push(key);
    }
  }
  text = text.replace(/^([A-Z0-9_]*_SECRET)=[ \t]*\r?$/gm, (_, key) => {
    added.push(`${key} (generated)`);
    return `${key}=${randomBytes(48).toString('base64url')}`;
  });
  if (text !== current) writeFileSync(API_ENV, text);

  if (created) log('Created apps/api/.env from apps/api/.env.example');
  if (added.length > 0) log(`Updated apps/api/.env: ${added.join(', ')}`);
}

function parseKeys(text) {
  return [...text.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map((m) => [m[1], m[2]]);
}

function readTarget() {
  ensureEnvFile();
  process.loadEnvFile(API_ENV); // does not override variables already set in the shell
  const raw = process.env.DATABASE_URL;
  if (!raw) fail('DATABASE_URL is not set in apps/api/.env');
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('DATABASE_URL in apps/api/.env is not a valid URL');
  }
  return {
    local: LOCAL_HOSTS.has(url.hostname),
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username || 'postgres'),
    password: decodeURIComponent(url.password || ''),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres',
  };
}

async function binaries() {
  const platform = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
  const pkg = `@embedded-postgres/${platform}-${os.arch()}`;
  try {
    return await import(pkg); // { initdb, pg_ctl, postgres } absolute paths
  } catch {
    fail(
      `No embedded PostgreSQL build for ${process.platform}/${os.arch()} (${pkg}). Run "npm install".`,
    );
  }
}

function run(bin, args, { background = false } = {}) {
  // Starting the server: stdio "ignore", because on Windows the background server would
  // otherwise inherit our pipes and keep this script (and npm run dev) from ever continuing.
  const res = spawnSync(bin, args, { stdio: background ? 'ignore' : 'inherit', windowsHide: true });
  if (res.error) fail(`Could not run ${path.basename(bin)}: ${res.error.message}`);
  return res.status ?? 1;
}

async function canConnect(t, database = 'postgres') {
  const client = new pg.Client({ ...t, database, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function initialise(t, bin) {
  if (!t.password) fail('DATABASE_URL must include a password for the embedded server');
  log(`First run: creating the database cluster in ${DATA_DIR} (takes up to a minute)…`);
  mkdirSync(DATA_DIR, { recursive: true });
  const pwFile = path.join(ROOT, 'data', `.pw-${process.pid}`);
  writeFileSync(pwFile, t.password, { mode: 0o600 });
  try {
    const status = run(bin.initdb, [
      '-D',
      DATA_DIR,
      '-U',
      t.user,
      `--pwfile=${pwFile}`,
      '--auth=scram-sha-256',
      '--encoding=UTF8',
      '--locale=C',
      '--data-checksums', // detect on-disk corruption
    ]);
    if (status !== 0) {
      rmSync(DATA_DIR, { recursive: true, force: true });
      fail('initdb failed (see above). The half-created data/db folder was removed.');
    }
  } finally {
    rmSync(pwFile, { force: true });
  }
}

async function ensureDatabase(t) {
  const client = new pg.Client({ ...t, database: 'postgres' });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      t.database,
    ]);
    if (rowCount === 0) {
      await client.query(`CREATE DATABASE "${t.database.replace(/"/g, '""')}"`);
      log(`Created database "${t.database}"`);
    }
  } finally {
    await client.end();
  }
}

async function start() {
  const t = readTarget();
  if (!t.local) {
    log(`DATABASE_URL points at ${t.host} — using that server; embedded PostgreSQL not started.`);
    return;
  }
  if (await canConnect(t)) {
    log(`PostgreSQL already running on localhost:${t.port}`);
  } else {
    const bin = await binaries();
    if (!existsSync(path.join(DATA_DIR, 'PG_VERSION'))) await initialise(t, bin);
    log(`Starting embedded PostgreSQL 16 on localhost:${t.port}…`);
    const status = run(
      bin.pg_ctl,
      [
        'start',
        '-D',
        DATA_DIR,
        '-l',
        LOG_FILE,
        '-o',
        `-p ${t.port} -c listen_addresses=localhost`,
        '-w',
        '-t',
        '120',
      ],
      { background: true },
    );
    if (status !== 0 || !(await canConnect(t))) {
      fail(
        `PostgreSQL did not start. See ${LOG_FILE}. ` +
          `If another program uses port ${t.port}, change the port in DATABASE_URL (apps/api/.env).`,
      );
    }
    log('PostgreSQL is running.');
  }
  await ensureDatabase(t);
}

async function stop() {
  const t = readTarget();
  if (!t.local || !existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
    log('No embedded PostgreSQL to stop.');
    return;
  }
  const bin = await binaries();
  const status = run(bin.pg_ctl, ['stop', '-D', DATA_DIR, '-m', 'fast', '-w', '-t', '60']);
  log(status === 0 ? 'PostgreSQL stopped.' : 'PostgreSQL was not running.');
}

async function status() {
  const t = readTarget();
  if (!t.local) return log(`Using external PostgreSQL at ${t.host}:${t.port}`);
  log(
    (await canConnect(t))
      ? `Running on localhost:${t.port} (data: ${DATA_DIR})`
      : `Not running (start it with "npm run db:start" or "npm run dev")`,
  );
}

const commands = { start, stop, status };
const cmd = process.argv[2];
if (!commands[cmd])
  fail(`Usage: node scripts/embedded-db.mjs <${Object.keys(commands).join('|')}>`);
await commands[cmd]();
