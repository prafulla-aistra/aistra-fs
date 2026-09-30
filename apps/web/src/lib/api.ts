import {
  ApiErrorCode,
  PROXY_UNAVAILABLE_HEADER,
  SERVER_UNREACHABLE_MESSAGE,
  type HealthResponse,
  type SessionResponse,
} from '@finance-close/shared';

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

/** No answer from the API at all (not started, restarting, stopped, or network down). */
export class ServerUnreachableError extends ApiError {
  constructor() {
    super(SERVER_UNREACHABLE_MESSAGE, 503, ApiErrorCode.ApiUnavailable, undefined);
    this.name = 'ServerUnreachableError';
  }
}

// ---------------------------------------------------------------------------
// Transport: retry while the API is briefly unreachable
// ---------------------------------------------------------------------------

/**
 * The API restarts for a few seconds whenever its code changes, and takes up to ~30 s to
 * start after `npm run dev`. A request that never reached it (connection refused, reported by
 * the dev proxy with a marker header, or a network error) is safe to retry — even a POST —
 * so keep trying for a while before telling the user the server is unreachable.
 */
const RETRY_WINDOW_MS = 20_000;

function neverReachedApi(res: Response): boolean {
  return res.status === 503 && res.headers.get(PROXY_UNAVAILABLE_HEADER) === 'api-unavailable';
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const deadline = Date.now() + RETRY_WINDOW_MS;
  let delay = 400;
  for (;;) {
    try {
      const res = await fetch(url, init);
      if (!neverReachedApi(res)) return res;
    } catch (err) {
      if (!(err instanceof TypeError)) throw err; // TypeError = network failure
    }
    if (Date.now() + delay > deadline) throw new ServerUnreachableError();
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 3000);
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
 * Exchanges the refresh cookie for a new session; null if there is no valid session.
 * Throws ServerUnreachableError (and leaves the current session alone) if the server
 * cannot be reached — being unable to ask is not the same as being signed out.
 * Concurrent callers share one request: the refresh token rotates, so two parallel
 * refreshes would end the session.
 */
export function refreshSession(): Promise<SessionResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetchWithRetry(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (res.status >= 500) throw new ServerUnreachableError();
      const session = res.ok ? ((await res.json()) as SessionResponse) : null;
      setSession(session);
      return session;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  // FormData sets its own multipart Content-Type (with the boundary).
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  return fetchWithRetry(`${API_BASE}${path}`, { ...init, headers, credentials: 'same-origin' });
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
    // Our API always answers with a JSON { code, message }. A server error without one came
    // from something in between (proxy, gateway), so the API itself was not reachable.
    if (typeof b.message !== 'string' && res.status >= 500) throw new ServerUnreachableError();
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
  /** Multipart upload of one file, as the form field "file". */
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiFetch<T>(path, { method: 'POST', body: form });
  },
};

/** Downloads an uploaded file (authenticated) and hands it to the browser as a download. */
export function downloadFile(fileId: string, name: string): Promise<void> {
  return downloadPath(`/files/${fileId}/download`, name);
}

/** Downloads any API file (e.g. an Excel export) with the session and saves it as `name`. */
export async function downloadPath(path: string, name: string): Promise<void> {
  let res = await send(path, {});
  if (res.status === 401 && (await refreshSession())) res = await send(path, {});
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(body.message ?? 'Download failed.', res.status, undefined, body);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Human-readable message for any error thrown by the API client. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return SERVER_UNREACHABLE_MESSAGE;
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
