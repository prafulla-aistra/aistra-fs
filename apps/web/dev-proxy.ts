import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import {
  ApiErrorCode,
  PROXY_UNAVAILABLE_HEADER,
  SERVER_UNREACHABLE_MESSAGE,
} from '@finance-close/shared';

/**
 * Error handler for the Vite dev proxy (/api → the API on port 3000).
 *
 * Without it, Vite answers a refused connection (API not started yet, or restarting after a
 * code change) with a bare "500 Internal Server Error" and an empty body — which the web app
 * could only show as "Request failed (500 …)". Instead, answer 503 with the usual
 * { statusCode, code, message } body and a marker header telling the web app the request
 * never reached the API, so it is safe to retry.
 *
 * Registered through `configure`, which Vite runs before adding its own handler; ours
 * responds first and Vite then sees the response is already sent.
 */
export function handleProxyError(
  err: Error,
  _req: IncomingMessage,
  res: ServerResponse | Socket | undefined,
): void {
  if (!res || !('writeHead' in res)) {
    res?.destroy(); // WebSocket upgrade: nothing to answer with
    return;
  }
  if (res.headersSent || res.writableEnded) return;
  const body = JSON.stringify({
    statusCode: 503,
    code: ApiErrorCode.ApiUnavailable,
    message: SERVER_UNREACHABLE_MESSAGE,
    detail: (err as NodeJS.ErrnoException).code ?? err.message,
  });
  res.writeHead(503, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    [PROXY_UNAVAILABLE_HEADER]: 'api-unavailable',
  });
  res.end(body);
}
