import type { HealthResponse, SessionResponse } from '@finance-close/shared';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ---------------------------------------------------------------------------
// Session: the access token lives only in memory (never localStorage). The refresh token
// is an httpOnly cookie the browser sends to /api/auth/* automatically.
// ---------------------------------------------------------------------------

let accessToken: string | null = null;
let onSessionChange: ((s: SessionResponse | null) => void) | null = null;
let refreshInFlight: Promise<SessionResponse | null> | null = null;

export function setSession(session: SessionResponse | null): void {
  accessToken = session?.accessToken ?? null;
  onSessionChange?.(session);
}

/** The auth provider subscribes here so background refreshes update the UI. */
export function subscribeSession(fn: (s: SessionResponse | null) => void): () => void {
  onSessionChange = fn;
  return () => {
    if (onSessionChange === fn) onSessionChange = null;
  };
}

/**
 * Exchanges the refresh cookie for a new session. Concurrent callers share one request —
 * the refresh token rotates, so two parallel refreshes would end the session.
 */
export function refreshSession(): Promise<SessionResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const session = res.ok ? ((await res.json()) as SessionResponse) : null;
      setSession(session);
      return session;
    } catch {
      return null; // network error: keep current state, caller decides
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'same-origin' });
}

/** JSON in/out. On an expired access token, refreshes once and retries. Throws ApiError. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await send(path, init);
  if (res.status === 401 && accessToken && !path.startsWith('/auth/')) {
    if (await refreshSession()) res = await send(path, init);
  }
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const b = (typeof body === 'object' && body !== null ? body : {}) as {
      message?: unknown;
      code?: unknown;
    };
    const message =
      typeof b.message === 'string'
        ? b.message
        : `Request failed (${res.status} ${res.statusText})`;
    const err = new ApiError(
      message,
      res.status,
      typeof b.code === 'string' ? b.code : undefined,
      body,
    );
    // The session ended on the server (deactivated, password reset elsewhere): sign out here.
    if (res.status === 401 && !path.startsWith('/auth/login')) setSession(null);
    throw err;
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T = void>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};

/** Human-readable message for any error thrown by the API client. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return 'Could not reach the server. Check that the app is running.';
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/**
 * Health is special: a 503 still carries a meaningful {status, db} body, so return it
 * instead of throwing. Network failures (API down) still throw.
 */
export async function getHealth(): Promise<HealthResponse> {
  try {
    return await apiFetch<HealthResponse>('/health');
  } catch (err) {
    if (err instanceof ApiError && err.status === 503 && isHealthResponse(err.body))
      return err.body;
    throw err;
  }
}

function isHealthResponse(v: unknown): v is HealthResponse {
  return typeof v === 'object' && v !== null && 'status' in v && 'db' in v;
}
