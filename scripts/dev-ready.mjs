#!/usr/bin/env node
/**
 * Runs alongside the API and web app in `npm run dev`. Prints one clear line once both are
 * actually answering, so nobody signs in during the ~30 s the API needs to start.
 *
 * It must never stop the app: it always ends with exit code 0, and it ends by simply
 * finishing — no process.exit(), and plain node:http without keep-alive, because on Windows
 * exiting while fetch() connections are still closing crashes Node (libuv assertion), and
 * `concurrently --kill-others-on-fail` would then stop everything.
 */
import http from 'node:http';

// WEB_PORT can be set in apps/web/.env (Vite reads the same file).
try {
  process.loadEnvFile('apps/web/.env');
} catch {
  // no apps/web/.env: defaults apply
}
const WEB_PORT = Number(process.env.WEB_PORT) || 5173;

const TIMEOUT_MS = 3 * 60_000;

function get(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { agent: false, timeout: 3000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

async function apiReady() {
  const res = await get('http://localhost:3000/api/health');
  try {
    return res.status === 200 && JSON.parse(res.body).db === 'ok';
  } catch {
    return false;
  }
}

async function webReady() {
  return (await get(`http://localhost:${WEB_PORT}/`)).status === 200;
}

async function main() {
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    if ((await apiReady()) && (await webReady())) {
      const secs = Math.round((Date.now() - started) / 1000);
      console.log('');
      console.log('  ==============================================================');
      console.log(`   Finance Close is ready (${secs}s). Open http://localhost:${WEB_PORT}`);
      console.log('  ==============================================================');
      console.log('');
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log('');
  console.log(
    '  Finance Close has not answered after 3 minutes. Look above for errors from [api] or [web].',
  );
  console.log('');
}

main().catch((err) =>
  console.log(`  (startup check stopped: ${err instanceof Error ? err.message : err})`),
);
