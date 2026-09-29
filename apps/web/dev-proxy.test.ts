import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Regression test for "Logging in shows Request failed (500 Internal Server Error)".
 * Cause: the API was restarting (or not started yet) and the Vite proxy turned the refused
 * connection into a bare 500. Runs the real Vite dev server with the real config.
 */
async function startVite(apiTarget: string): Promise<{ vite: ViteDevServer; url: string }> {
  process.env.API_PROXY_TARGET = apiTarget;
  const vite = await createServer({
    configFile: path.resolve(__dirname, 'vite.config.ts'),
    root: __dirname,
    logLevel: 'silent',
    server: { port: 0, strictPort: false },
  });
  await vite.listen();
  const port = (vite.httpServer!.address() as AddressInfo).port;
  return { vite, url: `http://localhost:${port}` };
}

describe('dev proxy when the API is not running', () => {
  let vite: ViteDevServer;
  let url: string;

  beforeAll(async () => {
    // Port 1 on localhost: nothing listens there, so the connection is refused.
    ({ vite, url } = await startVite('http://127.0.0.1:1'));
  });
  afterAll(() => vite?.close());

  it('answers login with 503 "Can\'t reach the server", not a bare 500', async () => {
    const res = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com', password: 'whatever123' }),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get('x-finance-close-proxy')).toBe('api-unavailable');
    expect(await res.json()).toMatchObject({
      statusCode: 503,
      code: 'API_UNAVAILABLE',
      message: "Can't reach the server. Check the app is running.",
    });
  });
});

describe('dev proxy when the API is running', () => {
  let vite: ViteDevServer;
  let api: Server;
  let url: string;

  beforeAll(async () => {
    api = createHttpServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reached: req.url }));
    });
    await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
    ({ vite, url } = await startVite(`http://127.0.0.1:${(api.address() as AddressInfo).port}`));
  });
  afterAll(async () => {
    await vite?.close();
    api?.close();
  });

  it('passes requests through unchanged', async () => {
    const res = await fetch(`${url}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reached: '/api/health' });
  });
});
