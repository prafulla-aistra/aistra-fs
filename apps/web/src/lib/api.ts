import type { HealthResponse } from '@finance-close/shared';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Thin fetch wrapper: JSON in/out, throws ApiError on non-2xx. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  });
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) throw new ApiError(`API ${res.status} ${res.statusText}`, res.status, body);
  return body as T;
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
