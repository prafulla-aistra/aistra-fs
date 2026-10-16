#!/usr/bin/env node
/**
 * First step of `npm run dev`: make sure the ports are free before starting anything.
 *
 * If Finance Close is already running (another terminal, or a window left open before the
 * laptop slept), starting a second copy would fail half-way with confusing errors. Say so
 * clearly instead.
 */
import http from 'node:http';
import net from 'node:net';

// WEB_PORT can be set in apps/web/.env (Vite reads the same file).
try {
  process.loadEnvFile('apps/web/.env');
} catch {
  // no apps/web/.env: defaults apply
}
const WEB_PORT = Number(process.env.WEB_PORT) || 5173;

const PORTS = [
  { port: 3000, name: 'API' },
  { port: WEB_PORT, name: 'web app' },
];

function inUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(1500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

/** Plain node:http (no fetch/keep-alive) so the script can end cleanly on Windows. */
function isFinanceClose() {
  return new Promise((resolve) => {
    const req = http.get(
      'http://localhost:3000/api/health',
      { agent: false, timeout: 3000 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve('db' in JSON.parse(body));
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

const busy = [];
for (const p of PORTS) if (await inUse(p.port)) busy.push(p);

if (busy.length > 0) {
  console.error('');
  if (await isFinanceClose()) {
    console.error(`  Finance Close is already running. Open http://localhost:${WEB_PORT}`);
    console.error(
      '  (To restart it, press Ctrl+C in the window where it runs, then run "npm run dev" again.)',
    );
  } else {
    for (const p of busy) {
      console.error(
        `  Port ${p.port} (needed by the ${p.name}) is already used by another program.`,
      );
    }
    console.error('  Close that program, or restart the laptop, and run "npm run dev" again.');
  }
  console.error('');
  process.exitCode = 1; // let the script finish on its own (see dev-ready.mjs)
}
